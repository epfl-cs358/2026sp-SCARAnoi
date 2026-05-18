// ─────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────

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

const servoMinInput = document.getElementById("servoMin");
const servoMaxInput = document.getElementById("servoMax");

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
let currentServoAngle  = null;   // tracks last sent servo angle for jog ±
let simMode            = false;  // offline simulation — no real fetch

let previewPosition  = null;
let pendingExecution = null;

function seedInitialWorkspacePose() {
  // Firmware initialises: shoulderDeg=-87, elbowDeg=-82, z=0, e=-137
  // FK: x = L1*sin(θ) + L2*sin(θ+ψ),  y = L1*cos(θ) + L2*cos(θ+ψ)
  const θ = -87 * Math.PI / 180, ψ = -82 * Math.PI / 180;
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const x = l1 * Math.sin(θ) + l2 * Math.sin(θ + ψ);
  const y = l1 * Math.cos(θ) + l2 * Math.cos(θ + ψ);
  setSimulatedPosition(x, y, 0, -137);
}

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
    servoStep:  Number(servoStepInput?.value ?? 5),
    servoMin:   Number(servoMinInput.value),
    servoMax:   Number(servoMaxInput.value)
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
// NETWORK / GCODE SEND  (with offline sim mode)
// ─────────────────────────────────────────────

function buildSimulatedM114Response() {
  if (!hasKnownPosition()) return "X:0.000 Y:0.000 Z:0.000 E:0.000  Joints theta:0.000 psi:0.000  steps S:0 P:0 Z:0 E:0";
  const p = simulatedPosition;
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  // Firmware IK: atan2(px, py) convention — matches ikScaraAngles in app
  let c2 = (p.x*p.x + p.y*p.y - l1*l1 - l2*l2) / (2*l1*l2);
  c2 = Math.max(-1, Math.min(1, c2));
  const IK_ELBOW_SIGN = -1;
  const s2 = IK_ELBOW_SIGN * Math.sqrt(Math.max(0, 1 - c2*c2));
  const psi   = Math.atan2(s2, c2);
  const theta = Math.atan2(p.x, p.y) - Math.atan2(l2*s2, l1 + l2*c2);
  const sDeg = (theta * 180 / Math.PI).toFixed(3);
  const eDeg = (psi   * 180 / Math.PI).toFixed(3);
  return `X:${p.x.toFixed(3)} Y:${p.y.toFixed(3)} Z:${p.z.toFixed(3)} E:${p.e.toFixed(3)}  Joints theta:${sDeg} psi:${eDeg}  steps S:0 P:0 Z:0 E:0\nok`;
}

function buildSimulatedResponse(gcode) {
  const upper = gcode.trim().toUpperCase();
  if (upper.startsWith("M114")) return buildSimulatedM114Response();
  if (upper.startsWith("M119")) return "x_min: open\nx_max: open\ny_min: open\ny_max: open\nz_min: open\nz_max: open\nok";
  if (upper.startsWith("M280")) {
    const m = gcode.match(/S([\d.]+)/i);
    return m ? `echo: servo P0 set to ${m[1]}\nok` : "ok";
  }
  if (upper.startsWith("M281")) return `echo: gripper bounds updated\nok`;
  if (upper.startsWith("M282")) return "echo: servo P0 detached\nok";
  if (upper.startsWith("M17"))  return "ok";
  if (upper.startsWith("M18") || upper.startsWith("M84")) return "ok";
  if (upper.startsWith("M112")) return "error: emergency stop";
  if (upper.startsWith("M999")) return "echo: emergency stop cleared\nok";
  if (upper.startsWith("G28"))  return "echo: homing complete\nok";
  if (upper.startsWith("M503")) return "SCARAnoi custom firmware settings\nok";
  if (upper.startsWith("M360")) return "ok";
  if (upper.startsWith("G90") || upper.startsWith("G91")) return "ok";
  if (upper.startsWith("G92")) return "ok";
  if (upper.match(/^G0\b/) || upper.match(/^G1\b/)) return "ok";
  return "ok";
}

async function sendRawGcode(gcode, label) {
  const lines = gcode.split("\n").map(l => l.trim()).filter(l => l);

  if (simMode) {
    // ── Simulation mode: apply to local state, log richly, no fetch ──
    for (const line of lines) {
      logBox.innerHTML += `\n<span class="log-sim">[SIM] &gt; ${escapeHtml(line)}</span>`;
    }
    logBox.scrollTop = logBox.scrollHeight;
    lastCommandEl.textContent = `[SIM] ${label} — ${gcode.replace(/\n/g, " | ")}`;

    applyGcodeToSimulation(gcode);

    // Build a realistic simulated response
    const simResp = buildSimulatedResponse(lines[lines.length - 1]);
    logBox.innerHTML += `\n<span class="log-sim-response">[SIM] &lt; ${escapeHtml(simResp)}</span>`;
    logBox.scrollTop = logBox.scrollHeight;
    lastResponseEl.textContent = simResp;
    connectionStatusEl.textContent = "Offline simulation mode";

    // If this was M114, parse the simulated response to update graph
    if (lines.some(l => l.toUpperCase().startsWith("M114"))) {
      parseM114Position(buildSimulatedM114Response());
    }
    return true;
  }

  // ── Live mode: real fetch ──
  appendLog(`> ${label}:\n${gcode}`);
  lastCommandEl.textContent = `${label} — ${gcode.replace(/\n/g, " | ")}`;
  applyGcodeToSimulation(gcode);
  try {
    const res  = await fetch(`${getControlBaseUrl()}/send?msg=${encodeURIComponent(gcode)}`);
    const text = await res.text();
    appendLog(`< ${text}`);
    lastResponseEl.textContent = text;
    connectionStatusEl.textContent = `Connected to ESP32 at ${CONFIG.espIp}`;
    updateCameraLinks();
    if (parseM114Position(text)) appendLog("; Graph synced from M114.");
    return true;
  } catch (err) {
    const msg = `Error: ${err}`;
    appendLog(`! ${msg}`);
    lastResponseEl.textContent = msg;
    connectionStatusEl.textContent = "Disconnected or request failed";
    return false;
  }
}

