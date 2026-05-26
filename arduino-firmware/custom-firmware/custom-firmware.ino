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
    G0/G1 X.. Y.. Z.. E.. F..   Move. X/Y are Cartesian mm. Z is mm. E is logical gripper angle.
    G28 [X] [Y] [Z] [E]         Home enabled axes.
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
    M360 X.. Y.. Z.. E.. F..    Joint move. X/Y are joint degrees, Z is mm, E is logical gripper angle. No SCARA IK.
    M361                        Report gripper orientation mode
    M361 S0                     Independent mode: gripper keeps a fixed world direction.
    M361 S1                     Tracking mode: gripper stays fixed relative to the elbow.
    M503                        Report main settings
    M999                        Clear emergency stop

  Important:
    - X/Y G-code targets are converted to SCARA joint angles inside the firmware.
    - In normal G0/G1 moves, E is now the logical gripper angle, not the raw E motor angle.
    - In independent mode, the E motor compensates shoulder rotation only.
    - In tracking mode, the E motor compensates shoulder rotation and adds elbow rotation.
    - M360 is also subject to the selected gripper mode, so X/Y joint moves compensate E automatically.
    - The firmware uses INPUT_PULLUP for endstops.
    - For a normally-open switch wired between signal and GND, triggered = LOW.
*/

#include <Arduino.h>
#include <Servo.h>
#include <math.h>

// ================================================================
// ========================= USER SETTINGS =========================
// ================================================================

#define G_CODE_SERIAL Serial2

// Serial speed. This matches your old Marlin config.
static const long BAUDRATE = 250000;

// ------------------------- Custom Commands -------------------------
// Default values for custom text macros. Change these as needed.

static float X_START_COORD = 0.0f;
static float Y_START_COORD = 240.0f;
static float Z_START_COORD = 150.0f;
static float E_START_COORD = 0.0f;

static float X_START = 78.932f;
static float Y_START = 73.564f;
static float Z_START = 0.0f;
static float E_START = 121.711f;

static float Z_UP = -140.0f;
static float Z_LAYER1 = -232.0f;
static float Z_LAYER2 = -215.0f;
static float Z_LAYER3 = -200.0f;
static float Z_LAYER4 = -185.0f;
static float Z_LAYER5 = -170.0f;

static float X_PEG2 = 144.0f;
static float X_PEG1 = 24.0f;
static float X_PEG0 = -95.0f;

static float Y_PEG2 = 240.0f;
static float Y_PEG1 = 250.0f;
static float Y_PEG0 = 265.0f;

static float X_PEG2_UP = 144.0f;
static float X_PEG1_UP = 24.0f;
static float X_PEG0_UP = -95.0f;

static float Y_PEG2_UP = 240.0f;
static float Y_PEG1_UP = 250.0f;
static float Y_PEG0_UP = 265.0f;

static int CURRENT_PEG = 1;

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

// E Endstop pins using free servo header pins.
static const uint8_t E_MIN_PIN = 5; // D5
static const uint8_t E_MAX_PIN = 4; // D4

// RAMPS servo header.
// Servo 0 is usually D11 on RAMPS 1.4.
static uint8_t SERVO_GRIPPER_PIN = 11;

// ------------------------- Motor logic ---------------------------
// A4988 enable is active LOW on RAMPS.
static const bool ENABLE_ACTIVE_LOW = true;

// Direction inversion. Change these if an axis moves the wrong way.
static bool INVERT_SHOULDER_DIR = true;  // RAMPS X driver
static bool INVERT_ELBOW_DIR    = true;  // RAMPS Y driver
static bool INVERT_Z_DIR        = false; // from your old Marlin config
static bool INVERT_E_DIR        = false; // wrist rotation

// ------------------------- Steps per unit ------------------------
// From your previous Marlin config:
//   { 88.8889, 35.5556, 400, 35.5556 }
// Here X/Y become SCARA joint degrees.
static float SHOULDER_STEPS_PER_DEG = 200*16*8 / 360; // 200 * 16 * 10/360
static float ELBOW_STEPS_PER_DEG    = 200*16*3.2 / 360;
static float Z_STEPS_PER_MM         = 200*8 / 8;
static float E_STEPS_PER_DEG        = 200*16*3.2 / 360;

// ------------------------- Speed limits --------------------------
// Conservative defaults. Increase only after testing.
static float MAX_SHOULDER_DEG_S = 140.0f;
static float MAX_ELBOW_DEG_S    = 350.0f;
static float MAX_Z_MM_S         = 40.0f;
static float MAX_E_DEG_S        = 350.0f;

static float CURRENT_SPEED = 3500.0f;
static const float SIDE_SPEED = 9000.0f;

// Minimum delay between coordinated step ticks.
// Larger = slower but safer for A4988 and mechanical testing.
static unsigned long MIN_STEP_TICK_US = 100;

// ------------------------- Acceleration --------------------------
// Simple trapezoidal acceleration profile.
// This only changes the delay between steps during a move.
static bool USE_ACCELERATION = true;

// Fraction of the move used for acceleration and deceleration.
// 0.20 means first 20% accelerates and last 20% decelerates.
static float ACCELERATION_PORTION = 0.2f;

// Start/end delay multiplier.
// 3.0 means the move starts and ends 3x slower than the target speed.
static float START_SPEED_FACTOR = 2.5f;

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
static float CARTESIAN_SEGMENT_MM = 1.0f;

