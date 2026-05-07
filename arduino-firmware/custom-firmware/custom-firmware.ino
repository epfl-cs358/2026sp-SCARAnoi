/*
  SCARAnoi Custom RAMPS 1.4 Firmware
  Board: Arduino Mega 2560 + RAMPS 1.4
  Drivers: A4988
  Motors:
    RAMPS X driver = SCARA shoulder joint motor
    RAMPS Y driver = SCARA elbow / platform joint motor
    RAMPS Z driver = vertical Z axis
    RAMPS E0 driver = wrist / gripper rotation axis

  This is NOT Marlin.
  It implements a small Marlin-like command set for manual robot control.

  Supported commands:
    G0/G1 X.. Y.. Z.. E.. F..   Move. X/Y are Cartesian mm. Z is mm. E is degrees.
    G28 [X] [Y] [Z]             Home enabled axes. E has no homing by default.
    G90                         Absolute positioning
    G91                         Relative positioning
    G92 X.. Y.. Z.. E..         Set current logical position
    M17                         Enable all motors
    M17 X / M17 Y / M17 Z / M17 E Enable selected motors only
    M18 / M84                   Disable all motors
    M18 X / M18 Y / M18 Z / M18 E Disable selected motors only
    M112                        Emergency stop, checked even during motion
    M119                        Report endstop states
    M114                        Report current position
    M211 S0/S1                  Disable/enable software limits
    M280 P0 Sangle              Move servo gripper to angle
    M281 Oangle Cangle          Set gripper open/close angles in RAM only
    M282 P0                     Detach servo
    M360 X.. Y.. Z.. E.. F..    Raw motor move. X/Y/E are degrees, Z is mm. No SCARA IK.
    M503                        Report main settings
    M999                        Clear emergency stop

  Important:
    - X/Y G-code targets are converted to SCARA joint angles inside the firmware.
    - The firmware uses INPUT_PULLUP for endstops.
    - For a normally-open switch wired between signal and GND, triggered = LOW.
*/

#include <Arduino.h>
#include <Servo.h>
#include <math.h>

// ================================================================
// ========================= USER SETTINGS =========================
// ================================================================

// Serial speed. This matches your old Marlin config.
static const long BAUDRATE = 250000;

// ------------------------- RAMPS 1.4 pins ------------------------
// Standard RAMPS 1.4 pin mapping for Arduino Mega.
static const uint8_t X_STEP_PIN = 54;
static const uint8_t X_DIR_PIN  = 55;
static const uint8_t X_EN_PIN   = 38;

static const uint8_t Y_STEP_PIN = 60;
static const uint8_t Y_DIR_PIN  = 61;
static const uint8_t Y_EN_PIN   = 56;

static const uint8_t Z_STEP_PIN = 46;
static const uint8_t Z_DIR_PIN  = 48;
static const uint8_t Z_EN_PIN   = 62;

static const uint8_t E_STEP_PIN = 26;
static const uint8_t E_DIR_PIN  = 28;
static const uint8_t E_EN_PIN   = 24;

// Endstop pins on RAMPS.
static const uint8_t X_MIN_PIN = 3;
static const uint8_t X_MAX_PIN = 2;
static const uint8_t Y_MIN_PIN = 14;
static const uint8_t Y_MAX_PIN = 15;
static const uint8_t Z_MIN_PIN = 18;
static const uint8_t Z_MAX_PIN = 19;

// RAMPS servo header.
// Servo 0 is usually D11 on RAMPS 1.4.
static uint8_t SERVO_GRIPPER_PIN = 11;

// ------------------------- Motor logic ---------------------------
// A4988 enable is active LOW on RAMPS.
static const bool ENABLE_ACTIVE_LOW = true;

// Direction inversion. Change these if an axis moves the wrong way.
static bool INVERT_SHOULDER_DIR = false;  // RAMPS X driver
static bool INVERT_ELBOW_DIR    = false;  // RAMPS Y driver
static bool INVERT_Z_DIR        = false;   // from your old Marlin config
static bool INVERT_E_DIR        = false;  // wrist rotation

// ------------------------- Steps per unit ------------------------
// From your previous Marlin config:
//   { 88.8889, 35.5556, 400, 35.5556 }
// Here X/Y become SCARA joint degrees.
static float SHOULDER_STEPS_PER_DEG = 70.55;
static float ELBOW_STEPS_PER_DEG    = 25.18;
static float Z_STEPS_PER_MM         = 400.0f;
static float E_STEPS_PER_DEG        = 25.18;

// ------------------------- Speed limits --------------------------
// Conservative defaults. Increase only after testing.
static float MAX_SHOULDER_DEG_S = 60.0f;
static float MAX_ELBOW_DEG_S    = 120.0f;
static float MAX_Z_MM_S         = 100.0f;
static float MAX_E_DEG_S        = 180.0f;

// Minimum delay between coordinated step ticks.
// Larger = slower but safer for A4988 and mechanical testing.
static unsigned long MIN_STEP_TICK_US = 100;

// ------------------------- Acceleration --------------------------
// Simple trapezoidal acceleration profile.
// This only changes the delay between steps during a move.
static bool USE_ACCELERATION = true;

// Fraction of the move used for acceleration and deceleration.
// 0.20 means first 20% accelerates and last 20% decelerates.
static float ACCELERATION_PORTION = 0.10f;

// Start/end delay multiplier.
// 3.0 means the move starts and ends 3x slower than the target speed.
static float START_SPEED_FACTOR = 3.0f;

// Step pulse width for A4988.
// 3-5 us is normally safe.
static const unsigned int STEP_PULSE_US = 4;

// ------------------------- SCARA geometry ------------------------
// From your old Marlin config.
static float LINK_1_MM = 185.412f;
static float LINK_2_MM = 111.000f;

// Offset of the SCARA base/tower in Cartesian coordinates.
static float SCARA_OFFSET_X = 0.0f;
static float SCARA_OFFSET_Y = 0.0f;

// Joint angle offsets in degrees.
// Use these if the mathematical zero angle does not match your physical zero.
static float SHOULDER_OFFSET_DEG = 0.0f;
static float ELBOW_OFFSET_DEG    = 0.0f;

// Elbow configuration.
// +1 and -1 choose the two possible IK solutions.
// If the arm bends the wrong way, switch this.
static int SCARA_ELBOW_SIGN = -1;

// Split long Cartesian moves into small segments.
// Smaller = closer to straight XY path, but more computation.
static float CARTESIAN_SEGMENT_MM = 2.0f;