// ─────────────────────────────────────────────
// POSITION SIMULATION
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
      // Firmware home: shoulderDeg=-87, elbowDeg=-82, z=0, e=-137
      // FK: x = L1*sin(θ) + L2*sin(θ+ψ),  y = L1*cos(θ) + L2*cos(θ+ψ)
      const θ = -87 * Math.PI / 180, ψ = -82 * Math.PI / 180;
      const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
      const hx = l1 * Math.sin(θ) + l2 * Math.sin(θ + ψ);
      const hy = l1 * Math.cos(θ) + l2 * Math.cos(θ + ψ);
      setSimulatedPosition(hx, hy, 0, -137);
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
    // Compute current joint angles via firmware IK convention
    const cur = ikScaraAngles(simulatedPosition.x, simulatedPosition.y);
    const θ = (cur.shoulderDeg + (dx ?? 0)) * Math.PI / 180;
    const ψ = (cur.elbowDeg    + (dy ?? 0)) * Math.PI / 180;
    // Firmware FK: x = L1*sin(θ) + L2*sin(θ+ψ),  y = L1*cos(θ) + L2*cos(θ+ψ)
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
  // displayScale shrinks the canvas drawing while keeping real-mm proportions.
  // IK, workspace limits and G-code all still use real l1/l2.
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

