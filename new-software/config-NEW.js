const CONFIG = {
  espIp: localStorage.getItem("scaranoiEspIp") || "172.21.76.162",

  // Python OpenCV bridge. It still runs locally for camera processing/CV.
  cvServerUrl: localStorage.getItem("scaranoiCvServerUrl") || "http://localhost:5000",

  // Robot commands are now sent to the ESP32 HTTP bridge, not to the computer/USB bridge.
  // The control URL is derived from espIp in getControlBaseUrl().

  arm: {
    link1: 185.412,
    link2: 111.000,
    forbiddenRadius: 35,
    displayScale: 0.55
  },

  hanoi: {
    maxDisks: 5,
    // Keep this false if you want to solve partial/variant setups such as [5 4 3].
    requireExactDiskCount: false,
    numDisks: 5,
    // After each completed disk transfer, capture CV again and compare it with the expected state.
    verifyAfterEachMove: true,
    targetPegWhenNotSolved: 2,
    targetPegWhenAlreadyOnRight: 0,
    // With M400/M114 sync, this only needs to be a short camera-settle delay.
    verifyDelayMs: 300,
    // Small UI gap between substeps. The solver now waits for firmware ok on each substep.
    autoStepDelayMs: 50,
    // Max time to wait for one Hanoi physical substep to finish and acknowledge.
    substepTimeoutSeconds: 45,
    // START is a firmware macro that currently prints more than one ok.
    // The ESP bridge waits for this many ok lines before the UI continues.
    startOkCount: 2,
    startTimeoutSeconds: 90,
    // After START, do not immediately run M400/M114. START already moved the arm
    // and old firmware output can still be flushing; syncing here can make M114 timeout.
    syncAfterStart: false,
    completionSyncCommand: "M400\nM114",
    completionTimeoutSeconds: 45,

    // Real peg centers used for drawing the yellow peg markers.
    firmwarePegs: [
      { name: "PEG0", x: -100, y: 275 },
      { name: "PEG1", x: 18,   y: 275 },
      { name: "PEG2", x: 145,  y: 275 }
    ],

    // Coordinates reached by the firmware PEG0/PEG1/PEG2 macros at Z_UP.
    // These should match X_PEG*_UP / Y_PEG*_UP in the Arduino firmware.
    firmwarePegUpPositions: [
      { name: "PEG0", x: -95, y: 275 },
      { name: "PEG1", x: 22,  y: 265 },
      { name: "PEG2", x: 140, y: 258 }
    ],

    firmwareCommands: {
      start: "START",
      up: "UP",
      open: "OPEN",
      close: "CLOSE1",
      pegCommandsByIndex: ["PEG0", "PEG1", "PEG2"],
      layerPrefix: "LAYER"
    },

    firmwareServo: {
      openAngle: 120,
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
    emergencyStop: "M112",
    // Home can be slow. This is only a maximum safety timeout; M114 is sent
    // immediately after G28 returns ok, not after a fixed delay.
    homeTimeoutSeconds: 120,
    positionSyncTimeoutSeconds: 10
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

    "firmware-peg0": {
      label: "Go to PEG0",
      gcode: "PEG0"
    },

    "firmware-peg1": {
      label: "Go to PEG1",
      gcode: "PEG1"
    },

    "firmware-peg2": {
      label: "Go to PEG2",
      gcode: "PEG2"
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