// ------------------------- Work limits ---------------------------
// Defaults based on your old Marlin file.
// You can tune these later.
static float X_MIN_MM = -(185.412f + 111.000f);
static float X_MAX_MM = 295.0f;
static float Y_MIN_MM = 0.0f;
static float Y_MAX_MM = 295.0f;
static float Z_MIN_MM = 0.0f;
static float Z_MAX_MM = 250.0f;
static float E_MIN_DEG = -180.0f;
static float E_MAX_DEG = 180.0f;

// Reach limits.
static float FORBIDDEN_RADIUS_MM = 35.0f;

// Software limits can be toggled with M211.
static bool SOFTWARE_LIMITS_ENABLED = false;

// ------------------------- Endstops ------------------------------
// Enable/disable each plug here.
// Since some of yours are connected but broken, keep them easy to disable.
static bool USE_X_MIN_ENDSTOP = true;
static bool USE_X_MAX_ENDSTOP = true;

static bool USE_Y_MIN_ENDSTOP = true;
static bool USE_Y_MAX_ENDSTOP = true;

static bool USE_Z_MIN_ENDSTOP = true;
static bool USE_Z_MAX_ENDSTOP = true;

// For normally-open switch wired between signal and GND with INPUT_PULLUP:
// triggered = LOW.
static bool ENDSTOP_TRIGGERED_STATE_LOW = true;

// During normal movement, abort if an enabled endstop is triggered.
// For debugging broken endstops, set this false.
static bool HARD_ENDSTOP_ABORT_ON_TRIGGER = true;

// ------------------------- Homing -----------------------------M360
static int SHOULDER_HOME_DIR = -1;
static int ELBOW_HOME_DIR    = -1;
static int Z_HOME_DIR        = -1;

// Position assigned after homing.
// These are important because they define where the robot thinks it is.
// Defaults chosen to match your old Marlin home position:
//   X = -(L1 + L2), Y = 0
// which corresponds roughly to shoulder = 180°, elbow = 0°.
static float SHOULDER_HOME_DEG = -87.0f;
static float ELBOW_HOME_DEG    = -137.0f;
static float Z_HOME_MM         = 0.0f;

// Homing speeds.
static float SHOULDER_HOME_DEG_S = 40.0f;
static float ELBOW_HOME_DEG_S    = 40.0f;
static float Z_HOME_MM_S         = 5.0f;

// Homing travel limits.
// If no endstop triggers after this much movement, homing fails.
static float SHOULDER_HOME_MAX_TRAVEL_DEG = 260.0f;
static float ELBOW_HOME_MAX_TRAVEL_DEG    = 260.0f;
static float Z_HOME_MAX_TRAVEL_MM         = 300.0f;

// Backoff after endstop trigger.
static float SHOULDER_HOME_BACKOFF_DEG = 3.0f;
static float ELBOW_HOME_BACKOFF_DEG    = 3.0f;
static float Z_HOME_BACKOFF_MM         = 3.0f;

// ------------------------- Servo gripper -------------------------
static int SERVO_OPEN_ANGLE  = 20;
static int SERVO_CLOSE_ANGLE = 90;
static int SERVO_MIN_ANGLE   = 0;
static int SERVO_MAX_ANGLE   = 180;

// ================================================================
// ======================= INTERNAL STATE ==========================
// ================================================================

struct AxisPins {
  uint8_t stepPin;
  uint8_t dirPin;
  uint8_t enPin;
  bool invertDir;
};

AxisPins shoulderAxis = { X_STEP_PIN, X_DIR_PIN, X_EN_PIN, false };
AxisPins elbowAxis    = { Y_STEP_PIN, Y_DIR_PIN, Y_EN_PIN, false };
AxisPins zAxis        = { Z_STEP_PIN, Z_DIR_PIN, Z_EN_PIN, true  };
AxisPins eAxis        = { E_STEP_PIN, E_DIR_PIN, E_EN_PIN, false };

struct Position {
  float x;
  float y;
  float z;
  float e;
  float shoulderDeg;
  float elbowDeg;
};

Position current = {
  -(185.412f + 111.000f), 0.0f, 0.0f, 0.0f,
  180.0f, 0.0f
};

long shoulderSteps = 0;
long elbowSteps = 0;
long zSteps = 0;
long eSteps = 0;

bool absoluteMode = true;
bool motorsEnabled = false;
bool shoulderMotorEnabled = false;
bool elbowMotorEnabled = false;
bool zMotorEnabled = false;
bool eMotorEnabled = false;
bool emergencyStopped = false;

static const int MAX_CMD_LENGTH = 127;
char inputLine[MAX_CMD_LENGTH + 1];
int inputPos = 0;

char emergencyBuffer[16];
int emergencyPos = 0;

Servo gripperServo;
bool gripperAttached = false;

// ================================================================
// ======================= UTILITY HELPERS =========================
// ================================================================

float degToRad(float deg) {
  return deg * PI / 180.0f;
}

float radToDeg(float rad) {
  return rad * 180.0f / PI;
}

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

bool approximatelyZero(float v) {
  return fabs(v) < 0.0001f;
}

void printOk() {
  Serial.println(F("ok"));
}

void printError(const __FlashStringHelper *msg) {
  Serial.print(F("error: "));
  Serial.println(msg);
}

void updateGlobalMotorState() {
  motorsEnabled = shoulderMotorEnabled || elbowMotorEnabled || zMotorEnabled || eMotorEnabled;
}

void enableMotorByLetter(char axis) {
  uint8_t active = ENABLE_ACTIVE_LOW ? LOW : HIGH;

  if (axis == 'X') {
    digitalWrite(X_EN_PIN, active);
    shoulderMotorEnabled = true;
  } else if (axis == 'Y') {
    digitalWrite(Y_EN_PIN, active);
    elbowMotorEnabled = true;
  } else if (axis == 'Z') {
    digitalWrite(Z_EN_PIN, active);
    zMotorEnabled = true;
  } else if (axis == 'E') {
    digitalWrite(E_EN_PIN, active);
    eMotorEnabled = true;
  }

  updateGlobalMotorState();
}

void disableMotorByLetter(char axis) {
  uint8_t inactive = ENABLE_ACTIVE_LOW ? HIGH : LOW;

  if (axis == 'X') {
    digitalWrite(X_EN_PIN, inactive);
    shoulderMotorEnabled = false;
  } else if (axis == 'Y') {
    digitalWrite(Y_EN_PIN, inactive);
    elbowMotorEnabled = false;
  } else if (axis == 'Z') {
    digitalWrite(Z_EN_PIN, inactive);
    zMotorEnabled = false;
  } else if (axis == 'E') {
    digitalWrite(E_EN_PIN, inactive);
    eMotorEnabled = false;
  }

  updateGlobalMotorState();
}

void enableMotors() {
  enableMotorByLetter('X');
  enableMotorByLetter('Y');
  enableMotorByLetter('Z');
  enableMotorByLetter('E');
}

