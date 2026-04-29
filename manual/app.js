const xySpeedSlider = document.getElementById("xySpeedSlider");
const zSpeedSlider = document.getElementById("zSpeedSlider");
const wristSpeedSlider = document.getElementById("wristSpeedSlider");

const xySpeedValue = document.getElementById("xySpeedValue");
const zSpeedValue = document.getElementById("zSpeedValue");
const wristSpeedValue = document.getElementById("wristSpeedValue");

const xySpeedStatus = document.getElementById("xySpeedStatus");
const zSpeedStatus = document.getElementById("zSpeedStatus");
const wristSpeedStatus = document.getElementById("wristSpeedStatus");

const xyStepInput = document.getElementById("xyStep");
const zStepInput = document.getElementById("zStep");
const wristStepInput = document.getElementById("wristStep");

const servoOpenInput = document.getElementById("servoOpen");
const servoCloseInput = document.getElementById("servoClose");
const servoMinInput = document.getElementById("servoMin");
const servoMaxInput = document.getElementById("servoMax");

const absXInput = document.getElementById("absX");
const absYInput = document.getElementById("absY");
const absZInput = document.getElementById("absZ");
const absEInput = document.getElementById("absE");

const customMsgInput = document.getElementById("customMsg");

const lastCommandEl = document.getElementById("lastCommand");
const lastResponseEl = document.getElementById("lastResponse");
const connectionStatusEl = document.getElementById("connectionStatus");
const previewAbsoluteCodeEl = document.getElementById("previewAbsoluteCode");
const logBox = document.getElementById("logBox");
const tooltipEl = document.getElementById("commandTooltip");
const tooltipToggle = document.getElementById("tooltipToggle");

const workspaceCanvas = document.getElementById("workspaceCanvas");
const workspaceCtx = workspaceCanvas.getContext("2d");

const coordXEl = document.getElementById("coordX");
const coordYEl = document.getElementById("coordY");
const coordZEl = document.getElementById("coordZ");
const coordEEl = document.getElementById("coordE");

const radiusStatusEl = document.getElementById("radiusStatus");
const workspaceStatusEl = document.getElementById("workspaceStatus");
const shoulderStatusEl = document.getElementById("shoulderStatus");
const elbowStatusEl = document.getElementById("elbowStatus");

let tooltipsEnabled = true;
let commandDescriptions = {};
let positioningMode = "absolute";
let simulatedPosition = null;

function hasKnownPosition() {
  return simulatedPosition !== null;
}

function setSimulatedPosition(x = 0, y = 0, z = 0, e = 0) {
  simulatedPosition = { x, y, z, e };
}

function getWorkspaceLimits() {
  const l1 = CONFIG.arm.link1;
  const l2 = CONFIG.arm.link2;

  return {
    maxReach: l1 + l2,
    minReach: Math.max(Math.abs(l1 - l2), CONFIG.arm.forbiddenRadius)
  };
}

function clampXYToWorkspace(x, y) {
  const limits = getWorkspaceLimits();
  const radius = Math.sqrt(x * x + y * y);

  if (radius === 0) {
    return {
      x: limits.minReach,
      y: 0,
      clamped: true
    };
  }

  let clampedRadius = radius;
  let clamped = false;

  if (radius > limits.maxReach) {
    clampedRadius = limits.maxReach;
    clamped = true;
  }

  if (radius < limits.minReach) {
    clampedRadius = limits.minReach;
    clamped = true;
  }

  return {
    x: x * clampedRadius / radius,
    y: y * clampedRadius / radius,
    clamped
  };
}

function isXYOutsideWorkspace(x, y) {
  return clampXYToWorkspace(x, y).clamped;
}

