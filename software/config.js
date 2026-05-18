const CONFIG = {
  // The ESP32 is connected as a normal Wi-Fi client on SPOT-iot.
  // Change this from the interface if the router gives the ESP32 another IP.
  espIp: localStorage.getItem("scaranoiEspIp") || "172.21.76.162",

  // Python OpenCV bridge. Run cv_server.py and open http://localhost:5000.
  // The camera panel uses this annotated stream instead of the raw ESP32 stream.
  cvServerUrl: localStorage.getItem("scaranoiCvServerUrl") || "http://localhost:5000",

  arm: {
    link1: 185.412,
    link2: 111.000,
    forbiddenRadius: 35,
    displayScale: 0.55
  },

  // Firmware-owned Hanoi coordinates/macros.
  // The solver now sends these text commands directly to the firmware instead of
  // generating raw peg X/Y/Z/servo values in the browser.
  hanoi: {
    numDisks: 5,
    targetPegWhenNotSolved: 2,
    targetPegWhenAlreadyOnRight: 0,
    autoStepDelayMs: 2000,

    firmwarePegs: [
      { name: "PEG0", x: 72,  y: 220 },
      { name: "PEG1", x: -2,  y: 195 },
      { name: "PEG2", x: -87, y: 230 }
    ],

    firmwareCommands: {
      start: "START",
      up: "UP",
      open: "OPEN",
      close: "CLOSE",
      pegCommandsByIndex: ["PEG0", "PEG1", "PEG2"],
      layerPrefix: "LAYER"
    },

    firmwareServo: {
      openAngle: 100,
      closeAngle: 0
    }
  },

  axes: {
    x: "X",
    y: "Y",
    z: "Z",
    wrist: "E"
  },

  gripper: {
    detach: "M282 P0"
  },

  system: {
    home: "G28",
    getPosition: "M114",
    checkEndstops: "M119",
    enableMotors: "M17",
    disableMotors: "M18",
    emergencyStop: "M112"
  }
};

function setEspIp(ip) {
  const clean = String(ip || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean) return false;
  CONFIG.espIp = clean;
  localStorage.setItem("scaranoiEspIp", clean);
  return true;
}

function getControlBaseUrl() {
  return `http://${CONFIG.espIp}`;
}

function getStreamUrl() {
  return `http://${CONFIG.espIp}:81/stream`;
}

function getCaptureUrl() {
  return `http://${CONFIG.espIp}/capture`;
}

function getCvServerBaseUrl() {
  const clean = String(CONFIG.cvServerUrl || "").trim().replace(/\/$/, "");
  return clean || "http://localhost:5000";
}

function getCvStreamUrl() {
  return `${getCvServerBaseUrl()}/cv-stream`;
}

function getCvSnapshotUrl() {
  return `${getCvServerBaseUrl()}/cv-snapshot`;
}

function getCvDetectUrl() {
  return `${getCvServerBaseUrl()}/detect`;
}

function getCvSetEspUrl() {
  return `${getCvServerBaseUrl()}/set-esp?ip=${encodeURIComponent(CONFIG.espIp)}`;
}