void disableMotors() {
  disableMotorByLetter('X');
  disableMotorByLetter('Y');
  disableMotorByLetter('Z');
  disableMotorByLetter('E');
}

void enableMotorsFromCommand(const String &line) {
  bool hasAxis = hasParam(line, 'X') || hasParam(line, 'Y') || hasParam(line, 'Z') || hasParam(line, 'E');

  if (!hasAxis) {
    enableMotors();
    return;
  }

  if (hasParam(line, 'X')) enableMotorByLetter('X');
  if (hasParam(line, 'Y')) enableMotorByLetter('Y');
  if (hasParam(line, 'Z')) enableMotorByLetter('Z');
  if (hasParam(line, 'E')) enableMotorByLetter('E');
}

void disableMotorsFromCommand(const String &line) {
  bool hasAxis = hasParam(line, 'X') || hasParam(line, 'Y') || hasParam(line, 'Z') || hasParam(line, 'E');

  if (!hasAxis) {
    disableMotors();
    return;
  }

  if (hasParam(line, 'X')) disableMotorByLetter('X');
  if (hasParam(line, 'Y')) disableMotorByLetter('Y');
  if (hasParam(line, 'Z')) disableMotorByLetter('Z');
  if (hasParam(line, 'E')) disableMotorByLetter('E');
}

void setDirection(const AxisPins &axis, int dirSign) {
  bool positive = dirSign >= 0;
  bool level = positive ^ axis.invertDir;
  digitalWrite(axis.dirPin, level ? HIGH : LOW);
}

void stepAxis(const AxisPins &axis) {
  digitalWrite(axis.stepPin, HIGH);
  delayMicroseconds(STEP_PULSE_US);
  digitalWrite(axis.stepPin, LOW);
}

bool pinTriggered(uint8_t pin) {
  int value = digitalRead(pin);
  if (ENDSTOP_TRIGGERED_STATE_LOW) return value == LOW;
  return value == HIGH;
}

bool xMinTriggered() { return USE_X_MIN_ENDSTOP && pinTriggered(X_MIN_PIN); }
bool xMaxTriggered() { return USE_X_MAX_ENDSTOP && pinTriggered(X_MAX_PIN); }
bool yMinTriggered() { return USE_Y_MIN_ENDSTOP && pinTriggered(Y_MIN_PIN); }
bool yMaxTriggered() { return USE_Y_MAX_ENDSTOP && pinTriggered(Y_MAX_PIN); }
bool zMinTriggered() { return USE_Z_MIN_ENDSTOP && pinTriggered(Z_MIN_PIN); }
bool zMaxTriggered() { return USE_Z_MAX_ENDSTOP && pinTriggered(Z_MAX_PIN); }

bool anyEnabledEndstopTriggered() {
  return xMinTriggered() || xMaxTriggered() || yMinTriggered() || yMaxTriggered() || zMinTriggered() || zMaxTriggered();
}

void emergencyStop(const __FlashStringHelper *reason) {
  emergencyStopped = true;
  disableMotors();

  Serial.print(F("error: emergency stop"));
  if (reason) {
    Serial.print(F(" - "));
    Serial.print(reason);
  }
  Serial.println();
}

void updateStepCountersFromPosition() {
  shoulderSteps = lround(current.shoulderDeg * SHOULDER_STEPS_PER_DEG);
  elbowSteps    = lround(current.elbowDeg    * ELBOW_STEPS_PER_DEG);
  zSteps        = lround(current.z           * Z_STEPS_PER_MM);
  eSteps        = lround(current.e           * E_STEPS_PER_DEG);
}

void forwardKinematics(float shoulderDeg, float elbowDeg, float &x, float &y) {
  float theta = degToRad(shoulderDeg - SHOULDER_OFFSET_DEG);
  float psi   = degToRad(elbowDeg - ELBOW_OFFSET_DEG);

  y = SCARA_OFFSET_Y + LINK_1_MM * cos(theta) + LINK_2_MM * cos(theta + psi);
  x = SCARA_OFFSET_X + LINK_1_MM * sin(theta) + LINK_2_MM * sin(theta + psi);
}

bool inverseKinematics(float x, float y, float &shoulderDeg, float &elbowDeg) {
  float px = x - SCARA_OFFSET_X;
  float py = y - SCARA_OFFSET_Y;

  float r2 = px * px + py * py;
  float r = sqrt(r2);

  float maxReach = LINK_1_MM + LINK_2_MM;
  float minReach = fabs(LINK_1_MM - LINK_2_MM);

  if (r > maxReach + 0.001f) return false;
  if (r < minReach - 0.001f) return false;
  if (r < FORBIDDEN_RADIUS_MM) return false;

  float c2 = (r2 - LINK_1_MM * LINK_1_MM - LINK_2_MM * LINK_2_MM) / (2.0f * LINK_1_MM * LINK_2_MM);
  c2 = clampFloat(c2, -1.0f, 1.0f);

  float s2 = SCARA_ELBOW_SIGN * sqrt(max(0.0f, 1.0f - c2 * c2));
  float psi = atan2(s2, c2);

  float theta = atan2(px, py) - atan2(LINK_2_MM * s2, LINK_1_MM + LINK_2_MM * c2);

  shoulderDeg = radToDeg(theta) + SHOULDER_OFFSET_DEG;
  elbowDeg = radToDeg(psi) + ELBOW_OFFSET_DEG;

  return true;
}

bool checkLogicalLimits(float x, float y, float z, float e) {
  if (!SOFTWARE_LIMITS_ENABLED) return true;

  if (x < X_MIN_MM || x > X_MAX_MM) {
    printError(F("X outside software limits"));
    return false;
  }
  if (y < Y_MIN_MM || y > Y_MAX_MM) {
    printError(F("Y outside software limits"));
    return false;
  }
  if (z < Z_MIN_MM || z > Z_MAX_MM) {
    printError(F("Z outside software limits"));
    return false;
  }
  if (e < E_MIN_DEG || e > E_MAX_DEG) {
    printError(F("E outside software limits"));
    return false;
  }
  return true;
}

// ================================================================
// =================== SERIAL / EMERGENCY CHECK ====================
// ================================================================

bool serialLineLooksEmergency(const String &line) {
  String upper = line;
  upper.toUpperCase();
  upper.trim();
  return upper.startsWith("M112");
}

// This is called during motion.
// It only looks for M112 so emergency stop is not stuck behind a long move.
void checkSerialEmergencyDuringMotion() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n' || emergencyPos >= 14) {
      emergencyBuffer[emergencyPos] = '\0';
      if (strstr(emergencyBuffer, "M112")) {
        emergencyStop(F("M112 received during motion"));
      }
      emergencyPos = 0;
      memset(emergencyBuffer, 0, 16);
      return;
    }

    emergencyBuffer[emergencyPos++] = c;
  }
}

