const CONFIG = {
  espIp: "192.168.4.1",

  arm: {
    link1: 185.412,
    link2: 111.0,
    forbiddenRadius: 35
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

function unitsPerSecondToFeedrate(unitsPerSecond) {
  return Number(unitsPerSecond) * 60;
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

function buildServoBounds(minAngle, maxAngle) {
  return `M281 P0 L${formatNumber(minAngle)} U${formatNumber(maxAngle)}`;
}

function getActionGcode(action, values) {
  const xyFeedrate = unitsPerSecondToFeedrate(values.xySpeed);
  const zFeedrate = unitsPerSecondToFeedrate(values.zSpeed);
  const wristFeedrate = unitsPerSecondToFeedrate(values.wristSpeed);

  const xyStep = Number(values.xyStep);
  const zStep = Number(values.zStep);
  const wristStep = Number(values.wristStep);

  const map = {
    home: {
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
      gcode: buildServoMove(values.servoOpen)
    },

    "close-gripper": {
      label: "Close Gripper",
      gcode: buildServoMove(values.servoClose)
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