// --------------------- Gripper orientation modes -----------------
// 0 = independent mode: gripper keeps a fixed world direction.
//     Motor E = logical E - shoulder.
// 1 = tracking mode: gripper stays fixed relative to the elbow.
//     Motor E = logical E - shoulder + elbow.
// Home uses tracking mode by default.
static int GRIPPER_MODE = 1;

static const int GRIPPER_MODE_INDEPENDENT = 0;
static const int GRIPPER_MODE_TRACKING    = 1;

// If the compensation moves the gripper in the wrong direction, change this to -1.
static int GRIPPER_COMPENSATION_SIGN = 1;

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

static bool USE_E_MIN_ENDSTOP = true;
static bool USE_E_MAX_ENDSTOP = true;

// For normally-open switch wired between signal and GND with INPUT_PULLUP:
// triggered = LOW.
static bool ENDSTOP_TRIGGERED_STATE_LOW = true;

// Debounce only happens after a pin first looks triggered.
// This helps against the random emergency stops caused by very short noise spikes.
static const int ENDSTOP_DEBOUNCE_READS = 3;
static const unsigned int ENDSTOP_DEBOUNCE_US = 80;

// During normal movement, abort if an enabled endstop is triggered.
// For debugging broken endstops, set this false.
static bool HARD_ENDSTOP_ABORT_ON_TRIGGER = true;

// ------------------------- Homing -----------------------------
static int SHOULDER_HOME_DIR = -1;
static int ELBOW_HOME_DIR    = -1;
static int Z_HOME_DIR        = 1;
static int E_HOME_DIR        = -1;

// Position assigned after homing.
// These are important because they define where the robot thinks it is.
// Defaults chosen to match your old Marlin home position:
//   X = -(L1 + L2), Y = 0
// which corresponds roughly to shoulder = 180°, elbow = 0°.
static float SHOULDER_HOME_DEG = -78.932f;
static float ELBOW_HOME_DEG    = -73.564f;
static float Z_HOME_MM         = 0.0f;
static float E_HOME_DEG        = -121.675f;



// This is the raw E motor angle after E homing.
// The reported logical E is computed from this and the current gripper mode.

// Homing speeds.
static float SHOULDER_HOME_DEG_S = 40.0f;
static float ELBOW_HOME_DEG_S    = 40.0f;
static float Z_HOME_MM_S         = 20.0f;
static float E_HOME_DEG_S        = 40.0f;

// Homing travel limits.
// If no endstop triggers after this much movement, homing fails.
static float SHOULDER_HOME_MAX_TRAVEL_DEG = 360.0f;
static float ELBOW_HOME_MAX_TRAVEL_DEG    = 360.0f;
static float Z_HOME_MAX_TRAVEL_MM         = 300.0f;
static float E_HOME_MAX_TRAVEL_DEG        = 360.0f;

// Backoff after endstop trigger.
static float SHOULDER_HOME_BACKOFF_DEG = 3.0f;
static float ELBOW_HOME_BACKOFF_DEG    = 3.0f;
static float Z_HOME_BACKOFF_MM         = 3.0f;
static float E_HOME_BACKOFF_DEG        = 3.0f;

// ------------------------- Servo gripper -------------------------
static int SERVO_OPEN_ANGLE  = 150;
static int SERVO_CLOSE_ANGLE1 = 110;
static int SERVO_CLOSE_ANGLE2 = 90;
static int SERVO_CLOSE_ANGLE3 = 70;
static int SERVO_CLOSE_ANGLE4 = 50;
static int SERVO_CLOSE_ANGLE5 = 20;
static int SERVO_MIN_ANGLE   = 0;
static int SERVO_MAX_ANGLE   = 270;

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
  float eMotorDeg;
  float shoulderDeg;
  float elbowDeg;
};

Position current = {
  -(185.412f + 111.000f), 0.0f, 0.0f, 0.0f, 0.0f,
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

bool hasParam(const String &line, char code);
float getParam(const String &line, char code, float fallback);

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
  G_CODE_SERIAL.println(F("ok"));
}

