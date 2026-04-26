const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
const statusSpeed = document.getElementById("statusSpeed");

const linearStepInput = document.getElementById("linearStep");
const wristStepInput = document.getElementById("wristStep");

const absXInput = document.getElementById("absX");
const absYInput = document.getElementById("absY");
const absZInput = document.getElementById("absZ");

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

function getUiValues() {
  return {
    speed: Number(speedSlider.value),
    linearStep: Number(linearStepInput.value),
    wristStep: Number(wristStepInput.value)
  };
}

function getPositionSnapshot() {
  if (!hasKnownPosition()) {
    return { position: null, positioningMode };
  }

  return {
    position: { ...simulatedPosition },
    positioningMode
  };
}

function restorePositionSnapshot(snapshot) {
  simulatedPosition = snapshot.position ? { ...snapshot.position } : null;
  positioningMode = snapshot.positioningMode;
  drawWorkspace();
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
        tooltipEl.innerHTML = renderTooltipContent(commandKey);
        moveTooltip(event);
      }
    });

    button.addEventListener("mouseleave", hideTooltip);
  });
}

function responseLooksSuccessful(text) {
  const lower = text.toLowerCase();

  if (lower.includes("error")) return false;
  if (lower.includes("timeout")) return false;
  if (lower.includes("no response")) return false;

  return lower.includes("ok");
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

async function sendRawGcode(gcode, label, options = {}) {
  const optimistic = options.optimistic ?? true;

  appendLog(`> Sending:\n${gcode}`);
  lastCommandEl.textContent = `${label} - ${gcode.replace(/\n/g, " | ")}`;

  const beforeSend = getPositionSnapshot();

  if (optimistic) {
    applyGcodeToSimulation(gcode);
  }

  try {
    const response = await fetch(
      `http://${CONFIG.espIp}/send?msg=${encodeURIComponent(gcode)}`
    );

    const text = await response.text();

    appendLog(`< ${text}`);
    lastResponseEl.textContent = text;
    connectionStatusEl.textContent = `Connected to ESP32 at ${CONFIG.espIp}`;

    const gotRealPosition = parseM114Position(text);
    const success = responseLooksSuccessful(text);

    if (!success) {
      restorePositionSnapshot(beforeSend);
      appendLog("! Command was not confirmed by Marlin. Graph reverted.");
      return false;
    }

    if (gotRealPosition) {
      appendLog("; Graph synced from M114 response.");
    }

    return true;
  } catch (error) {
    restorePositionSnapshot(beforeSend);

    const errorText = `Error: ${error}`;
    appendLog(`! ${errorText}`);
    appendLog("! Request failed. Graph reverted.");

    lastResponseEl.textContent = errorText;
    connectionStatusEl.textContent = "Disconnected or request failed";

    return false;
  }
}

async function syncPositionFromMarlin(reason = "Sync position") {
  appendLog(`; ${reason}: requesting M114`);
  const success = await sendRawGcode("M114", reason, { optimistic: false });

  if (!success || !hasKnownPosition()) {
    appendLog("; Position still unknown. Use Home then M114, or Set position with G92.");
  }
}

function updateSpeedDisplay() {
  speedValue.textContent = speedSlider.value;
  statusSpeed.textContent = speedSlider.value;
  updateAbsolutePreview();
}

function updateAbsolutePreview() {
  const moveGcode = buildAbsoluteMove(
    {
      x: absXInput.value.trim(),
      y: absYInput.value.trim(),
      z: absZInput.value.trim()
    },
    mmPerSecToFeedrate(speedSlider.value)
  );

  const setGcode = buildSetPosition({
    x: absXInput.value.trim(),
    y: absYInput.value.trim(),
    z: absZInput.value.trim()
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
  updateAbsolutePreview();
}

async function handleAction(action) {
  const result = getActionGcode(action, getUiValues());
  if (!result) return;

  const success = await sendRawGcode(result.gcode, result.label);

  if (success && action === "home") {
    await syncPositionFromMarlin("Home complete");
  }
}

async function handleGoToPosition() {
  const gcode = buildAbsoluteMove(
    {
      x: absXInput.value.trim(),
      y: absYInput.value.trim(),
      z: absZInput.value.trim()
    },
    mmPerSecToFeedrate(speedSlider.value)
  );

  if (!gcode) return;

  await sendRawGcode(gcode, "Go to Position");
}

async function handleSetPosition() {
  const gcode = buildSetPosition({
    x: absXInput.value.trim(),
    y: absYInput.value.trim(),
    z: absZInput.value.trim()
  });

  if (!gcode) return;

  const success = await sendRawGcode(gcode, "Set Position");

  if (success) {
    await syncPositionFromMarlin("Position set");
  }
}

async function handleCustomSend() {
  const value = customMsgInput.value.trim();
  if (!value) return;

  if (!isAllowedGcode(value)) {
    appendLog(`! Blocked: this command is not in the approved G-code list.`);
    return;
  }

  await sendRawGcode(value, "Custom G-code");
  customMsgInput.value = "";
}

function isAllowedGcode(gcode) {
  const allowed = [
    "G0",
    "G1",
    "G2",
    "G3",
    "G6",
    "G28",
    "G90",
    "G91",
    "G92",
    "M17",
    "M18",
    "M84",
    "M112",
    "M114",
    "M119",
    "M280",
    "M281",
    "M282"
  ];

  const lines = gcode
    .split("\n")
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line && !line.startsWith(";"));

  return lines.every((line) => {
    const command = line.split(/\s+/)[0];
    return allowed.includes(command);
  });
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
    ctx.fillText("Use G28 + M114 or G92 to sync", centerX, centerY + 14);
    ctx.textAlign = "left";
    return;
  }

  const l1 = CONFIG.arm.link1;
  const l2 = CONFIG.arm.link2;

  const x = simulatedPosition.x;
  const y = simulatedPosition.y;

  const distanceSquared = x * x + y * y;

  let cosElbow =
    (distanceSquared - l1 * l1 - l2 * l2) / (2 * l1 * l2);

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
  const minReach = Math.abs(l1 - l2);

  let cosElbow =
    (x * x + y * y - l1 * l1 - l2 * l2) / (2 * l1 * l2);

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
  } else if (r < minReach || r < CONFIG.arm.forbiddenRadius) {
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
    .filter((line) => line && !line.startsWith(";"));

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
      return;
    }

    if (upper.match(/^G2\b/) || upper.match(/^G3\b/)) {
      applyCoordinateValues(line, "absolute", false);
      return;
    }

    if (upper.match(/^G6\b/)) {
      if (!hasKnownPosition()) return;

      const c = extractLetterValue(line, "C");
      if (c !== null) simulatedPosition.z = c;
    }
  });

  clampSimulatedPosition();
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

function clampSimulatedPosition() {
  if (!hasKnownPosition()) return;

  const maxReach = CONFIG.arm.link1 + CONFIG.arm.link2;
  const r = Math.sqrt(
    simulatedPosition.x * simulatedPosition.x +
    simulatedPosition.y * simulatedPosition.y
  );

  if (r > maxReach) {
    const angle = Math.atan2(simulatedPosition.y, simulatedPosition.x);
    simulatedPosition.x = maxReach * Math.cos(angle);
    simulatedPosition.y = maxReach * Math.sin(angle);

    appendLog("! Simulation clamped position to max reach.");
  }
}

speedSlider.addEventListener("input", updateSpeedDisplay);
absXInput.addEventListener("input", updateAbsolutePreview);
absYInput.addEventListener("input", updateAbsolutePreview);
absZInput.addEventListener("input", updateAbsolutePreview);

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

  await syncPositionFromMarlin("Startup sync");
}

initApp();