// Draw peg0 / peg1 / peg2 as yellow triangles using saved X/Y data
function drawPegs(ctx, cx, cy, scale) {
  const ds = CONFIG.arm.displayScale ?? 1;
  const xList = (typeof sdAxis !== "undefined" && sdAxis?.x) || [];
  const yList = (typeof sdAxis !== "undefined" && sdAxis?.y) || [];
  const yEntry = yList.find(r => r.name === "pegs (shared)") || yList[0];
  const yVal = (yEntry && yEntry.value !== "") ? Number(yEntry.value) : null;
  if (yVal === null) return;

  const PEG_H = 9;
  ctx.save();
  ["peg0","peg1","peg2"].forEach((name, i) => {
    const xEntry = xList.find(r => r.name === name);
    if (!xEntry || xEntry.value === "") return;
    const sx = cx + Number(xEntry.value) * ds * scale;
    const sy = cy - yVal * ds * scale;
    ctx.fillStyle = "#f9e04b"; ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(sx, sy - PEG_H);
    ctx.lineTo(sx - PEG_H * 0.7, sy + PEG_H * 0.4);
    ctx.lineTo(sx + PEG_H * 0.7, sy + PEG_H * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.95; ctx.fillStyle = "#f9e04b";
    ctx.font = "bold 9px ui-monospace,monospace"; ctx.textAlign = "center";
    ctx.fillText("P" + i, sx, sy + PEG_H * 2);
  });
  ctx.restore();
}

function drawArm(ctx, cx, cy, scale) {
  if (!hasKnownPosition()) {
    ctx.fillStyle = "rgba(255,176,102,0.85)"; ctx.font = "14px ui-monospace,monospace"; ctx.textAlign = "center";
    ctx.fillText("Position unknown", cx, cy - 8);
    ctx.fillText("Use M114, G28, or G92 to sync", cx, cy + 14);
    ctx.textAlign = "left"; return;
  }
  const l1 = CONFIG.arm.link1, l2 = CONFIG.arm.link2;
  const ds = CONFIG.arm.displayScale ?? 1;
  const { x, y, e: wristDeg } = simulatedPosition;

  // Firmware IK: theta=atan2(x,y), psi=atan2(s2,c2), ELBOW_SIGN=-1
  // FK: x = L1*sin(θ) + L2*sin(θ+ψ),  y = L1*cos(θ) + L2*cos(θ+ψ)
  let c2 = (x*x + y*y - l1*l1 - l2*l2) / (2*l1*l2);
  c2 = Math.max(-1, Math.min(1, c2));
  const s2 = IK_ELBOW_SIGN * Math.sqrt(Math.max(0, 1 - c2*c2));
  const θ = Math.atan2(x, y) - Math.atan2(l2*s2, l1 + l2*c2);
  const ψ = Math.atan2(s2, c2);

  // Elbow position via firmware FK  (canvas: right=+x, up=+y so cy - y*scale)
  const elbowX = l1 * Math.sin(θ);
  const elbowY = l1 * Math.cos(θ);
  const ex  = cx + elbowX * ds * scale;
  const ey  = cy - elbowY * ds * scale;
  const ex2 = cx + x * ds * scale;
  const ey2 = cy - y * ds * scale;

  // Arm links — Shoulder: 
  const SHOULDER_COLOR = "#ff7a00";  // orange — shoulder #ff7a00
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

  // Joints (on top)
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

// "Save move…" button from precise panel — prompts for name then saves
function handleSavePreciseMove() {
  const name = prompt("Save move as:");
  if (!name || !name.trim()) return;
  const pick = (id) => { const v = document.getElementById(id)?.value.trim(); return v !== "" ? v : undefined; };
  const move = { name: name.trim(), x: pick("absX"), y: pick("absY"), z: pick("absZ"), e: pick("absE"), servo: pick("absServo") };
  if (!move.x && !move.y && !move.z && !move.e && !move.servo) { appendLog("! Nothing to save — fill at least one field."); return; }
  sdMoves.push(move);
  saveSdMoves();
  renderSdMoves();
  appendLog(`; Saved move "${move.name}".`);
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

function validateServoBounds() {
  const min = Number(servoMinInput.value), max = Number(servoMaxInput.value);
  if (servoMinInput.value.trim() === "" || servoMaxInput.value.trim() === "") {
    appendLog("! Servo min/max cannot be empty."); return false;
  }
  if (min >= max) { appendLog("! Servo min must be smaller than max."); return false; }
  return true;
}

async function handleAction(action) {
  // Servo jog ± — handled locally (not in getActionGcode)
  if (action === "servo-jog-plus" || action === "servo-jog-minus") {
    const v = getUiValues();
    if (currentServoAngle === null) {
      const seed = document.getElementById("absServo")?.value.trim();
      currentServoAngle = seed !== "" && seed !== undefined ? Number(seed) : v.servoMin;
    }
    const delta = action === "servo-jog-plus" ? v.servoStep : -v.servoStep;
    currentServoAngle = Math.min(v.servoMax, Math.max(v.servoMin, currentServoAngle + delta));
    const gcode = buildServoMove(currentServoAngle);
    await sendRawGcode(gcode, `Servo ${delta > 0 ? "+" : "−"}${v.servoStep}° → ${formatNumber(currentServoAngle)}°`);
    const el = document.getElementById("absServo"); if (el) el.value = formatNumber(currentServoAngle);
    updateCurrentServoDisplay();
    return;
  }

  if (action === "servo-bounds" && !validateServoBounds()) return;

  const result = getActionGcode(action, getUiValues());
  if (!result) return;

  const gcodeToSend = getClampedJogGcode(action) || result.gcode;
  await sendRawGcode(gcodeToSend, result.label);

  // Sync currentServoAngle when open/close gripper sent
  if (action === "open-gripper" || action === "close-gripper") {
    const m = gcodeToSend.match(/M280 P0 S([\d.]+)/);
    if (m) currentServoAngle = Number(m[1]);
  }

  if (action === "home") await sendRawGcode(CONFIG.system.getPosition, "Get Position after Home");
}

async function handleCustomSend() {
  const v = customMsgInput.value.trim();
  if (!v) return;
  await sendRawGcode(v, "Custom G-code");
  customMsgInput.value = "";
}

// ─────────────────────────────────────────────
// DISK GRIP / RELEASE TABLE  (in Saved Data › Servo section)
// ─────────────────────────────────────────────

const NUM_DISKS = 5;
const DISK_ANGLES_KEY = "diskAngles";
const DISK_ANGLE_DEFAULTS = CONFIG.hanoi?.diskAngles || {};
let diskAngles = JSON.parse(localStorage.getItem(DISK_ANGLES_KEY) || JSON.stringify(DISK_ANGLE_DEFAULTS));

function saveDiskAngles() { localStorage.setItem(DISK_ANGLES_KEY, JSON.stringify(diskAngles)); }

function updateCurrentServoDisplay() {
  const el = document.getElementById("currentServoDisplay");
  if (el) el.textContent = currentServoAngle !== null ? formatNumber(currentServoAngle) : "—";
}

function buildDiskTable() {
  const container = document.getElementById("diskGripTable");
  if (!container) return;
  container.innerHTML = "";

  const groupTop = document.createElement("div");
  groupTop.className = "disk-row-group disk-row-group--3";
  const groupBottom = document.createElement("div");
  groupBottom.className = "disk-row-group disk-row-group--2";

  for (let d = 1; d <= NUM_DISKS; d++) {
    const saved = diskAngles[`disk${d}`] || {};
    const row = document.createElement("div");
    row.className = "disk-row";
    row.innerHTML = `
      <div class="disk-row-top">
        <div class="disk-label">Disk ${d}</div>
        <div class="field-block">
          <label class="field-label">Grip °</label>
          <div class="disk-angle-row">
            <input class="disk-grip" type="number" min="0" max="180" step="1" value="${saved.grip ?? ""}" placeholder="—" />
            <button class="btn btn-secondary btn-xsmall disk-capture-grip" title="Capture current servo angle as Grip">↓</button>
          </div>
        </div>
        <div class="field-block">
          <label class="field-label">Release °</label>
          <div class="disk-angle-row">
            <input class="disk-release" type="number" min="0" max="180" step="1" value="${saved.release ?? ""}" placeholder="—" />
            <button class="btn btn-secondary btn-xsmall disk-capture-release" title="Capture current servo angle as Release">↓</button>
          </div>
        </div>
      </div>
      <div class="disk-row-bottom">
        <button class="btn btn-secondary btn-small disk-save-btn">Save</button>
        <button class="btn btn-primary btn-small disk-grip-btn">Grip</button>
        <button class="btn btn-secondary btn-small disk-release-btn">Release</button>
      </div>
    `;
    const gripIn = row.querySelector(".disk-grip"), relIn = row.querySelector(".disk-release");
    const saveBtn = row.querySelector(".disk-save-btn");

    row.querySelector(".disk-capture-grip").addEventListener("click", () => {
      if (currentServoAngle === null) { appendLog("! Servo angle unknown — move servo first."); return; }
      gripIn.value = formatNumber(currentServoAngle);
    });
    row.querySelector(".disk-capture-release").addEventListener("click", () => {
      if (currentServoAngle === null) { appendLog("! Servo angle unknown — move servo first."); return; }
      relIn.value = formatNumber(currentServoAngle);
    });
    saveBtn.addEventListener("click", () => {
      diskAngles[`disk${d}`] = { grip: gripIn.value.trim(), release: relIn.value.trim() };
      saveDiskAngles();
      appendLog(`; Disk ${d}: grip=${gripIn.value}° release=${relIn.value}° saved.`);
      flashBtn(saveBtn);
    });
    row.querySelector(".disk-grip-btn").addEventListener("click", async () => {
      const g = gripIn.value.trim();
      if (!g) { appendLog(`! Disk ${d}: grip angle not set.`); return; }
      const a = Number(g);
      if (Number.isNaN(a) || a < 0 || a > 180) { appendLog(`! Disk ${d}: invalid grip angle.`); return; }
      await sendRawGcode(buildServoMove(a), `Disk ${d} Grip`);
      currentServoAngle = a; updateCurrentServoDisplay();
    });
    row.querySelector(".disk-release-btn").addEventListener("click", async () => {
      const r = relIn.value.trim();
      if (!r) { appendLog(`! Disk ${d}: release angle not set.`); return; }
      const a = Number(r);
      if (Number.isNaN(a) || a < 0 || a > 180) { appendLog(`! Disk ${d}: invalid release angle.`); return; }
      await sendRawGcode(buildServoMove(a), `Disk ${d} Release`);
      currentServoAngle = a; updateCurrentServoDisplay();
    });
    (d <= 3 ? groupTop : groupBottom).appendChild(row);
  }

  container.appendChild(groupTop);
  container.appendChild(groupBottom);
}

function getGripAngleForDisk(d)    { return diskAngles[`disk${d}`]?.grip    ?? null; }
function getReleaseAngleForDisk(d) { return diskAngles[`disk${d}`]?.release ?? null; }

// ─────────────────────────────────────────────
// SERVO INITIAL POSITION
// ─────────────────────────────────────────────

let servoInitialAngle = Number(localStorage.getItem("servoInitialAngle") || "0");

function renderServoInitialResult() {
  const el = document.getElementById("servoCalResult");
  if (el) el.innerHTML = `<span class="cal-ok">✓</span> Physical start: <strong>${servoInitialAngle}°</strong>`;
}

function setupServoInitialAngle() {
  const radio = document.querySelector(`input[name="servoInitial"][value="${servoInitialAngle}"]`);
  if (radio) radio.checked = true;
  document.querySelector('[data-action="servo-bounds"]')?.addEventListener("click", () => {
    const checked = document.querySelector('input[name="servoInitial"]:checked');
    if (checked) {
      servoInitialAngle = Number(checked.value);
      localStorage.setItem("servoInitialAngle", servoInitialAngle);
      renderServoInitialResult();
      appendLog(`; Servo initial position saved: ${servoInitialAngle}°`);
    }
  });
  renderServoInitialResult();
}

// ─────────────────────────────────────────────
// SAVED DATA
// ─────────────────────────────────────────────
//
// Storage:
//   sdAxis  → { x:[{name,value}], y:[…], z:[…], e:[…] }
//   sdConst → { diskHeight: "10" }
//   sdMoves → [{name,x,y,z,e,servo}]
//
// IK reads: ikGetPlatformBaseZ()   ← z["platform base"]
//           ikGetDiskHeight()       ← sdConst.diskHeight
//           ikGetZClearance()       ← z["height up (clearance)"]
//           ikGetPegXY(peg)         ← x[peg0/1/2] + y["pegs (shared)"]
//           getPegOffset(peg)       ← derived from absolute X values

const SD_AXIS_KEY  = "sdAxis2";
const SD_CONST_KEY = "sdConst2";
const SD_MOVES_KEY = "sdMoves2";

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

function loadSdAxis()  { try { const r = localStorage.getItem(SD_AXIS_KEY);  if (r) return JSON.parse(r); } catch(_){} const d = JSON.parse(JSON.stringify(SD_AXIS_DEFAULTS)); localStorage.setItem(SD_AXIS_KEY, JSON.stringify(d)); return d; }
function loadSdConst() { try { const r = localStorage.getItem(SD_CONST_KEY); if (r) return JSON.parse(r); } catch(_) {} return { diskHeight: CONFIG.hanoi?.diskHeight ?? "" }; }
function loadSdMoves() { try { return JSON.parse(localStorage.getItem(SD_MOVES_KEY) || "[]"); } catch(_) { return []; } }

let sdAxis  = loadSdAxis();
let sdConst = loadSdConst();
let sdMoves = loadSdMoves();

function saveSdAxis()  { localStorage.setItem(SD_AXIS_KEY,  JSON.stringify(sdAxis));  }
function saveSdConst() { localStorage.setItem(SD_CONST_KEY, JSON.stringify(sdConst)); }
function saveSdMoves() { localStorage.setItem(SD_MOVES_KEY, JSON.stringify(sdMoves)); }

// ── IK getters ────────────────────────────────

function sdFindVal(axis, name) {
  const e = (sdAxis[axis] || []).find(e => e.name === name);
  return (e && e.value !== "") ? Number(e.value) : null;
}

function ikGetPlatformBaseZ()  { return sdFindVal("z", "platform base"); }
function ikGetDiskHeight()     { const v = sdConst.diskHeight; return (v !== undefined && v !== "") ? Number(v) : null; }
function ikGetZClearance()     { return sdFindVal("z", "height up (clearance)"); }

function ikGetPegXY(peg) {
  // peg is 0, 1, or 2 — maps directly to pegNames
  const xList = sdAxis.x || [], yList = sdAxis.y || [];
  const pegNames = ["peg0","peg1","peg2"];
  const xEntry = xList.find(r => r.name === pegNames[peg]);
  const yEntry = yList.find(r => r.name === "pegs (shared)") || yList[0];
  const x = (xEntry && xEntry.value !== "") ? Number(xEntry.value) : null;
  const y = (yEntry && yEntry.value !== "") ? Number(yEntry.value) : null;
  if (x === null || y === null) return null;
  return { x, y };
}

function getPegOffset(peg) {
  // peg1 is the middle peg (IK reference, offset=0)
  // peg0 and peg2 are outer pegs, stored as absolute X
  if (peg === 1) return 0;
  const mid = sdFindVal("x", "peg1");
  if (mid === null) return NaN;
  const target = sdFindVal("x", peg === 0 ? "peg0" : "peg2");
  if (target === null) return NaN;
  return target - mid;
}

function captureAxisValue(axis) {
  if (!hasKnownPosition()) return null;
  return formatNumber(simulatedPosition[axis]);
}

// ── Per-axis rows ─────────────────────────────

function buildAxisGoHandler(axis, getVal) {
  return async () => {
    const val = getVal();
    if (val === "" || val === null || val === undefined) { appendLog(`! No value saved to go to.`); return; }
    const n = Number(val);
    if (Number.isNaN(n)) { appendLog("! Invalid value."); return; }
    // For X/Y we need the paired axis too for a valid move
    let gcode;
    if (axis === "x") {
      const y = hasKnownPosition() ? simulatedPosition.y : "";
      gcode = buildAbsoluteMove({ x: n, y, z: "", e: "" }, unitsPerSecondToFeedrate(xySpeedSlider.value));
      if (y !== "" && isXYOutsideWorkspace(n, Number(y))) { appendLog("! Target X outside workspace."); return; }
      if (y !== "") setPreviewPosition(n, Number(y));
    } else if (axis === "y") {
      const x = hasKnownPosition() ? simulatedPosition.x : "";
      gcode = buildAbsoluteMove({ x, y: n, z: "", e: "" }, unitsPerSecondToFeedrate(xySpeedSlider.value));
      if (x !== "" && isXYOutsideWorkspace(Number(x), n)) { appendLog("! Target Y outside workspace."); return; }
      if (x !== "") setPreviewPosition(Number(x), n);
    } else if (axis === "z") {
      gcode = buildAbsoluteMove({ x: "", y: "", z: n, e: "" }, unitsPerSecondToFeedrate(zSpeedSlider.value));
    } else if (axis === "e") {
      gcode = buildAbsoluteMove({ x: "", y: "", z: "", e: n }, unitsPerSecondToFeedrate(wristSpeedSlider.value));
    }
    if (!gcode) { appendLog("! Nothing to send."); return; }
    pendingExecution = async () => { await sendRawGcode(gcode, `Go to ${axis.toUpperCase()} ${n}`); };
    updatePreviewBanner(`Go to ${axis.toUpperCase()} ${n}`);
  };
}

function renderSdAxisRows(axis) {
  const container = document.getElementById(`sdRows${axis.toUpperCase()}`);
  if (!container) return;
  container.innerHTML = "";
  (sdAxis[axis] || []).forEach((entry, idx) => {
    const row = document.createElement("div");
    row.className = "sd-row";
    row.innerHTML = `
      <span class="sd-row-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
      <input class="sd-row-val" type="number" step="0.1" value="${entry.value ?? ""}" placeholder="—" />
      <button class="btn btn-secondary btn-xsmall sd-row-capture" title="Capture current ${axis.toUpperCase()}">↓</button>
      <button class="btn btn-secondary btn-xsmall sd-row-save">Save</button>
      <button class="btn btn-primary btn-xsmall sd-row-go" title="Go to this value">→</button>
      <button class="btn btn-secondary btn-xsmall sd-row-del">✕</button>
    `;
    const valInput = row.querySelector(".sd-row-val");
    row.querySelector(".sd-row-capture").addEventListener("click", () => {
      const v = captureAxisValue(axis);
      if (v === null) { appendLog("! Position unknown. Use M114 or G28 first."); return; }
      valInput.value = v;
    });
    row.querySelector(".sd-row-save").addEventListener("click", () => {
      sdAxis[axis][idx].value = valInput.value.trim();
      saveSdAxis();
      appendLog(`; Saved ${axis.toUpperCase()} "${entry.name}" = ${valInput.value}`);
      flashBtn(row.querySelector(".sd-row-save"));
    });
    row.querySelector(".sd-row-go").addEventListener("click", buildAxisGoHandler(axis, () => valInput.value.trim()));
    row.querySelector(".sd-row-del").addEventListener("click", () => {
      if (!confirm(`Delete "${entry.name}"?`)) return;
      sdAxis[axis].splice(idx, 1); saveSdAxis(); renderSdAxisRows(axis);
      appendLog(`; Deleted ${axis.toUpperCase()} "${entry.name}".`);
    });
    container.appendChild(row);
  });
}

function setupSdAxisAdder(axis) {
  const addBtn  = document.querySelector(`.sd-add-entry[data-axis="${axis}"]`);
  const nameIn  = document.querySelector(`.sd-new-name[data-axis="${axis}"]`);
  const valIn   = document.querySelector(`.sd-new-val[data-axis="${axis}"]`);
  const capBtn  = document.querySelector(`.sd-capture-new[data-axis="${axis}"]`);

  capBtn?.addEventListener("click", () => {
    const v = captureAxisValue(axis);
    if (v === null) { appendLog("! Position unknown. Use M114 or G28 first."); return; }
    if (valIn) valIn.value = v;
  });

  const doAdd = () => {
    const name = nameIn?.value.trim();
    if (!name) { appendLog("! Enter a name before adding."); return; }
    if (!sdAxis[axis]) sdAxis[axis] = [];
    if (sdAxis[axis].find(e => e.name === name)) { appendLog(`! "${name}" already exists in ${axis.toUpperCase()}.`); return; }
    sdAxis[axis].push({ name, value: valIn?.value.trim() || "" });
    saveSdAxis(); nameIn.value = ""; if (valIn) valIn.value = "";
    renderSdAxisRows(axis);
    appendLog(`; Added ${axis.toUpperCase()} "${name}".`);
  };
  addBtn?.addEventListener("click", doAdd);
  nameIn?.addEventListener("keydown", e => { if (e.key === "Enter") doAdd(); });
}

// ── Z constants ───────────────────────────────

function renderSdConst() {
  const el = document.getElementById("sdDiskHeight");
  if (el && sdConst.diskHeight !== undefined) el.value = sdConst.diskHeight;
}

function setupSdConst() {
  document.getElementById("sdSaveDiskHeight")?.addEventListener("click", () => {
    sdConst.diskHeight = document.getElementById("sdDiskHeight")?.value.trim() || "";
    saveSdConst();
    appendLog(`; Disk height saved: ${sdConst.diskHeight} mm`);
    flashBtn(document.getElementById("sdSaveDiskHeight"));
  });
}

// ── Combined moves ────────────────────────────

function renderSdMoves() {
  const container = document.getElementById("sdMovesList");
  if (!container) return;
  container.innerHTML = "";
  if (sdMoves.length === 0) { container.innerHTML = `<div class="sd-moves-empty">No moves saved yet.</div>`; return; }

  sdMoves.forEach((move, idx) => {
    const row = document.createElement("div");
    row.className = "sd-move-row";
    const parts = [];
    if (move.x     !== undefined) parts.push(`X${move.x}`);
    if (move.y     !== undefined) parts.push(`Y${move.y}`);
    if (move.z     !== undefined) parts.push(`Z${move.z}`);
    if (move.e     !== undefined) parts.push(`E${move.e}°`);
    if (move.servo !== undefined) parts.push(`S${move.servo}°`);
    row.innerHTML = `
      <div class="sd-move-info">
        <span class="sd-move-name">${escapeHtml(move.name)}</span>
        <span class="sd-move-coords">${parts.join(" · ") || "—"}</span>
      </div>
      <div class="sd-move-actions">
        <button class="btn btn-primary btn-xsmall sd-move-go">Go</button>
        <button class="btn btn-secondary btn-xsmall sd-move-del">✕</button>
      </div>
    `;
    row.querySelector(".sd-move-go").addEventListener("click", async () => {
      const x = move.x !== undefined ? Number(move.x) : null;
      const y = move.y !== undefined ? Number(move.y) : null;
      if (x !== null && y !== null && isXYOutsideWorkspace(x, y)) { appendLog(`! "${move.name}" XY outside workspace.`); return; }
      const gcode = buildAbsoluteMove({ x: move.x ?? "", y: move.y ?? "", z: move.z ?? "", e: move.e ?? "" }, unitsPerSecondToFeedrate(xySpeedSlider.value));
      if (gcode) {
        if (x !== null && y !== null) setPreviewPosition(x, y);
        pendingExecution = async () => {
          await sendRawGcode(gcode, `Go to "${move.name}"`);
          if (move.servo !== undefined) await sendRawGcode(buildServoMove(Number(move.servo)), `"${move.name}" servo`);
        };
        updatePreviewBanner(`Go to "${move.name}"`);
      }
    });
    row.querySelector(".sd-move-del").addEventListener("click", () => {
      if (!confirm(`Delete move "${move.name}"?`)) return;
      sdMoves.splice(idx, 1); saveSdMoves(); renderSdMoves();
      appendLog(`; Deleted move "${move.name}".`);
    });
    container.appendChild(row);
  });
}

function setupSdMoves() {
  // ↓ Current pos: fill from simulatedPosition
  document.getElementById("sdCaptureCurrent")?.addEventListener("click", () => {
    if (!hasKnownPosition()) { appendLog("! Position unknown. Use M114 or G28 first."); return; }
    const s = simulatedPosition;
    document.getElementById("sdMoveX").value = formatNumber(s.x);
    document.getElementById("sdMoveY").value = formatNumber(s.y);
    document.getElementById("sdMoveZ").value = formatNumber(s.z);
    document.getElementById("sdMoveE").value = formatNumber(s.e);
    if (currentServoAngle !== null) document.getElementById("sdMoveServo").value = formatNumber(currentServoAngle);
  });

  document.getElementById("sdSaveMove")?.addEventListener("click", () => {
    const name = document.getElementById("sdMoveName")?.value.trim();
    if (!name) { appendLog("! Enter a name for the move."); return; }
    const pick = (id) => { const v = document.getElementById(id)?.value.trim(); return v !== "" ? v : undefined; };
    const move = { name, x: pick("sdMoveX"), y: pick("sdMoveY"), z: pick("sdMoveZ"), e: pick("sdMoveE"), servo: pick("sdMoveServo") };
    if (!move.x && !move.y && !move.z && !move.e && !move.servo) { appendLog("! Nothing to save — fill at least one field."); return; }
    sdMoves.push(move); saveSdMoves(); renderSdMoves();
    appendLog(`; Saved move "${name}".`);
    ["sdMoveName","sdMoveX","sdMoveY","sdMoveZ","sdMoveE","sdMoveServo"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  });
}

// ── Master setup ──────────────────────────────

function setupSavedData() {
  ["x","y","z","e"].forEach(axis => { renderSdAxisRows(axis); setupSdAxisAdder(axis); });
  renderSdConst(); setupSdConst();
  buildDiskTable();
  setupSdMoves(); renderSdMoves();

  document.getElementById("clearSavedDataBtn")?.addEventListener("click", () => {
    if (!confirm("Clear ALL saved data?")) return;
    sdAxis  = JSON.parse(JSON.stringify(SD_AXIS_DEFAULTS));
    sdConst = {}; sdMoves = [];
    saveSdAxis(); saveSdConst(); saveSdMoves();
    ["x","y","z","e"].forEach(axis => renderSdAxisRows(axis));
    renderSdConst(); renderSdMoves();
    appendLog("; Saved data cleared.");
  });
}

// ─────────────────────────────────────────────
// IK DISK MOVE PLANNER — 3-stage flow
//   Stage 1: Compute → show plan (natural language + gcode) → user approves plan
//   Stage 2: Show preview on graph → user confirms execution
//   Stage 3: Execute
// ─────────────────────────────────────────────

// Mirrors firmware inverseKinematics() exactly:
//   theta = atan2(px, py) - atan2(L2*s2, L1+L2*c2)   [note: atan2(x,y) not atan2(y,x)]
//   psi   = atan2(s2, c2),  s2 = SCARA_ELBOW_SIGN * sqrt(1-c2²)
//   FK:  x = L1*sin(θ) + L2*sin(θ+ψ),  y = L1*cos(θ) + L2*cos(θ+ψ)
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
  const el = document.getElementById("ikClearanceNote"); if (!el) return;
  const v = ikGetZClearance();
  el.innerHTML = v !== null
    ? `Z clearance: <strong>${v} mm</strong> — from saved Z "height up (clearance)"`
    : `Z clearance: <span style="color:var(--danger)">⚠ not set — save "height up (clearance)" in Z axis</span>`;
}

function ikSetStage(stage) {
  // Only manage step buttons visibility now — stage 2/3 bars removed
  document.getElementById("ikActions").style.display = (ikStepGcodes.length > 0) ? "flex" : "none";
}

function computeIKTransfer() {
  const diskType  = Number(document.querySelector('input[name="ikDisk"]:checked')?.value  || 1);
  const fromPeg   = Number(document.querySelector('input[name="ikFrom"]:checked')?.value  || 0);
  const toPeg     = Number(document.querySelector('input[name="ikTo"]:checked')?.value    || 2);
  const diskLevel = Number(document.querySelector('input[name="ikLevel"]:checked')?.value || 1);
  const zClear    = ikGetZClearance();

  const resultEl = document.getElementById("ikResult");
  ikStepGcodes = []; ikStepLabels = []; ikComputedData = null;
  ikSetStage(null);

  const err = (msg) => { resultEl.innerHTML = `<div class="ik-error">${msg}</div>`; ikSetStage(null); };

  if (fromPeg === toPeg) return err("From and To pegs must be different.");
  if (zClear  === null)  return err('Z clearance not set. Save "height up (clearance)" in Z axis.');

  const fromXY = ikGetPegXY(fromPeg), toXY = ikGetPegXY(toPeg);
  if (!fromXY) return err(`Missing X or Y data for Peg ${fromPeg}. Check Saved Data.`);
  if (!toXY)   return err(`Missing X or Y data for Peg ${toPeg}. Check Saved Data.`);
  if (isXYOutsideWorkspace(toXY.x, toXY.y)) return err(`Target Peg ${toPeg} (X${toXY.x.toFixed(1)}, Y${toXY.y.toFixed(1)}) is outside the workspace.`);

  const dropZ = ikGetDropZ();
  if (dropZ === null) return err('"release / top-of-peg" Z not saved. Check Saved Data.');

  const gripAngle    = getGripAngleForDisk(diskType);
  const releaseAngle = getReleaseAngleForDisk(diskType);
  if (!gripAngle)    return err(`Grip angle not saved for Disk ${diskType}. Set it in Saved Data → Servo.`);
  if (!releaseAngle) return err(`Release angle not saved for Disk ${diskType}. Set it in Saved Data → Servo.`);

  const fromIK = ikScaraAngles(fromXY.x, fromXY.y);
  const toIK   = ikScaraAngles(toXY.x,   toXY.y);
  const feedXY = unitsPerSecondToFeedrate(xySpeedSlider.value);
  const feedZ  = unitsPerSecondToFeedrate(zSpeedSlider.value);

  // Step 0: move to source peg XY at clearance height (G1 Cartesian — firmware handles IK)
  const liftZ = dropZ + zClear;
  const curXY = hasKnownPosition() ? { x: simulatedPosition.x, y: simulatedPosition.y } : fromXY;
  const alreadyAtFrom = Math.hypot(curXY.x - fromXY.x, curXY.y - fromXY.y) < 1.0;
  const s0 = alreadyAtFrom ? null : `G90\nG1 X${formatNumber(fromXY.x)} Y${formatNumber(fromXY.y)} Z${formatNumber(liftZ)} F${feedXY}`;

  // Compute joint deltas from source peg IK (arm will be at fromPeg after s0/grip)
  const sDelta = ikShortestDelta(fromIK.shoulderDeg, toIK.shoulderDeg);
  const eDelta = ikShortestDelta(fromIK.elbowDeg,    toIK.elbowDeg);

  const gripZ = ikGetGripZ(diskLevel);
  const liftZ2 = liftZ; // already computed above

  // Step 1: descend to grip Z, close gripper, lift to clearance
  const s1 = [
    `G90\nG1 Z${formatNumber(gripZ)} F${feedZ}`,
    `M280 P0 S${formatNumber(gripAngle)}`,
    `G90\nG1 Z${formatNumber(liftZ2)} F${feedZ}`
  ].join("\n");

  // Step 2: rotate joints to destination peg via M360 (raw delta, no IK)
  const s2parts = [];
  if (Math.abs(sDelta) > 0.01) s2parts.push(`X${formatNumber(sDelta)}`);
  if (Math.abs(eDelta) > 0.01) s2parts.push(`Y${formatNumber(eDelta)}`);
  const s2 = s2parts.length ? `M360 ${s2parts.join(" ")} F${feedXY}` : null;

  // Step 3: lower to drop Z, open gripper
  const s3 = [
    `G90\nG1 Z${formatNumber(dropZ)} F${feedZ}`,
    `M280 P0 S${formatNumber(releaseAngle)}`
  ].join("\n");

  // Natural language helpers
  const signStr = (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const levelLabel = diskLevel === 1 ? "bottom" : diskLevel === 5 ? "top" : `level ${diskLevel}`;

  // Store for auto-confirm flow
  const allSteps = [
    s0 ? { label: `Position over Peg ${fromPeg}`, gcode: s0 } : null,
    { label: "Descend, Grip & Lift", gcode: s1 },
    s2 ? { label: "Rotate joints",  gcode: s2 } : null,
    { label: "Lower & Release",     gcode: s3 }
  ].filter(Boolean);

  ikStepGcodes  = allSteps.map(s => s.gcode);
  ikStepLabels  = allSteps.map(s => s.label);

  ikComputedData = { diskType, fromPeg, toPeg, diskLevel, fromXY, toXY, levelLabel };

  const nlLines = [
    `<strong>Disk ${diskType}</strong>, <strong>${levelLabel}</strong> of stack: Peg <strong>${fromPeg}</strong> → Peg <strong>${toPeg}</strong>`,
    s0 ? `<strong>Step 1 — Position over Peg ${fromPeg}</strong>` : null,
    s0 ? `&nbsp;&nbsp;Move to X<strong>${formatNumber(fromXY.x)}</strong> Y<strong>${formatNumber(fromXY.y)}</strong> at Z<strong>${formatNumber(liftZ2)}</strong> mm clearance.` : null,
    `<strong>Step ${s0 ? "2" : "1"} — Descend, Grip &amp; Lift</strong>`,
    `&nbsp;&nbsp;Lower arm to Z <strong>${gripZ.toFixed(2)} mm</strong>, close servo to <strong>${gripAngle}°</strong>, lift to Z <strong>${liftZ2.toFixed(2)} mm</strong>.`,
    s2 ? `<strong>Step ${s0 ? "3" : "2"} — Rotate joints</strong>` : null,
    s2 ? `&nbsp;&nbsp;Shoulder: <strong>${signStr(sDelta)}°</strong> &nbsp; Elbow: <strong>${signStr(eDelta)}°</strong>` : null,
    `<strong>Step ${[s0,true,s2,true].filter(Boolean).length} — Lower &amp; Release</strong>`,
    `&nbsp;&nbsp;Lower to Z <strong>${dropZ.toFixed(2)} mm</strong>, open servo to <strong>${releaseAngle}°</strong>.`
  ].filter(Boolean);

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
      <button class="btn btn-secondary btn-xsmall" id="ikToggleGcode">Show G-code</button>
    </div>
    <div class="ik-gcode-steps" id="ikGcodeSteps" style="display:none">${stepRows}</div>
  `;
  document.getElementById("ikToggleGcode")?.addEventListener("click", (e) => {
    const el = document.getElementById("ikGcodeSteps");
    const shown = el.style.display !== "none";
    el.style.display = shown ? "none" : "block";
    e.target.textContent = shown ? "Show G-code" : "Hide G-code";
  });

  // Auto-queue the first step for preview+confirm immediately
  ikSetStage("plan");
  ikQueueNextStep(0);
}

/**
 * Queue step i for preview+confirm via the shared preview banner.
 * After confirm → execute → auto-queue next step.
 * This replaces the old manual step buttons.
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

  // Show ghost arm preview for steps that move XY
  if (ikComputedData) {
    if (label.startsWith("Position over Peg")) setPreviewPosition(ikComputedData.fromXY.x, ikComputedData.fromXY.y);
    else if (label === "Rotate joints")        setPreviewPosition(ikComputedData.toXY.x,   ikComputedData.toXY.y);
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

[servoMinInput, servoMaxInput].forEach(el => el.addEventListener("input", () => { if (tooltipEl.classList.contains("visible")) tooltipEl.classList.remove("visible"); }));

document.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => handleAction(btn.dataset.action)));

document.getElementById("goToPositionBtn")?.addEventListener("click",  handleGoToPosition);
document.getElementById("setPositionBtn")?.addEventListener("click",   handleSetPosition);
document.getElementById("savePreciseMoveBtn")?.addEventListener("click", handleSavePreciseMove);
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
  // The raw ESP32 stream is still used internally by cv_server.py.
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
  setupServoInitialAngle();
  setupSavedData();
  setupIKPlanner();
  updateIkClearanceNote();
  if (typeof setupHanoiSolver === "function") setupHanoiSolver();
  updateCurrentServoDisplay();

  // Simulation mode toggle
  const simToggle = document.getElementById("simModeToggle");
  if (simToggle) {
    simToggle.addEventListener("change", () => {
      simMode = simToggle.checked;
      document.body.classList.toggle("sim-mode", simMode);
      const label = document.getElementById("simModeLabel");
      if (label) label.textContent = simMode ? "SIMULATION" : "Simulation";
      if (simMode) {
        appendLog("⚡ Simulation mode ON — commands applied locally, no real send.", "log-sim");
        // Seed position if none known
        if (!hasKnownPosition()) {
          seedInitialWorkspacePose();
          drawWorkspace();
          appendLog(`; Seeded initial position X:0 Y:${formatNumber(CONFIG.arm.link1 + CONFIG.arm.link2)} Z:0 E:90 for simulation.`, "log-sim");
        }
      } else {
        appendLog("; Simulation mode OFF — live mode.");
      }
    });
  }

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
  if (!hasKnownPosition()) seedInitialWorkspacePose();
  resizeWorkspaceCanvas();
  window.addEventListener("resize", resizeWorkspaceCanvas);
  // Guarantee draw after full layout paint
  setTimeout(() => { resizeWorkspaceCanvas(); }, 100);
  setTimeout(() => { resizeWorkspaceCanvas(); }, 500);
}

initApp();