// ================================================================
// ======================= MOTION CONTROL ==========================
// ================================================================

unsigned long computeTickDelayUs(
  float startShoulder, float targetShoulder,
  float startElbow, float targetElbow,
  float startZ, float targetZ,
  float startE, float targetE,
  float cartDistanceMm,
  float feedMmPerMin,
  long maxSteps
) {
  if (maxSteps <= 0) return MIN_STEP_TICK_US;

  float requiredSeconds = 0.0f;

  // Clamp feedrate to prevent overflow
  if (feedMmPerMin > 10000.0f) feedMmPerMin = 10000.0f;
  if (feedMmPerMin < 0.1f) feedMmPerMin = 0.1f;

  // XY feedrate (not including Z)
  if (cartDistanceMm > 0.0001f && feedMmPerMin > 0.0001f) {
    float feedMmPerSec = feedMmPerMin / 60.0f;
    requiredSeconds = max(requiredSeconds, cartDistanceMm / feedMmPerSec);
  }

  // Joint speeds limit the move
  requiredSeconds = max(requiredSeconds, fabs(targetShoulder - startShoulder) / MAX_SHOULDER_DEG_S);
  requiredSeconds = max(requiredSeconds, fabs(targetElbow - startElbow) / MAX_ELBOW_DEG_S);
  
  // Z and E move in parallel with XY
  requiredSeconds = max(requiredSeconds, fabs(targetZ - startZ) / MAX_Z_MM_S);
  requiredSeconds = max(requiredSeconds, fabs(targetE - startE) / MAX_E_DEG_S);

  // Clamp to prevent overflow
  if (requiredSeconds > 3600.0f) requiredSeconds = 3600.0f;  // 1 hour max
  if (requiredSeconds < 0.001f) requiredSeconds = 0.001f;

  unsigned long tickUs = (unsigned long)((requiredSeconds * 1000000.0f) / (float)maxSteps);
  if (tickUs < MIN_STEP_TICK_US) tickUs = MIN_STEP_TICK_US;
  
  return tickUs;
}

bool moveJointsTo(
  float targetShoulderDeg,
  float targetElbowDeg,
  float targetZMm,
  float targetEDeg,
  float cartDistanceMm,
  float feedMmPerMin
) {
  if (emergencyStopped) {
    printError(F("machine is emergency stopped; send M999 to clear"));
    return false;
  }

  enableMotors();

  long targetShoulderSteps = lround(targetShoulderDeg * SHOULDER_STEPS_PER_DEG);
  long targetElbowSteps    = lround(targetElbowDeg    * ELBOW_STEPS_PER_DEG);
  long targetZSteps        = lround(targetZMm         * Z_STEPS_PER_MM);
  long targetESteps        = lround(targetEDeg        * E_STEPS_PER_DEG);

  long dS = targetShoulderSteps - shoulderSteps;
  long dEl = targetElbowSteps - elbowSteps;
  long dZ = targetZSteps - zSteps;
  long dE = targetESteps - eSteps;

  long absS = labs(dS);
  long absEl = labs(dEl);
  long absZ = labs(dZ);
  long absE = labs(dE);

  long maxSteps = max(max(absS, absEl), max(absZ, absE));

  if (maxSteps == 0) return true;

  int dirS = dS >= 0 ? +1 : -1;
  int dirEl = dEl >= 0 ? +1 : -1;
  int dirZ = dZ >= 0 ? +1 : -1;
  int dirE = dE >= 0 ? +1 : -1;

  setDirection(shoulderAxis, dirS);
  setDirection(elbowAxis, dirEl);
  setDirection(zAxis, dirZ);
  setDirection(eAxis, dirE);

  unsigned long tickUs = computeTickDelayUs(
    current.shoulderDeg, targetShoulderDeg,
    current.elbowDeg, targetElbowDeg,
    current.z, targetZMm,
    current.e, targetEDeg,
    cartDistanceMm,
    feedMmPerMin,
    maxSteps
  );
  
  unsigned long startTickUs = (unsigned long)(tickUs * START_SPEED_FACTOR);

  long accelSteps = 0;
  long decelStart = maxSteps;

  if (USE_ACCELERATION && maxSteps > 20) {
    accelSteps = max(1L, (long)(maxSteps * ACCELERATION_PORTION));

    if (accelSteps * 2 > maxSteps) {
      accelSteps = maxSteps / 2;
    }

    decelStart = maxSteps - accelSteps;
  }

  // FIXED: Proper DDA with cumulative error tracking, no overflow
  long errS = maxSteps / 2;
  long errEl = maxSteps / 2;
  long errZ = maxSteps / 2;
  long errE = maxSteps / 2;

  for (long i = 0; i < maxSteps; i++) {
    // Non-blocking emergency check (doesn't stall motion loop)
    if (i % 50 == 0) {  // Check every 50 steps instead of every step
      checkSerialEmergencyDuringMotion();
    }
    
    if (emergencyStopped) return false;

    if (HARD_ENDSTOP_ABORT_ON_TRIGGER && anyEnabledEndstopTriggered()) {
      emergencyStop(F("enabled endstop triggered during movement"));
      return false;
    }

    // DDA stepping - much more stable than Bresenham with accumulators
    bool doS = false, doEl = false, doZ = false, doE = false;

    errS -= absS;
    if (errS <= 0) {
      errS += maxSteps;
      doS = true;
    }

    errEl -= absEl;
    if (errEl <= 0) {
      errEl += maxSteps;
      doEl = true;
    }

    errZ -= absZ;
    if (errZ <= 0) {
      errZ += maxSteps;
      doZ = true;
    }

    errE -= absE;
    if (errE <= 0) {
      errE += maxSteps;
      doE = true;
    }

    if (doS) {
      stepAxis(shoulderAxis);
      shoulderSteps += dirS;
    }
    if (doEl) {
      stepAxis(elbowAxis);
      elbowSteps += dirEl;
    }
    if (doZ) {
      stepAxis(zAxis);
      zSteps += dirZ;
    }
    if (doE) {
      stepAxis(eAxis);
      eSteps += dirE;
    }

    unsigned long currentTickUs = tickUs;

    if (USE_ACCELERATION && accelSteps > 0) {
      if (i < accelSteps) {
        float t = (float)i / (float)accelSteps;
        currentTickUs = startTickUs - (unsigned long)((startTickUs - tickUs) * t);
      } else if (i >= decelStart) {
        float t = (float)(i - decelStart) / (float)accelSteps;
        currentTickUs = tickUs + (unsigned long)((startTickUs - tickUs) * t);
      }
    }

    delayMicroseconds(currentTickUs);
    }

  current.shoulderDeg = targetShoulderDeg;
  current.elbowDeg = targetElbowDeg;
  current.z = targetZMm;
  current.e = targetEDeg;
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);

  return true;
}

