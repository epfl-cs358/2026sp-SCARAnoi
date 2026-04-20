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

let tooltipsEnabled = true;

let commandDescriptions = {};

function getUiValues() {
  return {
    speed: Number(speedSlider.value),
    linearStep: Number(linearStepInput.value),
    wristStep: Number(wristStepInput.value)
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

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

    if (!tooltipsEnabled) {
      hideTooltip();
    }
  });
}

function moveTooltip(event) {
  const offsetX = 14;
  const offsetY = 14;

  tooltipEl.style.left = `${event.pageX + offsetX}px`;
  tooltipEl.style.top = `${event.pageY + offsetY}px`;
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
      const isVisible = tooltipEl.classList.contains("visible");
      if (isVisible) {
        tooltipEl.innerHTML = renderTooltipContent(commandKey);
        moveTooltip(event);
      }
    });

    button.addEventListener("mouseleave", hideTooltip);
  });
}

async function sendRawGcode(gcode, label) {
  appendLog(`> Sending:\n${gcode}`);
  lastCommandEl.textContent = `${label} - ${gcode.replace(/\n/g, " | ")}`;

  try {
    const response = await fetch(
      `http://${CONFIG.espIp}/send?msg=${encodeURIComponent(gcode)}`
    );

    const text = await response.text();
    appendLog(`< ${text}`);
    lastResponseEl.textContent = text;
    connectionStatusEl.textContent = `Connected to ESP32 at ${CONFIG.espIp}`;
  } catch (error) {
    const errorText = `Error: ${error}`;
    appendLog(`! ${errorText}`);
    lastResponseEl.textContent = errorText;
    connectionStatusEl.textContent = "Disconnected or request failed";
  }
}

function updateSpeedDisplay() {
  speedValue.textContent = speedSlider.value;
  statusSpeed.textContent = speedSlider.value;
  updateAbsolutePreview();
}

function updateAbsolutePreview() {
  const gcode = buildAbsoluteMove(
    {
      x: absXInput.value.trim(),
      y: absYInput.value.trim(),
      z: absZInput.value.trim()
    },
    mmPerSecToFeedrate(speedSlider.value)
  );

  previewAbsoluteCodeEl.textContent = gcode
    ? `Preview: ${gcode.replace(/\n/g, " | ")}`
    : "Preview: waiting for coordinates";
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
  await sendRawGcode(result.gcode, result.label);
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

async function handleCustomSend() {
  const value = customMsgInput.value.trim();
  if (!value) return;

  await sendRawGcode(value, "Custom G-code");
  customMsgInput.value = "";
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
}

initApp();