function getTargetXYFromInputs() {
  const xRaw = absXInput.value.trim();
  const yRaw = absYInput.value.trim();

  if (xRaw === "" && yRaw === "") {
    return null;
  }

  const currentX = hasKnownPosition() ? simulatedPosition.x : 0;
  const currentY = hasKnownPosition() ? simulatedPosition.y : 0;

  const targetX = xRaw !== "" ? Number(xRaw) : currentX;
  const targetY = yRaw !== "" ? Number(yRaw) : currentY;

  if (Number.isNaN(targetX) || Number.isNaN(targetY)) {
    appendLog("! X and Y must be valid numbers.");
    return null;
  }

  return {
    x: targetX,
    y: targetY
  };
}

function getUiValues() {
  return {
    xySpeed: Number(xySpeedSlider.value),
    zSpeed: Number(zSpeedSlider.value),
    wristSpeed: Number(wristSpeedSlider.value),

    xyStep: Number(xyStepInput.value),
    zStep: Number(zStepInput.value),
    wristStep: Number(wristStepInput.value),

    servoOpen: Number(servoOpenInput.value),
    servoClose: Number(servoCloseInput.value),
    servoMin: Number(servoMinInput.value),
    servoMax: Number(servoMaxInput.value)
  };
}

function appendLog(text) {
  logBox.textContent += `\n${text}`;
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.textContent = "Ready.";
}