bool moveLinearCartesian(float targetX, float targetY, float targetZ, float targetE, float feedMmPerMin) {
  if (!checkLogicalLimits(targetX, targetY, targetZ, targetE)) return false;

  float targetShoulder, targetElbow;
  if (!inverseKinematics(targetX, targetY, targetShoulder, targetElbow)) {
    printError(F("target XY is outside SCARA reachable workspace"));
    return false;
  }

  float dx = targetX - current.x;
  float dy = targetY - current.y;
  float dz = targetZ - current.z;
  float de = targetE - current.e;

  // FIXED: Only XY distance for feedrate, not Z
  float xyDistance = sqrt(dx * dx + dy * dy);
  float maxZEDistance = max(fabs(dz), fabs(de));

  int segments = max(1, (int)ceil(xyDistance / CARTESIAN_SEGMENT_MM));

  float startX = current.x;
  float startY = current.y;
  float startZ = current.z;
  float startE = current.e;

  // Save position state for rollback on failure
  Position savedPosition = current;

  for (int i = 1; i <= segments; i++) {
    if (emergencyStopped) {
      current = savedPosition;
      updateStepCountersFromPosition();
      return false;
    }

    float t = (float)i / (float)segments;
    float sx = startX + dx * t;
    float sy = startY + dy * t;
    float sz = startZ + dz * t;
    float se = startE + de * t;

    float sShoulder, sElbow;
    if (!inverseKinematics(sx, sy, sShoulder, sElbow)) {
      printError(F("intermediate XY segment is outside SCARA workspace"));
      current = savedPosition;
      updateStepCountersFromPosition();
      return false;
    }

    // FIXED: Pass only XY distance for feedrate, Z/E handled separately in moveJointsTo
    float segmentXYDistance = xyDistance / (float)segments;
    if (!moveJointsTo(sShoulder, sElbow, sz, se, segmentXYDistance, feedMmPerMin)) {
      current = savedPosition;
      updateStepCountersFromPosition();
      return false;
    }
  }

  // Always set exact target to avoid rounding drift
  current.x = targetX;
  current.y = targetY;
  current.z = targetZ;
  current.e = targetE;
  current.shoulderDeg = targetShoulder;
  current.elbowDeg = targetElbow;
  updateStepCountersFromPosition();

  return true;
}

// ================================================================
// =========================== HOMING ==============================
// ================================================================

bool homeSingleJoint(
  const AxisPins &axis,
  long &stepCounter,
  float stepsPerUnit,
  int homeDir,
  float maxTravelUnits,
  float speedUnitsPerSec,
  bool useMin,
  bool useMax,
  bool (*minTriggeredFunc)(),
  bool (*maxTriggeredFunc)(),
  float backoffUnits,
  float homeAssignedUnit
) {
  if (!useMin && !useMax) {
    Serial.println(F("echo: homing skipped because endstop is disabled"));
    stepCounter = lround(homeAssignedUnit * stepsPerUnit);
    return true;
  }

  enableMotors();

  bool useTargetMin = homeDir < 0;
  // FIXED: Correct logic for min/max endstop checks
  if (useTargetMin && !useMin) {
    printError(F("requested min homing but min endstop disabled"));
    return false;
  }
  if (!useTargetMin && !useMax) {
    printError(F("requested max homing but max endstop disabled"));
    return false;
  }

  if (emergencyStopped) {
    printError(F("cannot home while emergency stopped"));
    return false;
  }

  setDirection(axis, homeDir);

  long maxTravelSteps = labs(lround(maxTravelUnits * stepsPerUnit));
  unsigned long stepDelayUs = (unsigned long)(1000000.0f / max(1.0f, speedUnitsPerSec * stepsPerUnit));
  if (stepDelayUs < MIN_STEP_TICK_US) stepDelayUs = MIN_STEP_TICK_US;

  for (long i = 0; i < maxTravelSteps; i++) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return false;

    bool triggered = useTargetMin ? minTriggeredFunc() : maxTriggeredFunc();
    if (triggered) break;

    stepAxis(axis);
    stepCounter += homeDir;
    delayMicroseconds(stepDelayUs);

    if (i == maxTravelSteps - 1) {
      printError(F("homing failed: endstop not reached"));
      return false;
    }
  }

  // Back off from switch
  setDirection(axis, -homeDir);
  long backoffSteps = labs(lround(backoffUnits * stepsPerUnit));
  for (long i = 0; i < backoffSteps; i++) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return false;

    stepAxis(axis);
    stepCounter -= homeDir;
    delayMicroseconds(stepDelayUs);
  }

  stepCounter = lround(homeAssignedUnit * stepsPerUnit);
  return true;
}

bool homeZ() {
  return homeSingleJoint(
    zAxis,
    zSteps,
    Z_STEPS_PER_MM,
    Z_HOME_DIR,
    Z_HOME_MAX_TRAVEL_MM,
    Z_HOME_MM_S,
    USE_Z_MIN_ENDSTOP,
    USE_Z_MAX_ENDSTOP,
    zMinTriggered,
    zMaxTriggered,
    Z_HOME_BACKOFF_MM,
    Z_HOME_MM
  );
}

bool homeShoulder() {
  return homeSingleJoint(
    shoulderAxis,
    shoulderSteps,
    SHOULDER_STEPS_PER_DEG,
    SHOULDER_HOME_DIR,
    SHOULDER_HOME_MAX_TRAVEL_DEG,
    SHOULDER_HOME_DEG_S,
    USE_X_MIN_ENDSTOP,
    USE_X_MAX_ENDSTOP,
    xMinTriggered,
    xMaxTriggered,
    SHOULDER_HOME_BACKOFF_DEG,
    SHOULDER_HOME_DEG
  );
}

bool homeElbow() {
  return homeSingleJoint(
    elbowAxis,
    elbowSteps,
    ELBOW_STEPS_PER_DEG,
    ELBOW_HOME_DIR,
    ELBOW_HOME_MAX_TRAVEL_DEG,
    ELBOW_HOME_DEG_S,
    USE_Y_MIN_ENDSTOP,
    USE_Y_MAX_ENDSTOP,
    yMinTriggered,
    yMaxTriggered,
    ELBOW_HOME_BACKOFF_DEG,
    ELBOW_HOME_DEG
  );
}