function unitsPerSecondToFeedrate(unitsPerSecond) {
  return Number(unitsPerSecond) * 60;
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function buildRelativeMove(axis, delta, feedrate) {
  return `G91\nG1 ${axis}${formatNumber(delta)} F${feedrate}\nG90`;
}

function buildAbsoluteMove(coords, feedrate) {
  const parts = [];

  if (coords.x !== "" && coords.x !== null && coords.x !== undefined) {
    parts.push(`${CONFIG.axes.x}${formatNumber(coords.x)}`);
  }

  if (coords.y !== "" && coords.y !== null && coords.y !== undefined) {
    parts.push(`${CONFIG.axes.y}${formatNumber(coords.y)}`);
  }

  if (coords.z !== "" && coords.z !== null && coords.z !== undefined) {
    parts.push(`${CONFIG.axes.z}${formatNumber(coords.z)}`);
  }

  if (coords.e !== "" && coords.e !== null && coords.e !== undefined) {
    parts.push(`${CONFIG.axes.wrist}${formatNumber(coords.e)}`);
  }

  if (parts.length === 0) return null;

  return `G90\nG1 ${parts.join(" ")} F${feedrate}`;
}

function buildSetPosition(coords) {
  const parts = [];

  if (coords.x !== "" && coords.x !== null && coords.x !== undefined) {
    parts.push(`${CONFIG.axes.x}${formatNumber(coords.x)}`);
  }

  if (coords.y !== "" && coords.y !== null && coords.y !== undefined) {
    parts.push(`${CONFIG.axes.y}${formatNumber(coords.y)}`);
  }

  if (coords.z !== "" && coords.z !== null && coords.z !== undefined) {
    parts.push(`${CONFIG.axes.z}${formatNumber(coords.z)}`);
  }

  if (coords.e !== "" && coords.e !== null && coords.e !== undefined) {
    parts.push(`${CONFIG.axes.wrist}${formatNumber(coords.e)}`);
  }

  if (parts.length === 0) return null;

  return `G92 ${parts.join(" ")}`;
}

function buildServoMove(angle) {
  return `M280 P0 S${formatNumber(angle)}`;
}

// Firmware M281 uses O=open angle, C=close angle.
function buildServoBounds(minAngle, maxAngle) {
  return `M281 O${formatNumber(minAngle)} C${formatNumber(maxAngle)}`;
}

function getActionGcode(action, values) {
  const xyFeedrate = unitsPerSecondToFeedrate(values.xySpeed);
  const zFeedrate = unitsPerSecondToFeedrate(values.zSpeed);
  const wristFeedrate = unitsPerSecondToFeedrate(values.wristSpeed);

  const xyStep = Number(values.xyStep);
  const zStep = Number(values.zStep);
  const wristStep = Number(values.wristStep);

  const map = {
    "home": {
      label: "Home",
      gcode: CONFIG.system.home
    },

    "move-up": {
      label: "Z Up",
      gcode: buildRelativeMove(CONFIG.axes.z, zStep, zFeedrate)
    },

    "move-down": {
      label: "Z Down",
      gcode: buildRelativeMove(CONFIG.axes.z, -zStep, zFeedrate)
    },

    "jog-x-negative": {
      label: "Jog X -",
      gcode: buildRelativeMove(CONFIG.axes.x, -xyStep, xyFeedrate)
    },

    "jog-x-positive": {
      label: "Jog X +",
      gcode: buildRelativeMove(CONFIG.axes.x, xyStep, xyFeedrate)
    },

    "jog-y-negative": {
      label: "Jog Y -",
      gcode: buildRelativeMove(CONFIG.axes.y, -xyStep, xyFeedrate)
    },

    "jog-y-positive": {
      label: "Jog Y +",
      gcode: buildRelativeMove(CONFIG.axes.y, xyStep, xyFeedrate)
    },

    "wrist-left": {
      label: "Wrist Left",
      gcode: buildRelativeMove(CONFIG.axes.wrist, -wristStep, wristFeedrate)
    },

    "wrist-right": {
      label: "Wrist Right",
      gcode: buildRelativeMove(CONFIG.axes.wrist, wristStep, wristFeedrate)
    },

    "open-gripper": {
      label: "Open Gripper",
      gcode: CONFIG.hanoi.firmwareCommands.open
    },

    "close-gripper": {
      label: "Close Gripper",
      gcode: CONFIG.hanoi.firmwareCommands.close
    },

    "firmware-start": {
      label: "Firmware Start",
      gcode: CONFIG.hanoi.firmwareCommands.start
    },

    "firmware-up": {
      label: "Safe Height",
      gcode: CONFIG.hanoi.firmwareCommands.up
    },

    "firmware-peg1": {
      label: "Go to PEG1",
      gcode: "PEG1"
    },

    "firmware-peg2": {
      label: "Go to PEG2",
      gcode: "PEG2"
    },

    "firmware-peg3": {
      label: "Go to PEG3",
      gcode: "PEG3"
    },

    "firmware-layer1": {
      label: "Go to LAYER1",
      gcode: "LAYER1"
    },

    "firmware-layer2": {
      label: "Go to LAYER2",
      gcode: "LAYER2"
    },

    "firmware-layer3": {
      label: "Go to LAYER3",
      gcode: "LAYER3"
    },

    "firmware-layer4": {
      label: "Go to LAYER4",
      gcode: "LAYER4"
    },

    "firmware-layer5": {
      label: "Go to LAYER5",
      gcode: "LAYER5"
    },

    "servo-bounds": {
      label: "Servo Bounds",
      gcode: buildServoBounds(values.servoMin, values.servoMax)
    },

    "detach-servo": {
      label: "Detach Servo",
      gcode: CONFIG.gripper.detach
    },

    "get-position": {
      label: "Get Position",
      gcode: CONFIG.system.getPosition
    },

    "check-endstops": {
      label: "Check Endstops",
      gcode: CONFIG.system.checkEndstops
    },

    "enable-motors": {
      label: "Enable Motors",
      gcode: CONFIG.system.enableMotors
    },

    "disable-motors": {
      label: "Disable Motors",
      gcode: CONFIG.system.disableMotors
    },

    "emergency-stop": {
      label: "Emergency Stop",
      gcode: CONFIG.system.emergencyStop
    }
  };

  return map[action] || null;
}