const xySpeedSlider   = document.getElementById("xySpeedSlider");
const zSpeedSlider    = document.getElementById("zSpeedSlider");
const wristSpeedSlider = document.getElementById("wristSpeedSlider");
const servoSpeedSlider = document.getElementById("servoSpeedSlider");

const xySpeedValue    = document.getElementById("xySpeedValue");
const zSpeedValue     = document.getElementById("zSpeedValue");
const wristSpeedValue = document.getElementById("wristSpeedValue");
const servoSpeedValue = document.getElementById("servoSpeedValue");

const xySpeedStatus    = document.getElementById("xySpeedStatus");
const zSpeedStatus     = document.getElementById("zSpeedStatus");
const wristSpeedStatus = document.getElementById("wristSpeedStatus");

const xyStepInput    = document.getElementById("xyStep");
const zStepInput     = document.getElementById("zStep");
const wristStepInput = document.getElementById("wristStep");
const servoStepInput = document.getElementById("servoStep");


const absXInput = document.getElementById("absX");
const absYInput = document.getElementById("absY");
const absZInput = document.getElementById("absZ");
const absEInput = document.getElementById("absE");

const customMsgInput = document.getElementById("customMsg");

const lastCommandEl       = document.getElementById("lastCommand");
const lastResponseEl      = document.getElementById("lastResponse");
const connectionStatusEl  = document.getElementById("connectionStatus");
const previewAbsoluteCodeEl = document.getElementById("previewAbsoluteCode");
const logBox              = document.getElementById("logBox");
const tooltipEl           = document.getElementById("commandTooltip");
const tooltipToggle       = document.getElementById("tooltipToggle");

const workspaceCanvas = document.getElementById("workspaceCanvas");
const workspaceCtx    = workspaceCanvas.getContext("2d");

const coordXEl = document.getElementById("coordX");
const coordYEl = document.getElementById("coordY");
const coordZEl = document.getElementById("coordZ");
const coordEEl = document.getElementById("coordE");

const radiusStatusEl    = document.getElementById("radiusStatus");
const workspaceStatusEl = document.getElementById("workspaceStatus");
const shoulderStatusEl  = document.getElementById("shoulderStatus");
const elbowStatusEl     = document.getElementById("elbowStatus");

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

let tooltipsEnabled    = true;
let commandDescriptions = {};
let positioningMode    = "absolute";
let simulatedPosition  = null;
let currentServoAngle  = null;   

let previewPosition  = null;
let pendingExecution = null;

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function hasKnownPosition() { return simulatedPosition !== null; }

function setSimulatedPosition(x = 0, y = 0, z = 0, e = 0) {
  simulatedPosition = { x, y, z, e };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function flashBtn(btn, label = "✓", delay = 1200) {
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = prev; }, delay);
}

function appendLog(text, cssClass) {
  const span = document.createElement("span");
  if (cssClass) span.className = cssClass;
  span.textContent = "\n" + text;
  logBox.appendChild(span);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "Ready.";
}

function getUiValues() {
  return {
    xySpeed:    Number(xySpeedSlider.value),
    zSpeed:     Number(zSpeedSlider.value),
    wristSpeed: Number(wristSpeedSlider.value),
    xyStep:     Number(xyStepInput.value),
    zStep:      Number(zStepInput.value),
    wristStep:  Number(wristStepInput.value),
    servoStep:  Number(servoStepInput?.value ?? 5)
  };
}

// ─────────────────────────────────────────────
// WORKSPACE GEOMETRY
// ─────────────────────────────────────────────

function getWorkspaceLimits() {
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  return { maxReach: l1 + l2, minReach: Math.max(Math.abs(l1 - l2), CONFIG.arm.forbiddenRadius) };
}

function clampXYToWorkspace(x, y) {
  const { maxReach, minReach } = getWorkspaceLimits();
  const radius = Math.sqrt(x * x + y * y);
  if (radius === 0) return { x: minReach, y: 0, clamped: true };
  let r = radius, clamped = false;
  if (radius > maxReach) { r = maxReach; clamped = true; }
  if (radius < minReach) { r = minReach; clamped = true; }
  return { x: x * r / radius, y: y * r / radius, clamped };
}

function isXYOutsideWorkspace(x, y) { return clampXYToWorkspace(x, y).clamped; }

// ─────────────────────────────────────────────
// COMMAND DESCRIPTIONS / TOOLTIPS
// ─────────────────────────────────────────────