void updatePositionAfterHoming() {
  current.shoulderDeg = (float)shoulderSteps / SHOULDER_STEPS_PER_DEG;
  current.elbowDeg = (float)elbowSteps / ELBOW_STEPS_PER_DEG;
  current.z = (float)zSteps / Z_STEPS_PER_MM;
  current.e = (float)eSteps / E_STEPS_PER_DEG;
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
}

bool handleG28(const String &line) {
  if (emergencyStopped) {
    printError(F("cannot home while emergency stopped"));
    return false;
  }

  bool hasX = line.indexOf('X') >= 0;
  bool hasY = line.indexOf('Y') >= 0;
  bool hasZ = line.indexOf('Z') >= 0;

  bool homeAll = !hasX && !hasY && !hasZ;

  if (homeAll || hasZ) {
    if (!homeZ()) return false;
  }

  if (homeAll || hasX) {
    if (!homeShoulder()) return false;
  }

  if (homeAll || hasY) {
    if (!homeElbow()) return false;
  }

  updatePositionAfterHoming();
  return true;
}

// ================================================================
// ======================= G-CODE PARSING ==========================
// ================================================================

bool hasParam(const String &line, char code) {
  int idx = line.indexOf(code);
  if (idx < 0) return false;
  
  // Must be preceded by space or start of line
  if (idx > 0 && isAlphaNumeric(line[idx - 1])) return false;
  
  // Must be followed by digit, sign, or decimal point
  if (idx + 1 < line.length()) {
    char next = line[idx + 1];
    if (!isDigit(next) && next != '-' && next != '+' && next != '.') return false;
  }
  
  return true;
}

float getParam(const String &line, char code, float fallback) {
  int idx = line.indexOf(code);
  if (idx < 0) return fallback;

  // Validate position
  if (idx > 0 && isAlphaNumeric(line[idx - 1])) return fallback;

  int start = idx + 1;
  while (start < line.length() && line[start] == ' ') start++;

  int end = start;
  while (end < line.length()) {
    char c = line[end];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.') {
      end++;
    } else {
      break;
    }
  }

  if (end == start) return fallback;
  return line.substring(start, end).toFloat();
}

int getCommandNumber(const String &line, char letter) {
  int idx = line.indexOf(letter);
  if (idx < 0) return -1;

  int start = idx + 1;
  // FIXED: Skip spaces after letter
  while (start < line.length() && line[start] == ' ') start++;
  
  int end = start;
  while (end < line.length() && isDigit(line[end])) {
    end++;
  }

  if (end == start) return -1;
  return line.substring(start, end).toInt();
}

String stripCommentAndUpper(String line) {
  int semicolon = line.indexOf(';');
  if (semicolon >= 0) line = line.substring(0, semicolon);

  line.trim();
  line.toUpperCase();
  return line;
}


bool moveRawMotors(float deltaShoulderDeg, float deltaElbowDeg, float deltaZMm, float deltaEDeg, float feedUnitsPerMin) {
  if (emergencyStopped) {
    printError(F("machine is emergency stopped; send M999 to clear"));
    return false;
  }

  float targetShoulder = current.shoulderDeg + deltaShoulderDeg;
  float targetElbow = current.elbowDeg + deltaElbowDeg;
  float targetZ = current.z + deltaZMm;
  float targetE = current.e + deltaEDeg;

  if (SOFTWARE_LIMITS_ENABLED) {
    if (targetZ < Z_MIN_MM || targetZ > Z_MAX_MM) {
      printError(F("raw move blocked: Z outside software limits"));
      return false;
    }

    if (targetE < E_MIN_DEG || targetE > E_MAX_DEG) {
      printError(F("raw move blocked: E outside software limits"));
      return false;
    }
  }

  // For raw movement, feed is interpreted as units/min for the largest moving axis.
  // X/Y/E use degrees, Z uses mm.
  float largestMove = max(max(fabs(deltaShoulderDeg), fabs(deltaElbowDeg)), max(fabs(deltaZMm), fabs(deltaEDeg)));
  float fakeDistance = largestMove;

  if (!moveJointsTo(targetShoulder, targetElbow, targetZ, targetE, fakeDistance, feedUnitsPerMin)) {
    return false;
  }

  // Update Cartesian X/Y estimate from the new joint angles.
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
  return true;
}

void handleRawMoveM360(const String &line) {
  float dx = getParam(line, 'X', 0.0f); // shoulder motor, degrees
  float dy = getParam(line, 'Y', 0.0f); // elbow/platform motor, degrees
  float dz = getParam(line, 'Z', 0.0f); // Z motor, mm
  float de = getParam(line, 'E', 0.0f); // wrist motor, degrees
  float feed = getParam(line, 'F', 600.0f);

  if (!hasParam(line, 'X') && !hasParam(line, 'Y') && !hasParam(line, 'Z') && !hasParam(line, 'E')) {
    printError(F("M360 needs at least one axis parameter"));
    return;
  }

  if (moveRawMotors(dx, dy, dz, de, feed)) {
    printOk();
  }
}


// ================================================================
// ======================= COMMAND HANDLERS ========================
// ================================================================

void reportPosition() {
  Serial.print(F("X:"));
  Serial.print(current.x, 3);
  Serial.print(F(" Y:"));
  Serial.print(current.y, 3);
  Serial.print(F(" Z:"));
  Serial.print(current.z, 3);
  Serial.print(F(" E:"));
  Serial.print(current.e, 3);

  Serial.print(F("  Joints theta:"));
  Serial.print(current.shoulderDeg, 3);
  Serial.print(F(" psi:"));
  Serial.print(current.elbowDeg, 3);

  Serial.print(F("  steps S:"));
  Serial.print(shoulderSteps);
  Serial.print(F(" P:"));
  Serial.print(elbowSteps);
  Serial.print(F(" Z:"));
  Serial.print(zSteps);
  Serial.print(F(" E:"));
  Serial.println(eSteps);
}

void reportEndstops() {
  Serial.println(F("Reporting endstop status"));
  Serial.print(F("x_min: "));
  Serial.println(xMinTriggered() ? F("TRIGGERED") : F("open"));

  Serial.print(F("x_max: "));
  Serial.println(xMaxTriggered() ? F("TRIGGERED") : F("open"));

  Serial.print(F("y_min: "));
  Serial.println(yMinTriggered() ? F("TRIGGERED") : F("open"));

  Serial.print(F("y_max: "));
  Serial.println(yMaxTriggered() ? F("TRIGGERED") : F("open"));

  Serial.print(F("z_min: "));
  Serial.println(zMinTriggered() ? F("TRIGGERED") : F("open"));

  Serial.print(F("z_max: "));
  Serial.println(zMaxTriggered() ? F("TRIGGERED") : F("open"));
}