void printError(const __FlashStringHelper *msg) {
  G_CODE_SERIAL.print(F("error: "));
  G_CODE_SERIAL.println(msg);
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

bool rawPinTriggered(uint8_t pin) {
  int value = digitalRead(pin);
  if (ENDSTOP_TRIGGERED_STATE_LOW) return value == LOW;
  return value == HIGH;
}

bool pinTriggered(uint8_t pin) {
  if (!rawPinTriggered(pin)) return false;

  for (int i = 0; i < ENDSTOP_DEBOUNCE_READS; i++) {
    delayMicroseconds(ENDSTOP_DEBOUNCE_US);
    if (!rawPinTriggered(pin)) return false;
  }

  return true;
}

bool xMinTriggered() { return USE_X_MIN_ENDSTOP && pinTriggered(X_MIN_PIN); }
bool xMaxTriggered() { return USE_X_MAX_ENDSTOP && pinTriggered(X_MAX_PIN); }
bool yMinTriggered() { return USE_Y_MIN_ENDSTOP && pinTriggered(Y_MIN_PIN); }
bool yMaxTriggered() { return USE_Y_MAX_ENDSTOP && pinTriggered(Y_MAX_PIN); }
bool zMinTriggered() { return USE_Z_MIN_ENDSTOP && pinTriggered(Z_MIN_PIN); }
bool zMaxTriggered() { return USE_Z_MAX_ENDSTOP && pinTriggered(Z_MAX_PIN); }
bool eMinTriggered() { return USE_E_MIN_ENDSTOP && pinTriggered(E_MIN_PIN); }
bool eMaxTriggered() { return USE_E_MAX_ENDSTOP && pinTriggered(E_MAX_PIN); }

const char *firstTriggeredEndstopName() {
  if (xMinTriggered()) return "x_min";
  if (xMaxTriggered()) return "x_max";
  if (yMinTriggered()) return "y_min";
  if (yMaxTriggered()) return "y_max";
  if (zMinTriggered()) return "z_min";
  if (zMaxTriggered()) return "z_max";
  if (eMinTriggered()) return "e_min";
  if (eMaxTriggered()) return "e_max";
  return NULL;
}

bool anyEnabledEndstopTriggered() {
  return firstTriggeredEndstopName() != NULL;
}

float gripperCompensationFor(float shoulderDeg, float elbowDeg) {
  float compensation = 0;

  if (GRIPPER_MODE == GRIPPER_MODE_TRACKING) {
    compensation += elbowDeg;
  } else {
    compensation -= shoulderDeg;
  }

  return compensation * (float)GRIPPER_COMPENSATION_SIGN;
}

float logicalToMotorE(float logicalE, float shoulderDeg, float elbowDeg) {
  return logicalE + gripperCompensationFor(shoulderDeg, elbowDeg);
}

float motorToLogicalE(float motorE, float shoulderDeg, float elbowDeg) {
  return motorE - gripperCompensationFor(shoulderDeg, elbowDeg);
}

void emergencyStop(const __FlashStringHelper *reason) {
  emergencyStopped = true;
  disableMotors();

  G_CODE_SERIAL.print(F("error: emergency stop"));
  if (reason) {
    G_CODE_SERIAL.print(F(" - "));
    G_CODE_SERIAL.print(reason);
  }
  G_CODE_SERIAL.println();
}

void emergencyStopEndstop(const char *name) {
  emergencyStopped = true;
  disableMotors();

  G_CODE_SERIAL.print(F("error: emergency stop - enabled endstop triggered during movement"));
  if (name) {
    G_CODE_SERIAL.print(F(": "));
    G_CODE_SERIAL.print(name);
  }
  G_CODE_SERIAL.println();
}

void updateStepCountersFromPosition() {
  shoulderSteps = lround(current.shoulderDeg * SHOULDER_STEPS_PER_DEG);
  elbowSteps    = lround(current.elbowDeg    * ELBOW_STEPS_PER_DEG);
  zSteps        = lround(current.z           * Z_STEPS_PER_MM);
  eSteps        = lround(current.eMotorDeg   * E_STEPS_PER_DEG);
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

  /*if (r > maxReach + 0.001f) return false;
  if (r < minReach - 0.001f) return false;
  if (r < FORBIDDEN_RADIUS_MM) return false;*/

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
// =================== G_CODE_SERIAL / EMERGENCY CHECK ====================
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
  while (G_CODE_SERIAL.available() > 0) {
    char c = (char)G_CODE_SERIAL.read();

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
  float startEMotor, float targetEMotor,
  float cartDistanceMm,
  float feedMmPerMin,
  long maxSteps
) {
  if (maxSteps <= 0) return MIN_STEP_TICK_US;

  float requiredSeconds = 0.0f;

  // Clamp feedrate to prevent overflow
  if (feedMmPerMin > 35000.0f) feedMmPerMin = 35000.0f;
  if (feedMmPerMin < 0.1f) feedMmPerMin = 0.1f;

  // XY feedrate (not including Z)
  if (cartDistanceMm > 0.0001f && feedMmPerMin > 0.0001f) {
    float feedMmPerSec = feedMmPerMin / 60.0f;
    requiredSeconds = max(requiredSeconds, cartDistanceMm / feedMmPerSec);
  }

  // Joint speeds limit the move
  requiredSeconds = max(requiredSeconds, fabs(targetShoulder - startShoulder) / MAX_SHOULDER_DEG_S);
  requiredSeconds = max(requiredSeconds, fabs(targetElbow - startElbow) / MAX_ELBOW_DEG_S);

  // Z and raw E motor move in parallel with XY
  requiredSeconds = max(requiredSeconds, fabs(targetZ - startZ) / MAX_Z_MM_S);
  requiredSeconds = max(requiredSeconds, fabs(targetEMotor - startEMotor) / MAX_E_DEG_S);

  // Clamp to prevent overflow
  if (requiredSeconds > 3600.0f) requiredSeconds = 3600.0f;
  if (requiredSeconds < 0.001f) requiredSeconds = 0.001f;

  unsigned long tickUs = (unsigned long)((requiredSeconds * 1000000.0f) / (float)maxSteps);
  if (tickUs > STEP_PULSE_US) {
      tickUs -= STEP_PULSE_US;
  }

  return tickUs;
}

bool moveJointsToMotor(
  float targetShoulderDeg,
  float targetElbowDeg,
  float targetZMm,
  float targetLogicalEDeg,
  float targetEMotorDeg,
  float cartDistanceMm,
  float feedMmPerMin
) {
  if (emergencyStopped) {
    printError(F("machine is emergency stopped; send M999 to clear"));
    return false;
  }

  long targetShoulderSteps = lround(targetShoulderDeg * SHOULDER_STEPS_PER_DEG);
  long targetElbowSteps    = lround(targetElbowDeg    * ELBOW_STEPS_PER_DEG);
  long targetZSteps        = lround(targetZMm         * Z_STEPS_PER_MM);
  long targetESteps        = lround(targetEMotorDeg   * E_STEPS_PER_DEG);

  long dS = targetShoulderSteps - shoulderSteps;
  long dEl = targetElbowSteps - elbowSteps;
  long dZ = targetZSteps - zSteps;
  long dE = targetESteps - eSteps;

    // Enable only axes that will actually move this command
  if (dS != 0 || dEl != 0 || dZ != 0 || dE != 0) enableMotors();
  else disableMotors();

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
    current.eMotorDeg, targetEMotorDeg,
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
    if (i % 50 == 0) {
      checkSerialEmergencyDuringMotion();
    }

    if (emergencyStopped) return false;

    if (HARD_ENDSTOP_ABORT_ON_TRIGGER) {
      const char *hit = firstTriggeredEndstopName();
      if (hit != NULL) {
        emergencyStopEndstop(hit);
        return false;
      }
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
  current.e = targetLogicalEDeg;
  current.eMotorDeg = targetEMotorDeg;
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);

  return true;
}

bool moveJointsTo(
  float targetShoulderDeg,
  float targetElbowDeg,
  float targetZMm,
  float targetLogicalEDeg,
  float cartDistanceMm,
  float feedMmPerMin
) {
  float targetEMotorDeg = logicalToMotorE(targetLogicalEDeg, targetShoulderDeg, targetElbowDeg);

  return moveJointsToMotor(
    targetShoulderDeg,
    targetElbowDeg,
    targetZMm,
    targetLogicalEDeg,
    targetEMotorDeg,
    cartDistanceMm,
    feedMmPerMin
  );
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
  current.eMotorDeg = logicalToMotorE(current.e, current.shoulderDeg, current.elbowDeg);
  updateStepCountersFromPosition();


  delay(300);
  disableMotors();

  return true;
}

// ================================================================
// =========================== HOMING ==============================
// ================================================================

void stepECompensationDuringHome(float axisUnitsMoved, float eCompensationPerUnit, float &eCompensationRemainder) {
  if (approximatelyZero(eCompensationPerUnit)) return;

  float eDeltaDeg = axisUnitsMoved * eCompensationPerUnit;
  eCompensationRemainder += eDeltaDeg * E_STEPS_PER_DEG;

  while (fabs(eCompensationRemainder) >= 1.0f) {
    int dirE = eCompensationRemainder > 0.0f ? +1 : -1;
    setDirection(eAxis, dirE);
    stepAxis(eAxis);
    eSteps += dirE;
    eCompensationRemainder -= (float)dirE;
  }
}

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
  float homeAssignedUnit,
  float eCompensationPerUnit
) {
  if (!useMin && !useMax) {
    G_CODE_SERIAL.println(F("echo: homing skipped because endstop is disabled"));
    stepCounter = lround(homeAssignedUnit * stepsPerUnit);
    return true;
  }

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

  float eCompensationRemainder = 0.0f;

  long maxTravelSteps = labs(lround(maxTravelUnits * stepsPerUnit));
  unsigned long stepDelayUs = (unsigned long)(1000000.0f / max(1.0f, speedUnitsPerSec * stepsPerUnit));
  if (stepDelayUs > STEP_PULSE_US) {
    stepDelayUs -= STEP_PULSE_US;
  } 

  if (stepDelayUs < MIN_STEP_TICK_US) stepDelayUs = MIN_STEP_TICK_US;

  for (long i = 0; i < maxTravelSteps; i++) {
    checkSerialEmergencyDuringMotion();
    if (emergencyStopped) return false;

    bool triggered = useTargetMin ? minTriggeredFunc() : maxTriggeredFunc();
    if (triggered) break;

    stepAxis(axis);
    stepCounter += homeDir;
    stepECompensationDuringHome((float)homeDir / stepsPerUnit, eCompensationPerUnit, eCompensationRemainder);
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
    stepECompensationDuringHome((float)(-homeDir) / stepsPerUnit, eCompensationPerUnit, eCompensationRemainder);
    delayMicroseconds(2000);
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
    Z_HOME_MM,
    0.0f
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
    SHOULDER_HOME_DEG,
    0.0f
  );
}

bool homeElbow() {
  bool homing = homeSingleJoint(
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
    ELBOW_HOME_DEG,
    (float)GRIPPER_COMPENSATION_SIGN
  );
  return homing;
}

bool homeE() {
  return homeSingleJoint(
    eAxis,
    eSteps,
    E_STEPS_PER_DEG,
    E_HOME_DIR,
    E_HOME_MAX_TRAVEL_DEG,
    E_HOME_DEG_S,
    USE_E_MIN_ENDSTOP,
    USE_E_MAX_ENDSTOP,
    eMinTriggered,
    eMaxTriggered,
    E_HOME_BACKOFF_DEG,
    E_HOME_DEG,
    0.0f
  );
}

void updatePositionAfterHoming() {
  current.shoulderDeg = (float)shoulderSteps / SHOULDER_STEPS_PER_DEG;
  current.elbowDeg = (float)elbowSteps / ELBOW_STEPS_PER_DEG;
  current.z = (float)zSteps / Z_STEPS_PER_MM;
  current.eMotorDeg = (float)eSteps / E_STEPS_PER_DEG;
  current.e = motorToLogicalE(current.eMotorDeg, current.shoulderDeg, current.elbowDeg);
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
}

bool handleG28(const String &line) {
  int tmp = GRIPPER_MODE;
  GRIPPER_MODE = GRIPPER_MODE_TRACKING;

  if (emergencyStopped) {
    printError(F("cannot home while emergency stopped"));
    return false;
  }

  bool hasX = line.indexOf('X') >= 0;
  bool hasY = line.indexOf('Y') >= 0;
  bool hasZ = line.indexOf('Z') >= 0;
  bool hasE = line.indexOf('E') >= 0;

  bool homeAll = !hasX && !hasY && !hasZ && !hasE;

  if (!homeAll) disableMotors();
  else enableMotors();

  if (homeAll || hasZ) {
    bool homed = homeZ();
    if (!homed) return homed;
  }

  if (homeAll || hasX) {
    bool homed = homeShoulder();
    if (!homed) return homed;
  }

  if (homeAll || hasY) {
    bool homed = homeElbow();
    if (!homed) return homed;
  }

  if (homeAll || hasE) {
    bool homed = homeE();
    if (!homed) return homed;
  }

  updatePositionAfterHoming();
  GRIPPER_MODE = tmp;
  delay(300);
  disableMotors();
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

  // M360 is still a direct joint move for X/Y/Z, but E is logical.
  // So if X/Y move and E is not given, the gripper keeps the same logical angle
  // and the raw E motor compensates according to the selected M361 mode.
  float targetLogicalE = current.e + deltaEDeg;
  float targetEMotor = logicalToMotorE(targetLogicalE, targetShoulder, targetElbow);

  if (SOFTWARE_LIMITS_ENABLED) {
    if (targetZ < Z_MIN_MM || targetZ > Z_MAX_MM) {
      printError(F("M360 blocked: Z outside software limits"));
      return false;
    }

    if (targetLogicalE < E_MIN_DEG || targetLogicalE > E_MAX_DEG) {
      printError(F("M360 blocked: logical E outside software limits"));
      return false;
    }
  }

  // For M360, feed is interpreted as units/min for the largest moving axis.
  // X/Y/E use degrees, Z uses mm.
  float eMotorDelta = targetEMotor - current.eMotorDeg;
  float largestMove = max(max(fabs(deltaShoulderDeg), fabs(deltaElbowDeg)), max(fabs(deltaZMm), fabs(eMotorDelta)));
  float fakeDistance = largestMove;

  if (!moveJointsToMotor(targetShoulder, targetElbow, targetZ, targetLogicalE, targetEMotor, fakeDistance, feedUnitsPerMin)) {
    return false;
  }

  // Update Cartesian X/Y estimate from the new joint angles.
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
  delay(300);
  disableMotors();
  return true;
}

void handleRawMoveM360(const String &line) {
  float dx = getParam(line, 'X', 0.0f); // shoulder motor, degrees
  float dy = getParam(line, 'Y', 0.0f); // elbow/platform motor, degrees
  float dz = getParam(line, 'Z', 0.0f); // Z motor, mm
  float de = getParam(line, 'E', 0.0f); // logical gripper angle, degrees
  float feed = getParam(line, 'F', CURRENT_SPEED);
  CURRENT_SPEED = feed;

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
  G_CODE_SERIAL.print(F("X:"));
  G_CODE_SERIAL.print(current.x, 3);
  G_CODE_SERIAL.print(F(" Y:"));
  G_CODE_SERIAL.print(current.y, 3);
  G_CODE_SERIAL.print(F(" Z:"));
  G_CODE_SERIAL.print(current.z, 3);
  G_CODE_SERIAL.print(F(" E:"));
  G_CODE_SERIAL.print(current.e, 3);

  G_CODE_SERIAL.print(F("  E_motor:"));
  G_CODE_SERIAL.print(current.eMotorDeg, 3);

  G_CODE_SERIAL.print(F("  Joints theta:"));
  G_CODE_SERIAL.print(current.shoulderDeg, 3);
  G_CODE_SERIAL.print(F(" psi:"));
  G_CODE_SERIAL.print(current.elbowDeg, 3);

  G_CODE_SERIAL.print(F("  gripper_mode:"));
  G_CODE_SERIAL.print(GRIPPER_MODE == GRIPPER_MODE_TRACKING ? F("tracking") : F("independent"));

  G_CODE_SERIAL.print(F("  steps S:"));
  G_CODE_SERIAL.print(shoulderSteps);
  G_CODE_SERIAL.print(F(" P:"));
  G_CODE_SERIAL.print(elbowSteps);
  G_CODE_SERIAL.print(F(" Z:"));
  G_CODE_SERIAL.print(zSteps);
  G_CODE_SERIAL.print(F(" E:"));
  G_CODE_SERIAL.println(eSteps);
}

void reportEndstops() {
  G_CODE_SERIAL.println(F("Reporting endstop status"));
  G_CODE_SERIAL.print(F("x_min: "));
  G_CODE_SERIAL.println(xMinTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("x_max: "));
  G_CODE_SERIAL.println(xMaxTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("y_min: "));
  G_CODE_SERIAL.println(yMinTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("y_max: "));
  G_CODE_SERIAL.println(yMaxTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("z_min: "));
  G_CODE_SERIAL.println(zMinTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("z_max: "));
  G_CODE_SERIAL.println(zMaxTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("e_min: "));
  G_CODE_SERIAL.println(eMinTriggered() ? F("TRIGGERED") : F("open"));

  G_CODE_SERIAL.print(F("e_max: "));
  G_CODE_SERIAL.println(eMaxTriggered() ? F("TRIGGERED") : F("open"));
}

void reportSettings() {
  G_CODE_SERIAL.println(F("SCARAnoi custom firmware settings"));

  G_CODE_SERIAL.print(F("Steps/unit: shoulder="));
  G_CODE_SERIAL.print(SHOULDER_STEPS_PER_DEG, 4);
  G_CODE_SERIAL.print(F(" steps/deg, elbow="));
  G_CODE_SERIAL.print(ELBOW_STEPS_PER_DEG, 4);
  G_CODE_SERIAL.print(F(" steps/deg, Z="));
  G_CODE_SERIAL.print(Z_STEPS_PER_MM, 4);
  G_CODE_SERIAL.print(F(" steps/mm, E="));
  G_CODE_SERIAL.print(E_STEPS_PER_DEG, 4);
  G_CODE_SERIAL.println(F(" steps/deg"));

  G_CODE_SERIAL.print(F("Links: L1="));
  G_CODE_SERIAL.print(LINK_1_MM, 3);
  G_CODE_SERIAL.print(F(" mm, L2="));
  G_CODE_SERIAL.print(LINK_2_MM, 3);
  G_CODE_SERIAL.println(F(" mm"));

  G_CODE_SERIAL.print(F("Gripper mode: "));
  G_CODE_SERIAL.println(GRIPPER_MODE == GRIPPER_MODE_TRACKING ? F("tracking") : F("independent"));

  G_CODE_SERIAL.print(F("Gripper compensation sign: "));
  G_CODE_SERIAL.println(GRIPPER_COMPENSATION_SIGN);

  G_CODE_SERIAL.print(F("Software limits: "));
  G_CODE_SERIAL.println(SOFTWARE_LIMITS_ENABLED ? F("ON") : F("OFF"));

  G_CODE_SERIAL.print(F("X["));
  G_CODE_SERIAL.print(X_MIN_MM);
  G_CODE_SERIAL.print(F(", "));
  G_CODE_SERIAL.print(X_MAX_MM);
  G_CODE_SERIAL.print(F("] Y["));
  G_CODE_SERIAL.print(Y_MIN_MM);
  G_CODE_SERIAL.print(F(", "));
  G_CODE_SERIAL.print(Y_MAX_MM);
  G_CODE_SERIAL.print(F("] Z["));
  G_CODE_SERIAL.print(Z_MIN_MM);
  G_CODE_SERIAL.print(F(", "));
  G_CODE_SERIAL.print(Z_MAX_MM);
  G_CODE_SERIAL.print(F("] E["));
  G_CODE_SERIAL.print(E_MIN_DEG);
  G_CODE_SERIAL.print(F(", "));
  G_CODE_SERIAL.print(E_MAX_DEG);
  G_CODE_SERIAL.println(F("]"));

  G_CODE_SERIAL.print(F("Motor states: X="));
  G_CODE_SERIAL.print(shoulderMotorEnabled ? F("ON") : F("OFF"));
  G_CODE_SERIAL.print(F(" Y="));
  G_CODE_SERIAL.print(elbowMotorEnabled ? F("ON") : F("OFF"));
  G_CODE_SERIAL.print(F(" Z="));
  G_CODE_SERIAL.print(zMotorEnabled ? F("ON") : F("OFF"));
  G_CODE_SERIAL.print(F(" E="));
  G_CODE_SERIAL.println(eMotorEnabled ? F("ON") : F("OFF"));

  G_CODE_SERIAL.print(F("Endstops enabled: Xmin="));
  G_CODE_SERIAL.print(USE_X_MIN_ENDSTOP);
  G_CODE_SERIAL.print(F(" Xmax="));
  G_CODE_SERIAL.print(USE_X_MAX_ENDSTOP);
  G_CODE_SERIAL.print(F(" Ymin="));
  G_CODE_SERIAL.print(USE_Y_MIN_ENDSTOP);
  G_CODE_SERIAL.print(F(" Ymax="));
  G_CODE_SERIAL.print(USE_Y_MAX_ENDSTOP);
  G_CODE_SERIAL.print(F(" Zmin="));
  G_CODE_SERIAL.print(USE_Z_MIN_ENDSTOP);
  G_CODE_SERIAL.print(F(" Zmax="));
  G_CODE_SERIAL.print(USE_Z_MAX_ENDSTOP);
  G_CODE_SERIAL.print(F(" Emin="));
  G_CODE_SERIAL.print(USE_E_MIN_ENDSTOP);
  G_CODE_SERIAL.print(F(" Emax="));
  G_CODE_SERIAL.println(USE_E_MAX_ENDSTOP);
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
  delay(200);

  gripperServo.detach();
  gripperAttached = false;

  G_CODE_SERIAL.print(F("echo: servo P0 set to "));
  G_CODE_SERIAL.println(angle);
}

void handleM281(const String &line) {
  if (hasParam(line, 'O')) SERVO_OPEN_ANGLE = (int)getParam(line, 'O', SERVO_OPEN_ANGLE);
  //if (hasParam(line, 'C')) SERVO_CLOSE_ANGLE = (int)getParam(line, 'C', SERVO_CLOSE_ANGLE);

  SERVO_OPEN_ANGLE = constrain(SERVO_OPEN_ANGLE, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
  //SERVO_CLOSE_ANGLE = constrain(SERVO_CLOSE_ANGLE, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);

  G_CODE_SERIAL.print(F("echo: gripper open="));
  G_CODE_SERIAL.print(SERVO_OPEN_ANGLE);
  //G_CODE_SERIAL.print(F(" close="));
  //G_CODE_SERIAL.println(SERVO_CLOSE_ANGLE);
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

  G_CODE_SERIAL.println(F("echo: servo P0 detached"));
}

void handleM361(const String &line) {
  if (hasParam(line, 'S')) {
    int mode = (int)getParam(line, 'S', GRIPPER_MODE);

    if (mode != GRIPPER_MODE_INDEPENDENT && mode != GRIPPER_MODE_TRACKING) {
      printError(F("M361 S must be 0 independent or 1 tracking"));
      return;
    }

    GRIPPER_MODE = mode;

    // Keep the raw E motor where it is and recompute the logical gripper angle.
    current.e = motorToLogicalE(current.eMotorDeg, current.shoulderDeg, current.elbowDeg);
  }

  G_CODE_SERIAL.print(F("echo: gripper mode="));
  G_CODE_SERIAL.println(GRIPPER_MODE == GRIPPER_MODE_TRACKING ? F("tracking") : F("independent"));
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
    current.eMotorDeg = logicalToMotorE(current.e, current.shoulderDeg, current.elbowDeg);
    updateStepCountersFromPosition();
  } else {
    printError(F("G92 XY position outside reachable workspace"));
    return;
  }
}

float getCurrentPegX_Up() {
  if (CURRENT_PEG == 2) return X_PEG2_UP;
  else if (CURRENT_PEG == 1) return X_PEG1_UP;
  else return X_PEG0_UP;
}

float getCurrentPegY_Up() {
  if (CURRENT_PEG == 2) return Y_PEG2_UP;
  else if (CURRENT_PEG == 1) return Y_PEG1_UP;
  else return Y_PEG0_UP;
}

float getCurrentPegX_Down() {
  if (CURRENT_PEG == 2) return X_PEG2;
  else if (CURRENT_PEG == 1) return X_PEG1;
  else return X_PEG0;
}

float getCurrentPegY_Down() {
  if (CURRENT_PEG == 2) return Y_PEG2;
  else if (CURRENT_PEG == 1) return Y_PEG1;
  else return Y_PEG0;
}


bool handleMove(const String &line) {
  float feed = getParam(line, 'F', CURRENT_SPEED);
  CURRENT_SPEED = feed;

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
  return moveLinearCartesian(targetX, targetY, targetZ, targetE, feed);
}

void handleCommand(String rawLine) {
  String line = stripCommentAndUpper(rawLine);
  if (line.length() == 0) return;

  if (serialLineLooksEmergency(line)) {
    emergencyStop(F("M112 received"));
    return;
  }

  // --- CUSTOM TEXT COMMANDS ---
  if (line == "START") {
    handleRawMoveM360("M360 X" + String(X_START) + " Y" + String(Y_START) + " Z" + String(Z_START) + " E" + String(E_START));
    handleM361("M361 S0");
    if (
      handleMove("G1 X" + String(getCurrentPegX_Up()) + " Y" + String(getCurrentPegY_Up())) &&
      handleMove("G1 Z" + String(Z_UP))
    ) {
      printOk();
    }
    return;
  }
    // UP: Moves to the UP X/Y coordinates for the current peg, at Z_UP height
  if (line == "UP") { 
    if (handleMove("G1 X" + String(getCurrentPegX_Up()) + " Y" + String(getCurrentPegY_Up()) + " Z" + String(Z_UP))) {
      printOk();
    } 
    return; 
  }
  
  if (line == "LAYER1") {
    if (
      handleMove("G1 X" + String(getCurrentPegX_Down()) + " Y" + String(getCurrentPegY_Down())) &&
      handleMove("G1 Z" + String(Z_LAYER1))
    ) {
      printOk();
    }
    return;
  }
  if (line == "LAYER2") {
    if (
      handleMove("G1 X" + String(getCurrentPegX_Down()) + " Y" + String(getCurrentPegY_Down())) &&
      handleMove("G1 Z" + String(Z_LAYER2))
    ) {
      printOk();
    }
    return;
  }
  if (line == "LAYER3") {
    if (
      handleMove("G1 X" + String(getCurrentPegX_Down()) + " Y" + String(getCurrentPegY_Down())) &&
      handleMove("G1 Z" + String(Z_LAYER3))
    ) {
      printOk();
    }
    return;
  }
  if (line == "LAYER4") {
    if (
      handleMove("G1 X" + String(getCurrentPegX_Down()) + " Y" + String(getCurrentPegY_Down())) &&
      handleMove("G1 Z" + String(Z_LAYER4))
    ) {
      printOk();
    }
    return;
  }
  if (line == "LAYER5") {
    if (
      handleMove("G1 X" + String(getCurrentPegX_Down()) + " Y" + String(getCurrentPegY_Down())) &&
      handleMove("G1 Z" + String(Z_LAYER5))
    ) {
      printOk();
    }
    return;
  }

  if (line == "PEG2") { 
    float old_speed = CURRENT_SPEED;
    CURRENT_SPEED = SIDE_SPEED;
    CURRENT_PEG = 2; 
    if (
      handleMove("G1 Z" + String(Z_UP)) &&
      handleMove("G1 X" + String(getCurrentPegX_Up()) + " Y" + String(getCurrentPegY_Up()))
    ) {
      printOk();
    }
    CURRENT_SPEED = old_speed;
    return; 
  }
  if (line == "PEG1") { 
    float old_speed = CURRENT_SPEED;
    CURRENT_SPEED = SIDE_SPEED;
    CURRENT_PEG = 1; 
    if (
      handleMove("G1 Z" + String(Z_UP)) &&
      handleMove("G1 X" + String(getCurrentPegX_Up()) + " Y" + String(getCurrentPegY_Up()))
    ) {
      printOk();
    }
    CURRENT_SPEED = old_speed;
    return; 
  }
  if (line == "PEG0") { 
    float old_speed = CURRENT_SPEED;
    CURRENT_SPEED = SIDE_SPEED;
    CURRENT_PEG = 0; 
    if (
      handleMove("G1 Z" + String(Z_UP)) &&
      handleMove("G1 X" + String(getCurrentPegX_Up()) + " Y" + String(getCurrentPegY_Up()))
    ) {
      printOk();
    }
    CURRENT_SPEED = old_speed;
    return; 
  }

  if (line == "SPEED") {
    G_CODE_SERIAL.println(String(CURRENT_SPEED));
    return;
  }


  if (line == "OPEN") { 
    handleM280("M280 P0 S" + String(SERVO_OPEN_ANGLE));
    printOk();
    return; 
  }
  if (line == "CLOSE1") { 
    handleM280("M280 P0 S" + String(SERVO_CLOSE_ANGLE1)); 
    printOk();
    return; 
  }
  if (line == "CLOSE2") { 
    handleM280("M280 P0 S" + String(SERVO_CLOSE_ANGLE2)); 
    printOk();
    return; 
  }
  if (line == "CLOSE3") { 
    handleM280("M280 P0 S" + String(SERVO_CLOSE_ANGLE3)); 
    printOk();
    return; 
  }
  if (line == "CLOSE4") { 
    handleM280("M280 P0 S" + String(SERVO_CLOSE_ANGLE4)); 
    printOk();
    return; 
  }
  if (line == "CLOSE5") { 
    handleM280("M280 P0 S" + String(SERVO_CLOSE_ANGLE5)); 
    printOk();
    return; 
  }


    // --- CENTER MEASUREMENT COMMANDS ---
  if (line == "CENTER X") { 
    if (USE_X_MIN_ENDSTOP && USE_X_MAX_ENDSTOP) measureAxisCenter('X', shoulderAxis, xMinTriggered, xMaxTriggered, -1);
    else printError(F("X min and max endstops must be enabled"));
    return; 
  }
  if (line == "CENTER Y") { 
    if (USE_Y_MIN_ENDSTOP && USE_Y_MAX_ENDSTOP) measureAxisCenter('Y', elbowAxis, yMinTriggered, yMaxTriggered, -1);
    else printError(F("Y min and max endstops must be enabled"));
    return; 
  }
  if (line == "CENTER Z") { 
    // If your Z min switch is actually in the +1 direction, change the -1 below to 1
    if (USE_Z_MIN_ENDSTOP && USE_Z_MAX_ENDSTOP) measureAxisCenter('Z', zAxis, zMinTriggered, zMaxTriggered, -1);
    else printError(F("Z min and max endstops must be enabled"));
    return; 
  }
  if (line == "CENTER E") { 
    if (USE_E_MIN_ENDSTOP && USE_E_MAX_ENDSTOP) measureAxisCenter('E', eAxis, eMinTriggered, eMaxTriggered, -1);
    else printError(F("E min and max endstops must be enabled"));
    return; 
  }
  // ----------------------------

  int g = getCommandNumber(line, 'G');
  int m = getCommandNumber(line, 'M');

  if (emergencyStopped && !(m == 999 || m == 112 || m == 114 || m == 119)) {
    printError(F("machine is emergency stopped; send M999 to clear"));
    return;
  }

  if (g == 0 || g == 1) {
    if (handleMove(line)) {
      printOk();
    }
    return;
  }

  if (g == 4) {
    unsigned long p = (unsigned long)getParam(line, 'P', 0.0f);
    delay(p);
    printOk();
    return;
  }

  if (g == 28) {
    if (handleG28(line)) {
      handleM280("M280 P0 S" + String(SERVO_OPEN_ANGLE));
      printOk();
    }
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
    G_CODE_SERIAL.print(F("echo: software endstops "));
    G_CODE_SERIAL.println(SOFTWARE_LIMITS_ENABLED ? F("ON") : F("OFF"));
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

  if (m == 361) {
    handleM361(line);
    printOk();
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
    G_CODE_SERIAL.println(F("echo: emergency stop cleared"));
    printOk();
    return;
  }

  G_CODE_SERIAL.print(F("error: unsupported command: "));
  G_CODE_SERIAL.println(line);
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
  pinMode(E_MIN_PIN, INPUT_PULLUP);
  pinMode(E_MAX_PIN, INPUT_PULLUP);

  disableMotors();
}

void setup() {
  G_CODE_SERIAL.begin(BAUDRATE);
  Serial.begin(BAUDRATE);
  setupPins();

  current.shoulderDeg = SHOULDER_HOME_DEG;
  current.elbowDeg = ELBOW_HOME_DEG;
  current.z = Z_HOME_MM;
  current.eMotorDeg = E_HOME_DEG;
  current.e = motorToLogicalE(current.eMotorDeg, current.shoulderDeg, current.elbowDeg);
  forwardKinematics(current.shoulderDeg, current.elbowDeg, current.x, current.y);
  updateStepCountersFromPosition();

  G_CODE_SERIAL.println(F("SCARAnoi custom RAMPS firmware ready"));
  G_CODE_SERIAL.println(F("echo: send M503 for settings, M119 for endstops, M114 for position"));
  G_CODE_SERIAL.println(F("echo: M361 S0 independent gripper mode, M361 S1 tracking gripper mode"));
  printOk();
}

void loop() {
  while (G_CODE_SERIAL.available() > 0) {
    char c = (char)G_CODE_SERIAL.read();
    Serial.print(c);

    

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