async function loadCommandDescriptions() {
  try {
    const res = await fetch("command-descriptions.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    commandDescriptions = await res.json();
  } catch (e) {
    appendLog(`! Failed to load command descriptions: ${e}`);
    commandDescriptions = {};
  }
}

function getTooltipData(action) {
  const desc = commandDescriptions[action];
  const data = getActionGcode(action, getUiValues());
  if (!desc && !data) return null;
  return {
    command:     data?.gcode || desc?.command || "No command available",
    description: desc?.description || "No description available."
  };
}

function showTooltip(action, event) {
  if (!tooltipsEnabled) return;
  const d = getTooltipData(action);
  if (!d) return;
  tooltipEl.innerHTML = `
    <div class="tooltip-command">${escapeHtml(d.command)}</div>
    <div class="tooltip-description">${escapeHtml(d.description)}</div>
  `;
  tooltipEl.classList.add("visible");
  moveTooltip(event);
}

function moveTooltip(e) {
  tooltipEl.style.left = `${e.pageX + 14}px`;
  tooltipEl.style.top  = `${e.pageY + 14}px`;
}

function hideTooltip() { tooltipEl.classList.remove("visible"); }

function setupTooltipToggle() {
  if (!tooltipToggle) return;
  tooltipsEnabled = tooltipToggle.checked;
  tooltipToggle.addEventListener("change", () => {
    tooltipsEnabled = tooltipToggle.checked;
    if (!tooltipsEnabled) hideTooltip();
  });
}

function setupCommandTooltips() {
  document.querySelectorAll("[data-command]").forEach((btn) => {
    const key = btn.dataset.command;
    btn.addEventListener("mouseenter", (e) => showTooltip(key, e));
    btn.addEventListener("mousemove",  (e) => { if (tooltipEl.classList.contains("visible")) moveTooltip(e); });
    btn.addEventListener("mouseleave", hideTooltip);
  });
}

// ─────────────────────────────────────────────
// NETWORK / GCODE SEND
// ─────────────────────────────────────────────

function parseCommandResponse(text) {
  const response = String(text || "");
  const lower = response.toLowerCase();

  const hasFailure = /\b(error|failed|failure|fatal|timeout)\b/i.test(response)
    || /no response/i.test(response)
    || /unable to receive/i.test(response)
    || /did not receive/i.test(response);

  if (hasFailure) {
    return {
      ok: false,
      reason: "Arduino/ESP reported an error, failure, or timeout.",
    };
  }

  const hasOk = /\bok\b/i.test(response);

  if (hasOk) {
    return {
      ok: true,
      reason: "Arduino acknowledged the command.",
    };
  }

  return {
    ok: false,
    reason: "No Arduino ok was found in the response.",
  };
}

function commandResponseFinishedOk(text) {
  return parseCommandResponse(text).ok;
}

async function sendRawGcode(gcode, label, options = {}) {
  const lines = gcode.split("\n").map(l => l.trim()).filter(l => l);
  const waitForPosition = Boolean(options.waitForPosition);
  const waitForOkCount = Number(options.waitForOkCount || 0);
  const expectOk = Boolean(options.expectOk || waitForPosition || waitForOkCount > 0);
  const timeoutSeconds = Number(options.timeoutSeconds ?? 2);

  appendLog(`> ${label}:\n${gcode}`);
  lastCommandEl.textContent = `${label} — ${gcode.replace(/\n/g, " | ")}`;

  try {
    let waitForParam = "";
    if (waitForPosition) {
      waitForParam = "&wait_for=position";
    } else if (waitForOkCount > 0) {
      waitForParam = `&wait_for=ok_count&ok_count=${encodeURIComponent(String(waitForOkCount))}`;
    }

    const url =
      `${getControlBaseUrl()}/send?msg=${encodeURIComponent(gcode)}` +
      `&wait=${expectOk ? "1" : "0"}` +
      `&timeout=${encodeURIComponent(String(timeoutSeconds))}` +
      waitForParam;

    const res = await fetch(url);
    const text = await res.text();

    appendLog(`< ${text}`);
    lastResponseEl.textContent = text;
    connectionStatusEl.textContent = `Connected to ESP serial bridge at ${getControlBaseUrl()}`;
    updateCameraLinks();
    if (parseM114Position(text)) appendLog("; Graph synced from M114.");

    if (!res.ok) {
      appendLog(`! Bridge HTTP error ${res.status}.`);
      return false;
    }

    if (!expectOk) {
      const lower = text.toLowerCase();
      if (/\b(error|failed|exception)\b/.test(lower) && !text.includes("sent without waiting for ok")) {
        appendLog("! Bridge reported an immediate send error.");
        return false;
      }
      applyGcodeToSimulation(gcode);
      return true;
    }

    const result = parseCommandResponse(text);
    if (!result.ok) {
      appendLog(`! ${result.reason} Stopping the current sequence.`);
      return false;
    }

    applyGcodeToSimulation(gcode);
    return true;
  } catch (err) {
    const msg = `Error: ${err}`;
    appendLog(`! ${msg}`);
    lastResponseEl.textContent = msg;
    connectionStatusEl.textContent = "ESP serial bridge disconnected or request failed";
    return false;
  }
}

// ─────────────────────────────────────────────
// POSITION TRACKING
// ─────────────────────────────────────────────

function parseM114Position(text) {
  const x = text.match(/X:\s*(-?\d+(\.\d+)?)/i);
  const y = text.match(/Y:\s*(-?\d+(\.\d+)?)/i);
  const z = text.match(/Z:\s*(-?\d+(\.\d+)?)/i);
  const e = text.match(/E:\s*(-?\d+(\.\d+)?)/i);
  if (!x && !y && !z && !e) return false;
  if (!hasKnownPosition()) setSimulatedPosition(0, 0, 0, 0);
  if (x) simulatedPosition.x = Number(x[1]);
  if (y) simulatedPosition.y = Number(y[1]);
  if (z) simulatedPosition.z = Number(z[1]);
  if (e) simulatedPosition.e = Number(e[1]);
  drawWorkspace();
  return true;
}

function applyGcodeToSimulation(gcode) {
  const lines = gcode.split("\n").map(l => l.trim()).filter(l => l);
  lines.forEach((line) => {
    const u = line.toUpperCase();
    if (u.startsWith("G90"))                       { positioningMode = "absolute"; return; }
    if (u.startsWith("G91"))                       { positioningMode = "relative"; return; }
    if (u.startsWith("G92"))                       { applyCoordinateValues(line, "absolute", true); return; }
    if (u.match(/^G0\b/) || u.match(/^G1\b/))     { applyCoordinateValues(line, positioningMode, false); return; }
    if (u.startsWith("M360"))                      { applyM360ToSimulation(line); return; }
    if (u.startsWith("G28")) {
      simulatedPosition = null;
      positioningMode = "absolute";
      return;
    }
  });
  drawWorkspace();
}

function applyM360ToSimulation(line) {
  if (!hasKnownPosition()) return;
  const dx = extractLetterValue(line, "X");  // shoulder delta, degrees
  const dy = extractLetterValue(line, "Y");  // elbow delta, degrees
  const de = extractLetterValue(line, "E");  // wrist delta, degrees
  if (de !== null) simulatedPosition.e += de;
  if (dx !== null || dy !== null) {
    const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
    const cur = ikScaraAngles(simulatedPosition.x, simulatedPosition.y);
    const θ = (cur.shoulderDeg + (dx ?? 0)) * Math.PI / 180;
    const ψ = (cur.elbowDeg    + (dy ?? 0)) * Math.PI / 180;
    simulatedPosition.x = l1 * Math.sin(θ) + l2 * Math.sin(θ + ψ);
    simulatedPosition.y = l1 * Math.cos(θ) + l2 * Math.cos(θ + ψ);
  }
}

function applyCoordinateValues(line, mode, canCreate) {
  if (!hasKnownPosition()) {
    if (!canCreate) { appendLog("; Position unknown — graph not updated."); return; }
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
  const m = line.match(new RegExp(`${letter}(-?\\d+(\\.\\d+)?)`, "i"));
  return m ? Number(m[1]) : null;
}

// ─────────────────────────────────────────────
// WORKSPACE CANVAS
// ─────────────────────────────────────────────

function drawGrid(ctx, W, H, cx, cy, scale) {
  const stepMm = 50;
  const stepPx = stepMm * scale;
  const maxLines = 30;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -maxLines; i <= maxLines; i++) {
    const x = cx + i * stepPx;
    const y = cy + i * stepPx;
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  ctx.moveTo(0, cy); ctx.lineTo(W, cy);
  ctx.stroke();
  ctx.restore();
}

function drawWorkspaceZones(ctx, cx, cy, scale, maxR, minR) {
  const ds = CONFIG.arm.displayScale ?? 1;
  ctx.save();
  ctx.fillStyle = "rgba(124,255,178,0.08)";
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * ds * scale, 0, Math.PI * 2);
  ctx.fill();

  const forbiddenR = Math.max(minR, CONFIG.arm.forbiddenRadius || 0);
  if (forbiddenR > 0) {
    ctx.fillStyle = "rgba(255,94,94,0.14)";
    ctx.beginPath();
    ctx.arc(cx, cy, forbiddenR * ds * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * ds * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function resizeWorkspaceCanvas() {
  const w = workspaceCanvas.offsetWidth  || 400;
  const h = workspaceCanvas.offsetHeight || 320;
  if (w < 10) { requestAnimationFrame(resizeWorkspaceCanvas); return; }
  workspaceCanvas.width  = w;
  workspaceCanvas.height = h;
  drawWorkspace();
}

function drawWorkspace() {
  const ctx = workspaceCtx;
  const W = workspaceCanvas.width, H = workspaceCanvas.height;
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const maxR = l1 + l2, minR = Math.abs(l1 - l2);
  const cx = W / 2, cy = H / 2;
  const ds = CONFIG.arm.displayScale ?? 1;
  const scale = Math.min(W, H) / ((maxR * ds) * 2.35);

  ctx.clearRect(0, 0, W, H);
  drawGrid(ctx, W, H, cx, cy, scale);
  drawWorkspaceZones(ctx, cx, cy, scale, maxR, minR);
  drawPegs(ctx, cx, cy, scale);
  if (previewPosition !== null) drawArmGhost(ctx, cx, cy, scale, previewPosition.x, previewPosition.y);
  drawArm(ctx, cx, cy, scale);
  updateWorkspaceState();
}


function getFirmwarePegXY(peg, kind = "down") {
  const source =
    kind === "up"
      ? (CONFIG.hanoi?.firmwarePegUpPositions || CONFIG.hanoi?.firmwarePegs || [])
      : (CONFIG.hanoi?.firmwarePegs || []);

  const p = source[peg];
  if (!p || p.x === undefined || p.y === undefined) return null;
  return { x: Number(p.x), y: Number(p.y), name: p.name || `PEG${peg}` };
}

function firmwarePegLabel(peg) {
  return getFirmwarePegXY(peg, "down")?.name || `PEG${peg}`;
}

// Draw PEG0 / PEG1 / PEG2 as yellow triangles 
function drawPegs(ctx, cx, cy, scale) {
  const ds = CONFIG.arm.displayScale ?? 1;
  const pegs = CONFIG.hanoi?.firmwarePegs || [];
  if (!pegs.length) return;

  const PEG_H = 9;
  ctx.save();
  pegs.forEach((peg, i) => {
    if (peg.x === undefined || peg.y === undefined) return;
    const sx = cx + Number(peg.x) * ds * scale;
    const sy = cy - Number(peg.y) * ds * scale;
    ctx.fillStyle = "#f9e04b";
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(sx, sy - PEG_H);
    ctx.lineTo(sx - PEG_H * 0.7, sy + PEG_H * 0.4);
    ctx.lineTo(sx + PEG_H * 0.7, sy + PEG_H * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#f9e04b";
    ctx.font = "bold 9px ui-monospace,monospace";
    ctx.textAlign = "center";
    ctx.fillText(peg.name || `P${i}`, sx, sy + PEG_H * 2);
  });
  ctx.restore();
}

function drawArm(ctx, cx, cy, scale) {
  if (!hasKnownPosition()) return;
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const ds = CONFIG.arm.displayScale ?? 1;
  const { x, y, e: wristDeg } = simulatedPosition;

  let c2 = (x*x + y*y - l1*l1 - l2*l2) / (2*l1*l2);
  c2 = Math.max(-1, Math.min(1, c2));
  const s2 = IK_ELBOW_SIGN * Math.sqrt(Math.max(0, 1 - c2*c2));
  const θ = Math.atan2(x, y) - Math.atan2(l2*s2, l1 + l2*c2);
  const ψ = Math.atan2(s2, c2);

  const elbowX = l1 * Math.sin(θ);
  const elbowY = l1 * Math.cos(θ);
  const ex  = cx + elbowX * ds * scale;
  const ey  = cy - elbowY * ds * scale;
  const ex2 = cx + x * ds * scale;
  const ey2 = cy - y * ds * scale;

  const SHOULDER_COLOR = "#ff7a00";  
  const ELBOW_COLOR    = "#ffb066";

  ctx.lineCap = "round";
  ctx.strokeStyle = SHOULDER_COLOR; ctx.lineWidth = 6; ctx.shadowColor = SHOULDER_COLOR; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = ELBOW_COLOR; ctx.lineWidth = 5; ctx.shadowColor = ELBOW_COLOR; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex2, ey2); ctx.stroke();
  ctx.shadowBlur = 0;

  // Segment labels at midpoint
  ctx.save();
  ctx.font = "bold 11px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const m1x = (cx + ex) / 2, m1y = (cy + ey) / 2;
  const m2x = (ex + ex2) / 2, m2y = (ey + ey2) / 2;
  // Offset labels perpendicularly to the segment
  const a1 = Math.atan2(ey - cy, ex - cx);
  const a2 = Math.atan2(ey2 - ey, ex2 - ex);
  const off = 13;
  ctx.fillStyle = SHOULDER_COLOR;
  ctx.fillText("Shoulder", m1x + Math.sin(a1) * off, m1y - Math.cos(a1) * off);
  ctx.fillStyle = ELBOW_COLOR;
  ctx.fillText("Elbow", m2x + Math.sin(a2) * off, m2y - Math.cos(a2) * off);
  ctx.restore();

  // Wrist E angle indicator
  const wristRad = (wristDeg ?? 0) * Math.PI / 180;
  const wLen = 26;
  const wTipX  = ex2 + Math.cos(wristRad) * wLen;
  const wTipY  = ey2 - Math.sin(wristRad) * wLen;
  const wTailX = ex2 - Math.cos(wristRad) * wLen * 0.35;
  const wTailY = ey2 + Math.sin(wristRad) * wLen * 0.35;
  ctx.save();
  ctx.strokeStyle = "#ce93d8"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  ctx.shadowColor = "#ce93d8"; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.moveTo(wTailX, wTailY); ctx.lineTo(wTipX, wTipY); ctx.stroke();
  const aLen = 6, aAng = 0.42;
  ctx.fillStyle = "#ce93d8"; ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(wTipX, wTipY);
  ctx.lineTo(wTipX - aLen * Math.cos(wristRad - aAng), wTipY + aLen * Math.sin(wristRad - aAng));
  ctx.lineTo(wTipX - aLen * Math.cos(wristRad + aAng), wTipY + aLen * Math.sin(wristRad + aAng));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ce93d8"; ctx.font = "bold 10px ui-monospace,monospace"; ctx.textAlign = "left";
  ctx.fillText("E" + (wristDeg ?? 0).toFixed(1) + "°", wTipX + 4, wTipY - 3);
  ctx.restore();

  [[cx, cy, SHOULDER_COLOR, 6], [ex, ey, ELBOW_COLOR, 5], [ex2, ey2, "#f5f5f5", 6]].forEach(([jx, jy, c, r]) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(jx, jy, r, 0, Math.PI * 2); ctx.fill();
  });
}

function drawArmGhost(ctx, cx, cy, scale, tx, ty) {
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const ds = CONFIG.arm.displayScale ?? 1;
  // Firmware IK convention
  let c2 = (tx*tx + ty*ty - l1*l1 - l2*l2) / (2*l1*l2);
  c2 = Math.max(-1, Math.min(1, c2));
  const s2 = IK_ELBOW_SIGN * Math.sqrt(Math.max(0, 1 - c2*c2));
  const θ = Math.atan2(tx, ty) - Math.atan2(l2*s2, l1 + l2*c2);
  const elbowX = l1 * Math.sin(θ);
  const elbowY = l1 * Math.cos(θ);
  const ex  = cx + elbowX * ds * scale;
  const ey  = cy - elbowY * ds * scale;
  const ex2 = cx + tx * ds * scale;
  const ey2 = cy - ty * ds * scale;
  ctx.save(); ctx.lineCap = "round"; ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.45;
  ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 5; ctx.shadowColor = "#4fc3f7"; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = "#81d4fa"; ctx.lineWidth = 4; ctx.shadowColor = "#81d4fa"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex2, ey2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.setLineDash([]); ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#4fc3f7"; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex2, ey2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8; ctx.fillStyle = "#4fc3f7"; ctx.font = "11px ui-monospace,monospace";
  ctx.fillText(`→ X${tx.toFixed(1)} Y${ty.toFixed(1)}`, ex2 + 9, ey2 - 6);
  ctx.restore();
}

function updateWorkspaceState() {
  if (!hasKnownPosition()) {
    coordXEl.textContent = "--"; coordYEl.textContent = "--";
    coordZEl.textContent = "--"; coordEEl.textContent = "--";
    radiusStatusEl.textContent = "--"; shoulderStatusEl.textContent = "--"; elbowStatusEl.textContent = "--";
    workspaceStatusEl.className = "status-value status-warning";
    workspaceStatusEl.textContent = "Unknown"; return;
  }
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const { x, y } = simulatedPosition;
  const r = Math.sqrt(x*x + y*y);
  const maxR = l1 + l2, minR = Math.max(Math.abs(l1 - l2), CONFIG.arm.forbiddenRadius);
  let cosE = (x*x + y*y - l1*l1 - l2*l2) / (2*l1*l2);
  cosE = Math.max(-1, Math.min(1, cosE));
  coordXEl.textContent = x.toFixed(1); coordYEl.textContent = y.toFixed(1);
  coordZEl.textContent = simulatedPosition.z.toFixed(1); coordEEl.textContent = simulatedPosition.e.toFixed(1);
  radiusStatusEl.textContent   = `${r.toFixed(1)} mm`;
  const ik = ikScaraAngles(x, y);
  shoulderStatusEl.textContent = `${ik.shoulderDeg.toFixed(1)}°`;
  elbowStatusEl.textContent    = `${ik.elbowDeg.toFixed(1)}°`;
  workspaceStatusEl.className = "status-value";
  if      (r > maxR)         { workspaceStatusEl.textContent = "Out of reach";   workspaceStatusEl.classList.add("status-danger"); }
  else if (r < minR)         { workspaceStatusEl.textContent = "Forbidden zone"; workspaceStatusEl.classList.add("status-danger"); }
  else if (r > maxR * 0.9)   { workspaceStatusEl.textContent = "Near limit";     workspaceStatusEl.classList.add("status-warning"); }
  else                       { workspaceStatusEl.textContent = "OK";             workspaceStatusEl.classList.add("status-ok"); }
}

// ─────────────────────────────────────────────
// PRECISE MOVE
// ─────────────────────────────────────────────

function updateSpeedDisplay() {
  xySpeedValue.textContent    = xySpeedSlider.value;
  zSpeedValue.textContent     = zSpeedSlider.value;
  wristSpeedValue.textContent = wristSpeedSlider.value;
  servoSpeedValue.textContent = servoSpeedSlider.value;
  xySpeedStatus.textContent    = xySpeedSlider.value;
  zSpeedStatus.textContent     = zSpeedSlider.value;
  wristSpeedStatus.textContent = wristSpeedSlider.value;
  updateAbsolutePreview();
}

function updateAbsolutePreview() {
  const absServoVal = document.getElementById("absServo")?.value.trim() || "";
  const moveGcode = buildAbsoluteMove(
    { x: absXInput.value.trim(), y: absYInput.value.trim(), z: absZInput.value.trim(), e: absEInput.value.trim() },
    unitsPerSecondToFeedrate(xySpeedSlider.value)
  );
  const servoGcode = absServoVal !== "" ? buildServoMove(Number(absServoVal)) : null;
  if (!moveGcode && !servoGcode) { previewAbsoluteCodeEl.textContent = "Preview: waiting for coordinates"; return; }
  const parts = [];
  if (moveGcode)  parts.push(`Move: ${moveGcode.replace(/\n/g, " | ")}`);
  if (servoGcode) parts.push(`Servo: ${servoGcode}`);
  previewAbsoluteCodeEl.textContent = parts.join(" | ");
}

function clearAbsoluteFields() {
  ["absX","absY","absZ","absE","absServo"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  updateAbsolutePreview();
}

function getTargetXYFromInputs() {
  const xRaw = absXInput.value.trim(), yRaw = absYInput.value.trim();
  if (xRaw === "" && yRaw === "") return null;
  const curX = hasKnownPosition() ? simulatedPosition.x : 0;
  const curY = hasKnownPosition() ? simulatedPosition.y : 0;
  const tx = xRaw !== "" ? Number(xRaw) : curX;
  const ty = yRaw !== "" ? Number(yRaw) : curY;
  if (Number.isNaN(tx) || Number.isNaN(ty)) { appendLog("! X and Y must be valid numbers."); return null; }
  return { x: tx, y: ty };
}

function updatePreciseMovePreview() {
  const x = absXInput.value.trim(), y = absYInput.value.trim();
  if (x !== "" && y !== "" && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))) {
    setPreviewPosition(Number(x), Number(y));
  } else if (!pendingExecution) { clearPreviewPosition(); }
}

function setPreviewPosition(x, y) { previewPosition = { x: Number(x), y: Number(y) }; drawWorkspace(); }

function clearPreviewPosition() {
  previewPosition = null; pendingExecution = null;
  drawWorkspace(); updatePreviewBanner(null);
}

function updatePreviewBanner(label) {
  const banner = document.getElementById("previewBanner");
  if (!label) { if (banner) banner.style.display = "none"; return; }
  if (!banner) return;
  banner.style.display = "flex";
  document.getElementById("previewBannerLabel").textContent = label;
}

async function handleGoToPosition() {
  const target = getTargetXYFromInputs();
  if (target && isXYOutsideWorkspace(target.x, target.y)) {
    appendLog(`! Target outside workspace. X${target.x.toFixed(2)} Y${target.y.toFixed(2)}`); return;
  }
  const gcode = buildAbsoluteMove(
    { x: absXInput.value.trim(), y: absYInput.value.trim(), z: absZInput.value.trim(), e: absEInput.value.trim() },
    unitsPerSecondToFeedrate(xySpeedSlider.value)
  );
  if (!gcode) return;
  const servoVal = document.getElementById("absServo")?.value.trim();
  if (target) setPreviewPosition(target.x, target.y);
  pendingExecution = async () => {
    await sendRawGcode(gcode, "Go to Position");
    if (servoVal) await sendRawGcode(buildServoMove(Number(servoVal)), "Go to Position – Servo");
  };
  updatePreviewBanner(`Go to X${target ? target.x.toFixed(1) : "?"} Y${target ? target.y.toFixed(1) : "?"}`);
}

async function handleSetPosition() {
  const gcode = buildSetPosition({
    x: absXInput.value.trim(), y: absYInput.value.trim(),
    z: absZInput.value.trim(), e: absEInput.value.trim()
  });
  if (!gcode) { appendLog("! Nothing to set — fill at least one field."); return; }
  await sendRawGcode(gcode, "Set Origin (G92)");
}

// ─────────────────────────────────────────────
// MANUAL CONTROL ACTIONS
// ─────────────────────────────────────────────

function getClampedJogGcode(action) {
  if (!hasKnownPosition()) return null;
  const v = getUiValues();
  const feed = unitsPerSecondToFeedrate(v.xySpeed);
  let nx = simulatedPosition.x, ny = simulatedPosition.y;
  if      (action === "jog-x-negative") nx -= v.xyStep;
  else if (action === "jog-x-positive") nx += v.xyStep;
  else if (action === "jog-y-negative") ny -= v.xyStep;
  else if (action === "jog-y-positive") ny += v.xyStep;
  else return null;
  const c = clampXYToWorkspace(nx, ny);
  if (!c.clamped) return null;
  appendLog(`! Jog clamped to X${c.x.toFixed(2)} Y${c.y.toFixed(2)}.`);
  return buildAbsoluteMove({ x: c.x, y: c.y, z: "", e: "" }, feed);
}

async function handleAction(action) {
  if (action === "servo-jog-plus" || action === "servo-jog-minus") {
    const v = getUiValues();
    if (currentServoAngle === null) {
      const seed = document.getElementById("absServo")?.value.trim();
      currentServoAngle = seed !== "" && seed !== undefined ? Number(seed) : (CONFIG.hanoi?.firmwareServo?.openAngle ?? 0);
    }
    const delta = action === "servo-jog-plus" ? v.servoStep : -v.servoStep;
    currentServoAngle = Math.min(180, Math.max(0, currentServoAngle + delta));
    const gcode = buildServoMove(currentServoAngle);
    await sendRawGcode(gcode, `Servo ${delta > 0 ? "+" : "−"}${v.servoStep}° → ${formatNumber(currentServoAngle)}°`);
    const el = document.getElementById("absServo"); if (el) el.value = formatNumber(currentServoAngle);
    return;
  }


  const result = getActionGcode(action, getUiValues());
  if (!result) return;

  const gcodeToSend = getClampedJogGcode(action) || result.gcode;

  const expectsPosition = action === "get-position";
  const isHome = action === "home";
  const expectsReply = expectsPosition || action === "check-endstops" || isHome;
  const sentOk = await sendRawGcode(gcodeToSend, result.label, {
    expectOk: expectsReply,
    waitForPosition: expectsPosition,
    timeoutSeconds: isHome ? Number(CONFIG.system?.homeTimeoutSeconds ?? 120) : (expectsReply ? 3 : 2)
  });
  if (!sentOk) return;

  if (action === "open-gripper") {
    currentServoAngle = CONFIG.hanoi?.firmwareServo?.openAngle ?? currentServoAngle;
  } else if (action === "close-gripper") {
    currentServoAngle = CONFIG.hanoi?.firmwareServo?.closeAngle ?? currentServoAngle;
  } else {
    const m = gcodeToSend.match(/M280 P0 S([\d.]+)/);
    if (m) currentServoAngle = Number(m[1]);
  }
  if (action === "home") {
    appendLog("; Home acknowledged by firmware. Requesting position now…");
    await sendRawGcode(CONFIG.system.getPosition, "Get Position after Home", {
      expectOk: true,
      waitForPosition: true,
      timeoutSeconds: Number(CONFIG.system?.positionSyncTimeoutSeconds ?? 10)
    });
  }
}

async function handleCustomSend() {
  const v = customMsgInput.value.trim();
  if (!v) return;

  // Manual custom commands should also wait for firmware acknowledgement.
  // Otherwise the UI can say "sent" while the Arduino is still busy and the
  // firmware may swallow later commands during motion.
  const expectsPosition = /(^|\n)\s*M114\b/i.test(v);
  const isStartOnly = /^\s*START\s*$/i.test(v);
  await sendRawGcode(v, "Custom G-code", {
    expectOk: true,
    waitForPosition: expectsPosition,
    waitForOkCount: isStartOnly ? Number(CONFIG.hanoi?.startOkCount ?? 2) : 0,
    timeoutSeconds: isStartOnly
      ? Number(CONFIG.hanoi?.startTimeoutSeconds ?? 90)
      : (expectsPosition ? Number(CONFIG.system?.positionSyncTimeoutSeconds ?? 10) : Number(CONFIG.hanoi?.substepTimeoutSeconds ?? 45))
  });
  customMsgInput.value = "";
}

// ─────────────────────────────────────────────
// IK CALIBRATION VALUES
// ─────────────────────────────────────────────

// The old saved-data UI was removed from index.html. Keep only the small
// calibration store used by the IK test section, so app.js does not carry the
// unused saved-move / per-disk servo table code.
const SD_AXIS_KEY  = "sdAxis2";
const SD_CONST_KEY = "sdConst2";

const HANOI_CAL = CONFIG.hanoi?.calibration || {};
const SD_AXIS_DEFAULTS = {
  x: [
    { name: "peg0", value: HANOI_CAL.peg0X ?? "" },
    { name: "peg1", value: HANOI_CAL.peg1X ?? "" },
    { name: "peg2", value: HANOI_CAL.peg2X ?? "" }
  ],
  y: [{ name: "pegs (shared)", value: HANOI_CAL.pegsY ?? "" }],
  z: [
    { name: "platform base", value: HANOI_CAL.platformBaseZ ?? "" },
    { name: "release / top-of-peg", value: HANOI_CAL.dropZ ?? "" },
    { name: "height up (clearance)", value: HANOI_CAL.clearanceZ ?? "" }
  ],
  e: []
};

function loadSdAxis() {
  try {
    const raw = localStorage.getItem(SD_AXIS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return JSON.parse(JSON.stringify(SD_AXIS_DEFAULTS));
}

function loadSdConst() {
  try {
    const raw = localStorage.getItem(SD_CONST_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { diskHeight: CONFIG.hanoi?.diskHeight ?? "" };
}

const sdAxis = loadSdAxis();
const sdConst = loadSdConst();

function sdFindVal(axis, name) {
  const entry = (sdAxis[axis] || []).find(e => e.name === name);
  return (entry && entry.value !== "") ? Number(entry.value) : null;
}

function ikGetPlatformBaseZ()  { return sdFindVal("z", "platform base"); }
function ikGetDiskHeight()     { const v = sdConst.diskHeight; return (v !== undefined && v !== "") ? Number(v) : null; }
function ikGetZClearance()     { return sdFindVal("z", "height up (clearance)"); }

function ikGetPegXY(peg) {
  // The PEG macros move to the safe "UP" coordinates, not exactly to the peg center.
  // Use the UP coordinates for previews/ghost arm positions.
  return getFirmwarePegXY(peg, "up");
}

function getPegOffset(peg) {
  const mid = getFirmwarePegXY(1);
  const target = getFirmwarePegXY(peg);
  if (!mid || !target) return NaN;
  return target.x - mid.x;
}

// ─────────────────────────────────────────────
// IK DISK MOVE PLANNER — 3-stage flow
//   Stage 1: Compute -> show plan -> user approves plan
//   Stage 2: Show preview on graph -> user confirms execution
//   Stage 3: Execute
// ─────────────────────────────────────────────

const IK_ELBOW_SIGN = -1;  // matches firmware SCARA_ELBOW_SIGN
const DISK_HEIGHT_MM_FALLBACK = 10;
let ikStepGcodes  = [];      // raw gcode strings per step
let ikStepLabels  = [];      // short labels for each step
let ikComputedData = null;   // full computed plan for stage transitions

function ikScaraAngles(x, y) {
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  let c2 = (x*x + y*y - l1*l1 - l2*l2) / (2*l1*l2);
  c2 = Math.max(-1, Math.min(1, c2));
  const s2 = IK_ELBOW_SIGN * Math.sqrt(Math.max(0, 1 - c2*c2));
  return {
    shoulderDeg: (Math.atan2(x, y) - Math.atan2(l2*s2, l1+l2*c2)) * 180 / Math.PI,
    elbowDeg:    Math.atan2(s2, c2) * 180 / Math.PI
  };
}

function ikShortestDelta(from, to) {
  let d = to - from;
  while (d >  180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function ikGetDropZ()           { return sdFindVal("z", "release / top-of-peg"); }
function ikGetGripZ(diskLevel) {
  const baseZ = ikGetPlatformBaseZ(); if (baseZ === null) return null;
  return baseZ + (diskLevel - 1) * (ikGetDiskHeight() ?? DISK_HEIGHT_MM_FALLBACK);
}

function updateIkClearanceNote() {
  const el = document.getElementById("ikClearanceNote");
  if (!el) return;
  el.innerHTML = `Firmware macro mode: peg positions, layers, safe height, and gripper angles are defined in <strong>firmware.ino</strong>.`;
}

function ikSetStage(stage) {
  document.getElementById("ikActions").style.display = (ikStepGcodes.length > 0) ? "flex" : "none";
}

function computeIKTransfer() {
  const diskType  = Number(document.querySelector('input[name="ikDisk"]:checked')?.value  || 1);
  const fromPeg   = Number(document.querySelector('input[name="ikFrom"]:checked')?.value  || 0);
  const toPeg     = Number(document.querySelector('input[name="ikTo"]:checked')?.value    || 2);
  const diskLevel = Number(document.querySelector('input[name="ikLevel"]:checked')?.value || 1);

  const resultEl = document.getElementById("ikResult");
  ikStepGcodes = [];
  ikStepLabels = [];
  ikComputedData = null;
  ikSetStage(null);

  const err = (msg) => { resultEl.innerHTML = `<div class="ik-error">${msg}</div>`; ikSetStage(null); };

  if (fromPeg === toPeg) return err("From and To pegs must be different.");
  if (diskLevel < 1 || diskLevel > 5) return err("Layer must be between 1 and 5.");

  const fromXY = ikGetPegXY(fromPeg);
  const toXY = ikGetPegXY(toPeg);
  const sourceLayer = `LAYER${diskLevel}`;
  const targetLayer = `LAYER1`;

  const allSteps = [
    { label: `Move above ${firmwarePegLabel(fromPeg)}`, gcode: `UP
${firmwarePegLabel(fromPeg)}` },
    { label: `Pick Disk ${diskType} from layer ${diskLevel}`, gcode: `${sourceLayer}
CLOSE
UP` },
    { label: `Move to ${firmwarePegLabel(toPeg)}`, gcode: `${firmwarePegLabel(toPeg)}` },
    { label: `Place Disk ${diskType} on target layer`, gcode: `${targetLayer}
OPEN
UP` }
  ];

  ikStepGcodes  = allSteps.map(s => s.gcode);
  ikStepLabels  = allSteps.map(s => s.label);
  ikComputedData = { diskType, fromPeg, toPeg, diskLevel, fromXY, toXY };

  const nlLines = [
    `<strong>Disk ${diskType}</strong>: ${firmwarePegLabel(fromPeg)} → ${firmwarePegLabel(toPeg)}`,
    `<strong>Step 1 — Move above source</strong>: send <code>UP</code>, then <code>${firmwarePegLabel(fromPeg)}</code>.`,
    `<strong>Step 2 — Pick</strong>: send <code>${sourceLayer}</code>, <code>CLOSE</code>, then <code>UP</code>.`,
    `<strong>Step 3 — Move to target</strong>: send <code>${firmwarePegLabel(toPeg)}</code>.`,
    `<strong>Step 4 — Place</strong>: send target layer command, <code>OPEN</code>, then <code>UP</code>.`
  ];

  const stepRows = allSteps.map((s, i) => `
    <div class="ik-step-row">
      <div class="ik-step-badge">${i + 1}</div>
      <div class="ik-step-content">
        <div class="ik-step-label">${s.label}</div>
        <div class="ik-step-gcode">${escapeHtml(s.gcode)}</div>
      </div>
    </div>`).join("");

  resultEl.innerHTML = `
    <div class="ik-nl-summary">${nlLines.join("<br>")}</div>
    <div class="ik-gcode-toggle-row">
      <button class="btn btn-secondary btn-xsmall" id="ikToggleGcode">Show firmware commands</button>
    </div>
    <div class="ik-gcode-steps" id="ikGcodeSteps" style="display:none">${stepRows}</div>
  `;
  document.getElementById("ikToggleGcode")?.addEventListener("click", (e) => {
    const el = document.getElementById("ikGcodeSteps");
    const shown = el.style.display !== "none";
    el.style.display = shown ? "none" : "block";
    e.target.textContent = shown ? "Show firmware commands" : "Hide firmware commands";
  });

  ikSetStage("plan");
  ikQueueNextStep(0);
}

/**
 * Queue step i for preview+confirm via the shared preview banner.
 */
function ikQueueNextStep(i) {
  if (i >= ikStepGcodes.length) {
    // All steps done
    clearPreviewPosition();
    ikSetStage(null);
    appendLog("; IK move complete.");
    return;
  }
  const label = ikStepLabels[i];
  const gcode = ikStepGcodes[i];

  if (ikComputedData) {
    if (label.startsWith("Move above") && ikComputedData.fromXY) setPreviewPosition(ikComputedData.fromXY.x, ikComputedData.fromXY.y);
    else if (label.startsWith("Move to") && ikComputedData.toXY)  setPreviewPosition(ikComputedData.toXY.x,   ikComputedData.toXY.y);
  }

  pendingExecution = async () => {
    clearPreviewPosition();
    appendLog(`; IK Step ${i + 1}/${ikStepGcodes.length}: ${label}`);
    await sendRawGcode(gcode, `IK ${label}`);
    // Auto-queue the next step
    ikQueueNextStep(i + 1);
  };
  updatePreviewBanner(`Step ${i + 1}/${ikStepGcodes.length} — ${label}`);
}

function setupIKPlanner() {
  document.getElementById("ikComputeBtn")?.addEventListener("click", () => {
    updateIkClearanceNote();
    computeIKTransfer();
  });

  // Recompute automatically when inputs change
  document.querySelectorAll('input[name="ikFrom"],input[name="ikTo"],input[name="ikDisk"],input[name="ikLevel"]').forEach(r => {
    r.addEventListener("change", () => {
      if (ikStepGcodes.length > 0) { ikSetStage(null); computeIKTransfer(); }
    });
  });
}

// ─────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────

xySpeedSlider.addEventListener("input",    updateSpeedDisplay);
zSpeedSlider.addEventListener("input",     updateSpeedDisplay);
wristSpeedSlider.addEventListener("input", updateSpeedDisplay);
servoSpeedSlider.addEventListener("input", updateSpeedDisplay);

[absXInput, absYInput, absZInput, absEInput].forEach(el => el.addEventListener("input", updateAbsolutePreview));
document.getElementById("absServo")?.addEventListener("input", updateAbsolutePreview);
absXInput.addEventListener("input", updatePreciseMovePreview);
absYInput.addEventListener("input", updatePreciseMovePreview);


document.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => handleAction(btn.dataset.action)));

document.getElementById("goToPositionBtn")?.addEventListener("click",  handleGoToPosition);
document.getElementById("setPositionBtn")?.addEventListener("click",   handleSetPosition);
document.getElementById("clearAbsoluteBtn")?.addEventListener("click", clearAbsoluteFields);
document.getElementById("sendCustomBtn")?.addEventListener("click",    handleCustomSend);
document.getElementById("clearLogBtn")?.addEventListener("click",      clearLog);

customMsgInput.addEventListener("keydown", e => { if (e.key === "Enter") handleCustomSend(); });


// ─────────────────────────────────────────────
// NETWORK / CAMERA
// ─────────────────────────────────────────────

function updateCameraLinks() {
  const feed = document.getElementById("cameraFeed");
  const captureLink = document.getElementById("cameraCaptureLink");
  const ipInput = document.getElementById("espIpInput");

  if (ipInput) ipInput.value = CONFIG.espIp;

  // The visible camera is now the Python/OpenCV annotated stream.
  // The raw ESP32 stream is used internally by cv_server.py.
  if (feed && feed.dataset.paused !== "true") {
    feed.src = `${getCvStreamUrl()}?t=${Date.now()}`;
  }

  if (captureLink) captureLink.href = `${getCvSnapshotUrl()}?t=${Date.now()}`;
}

async function syncCvServerEspIp() {
  // Tell the local OpenCV bridge which ESP32 stream it should read.
  // If the Python server is not running yet, this fails silently and the UI still loads.
  try {
    await fetch(`${getCvSetEspUrl()}&t=${Date.now()}`, { cache: "no-store" });
  } catch (_) {
    appendLog("! OpenCV server not reachable yet. Start cv_server.py to see the annotated stream.");
  }
}

function setupNetworkPanel() {
  const ipInput = document.getElementById("espIpInput");
  const saveBtn = document.getElementById("saveEspIpBtn");
  const reloadBtn = document.getElementById("reloadCameraBtn");
  const pauseBtn = document.getElementById("pauseCameraBtn");

  updateCameraLinks();
  void syncCvServerEspIp();

  saveBtn?.addEventListener("click", async () => {
    if (!setEspIp(ipInput?.value)) { appendLog("! Empty ESP IP."); return; }
    appendLog(`; ESP IP set to ${CONFIG.espIp}.`);
    await syncCvServerEspIp();
    updateCameraLinks();
  });

  ipInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn?.click();
  });

  reloadBtn?.addEventListener("click", () => {
    const feed = document.getElementById("cameraFeed");
    if (feed) feed.dataset.paused = "false";
    updateCameraLinks();
  });

  pauseBtn?.addEventListener("click", () => {
    const feed = document.getElementById("cameraFeed");
    if (!feed) return;
    const paused = feed.dataset.paused === "true";
    if (paused) {
      feed.dataset.paused = "false";
      pauseBtn.textContent = "Pause";
      updateCameraLinks();
    } else {
      feed.dataset.paused = "true";
      feed.removeAttribute("src");
      pauseBtn.textContent = "Resume";
    }
  });
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

async function initApp() {
  await loadCommandDescriptions();
  setupNetworkPanel();
  setupTooltipToggle();
  setupCommandTooltips();
  setupIKPlanner();
  updateIkClearanceNote();
  if (typeof setupHanoiSolver === "function") setupHanoiSolver();

  // Collapsible cards — click header to toggle
  document.querySelectorAll(".advanced-drawer .card-header").forEach(header => {
    header.classList.add("collapsible");
    header.addEventListener("click", (e) => {
      if (e.target.closest("button, input, select, a")) return;
      const card = header.closest(".card");
      card.classList.toggle("collapsed");
      header.classList.toggle("collapsed");
    });
  });

  document.getElementById("previewConfirmBtn")?.addEventListener("click", async () => {
    const fn = pendingExecution; clearPreviewPosition(); if (fn) await fn();
  });
  document.getElementById("previewCancelBtn")?.addEventListener("click", () => {
    clearPreviewPosition(); appendLog("; Preview cancelled.");
  });

  updateSpeedDisplay();
  updateAbsolutePreview();
  resizeWorkspaceCanvas();
  window.addEventListener("resize", resizeWorkspaceCanvas);
  // Guarantee draw after full layout paint
  setTimeout(() => { resizeWorkspaceCanvas(); }, 100);
  setTimeout(() => { resizeWorkspaceCanvas(); }, 500);
}

initApp();