void reportSettings() {
  Serial.println(F("SCARAnoi custom firmware settings"));

  Serial.print(F("Steps/unit: shoulder="));
  Serial.print(SHOULDER_STEPS_PER_DEG, 4);
  Serial.print(F(" steps/deg, elbow="));
  Serial.print(ELBOW_STEPS_PER_DEG, 4);
  Serial.print(F(" steps/deg, Z="));
  Serial.print(Z_STEPS_PER_MM, 4);
  Serial.print(F(" steps/mm, E="));
  Serial.print(E_STEPS_PER_DEG, 4);
  Serial.println(F(" steps/deg"));

  Serial.print(F("Links: L1="));
  Serial.print(LINK_1_MM, 3);
  Serial.print(F(" mm, L2="));
  Serial.print(LINK_2_MM, 3);
  Serial.println(F(" mm"));

  Serial.print(F("Software limits: "));
  Serial.println(SOFTWARE_LIMITS_ENABLED ? F("ON") : F("OFF"));

  Serial.print(F("X["));
  Serial.print(X_MIN_MM);
  Serial.print(F(", "));
  Serial.print(X_MAX_MM);
  Serial.print(F("] Y["));
  Serial.print(Y_MIN_MM);
  Serial.print(F(", "));
  Serial.print(Y_MAX_MM);
  Serial.print(F("] Z["));
  Serial.print(Z_MIN_MM);
  Serial.print(F(", "));
  Serial.print(Z_MAX_MM);
  Serial.print(F("] E["));
  Serial.print(E_MIN_DEG);
  Serial.print(F(", "));
  Serial.print(E_MAX_DEG);
  Serial.println(F("]"));

  Serial.print(F("Motor states: X="));
  Serial.print(shoulderMotorEnabled ? F("ON") : F("OFF"));
  Serial.print(F(" Y="));
  Serial.print(elbowMotorEnabled ? F("ON") : F("OFF"));
  Serial.print(F(" Z="));
  Serial.print(zMotorEnabled ? F("ON") : F("OFF"));
  Serial.print(F(" E="));
  Serial.println(eMotorEnabled ? F("ON") : F("OFF"));

  Serial.print(F("Endstops enabled: Xmin="));
  Serial.print(USE_X_MIN_ENDSTOP);
  Serial.print(F(" Xmax="));
  Serial.print(USE_X_MAX_ENDSTOP);
  Serial.print(F(" Ymin="));
  Serial.print(USE_Y_MIN_ENDSTOP);
  Serial.print(F(" Ymax="));
  Serial.print(USE_Y_MAX_ENDSTOP);
  Serial.print(F(" Zmin="));
  Serial.print(USE_Z_MIN_ENDSTOP);
  Serial.print(F(" Zmax="));
  Serial.println(USE_Z_MAX_ENDSTOP);
}

void handleM92(const String &line) {
  // M92 X.. Y.. Z.. E..
  // In this firmware:
  //   X = shoulder steps/deg
  //   Y = elbow steps/deg
  //   Z = Z steps/mm
  //   E = wrist steps/deg
  if (hasParam(line, 'X')) SHOULDER_STEPS_PER_DEG = getParam(line, 'X', SHOULDER_STEPS_PER_DEG);
  if (hasParam(line, 'Y')) ELBOW_STEPS_PER_DEG = getParam(line, 'Y', ELBOW_STEPS_PER_DEG);
  if (hasParam(line, 'Z')) Z_STEPS_PER_MM = getParam(line, 'Z', Z_STEPS_PER_MM);
  if (hasParam(line, 'E')) E_STEPS_PER_DEG = getParam(line, 'E', E_STEPS_PER_DEG);
  updateStepCountersFromPosition();
}

void handleM203(const String &line) {
  // M203 X.. Y.. Z.. E..
  // X/Y are joint max speeds in deg/s here.
  if (hasParam(line, 'X')) MAX_SHOULDER_DEG_S = getParam(line, 'X', MAX_SHOULDER_DEG_S);
  if (hasParam(line, 'Y')) MAX_ELBOW_DEG_S = getParam(line, 'Y', MAX_ELBOW_DEG_S);
  if (hasParam(line, 'Z')) MAX_Z_MM_S = getParam(line, 'Z', MAX_Z_MM_S);
  if (hasParam(line, 'E')) MAX_E_DEG_S = getParam(line, 'E', MAX_E_DEG_S);
}

void handleM280(const String &line) {
  int servoIndex = (int)getParam(line, 'P', 0);
  int angle = (int)getParam(line, 'S', SERVO_OPEN_ANGLE);
  angle = constrain(angle, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);

  if (servoIndex != 0) {
    printError(F("only servo P0 is supported"));
    return;
  }

  if (!gripperAttached) {
    gripperServo.attach(SERVO_GRIPPER_PIN);
    gripperAttached = true;
  }

  gripperServo.write(angle);

  Serial.print(F("echo: servo P0 set to "));
  Serial.println(angle);
}

