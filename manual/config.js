const CONFIG = {
  espIp: "192.168.4.1",

  arm: {
    link1: 185.412,
    link2: 111.0,
    forbiddenRadius: 35
  },

  speed: {
    min: 10,
    max: 25,
    default: 15
  },

  steps: {
    linearDefault: 5,
    wristDefault: 5
  },

  axes: {
    x: "X",
    y: "Y",
    z: "Z",
    wrist: "E",
    shoulder: "A",
    elbow: "B",
    lift: "C"
  },

  gripper: {
    open: "M280 P0 S10",
    close: "M280 P0 S90",
    bounds: "M281 P0 L0 U180",
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

function mmPerSecToFeedrate(speedMmPerSec) {
  return Number(speedMmPerSec) * 60;
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
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

  if (parts.length === 0) return null;

  return `G92 ${parts.join(" ")}`;
}

function buildDirectStepperMove(values) {
  const feedrate = mmPerSecToFeedrate(values.speed);
  return `G6 A0 B0 C0 F${feedrate}`;
}

function getActionGcode(action, values) {
  const feedrate = mmPerSecToFeedrate(values.speed);
  const linearStep = Number(values.linearStep);
  const wristStep = Number(values.wristStep);

  const map = {
    home: {
      label: "Home",
      gcode: CONFIG.system.home
    },

    "move-up": {
      label: "Move Up",
      gcode: buildRelativeMove(CONFIG.axes.z, linearStep, feedrate)
    },

    "move-down": {
      label: "Move Down",
      gcode: buildRelativeMove(CONFIG.axes.z, -linearStep, feedrate)
    },

    "jog-x-negative": {
      label: "Jog X -",
      gcode: buildRelativeMove(CONFIG.axes.x, -linearStep, feedrate)
    },

    "jog-x-positive": {
      label: "Jog X +",
      gcode: buildRelativeMove(CONFIG.axes.x, linearStep, feedrate)
    },

    "jog-y-negative": {
      label: "Jog Y -",
      gcode: buildRelativeMove(CONFIG.axes.y, -linearStep, feedrate)
    },

    "jog-y-positive": {
      label: "Jog Y +",
      gcode: buildRelativeMove(CONFIG.axes.y, linearStep, feedrate)
    },

    "wrist-left": {
      label: "Wrist Left",
      gcode: buildRelativeMove(CONFIG.axes.wrist, -wristStep, feedrate)
    },

    "wrist-right": {
      label: "Wrist Right",
      gcode: buildRelativeMove(CONFIG.axes.wrist, wristStep, feedrate)
    },

    "direct-stepper": {
      label: "Direct Stepper Move",
      gcode: buildDirectStepperMove(values)
    },

    "open-gripper": {
      label: "Open Gripper",
      gcode: CONFIG.gripper.open
    },

    "close-gripper": {
      label: "Close Gripper",
      gcode: CONFIG.gripper.close
    },

    "servo-bounds": {
      label: "Servo Bounds",
      gcode: CONFIG.gripper.bounds
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