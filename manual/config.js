const CONFIG = {
  espIp: "192.168.4.1",

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
    wrist: "E"
  },

  gripper: {
    open: "M280 P0 S10",
    close: "M280 P0 S90"
  },

  system: {
    home: "G28",
    getPosition: "M114",
    stop: "M410",
    emergencyStop: "M112",
    firmwareInfo: "M115"
  }
};

/**
 * F in marlin expects mm/min, but our UI uses mm/s, so we convert here.
 */

function mmPerSecToFeedrate(speedMmPerSec) {
  return Number(speedMmPerSec) * 60;
}

/**
 * Formats a number to have at most 2 decimal places, and removes trailing .00 for integers.
 * To have G1 X10 F900 instead of G1 X10.00 F900 for example.
 */
function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

/**
 * Builds G-code for relative moves. 
 * Uses G91 to switch to relative mode, then G1 with the appropriate axis and feedrate, 
 * then G90 to switch back to absolute mode.
 */

function buildRelativeMove(axis, delta, feedrate) {
  return `G91\nG1 ${axis}${formatNumber(delta)} F${feedrate}\nG90`;
}

/**
 * Builds a command like:
 * G90
 * G1 X120 Y80 Z30 F900
 */

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

function getActionGcode(action, values) {
  const feedrate = mmPerSecToFeedrate(values.speed);
  const linearStep = Number(values.linearStep);
  const wristStep = Number(values.wristStep);

  const map = {
    "home": {
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
    "open-gripper": {
      label: "Open Gripper",
      gcode: CONFIG.gripper.open
    },
    "close-gripper": {
      label: "Close Gripper",
      gcode: CONFIG.gripper.close
    },
    "get-position": {
      label: "Get Position",
      gcode: CONFIG.system.getPosition
    },
    "stop": {
      label: "Stop",
      gcode: CONFIG.system.stop
    },
    "emergency-stop": {
      label: "Emergency Stop",
      gcode: CONFIG.system.emergencyStop
    },
    "firmware-info": {
      label: "Firmware Info",
      gcode: CONFIG.system.firmwareInfo
    }
  };

  return map[action] || null;
}