async function loadCommandDescriptions() {
  try {
    const response = await fetch("command-descriptions.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    commandDescriptions = await response.json();
  } catch (error) {
    appendLog(`! Failed to load command descriptions: ${error}`);
    commandDescriptions = {};
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTooltipData(action) {
  const descriptionEntry = commandDescriptions[action];
  const actionData = getActionGcode(action, getUiValues());

  if (!descriptionEntry && !actionData) return null;

  return {
    command: actionData?.gcode || descriptionEntry?.command || "No command available",
    description: descriptionEntry?.description || "No description available."
  };
}

function renderTooltipContent(action) {
  const data = getTooltipData(action);
  if (!data) return "";

  return `
    <div class="tooltip-command">${escapeHtml(data.command)}</div>
    <div class="tooltip-description">${escapeHtml(data.description)}</div>
  `;
}

function showTooltip(action, event) {
  if (!tooltipsEnabled) return;

  const html = renderTooltipContent(action);
  if (!html) return;

  tooltipEl.innerHTML = html;
  tooltipEl.classList.add("visible");
  moveTooltip(event);
}

function setupTooltipToggle() {
  if (!tooltipToggle) return;

  tooltipsEnabled = tooltipToggle.checked;

  tooltipToggle.addEventListener("change", () => {
    tooltipsEnabled = tooltipToggle.checked;
    if (!tooltipsEnabled) hideTooltip();
  });
}

function moveTooltip(event) {
  tooltipEl.style.left = `${event.pageX + 14}px`;
  tooltipEl.style.top = `${event.pageY + 14}px`;
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
}

function setupCommandTooltips() {
  const buttons = document.querySelectorAll("[data-command]");

  buttons.forEach((button) => {
    const commandKey = button.dataset.command;

    button.addEventListener("mouseenter", (event) => {
      showTooltip(commandKey, event);
    });

    button.addEventListener("mousemove", (event) => {
      if (tooltipEl.classList.contains("visible")) {
        moveTooltip(event);
      }
    });

    button.addEventListener("mouseleave", hideTooltip);
  });
}

function parseM114Position(text) {
  const x = text.match(/X:\s*(-?\d+(\.\d+)?)/i);
  const y = text.match(/Y:\s*(-?\d+(\.\d+)?)/i);
  const z = text.match(/Z:\s*(-?\d+(\.\d+)?)/i);
  const e = text.match(/E:\s*(-?\d+(\.\d+)?)/i);

  if (!x && !y && !z && !e) return false;

  if (!hasKnownPosition()) {
    setSimulatedPosition(0, 0, 0, 0);
  }

  if (x) simulatedPosition.x = Number(x[1]);
  if (y) simulatedPosition.y = Number(y[1]);
  if (z) simulatedPosition.z = Number(z[1]);
  if (e) simulatedPosition.e = Number(e[1]);

  drawWorkspace();
  return true;
}

function readServoAngle(input, label) {
  const raw = input.value.trim();

  if (raw === "") {
    appendLog(`! ${label} cannot be empty.`);
    return null;
  }

  const angle = Number(raw);

  if (Number.isNaN(angle)) {
    appendLog(`! ${label} must be a valid number.`);
    return null;
  }

  if (angle < 0 || angle > 180) {
    appendLog(`! ${label} must stay between 0 and 180 degrees.`);
    return null;
  }

  return angle;
}

function validateServoMove(action) {
  if (action === "open-gripper") {
    return readServoAngle(servoOpenInput, "Open angle") !== null;
  }

  if (action === "close-gripper") {
    return readServoAngle(servoCloseInput, "Close angle") !== null;
  }

  return true;
}

function validateServoBounds() {
  const min = readServoAngle(servoMinInput, "Servo min angle");
  const max = readServoAngle(servoMaxInput, "Servo max angle");

  if (min === null || max === null) return false;

  if (min >= max) {
    appendLog("! Servo min angle must be smaller than max angle.");
    return false;
  }

  return true;
}

async function sendRawGcode(gcode, label) {
  appendLog(`> Sending:\n${gcode}`);
  lastCommandEl.textContent = `${label} - ${gcode.replace(/\n/g, " | ")}`;

  applyGcodeToSimulation(gcode);

  try {
    const response = await fetch(
      `http://${CONFIG.espIp}/send?msg=${encodeURIComponent(gcode)}`
    );

    const text = await response.text();

    appendLog(`< Arduino raw response:\n${text}`);
    lastResponseEl.textContent = text;
    connectionStatusEl.textContent = `Connected to ESP32 at ${CONFIG.espIp}`;

    if (parseM114Position(text)) {
      appendLog("; Graph synced from M114 response.");
    }

    return true;
  } catch (error) {
    const errorText = `Error: ${error}`;

    appendLog(`! ${errorText}`);
    lastResponseEl.textContent = errorText;
    connectionStatusEl.textContent = "Disconnected or request failed";

    return false;
  }
}

function updateSpeedDisplay() {
  xySpeedValue.textContent = xySpeedSlider.value;
  zSpeedValue.textContent = zSpeedSlider.value;
  wristSpeedValue.textContent = wristSpeedSlider.value;

  xySpeedStatus.textContent = xySpeedSlider.value;
  zSpeedStatus.textContent = zSpeedSlider.value;
  wristSpeedStatus.textContent = wristSpeedSlider.value;

  updateAbsolutePreview();
}

function updateAbsolutePreview() {
  const moveGcode = buildAbsoluteMove(
    {
      x: absXInput.value.trim(),
      y: absYInput.value.trim(),
      z: absZInput.value.trim(),
      e: absEInput.value.trim()
    },
    unitsPerSecondToFeedrate(xySpeedSlider.value)
  );

  const setGcode = buildSetPosition({
    x: absXInput.value.trim(),
    y: absYInput.value.trim(),
    z: absZInput.value.trim(),
    e: absEInput.value.trim()
  });

  if (!moveGcode && !setGcode) {
    previewAbsoluteCodeEl.textContent = "Preview: waiting for coordinates";
    return;
  }

  previewAbsoluteCodeEl.textContent =
    `Move: ${moveGcode ? moveGcode.replace(/\n/g, " | ") : "—"} | ` +
    `Set: ${setGcode || "—"}`;
}

function clearAbsoluteFields() {
  absXInput.value = "";
  absYInput.value = "";
  absZInput.value = "";
  absEInput.value = "";
  updateAbsolutePreview();
}

function getClampedJogGcode(action) {
  if (!hasKnownPosition()) {
    return null;
  }

  const values = getUiValues();
  const xyFeedrate = unitsPerSecondToFeedrate(values.xySpeed);

  let nextX = simulatedPosition.x;
  let nextY = simulatedPosition.y;

  if (action === "jog-x-negative") {
    nextX -= values.xyStep;
  } else if (action === "jog-x-positive") {
    nextX += values.xyStep;
  } else if (action === "jog-y-negative") {
    nextY -= values.xyStep;
  } else if (action === "jog-y-positive") {
    nextY += values.xyStep;
  } else {
    return null;
  }

  const clamped = clampXYToWorkspace(nextX, nextY);

  if (!clamped.clamped) {
    return null;
  }

  appendLog(
    `! Jog target outside workspace. Clamped to X${clamped.x.toFixed(2)} Y${clamped.y.toFixed(2)}.`
  );

  return buildAbsoluteMove(
    {
      x: clamped.x,
      y: clamped.y,
      z: "",
      e: ""
    },
    xyFeedrate
  );
}

async function handleAction(action) {
  if (action === "servo-bounds" && !validateServoBounds()) return;
  if (!validateServoMove(action)) return;

  const result = getActionGcode(action, getUiValues());
  if (!result) return;

  const clampedJogGcode = getClampedJogGcode(action);
  const gcodeToSend = clampedJogGcode || result.gcode;

  await sendRawGcode(gcodeToSend, result.label);

  if (action === "home") {
    await sendRawGcode(CONFIG.system.getPosition, "Get Position after Home");
  }
}

async function handleGoToPosition() {
  const target = getTargetXYFromInputs();

  if (target && isXYOutsideWorkspace(target.x, target.y)) {
    appendLog(
      `! Target outside workspace. Nothing was sent. X${target.x.toFixed(2)} Y${target.y.toFixed(2)} is out of bounds.`
    );
    return;
  }

  const gcode = buildAbsoluteMove(
    {
      x: absXInput.value.trim(),
      y: absYInput.value.trim(),
      z: absZInput.value.trim(),
      e: absEInput.value.trim()
    },
    unitsPerSecondToFeedrate(xySpeedSlider.value)
  );

  if (!gcode) return;

  await sendRawGcode(gcode, "Go to Position");
}

async function handleSetPosition() {
  const target = getTargetXYFromInputs();

  if (target && isXYOutsideWorkspace(target.x, target.y)) {
    appendLog(
      `! Set position outside workspace. Nothing was sent. X${target.x.toFixed(2)} Y${target.y.toFixed(2)} is out of bounds.`
    );
    return;
  }

  const gcode = buildSetPosition({
    x: absXInput.value.trim(),
    y: absYInput.value.trim(),
    z: absZInput.value.trim(),
    e: absEInput.value.trim()
  });

  if (!gcode) return;

  await sendRawGcode(gcode, "Set Position");
}

async function handleCustomSend() {
  const value = customMsgInput.value.trim();
  if (!value) return;

  await sendRawGcode(value, "Custom G-code");
  customMsgInput.value = "";
}

function resizeWorkspaceCanvas() {
  workspaceCanvas.width = workspaceCanvas.clientWidth;
  workspaceCanvas.height = 320;
  drawWorkspace();
}

function drawWorkspace() {
  const ctx = workspaceCtx;
  const width = workspaceCanvas.width;
  const height = workspaceCanvas.height;

  const l1 = CONFIG.arm.link1;
  const l2 = CONFIG.arm.link2;
  const maxReach = l1 + l2;
  const minReach = Math.abs(l1 - l2);

  const centerX = width / 2;
  const centerY = height / 2;

  const scale = Math.min(width, height) / (maxReach * 2.35);

  ctx.clearRect(0, 0, width, height);

  drawGrid(ctx, width, height, centerX, centerY, scale);
  drawWorkspaceZones(ctx, centerX, centerY, scale, maxReach, minReach);
  drawArm(ctx, centerX, centerY, scale);
  updateWorkspaceState();
}

function drawGrid(ctx, width, height, centerX, centerY, scale) {
  ctx.strokeStyle = "rgba(255, 122, 0, 0.08)";
  ctx.lineWidth = 1;

  const step = 50 * scale;

  for (let x = centerX % step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = centerY % step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.setLineDash([5, 5]);

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText("X", width - 18, centerY - 8);
  ctx.fillText("Y", centerX + 8, 16);
}

function drawWorkspaceZones(ctx, centerX, centerY, scale, maxReach, minReach) {
  ctx.fillStyle = "rgba(124, 255, 178, 0.06)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxReach * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(124, 255, 178, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxReach * scale, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 94, 94, 0.18)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, minReach * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 94, 94, 0.22)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, CONFIG.arm.forbiddenRadius * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 122, 0, 0.08)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxReach * scale, 0, Math.PI * 2);
  ctx.arc(centerX, centerY, maxReach * 0.9 * scale, 0, Math.PI * 2, true);
  ctx.fill();
}

function drawArm(ctx, centerX, centerY, scale) {
  if (!hasKnownPosition()) {
    ctx.fillStyle = "rgba(255, 176, 102, 0.85)";
    ctx.font = "14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Position unknown", centerX, centerY - 8);
    ctx.fillText("Use M114, G28, or G92 to sync", centerX, centerY + 14);
    ctx.textAlign = "left";
    return;
  }

  const l1 = CONFIG.arm.link1;
  const l2 = CONFIG.arm.link2;

  const x = simulatedPosition.x;
  const y = simulatedPosition.y;

  const distanceSquared = x * x + y * y;

  let cosElbow = (distanceSquared - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  cosElbow = Math.max(-1, Math.min(1, cosElbow));

  const elbowAngle = Math.acos(cosElbow);

  const shoulderAngle =
    Math.atan2(y, x) -
    Math.atan2(l2 * Math.sin(elbowAngle), l1 + l2 * Math.cos(elbowAngle));

  const elbowX = centerX + l1 * Math.cos(shoulderAngle) * scale;
  const elbowY = centerY - l1 * Math.sin(shoulderAngle) * scale;

  const endX = centerX + x * scale;
  const endY = centerY - y * scale;

  ctx.lineCap = "round";

  ctx.strokeStyle = "#ff7a00";
  ctx.lineWidth = 5;
  ctx.shadowColor = "#ff7a00";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(elbowX, elbowY);
  ctx.stroke();

  ctx.strokeStyle = "#ffb066";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#ffb066";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(elbowX, elbowY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.shadowBlur = 0;

  drawJoint(ctx, centerX, centerY, 6, "#ff7a00");
  drawJoint(ctx, elbowX, elbowY, 5, "#ffb066");
  drawJoint(ctx, endX, endY, 6, "#f5f5f5");
}

function drawJoint(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function updateWorkspaceState() {
  if (!hasKnownPosition()) {
    coordXEl.textContent = "--";
    coordYEl.textContent = "--";
    coordZEl.textContent = "--";
    coordEEl.textContent = "--";

    radiusStatusEl.textContent = "--";
    shoulderStatusEl.textContent = "--";
    elbowStatusEl.textContent = "--";

    workspaceStatusEl.className = "status-value status-warning";
    workspaceStatusEl.textContent = "Unknown";
    return;
  }

  const l1 = CONFIG.arm.link1;
  const l2 = CONFIG.arm.link2;

  const x = simulatedPosition.x;
  const y = simulatedPosition.y;

  const r = Math.sqrt(x * x + y * y);
  const maxReach = l1 + l2;
  const minReach = Math.max(Math.abs(l1 - l2), CONFIG.arm.forbiddenRadius);

  let cosElbow = (x * x + y * y - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  cosElbow = Math.max(-1, Math.min(1, cosElbow));

  const elbowAngle = Math.acos(cosElbow) * 180 / Math.PI;
  const shoulderAngle = Math.atan2(y, x) * 180 / Math.PI;

  coordXEl.textContent = simulatedPosition.x.toFixed(1);
  coordYEl.textContent = simulatedPosition.y.toFixed(1);
  coordZEl.textContent = simulatedPosition.z.toFixed(1);
  coordEEl.textContent = simulatedPosition.e.toFixed(1);

  radiusStatusEl.textContent = `${r.toFixed(1)} mm`;
  shoulderStatusEl.textContent = `${shoulderAngle.toFixed(1)}°`;
  elbowStatusEl.textContent = `${elbowAngle.toFixed(1)}°`;

  workspaceStatusEl.className = "status-value";

  if (r > maxReach) {
    workspaceStatusEl.textContent = "Out of reach";
    workspaceStatusEl.classList.add("status-danger");
  } else if (r < minReach) {
    workspaceStatusEl.textContent = "Forbidden zone";
    workspaceStatusEl.classList.add("status-danger");
  } else if (r > maxReach * 0.9) {
    workspaceStatusEl.textContent = "Near limit";
    workspaceStatusEl.classList.add("status-warning");
  } else {
    workspaceStatusEl.textContent = "OK";
    workspaceStatusEl.classList.add("status-ok");
  }
}

function applyGcodeToSimulation(gcode) {
  const lines = gcode
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);

  lines.forEach((line) => {
    const upper = line.toUpperCase();

    if (upper.startsWith("G90")) {
      positioningMode = "absolute";
      return;
    }

    if (upper.startsWith("G91")) {
      positioningMode = "relative";
      return;
    }

    if (upper.startsWith("G92")) {
      applyCoordinateValues(line, "absolute", true);
      return;
    }

    if (upper.match(/^G0\b/) || upper.match(/^G1\b/)) {
      applyCoordinateValues(line, positioningMode, false);
    }
  });

  drawWorkspace();
}

function applyCoordinateValues(line, mode, canCreatePosition) {
  if (!hasKnownPosition()) {
    if (!canCreatePosition) {
      appendLog("; Position unknown. Command sent, but graph not updated.");
      return;
    }

    setSimulatedPosition(0, 0, 0, 0);
  }

  const x = extractLetterValue(line, "X");
  const y = extractLetterValue(line, "Y");
  const z = extractLetterValue(line, "Z");
  const e = extractLetterValue(line, "E");

  if (mode === "relative") {
    if (x !== null) simulatedPosition.x += x;
    if (y !== null) simulatedPosition.y += y;
    if (z !== null) simulatedPosition.z += z;
    if (e !== null) simulatedPosition.e += e;
  } else {
    if (x !== null) simulatedPosition.x = x;
    if (y !== null) simulatedPosition.y = y;
    if (z !== null) simulatedPosition.z = z;
    if (e !== null) simulatedPosition.e = e;
  }
}

function extractLetterValue(line, letter) {
  const match = line.match(new RegExp(`${letter}(-?\\d+(\\.\\d+)?)`, "i"));
  return match ? Number(match[1]) : null;
}

xySpeedSlider.addEventListener("input", updateSpeedDisplay);
zSpeedSlider.addEventListener("input", updateSpeedDisplay);
wristSpeedSlider.addEventListener("input", updateSpeedDisplay);

absXInput.addEventListener("input", updateAbsolutePreview);
absYInput.addEventListener("input", updateAbsolutePreview);
absZInput.addEventListener("input", updateAbsolutePreview);
absEInput.addEventListener("input", updateAbsolutePreview);

[
  servoOpenInput,
  servoCloseInput,
  servoMinInput,
  servoMaxInput
].forEach((input) => {
  input.addEventListener("input", () => {
    if (tooltipEl.classList.contains("visible")) {
      tooltipEl.classList.remove("visible");
    }
  });
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    handleAction(button.dataset.action);
  });
});

document.getElementById("goToPositionBtn").addEventListener("click", handleGoToPosition);
document.getElementById("setPositionBtn").addEventListener("click", handleSetPosition);
document.getElementById("clearAbsoluteBtn").addEventListener("click", clearAbsoluteFields);
document.getElementById("sendCustomBtn").addEventListener("click", handleCustomSend);
document.getElementById("clearLogBtn").addEventListener("click", clearLog);

customMsgInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleCustomSend();
  }
});

async function initApp() {
  await loadCommandDescriptions();

  setupTooltipToggle();
  setupCommandTooltips();

  updateSpeedDisplay();
  updateAbsolutePreview();
  resizeWorkspaceCanvas();

  window.addEventListener("resize", resizeWorkspaceCanvas);
}

initApp();