void handleM281(const String &line) {
  if (hasParam(line, 'O')) SERVO_OPEN_ANGLE = (int)getParam(line, 'O', SERVO_OPEN_ANGLE);
  if (hasParam(line, 'C')) SERVO_CLOSE_ANGLE = (int)getParam(line, 'C', SERVO_CLOSE_ANGLE);

  SERVO_OPEN_ANGLE = constrain(SERVO_OPEN_ANGLE, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
  SERVO_CLOSE_ANGLE = constrain(SERVO_CLOSE_ANGLE, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);

  Serial.print(F("echo: gripper open="));
  Serial.print(SERVO_OPEN_ANGLE);
  Serial.print(F(" close="));
  Serial.println(SERVO_CLOSE_ANGLE);
}

void handleM282(const String &line) {
  int servoIndex = (int)getParam(line, 'P', 0);
  if (servoIndex != 0) {
    printError(F("only servo P0 is supported"));
    return;
  }

  if (gripperAttached) {
    gripperServo.detach();
    gripperAttached = false;
  }

  Serial.println(F("echo: servo P0 detached"));
}

void handleG92(const String &line) {
  float newX = current.x, newY = current.y, newZ = current.z, newE = current.e;
  
  if (hasParam(line, 'X')) newX = getParam(line, 'X', current.x);
  if (hasParam(line, 'Y')) newY = getParam(line, 'Y', current.y);
  if (hasParam(line, 'Z')) newZ = getParam(line, 'Z', current.z);
  if (hasParam(line, 'E')) newE = getParam(line, 'E', current.e);

  // Validate before committing
  float s, p;
  if (inverseKinematics(newX, newY, s, p)) {
    // Only update if IK succeeds
    current.x = newX;
    current.y = newY;
    current.z = newZ;
    current.e = newE;
    current.shoulderDeg = s;
    current.elbowDeg = p;
    updateStepCountersFromPosition();
  } else {
    printError(F("G92 XY position outside reachable workspace"));
    return;
  }
}

void handleMove(const String &line) {
  float feed = getParam(line, 'F', 1200.0f);

  float targetX = current.x;
  float targetY = current.y;
  float targetZ = current.z;
  float targetE = current.e;

  if (absoluteMode) {
    if (hasParam(line, 'X')) targetX = getParam(line, 'X', current.x);
    if (hasParam(line, 'Y')) targetY = getParam(line, 'Y', current.y);
    if (hasParam(line, 'Z')) targetZ = getParam(line, 'Z', current.z);
    if (hasParam(line, 'E')) targetE = getParam(line, 'E', current.e);
  } else {
    if (hasParam(line, 'X')) targetX += getParam(line, 'X', 0.0f);
    if (hasParam(line, 'Y')) targetY += getParam(line, 'Y', 0.0f);
    if (hasParam(line, 'Z')) targetZ += getParam(line, 'Z', 0.0f);
    if (hasParam(line, 'E')) targetE += getParam(line, 'E', 0.0f);
  }

  if (moveLinearCartesian(targetX, targetY, targetZ, targetE, feed)) {
    printOk();
  }
}

void handleCommand(String rawLine) {
  String line = stripCommentAndUpper(rawLine);
  if (line.length() == 0) return;

  if (serialLineLooksEmergency(line)) {
    emergencyStop(F("M112 received"));
    return;
  }

  int g = getCommandNumber(line, 'G');
  int m = getCommandNumber(line, 'M');

  if (emergencyStopped && !(m == 999 || m == 112 || m == 114 || m == 119)) {
    printError(F("machine is emergency stopped; send M999 to clear"));
    return;
  }

  if (g == 0 || g == 1) {
    handleMove(line);
    return;
  }

  if (g == 4) {
    unsigned long p = (unsigned long)getParam(line, 'P', 0.0f);
    delay(p);
    printOk();
    return;
  }

  if (g == 28) {
    if (handleG28(line)) printOk();
    return;
  }

  if (g == 90) {
    absoluteMode = true;
    printOk();
    return;
  }

  if (g == 91) {
    absoluteMode = false;
    printOk();
    return;
  }

  if (g == 92) {
    handleG92(line);
    printOk();
    return;
  }

  if (m == 17) {
    enableMotorsFromCommand(line);
    printOk();
    return;
  }

  if (m == 18 || m == 84) {
    disableMotorsFromCommand(line);
    printOk();
    return;
  }

  if (m == 92) {
    handleM92(line);
    printOk();
    return;
  }

  if (m == 112) {
    emergencyStop(F("M112 received"));
    return;
  }

  if (m == 114) {
    reportPosition();
    printOk();
    return;
  }

  if (m == 119) {
    reportEndstops();
    printOk();
    return;
  }

  if (m == 203) {
    handleM203(line);
    printOk();
    return;
  }

  if (m == 211) {
    int s = (int)getParam(line, 'S', SOFTWARE_LIMITS_ENABLED ? 1 : 0);
    SOFTWARE_LIMITS_ENABLED = (s != 0);
    Serial.print(F("echo: software endstops "));
    Serial.println(SOFTWARE_LIMITS_ENABLED ? F("ON") : F("OFF"));
    printOk();
    return;
  }

  if (m == 280) {
    handleM280(line);
    printOk();
    return;
  }

  if (m == 281) {
    handleM281(line);
    printOk();
    return;
  }

  if (m == 282) {
    handleM282(line);
    printOk();
    return;
  }

  if (m == 360) {
    handleRawMoveM360(line);
    return;
  }

  if (m == 400) {
    // Moves are blocking, so by the time this is reached motion is complete.
    printOk();
    return;
  }

  if (m == 503) {
    reportSettings();
    printOk();
    return;
  }

  if (m == 999) {
    emergencyStopped = false;
    Serial.println(F("echo: emergency stop cleared"));
    printOk();
    return;
  }

  Serial.print(F("error: unsupported command: "));
  Serial.println(line);
}

// ================================================================
// ======================= ARDUINO SETUP/LOOP ======================
// ================================================================

void setupPins() {
  shoulderAxis.invertDir = INVERT_SHOULDER_DIR;
  elbowAxis.invertDir = INVERT_ELBOW_DIR;
  zAxis.invertDir = INVERT_Z_DIR;
  eAxis.invertDir = INVERT_E_DIR;

  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(X_EN_PIN, OUTPUT);

  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);
  pinMode(Y_EN_PIN, OUTPUT);

  pinMode(Z_STEP_PIN, OUTPUT);
  pinMode(Z_DIR_PIN, OUTPUT);
  pinMode(Z_EN_PIN, OUTPUT);

  pinMode(E_STEP_PIN, OUTPUT);
  pinMode(E_DIR_PIN, OUTPUT);
  pinMode(E_EN_PIN, OUTPUT);

  pinMode(SERVO_GRIPPER_PIN, OUTPUT);

  pinMode(X_MIN_PIN, INPUT_PULLUP);
  pinMode(X_MAX_PIN, INPUT_PULLUP);
  pinMode(Y_MIN_PIN, INPUT_PULLUP);
  pinMode(Y_MAX_PIN, INPUT_PULLUP);
  pinMode(Z_MIN_PIN, INPUT_PULLUP);
  pinMode(Z_MAX_PIN, INPUT_PULLUP);

  disableMotors();
}

void setup() {
  Serial.begin(BAUDRATE);
  setupPins();

  current.shoulderDeg = SHOULDER_HOME_DEG;
  current.elbowDeg = ELBOW_HOME_DEG;
  current.z = Z_HOME_MM;
  current.e = 0.0f;
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
  updateStepCountersFromPosition();

  Serial.println(F("SCARAnoi custom RAMPS firmware ready"));
  Serial.println(F("echo: send M503 for settings, M119 for endstops, M114 for position"));
  printOk();
}



void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      inputLine[inputPos] = '\0';
      String line(inputLine);
      inputPos = 0;
      memset(inputLine, 0, MAX_CMD_LENGTH + 1);
      handleCommand(line);
    } else if (inputPos < MAX_CMD_LENGTH) {
      inputLine[inputPos++] = c;

      // Early emergency detection
      if (inputPos >= 4) {
        if (strstr(inputLine, "M112") || strstr(inputLine, "m112")) {
          inputPos = 0;
          memset(inputLine, 0, MAX_CMD_LENGTH + 1);
          emergencyStop(F("M112 received"));
        }
      }
    } else {
      inputPos = 0;
      memset(inputLine, 0, MAX_CMD_LENGTH + 1);
      printError(F("command too long"));
    }
  }
}
