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

async function sendRawGcode(gcode, label) {
  appendLog(`> Sending:\n${gcode}`);
  lastCommandEl.textContent = `${label} — ${gcode.replace(/\n/g, " | ")}`;

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

updateSpeedDisplay();
updateAbsolutePreview();