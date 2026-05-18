// ═══════════════════════════════════════════════════════════════════════════
//  SCARAnoi — Tower of Hanoi Solver  (hanoi-solver.js)
// ═══════════════════════════════════════════════════════════════════════════
//
//  Depends on:  config.js  (CONFIG, formatNumber, buildAbsoluteMove,
//               buildServoMove, unitsPerSecondToFeedrate, ikScaraAngles,
//               ikShortestDelta)
//  and on app.js globals:  sdAxis, sdConst, diskAngles, simulatedPosition,
//               xySpeedSlider, zSpeedSlider, wristSpeedSlider,
//               sendRawGcode, appendLog, hasKnownPosition,
//               ikGetPegXY, ikGetPlatformBaseZ, ikGetDiskHeight,
//               ikGetZClearance, ikGetDropZ, ikGetGripZ,
//               getGripAngleForDisk, getReleaseAngleForDisk,
//               isXYOutsideWorkspace, IK_ELBOW_SIGN,
//               DISK_HEIGHT_MM_FALLBACK
//
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
//  HANOI ALGORITHM  (ported from hanoi_solver.py)
// ─────────────────────────────────────────────

function validateHanoiState(state, expectedDisks = null) {
  if (!Array.isArray(state) || state.length !== 3) {
    return { ok: false, error: "State must contain exactly 3 pegs." };
  }

  const all = [];
  for (let pegIdx = 0; pegIdx < 3; pegIdx++) {
    const peg = state[pegIdx];
    if (!Array.isArray(peg)) return { ok: false, error: `Peg ${pegIdx} is not a list.` };

    for (let level = 1; level < peg.length; level++) {
      const below = peg[level - 1];
      const above = peg[level];
      if (above >= below) {
        return {
          ok: false,
          error: `Illegal stack on Peg ${pegIdx}: disk ${above} sits on disk ${below}. Smaller disk numbers must be above larger ones.`
        };
      }
    }
    all.push(...peg);
  }

  if (expectedDisks !== null && all.length !== expectedDisks) {
    return { ok: false, error: `Expected ${expectedDisks} disks, detected ${all.length}. Retake the picture or edit manually.` };
  }

  const unique = new Set(all);
  if (unique.size !== all.length) {
    const dup = [...unique].filter(d => all.filter(x => x === d).length > 1);
    return { ok: false, error: `Duplicate disk number(s): ${dup.join(", ")}.` };
  }

  for (const d of all) {
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      return { ok: false, error: `Invalid disk id ${d}. Expected disk ids 1..5.` };
    }
  }

  return { ok: true, error: null };
}

function inferHanoiTargetPeg(state) {
  const disks = state.flat();
  if (disks.length === 0) return CONFIG.hanoi?.targetPegWhenNotSolved ?? 2;
  const largest = Math.max(...disks);
  const current = state.findIndex(peg => peg.includes(largest));
  return current === 2
    ? (CONFIG.hanoi?.targetPegWhenAlreadyOnRight ?? 0)
    : (CONFIG.hanoi?.targetPegWhenNotSolved ?? 2);
}

/**
 * Returns the ordered list of moves needed to solve Tower of Hanoi.
 * Disk convention follows detectDisque.py: 1 = smallest, 5 = largest.
 * Each move: { disk, from, to, diskLevel, toLevel }, where levels are bottom-first.
 */
function hanoiSolve(state, target = inferHanoiTargetPeg(state)) {
  const check = validateHanoiState(state);
  if (!check.ok) throw new Error(check.error);

  const work = state.map(p => [...p]);
  const moves = [];
  const disks = work.flat();
  if (disks.length === 0) return [];

  const largestDisk = Math.max(...disks);

  function findPeg(disk) {
    for (let peg = 0; peg < 3; peg++) {
      if (work[peg].includes(disk)) return peg;
    }
    throw new Error(`Disk ${disk} not found.`);
  }

  function moveTopDisks(largest, targetPeg) {
    if (largest === 0) return;

    const currentPeg = findPeg(largest);
    if (currentPeg === targetPeg) {
      moveTopDisks(largest - 1, targetPeg);
      return;
    }

    const auxPeg = 3 - currentPeg - targetPeg;
    moveTopDisks(largest - 1, auxPeg);

    const diskLevel = work[currentPeg].indexOf(largest) + 1;
    work[currentPeg].splice(work[currentPeg].indexOf(largest), 1);
    work[targetPeg].push(largest);
    const toLevel = work[targetPeg].length;
    moves.push({ disk: largest, from: currentPeg, to: targetPeg, diskLevel, toLevel });

    moveTopDisks(largest - 1, targetPeg);
  }

  moveTopDisks(largestDisk, target);
  return moves;
}

// ─────────────────────────────────────────────
//  G-CODE GENERATOR  (headless IK transfer)
// ─────────────────────────────────────────────

/**
 * Build G-code steps for a single disk move without touching the DOM.
 * Returns { steps: [{label, gcode}], error: string|null }
 */
function firmwarePegCommand(pegIdx) {
  const idx = Number(pegIdx);
  const explicit = CONFIG.hanoi?.firmwareCommands?.pegCommandsByIndex;
  if (Array.isArray(explicit) && explicit[idx]) return explicit[idx];
  return `PEG${idx}`;
}

function firmwareLayerCommand(level) {
  const prefix = CONFIG.hanoi?.firmwareCommands?.layerPrefix || "LAYER";
  const n = Math.max(1, Math.min(5, Number(level) || 1));
  return `${prefix}${n}`;
}

function firmwareSafeHeightCommand() {
  return CONFIG.hanoi?.firmwareCommands?.up || "UP";
}

function firmwareOpenCommand() {
  return CONFIG.hanoi?.firmwareCommands?.open || "OPEN";
}

function firmwareCloseCommand() {
  return CONFIG.hanoi?.firmwareCommands?.close || "CLOSE";
}

function firmwareStartCommand() {
  return CONFIG.hanoi?.firmwareCommands?.start || "START";
}

function uiPegLabel(pegIdx) {
  return `Peg ${Number(pegIdx)}`;
}

/**
 * Build firmware-macro steps for a single disk transfer.
 * The peg coordinates, Z layers, safe height, and servo angles are now owned by
 * the Arduino firmware through custom text commands: PEG0..PEG2, LAYER1..LAYER5,
 * UP, OPEN, and CLOSE. The browser only decides the logical Hanoi sequence.
 */
function buildMoveGcode(diskId, fromPeg, toPeg, diskLevel, toLevel = 1) {
  if (fromPeg === toPeg) {
    return { steps: [], error: "Source and target peg are the same." };
  }

  if (diskLevel < 1 || diskLevel > 5) {
    return { steps: [], error: `Invalid source layer ${diskLevel}. Expected 1..5.` };
  }

  if (toLevel < 1 || toLevel > 5) {
    return { steps: [], error: `Invalid target layer ${toLevel}. Expected 1..5.` };
  }

  const fromCmd = firmwarePegCommand(fromPeg);
  const toCmd = firmwarePegCommand(toPeg);
  const sourceLayerCmd = firmwareLayerCommand(diskLevel);
  const targetLayerCmd = firmwareLayerCommand(toLevel);
  const upCmd = firmwareSafeHeightCommand();
  const openCmd = firmwareOpenCommand();
  const closeCmd = firmwareCloseCommand();

  const steps = [
    {
      label: `Move above ${uiPegLabel(fromPeg)}`,
      gcode: `${upCmd}
${fromCmd}`
    },
    {
      label: `Pick Disk ${diskId} from ${uiPegLabel(fromPeg)} layer ${diskLevel}`,
      gcode: `${sourceLayerCmd}
${closeCmd}
${upCmd}`
    },
    {
      label: `Move to ${uiPegLabel(toPeg)}`,
      gcode: `${toCmd}`
    },
    {
      label: `Place Disk ${diskId} on ${uiPegLabel(toPeg)} layer ${toLevel}`,
      gcode: `${targetLayerCmd}
${openCmd}
${upCmd}`
    }
  ];

  return { steps, error: null };
}

// ─────────────────────────────────────────────
//  CV DETECTION  (Python OpenCV bridge)
// ─────────────────────────────────────────────

function formatDetectedState(state) {
  return state
    ? state.map((peg, i) => `Peg ${i}: [${peg.join(", ") || "empty"}]`).join("   ")
    : "No detection yet.";
}

async function drawLatestCvSnapshotFromServer() {
  const canvas = document.getElementById("cvSnapshotCanvas");
  if (!canvas || typeof getCvSnapshotUrl !== "function") return;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(true);
    };

    img.onerror = () => resolve(false);
    img.src = `${getCvSnapshotUrl()}?t=${Date.now()}`;
  });
}

/**
 * Ask the local Python OpenCV server for the latest detected state.
 * This replaces the old browser-side JS colour detection.
 *
 * Flow:
 *   ESP32 raw stream -> cv_server.py -> OpenCV annotated stream + JSON state -> browser
 */
async function detectStateFromCamera() {
  const summary = document.getElementById("cvDetectionSummary");

  try {
    const res = await fetch(`${getCvDetectUrl()}?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.ok) {
      const msg = data?.error || `OpenCV server returned HTTP ${res.status}`;
      appendLog(`! CV error: ${msg}`);
      if (summary) summary.textContent = msg;
      return null;
    }

    const state = data.state;
    if (!Array.isArray(state) || state.length !== 3) {
      appendLog("! CV error: invalid state returned by OpenCV server.");
      if (summary) summary.textContent = "Invalid CV state.";
      return null;
    }

    if (summary) summary.textContent = formatDetectedState(state);
    await drawLatestCvSnapshotFromServer();
    return state;
  } catch (e) {
    appendLog(`! Cannot reach OpenCV server at ${getCvServerBaseUrl()}. Start cv_server.py first.`);
    if (summary) summary.textContent = "OpenCV server offline.";
    return null;
  }
}

/**
 * JS port of the Python HSV colour detection.
 * Uses the same HSV_RANGES and disk layout as detectDisque.py.
 */
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 180, s * 255, v * 255]; // OpenCV-style H in [0,180]
}

const HSV_RANGES_JS = {
  green:  [[[35,  80,  60], [85, 255, 255]]],
  yellow: [[[18,  50, 130], [35, 255, 255]]],
  red:    [[[0,  140,  80], [10, 255, 255]], [[170,140,80],[180,255,255]]],
  pink:   [[[165, 50, 100],[179,135,200]], [[0,50,100],[12,135,200]]],
  blue:   [[[100,120,  40],[130,255,200]]]
};
const DISK_ID_MAP  = { green:1, yellow:2, red:3, pink:4, blue:5 };
const DISK_COLORS  = ["green","yellow","red","pink","blue"];
const ROI_BOTTOM   = 0.38;
const MIN_W_OVER_H = 0.8;


function renderCvDetectionPreview(imageData, W, H, detected, state, yBot, third) {
  const canvas = document.getElementById("cvSnapshotCanvas");
  const summary = document.getElementById("cvDetectionSummary");
  if (!canvas) return;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(W / 320));
  ctx.font = `${Math.max(14, Math.round(W / 38))}px sans-serif`;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(third, 0); ctx.lineTo(third, yBot);
  ctx.moveTo(2 * third, 0); ctx.lineTo(2 * third, yBot);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 160, 0, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, yBot); ctx.lineTo(W, yBot);
  ctx.stroke();

  const colors = {
    green: "#00d26a",
    yellow: "#ffd43b",
    red: "#ff4d4d",
    pink: "#ff5ac8",
    blue: "#4dabf7"
  };

  for (const d of detected) {
    const x = d.cx - d.w / 2;
    const y = d.cy - d.h / 2;
    const c = colors[d.color] || "#ffffff";
    ctx.strokeStyle = c;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.strokeRect(x, y, d.w, d.h);
    const label = `D${d.id} ${d.color}`;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(x, Math.max(0, y - 24), tw, 22);
    ctx.fillStyle = c;
    ctx.fillText(label, x + 5, Math.max(16, y - 7));
  }

  ctx.restore();

  if (summary) {
    summary.textContent = state
      ? state.map((peg, i) => `Peg ${i}: [${peg.join(", ") || "empty"}]`).join("   ")
      : "No detection yet.";
  }
}

function runColorDetection(imageData, W, H) {
  const data  = imageData.data;
  const yBot  = Math.floor(H * (1 - ROI_BOTTOM));
  const numPegs = 3;
  const third   = W / numPegs;

  const detected = [];

  for (const color of DISK_COLORS) {
    // Build per-pixel mask
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < yBot; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const [h, s, v] = rgbToHsv(data[i], data[i+1], data[i+2]);
        for (const [[hl,sl,vl],[hh,sh,vh]] of HSV_RANGES_JS[color]) {
          if (h >= hl && h <= hh && s >= sl && s <= sh && v >= vl && v <= vh) {
            mask[y * W + x] = 255;
            break;
          }
        }
      }
    }

    // Find bounding rect of largest blob using flood-fill approach
    let best = null, bestArea = 300;
    // Scan connected components (simplified: row-scan bounding boxes)
    let inBlob = false, bx0 = 0, bx1 = 0, by0 = 0, by1 = 0, area = 0;
    const visited = new Uint8Array(W * H);
    for (let y = 0; y < yBot; y++) {
      for (let x = 0; x < W; x++) {
        if (mask[y * W + x] && !visited[y * W + x]) {
          // BFS
          const queue = [[x, y]];
          visited[y * W + x] = 1;
          let minX = x, maxX = x, minY = y, maxY = y, cnt = 0;
          let qi = 0;
          while (qi < queue.length) {
            const [cx, cy] = queue[qi++];
            cnt++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
              if (nx >= 0 && nx < W && ny >= 0 && ny < yBot && mask[ny*W+nx] && !visited[ny*W+nx]) {
                visited[ny*W+nx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
          const bw = maxX - minX + 1, bh = maxY - minY + 1;
          if (cnt > bestArea && bh > 0 && (bw / bh) >= MIN_W_OVER_H) {
            bestArea = cnt;
            best = { cx: Math.round((minX+maxX)/2), cy: Math.round((minY+maxY)/2), w: bw, h: bh };
          }
        }
      }
    }

    if (best) {
      detected.push({ id: DISK_ID_MAP[color], color, ...best });
    }
  }

  // Assign to towers: rightmost zone → peg0, middle → peg1, leftmost → peg2
  // (mirrors the Python logic: zone = cx // third, pegIdx = (NUM_TOWERS-1) - zone)
  const buckets = [[], [], []];
  for (const d of detected) {
    const zone = Math.min(Math.floor(d.cx / third), numPegs - 1);
    const pegIdx = (numPegs - 1) - zone;
    buckets[pegIdx].push(d);
  }

  // Sort each bucket bottom→top (highest cy = lowest in image = bottom)
  const state = buckets.map(b => {
    b.sort((a, b) => b.cy - a.cy);
    return b.map(d => d.id);
  });

  renderCvDetectionPreview(imageData, W, H, detected, state, yBot, third);
  return state;
}

// ─────────────────────────────────────────────
//  SOLVER STATE MACHINE
// ─────────────────────────────────────────────

let hanoiState         = null;
let hanoiMoveQueue     = [];
let hanoiCurrentMove   = 0;
let hanoiCurrentStep   = 0;
let hanoiRunning       = false;
let hanoiPaused        = false;
let hanoiFullAuto      = false;  // true = Run all (no confirms)
let hanoiLiveState     = null;   // simulated tower state, updated after each completed move
const HANOI_STEP_DELAY_MS = CONFIG.hanoi?.autoStepDelayMs ?? 2000;

function hanoiHasPendingWork() {
  return hanoiMoveQueue.length > 0 && hanoiCurrentMove < hanoiMoveQueue.length;
}

async function hanoiExecuteCurrentStep() {
  const move = hanoiMoveQueue[hanoiCurrentMove];
  if (!move || move.error) return;

  const step = move.steps[hanoiCurrentStep];
  const moveLabel = `Move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}: Disk ${move.disk} ${uiPegLabel(move.from)}→${uiPegLabel(move.to)}`;

  clearPreviewPosition();
  appendLog(`; [Hanoi] ${moveLabel} — ${step.label}`);
  appendLog(step.gcode);
  console.log(`[Hanoi] ${moveLabel} — ${step.label}\n${step.gcode}`);
  await sendRawGcode(step.gcode, `Hanoi ${step.label}`);
  hanoiCurrentStep++;
}

function hanoiReset() {
  hanoiState       = null;
  hanoiMoveQueue   = [];
  hanoiCurrentMove = 0;
  hanoiCurrentStep = 0;
  hanoiRunning     = false;
  hanoiPaused      = false;
  hanoiFullAuto    = false;
  hanoiLiveState   = null;
  clearPreviewPosition();
  renderHanoiQueue();
  updateHanoiUI();
}

/**
 * Build the full move queue from a given state.
 * Returns error string if prerequisites are missing, null on success.
 */
function hanoiBuild(state) {
  const expected = CONFIG.hanoi?.numDisks ?? (state.flat().length || null);
  const validity = validateHanoiState(state, expected);
  if (!validity.ok) return validity.error;

  // Movement calibration now lives inside the Arduino firmware.
  // The browser only needs to validate the logical Hanoi state.

  const targetPeg = inferHanoiTargetPeg(state);
  const rawMoves = hanoiSolve(state, targetPeg);
  if (rawMoves.length === 0) return "Nothing to solve — the puzzle is already complete or empty.";

  hanoiMoveQueue = rawMoves.map((m, idx) => {
    const result = buildMoveGcode(m.disk, m.from, m.to, m.diskLevel, m.toLevel);

    // The interface calls START only once, before the first Hanoi movement.
    // The actual start pose/peg is defined by the firmware.
    if (idx === 0 && !result.error) {
      result.steps.unshift({
        label: "Initialize arm from home",
        gcode: firmwareStartCommand()
      });
    }

    return { ...m, steps: result.steps, error: result.error };
  });

  hanoiCurrentMove = 0;
  hanoiCurrentStep = 0;
  hanoiLiveState   = state.map(peg => [...peg]);
  appendLog(`; Hanoi target peg: ${uiPegLabel(targetPeg)}.`);
  return null;
}

// ─────────────────────────────────────────────
//  EXECUTION
// ─────────────────────────────────────────────

async function hanoiExecuteCurrentStep() {
  const move = hanoiMoveQueue[hanoiCurrentMove];
  if (!move || move.error) return false;

  const step = move.steps[hanoiCurrentStep];
  const moveLabel = `Move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}: Disk ${move.disk} ${uiPegLabel(move.from)}→${uiPegLabel(move.to)}`;

  clearPreviewPosition();
  appendLog(`; [Hanoi] ${moveLabel} — ${step.label}`);
  appendLog(step.gcode);
  console.log(`[Hanoi] ${moveLabel} — ${step.label}\n${step.gcode}`);
  await sendRawGcode(step.gcode, `Hanoi ${step.label}`);
  hanoiCurrentStep++;
  return true;
}

async function hanoiQueueNextSubStep() {
  if (!hanoiRunning) return;

  if (hanoiCurrentMove >= hanoiMoveQueue.length) {
    appendLog("; ✓ Hanoi sequence complete!");
    hanoiRunning  = false;
    hanoiFullAuto = false;
    hanoiPaused   = false;
    if (hanoiLiveState) renderHanoiState(hanoiLiveState);
    renderHanoiQueue();
    updateHanoiUI();
    return;
  }

  const move = hanoiMoveQueue[hanoiCurrentMove];

  if (move.error) {
    appendLog(`! Hanoi move ${hanoiCurrentMove + 1} error: ${move.error}`);
    hanoiRunning  = false;
    hanoiFullAuto = false;
    hanoiPaused   = false;
    updateHanoiUI();
    return;
  }

  if (hanoiCurrentStep >= move.steps.length) {
    if (hanoiLiveState) {
      const diskId = move.disk;
      const fromPeg = move.from, toPeg = move.to;
      const fi = hanoiLiveState[fromPeg].indexOf(diskId);
      if (fi !== -1) hanoiLiveState[fromPeg].splice(fi, 1);
      hanoiLiveState[toPeg].push(diskId);
      renderHanoiState(hanoiLiveState);
    }
    hanoiCurrentMove++;
    hanoiCurrentStep = 0;
    renderHanoiQueue();
    updateHanoiUI();
    await hanoiQueueNextSubStep();
    return;
  }

  const step = move.steps[hanoiCurrentStep];
  const moveLabel = `Move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}: Disk ${move.disk} ${uiPegLabel(move.from)}→${uiPegLabel(move.to)}`;
  const bannerLabel = `${moveLabel} — ${step.label} (${hanoiCurrentStep + 1}/${move.steps.length})`;

  if (typeof ikGetPegXY === "function") {
    if (step.label.startsWith("Move above")) {
      const fromXY = ikGetPegXY(move.from);
      if (fromXY) setPreviewPosition(fromXY.x, fromXY.y);
    } else if (step.label.startsWith("Move to")) {
      const toXY = ikGetPegXY(move.to);
      if (toXY) setPreviewPosition(toXY.x, toXY.y);
    }
  }

  renderHanoiQueue();
  updateHanoiUI();

  if (hanoiFullAuto) {
    await hanoiExecuteCurrentStep();
    if (!hanoiRunning) return;
    await new Promise(resolve => setTimeout(resolve, HANOI_STEP_DELAY_MS));
    if (!hanoiRunning) return;
    await hanoiQueueNextSubStep();
  } else {
    pendingExecution = async () => {
      await hanoiExecuteCurrentStep();
      updatePreviewBanner(bannerLabel);
      await hanoiQueueNextSubStep();
    };
    updatePreviewBanner(bannerLabel);
  }
}

function hanoiExecuteSuccessively() {
  if (!hanoiHasPendingWork()) {
    appendLog("! Hanoi: click Solve puzzle first to build the move queue.");
    return;
  }

  hanoiRunning  = true;
  hanoiPaused   = false;
  hanoiFullAuto = true;
  updateHanoiUI();

  if (typeof pendingExecution === "function") {
    const fn = pendingExecution;
    pendingExecution = null;
    void fn();
    return;
  }

  hanoiQueueNextSubStep();
}

function hanoiExecuteAfterApproval() {
  if (!hanoiHasPendingWork()) {
    appendLog("! Hanoi: click Solve puzzle first to build the move queue.");
    return;
  }

  hanoiRunning  = true;
  hanoiPaused   = false;
  hanoiFullAuto = false;
  updateHanoiUI();

  if (typeof pendingExecution !== "function") {
    hanoiQueueNextSubStep();
  }
}

function hanoiResume() {
  if (!hanoiPaused || !hanoiHasPendingWork()) return;
  appendLog(`; Hanoi: resuming in ${hanoiFullAuto ? "execute steps successively" : "execute steps after approval"} mode.`);
  hanoiRunning = true;
  hanoiPaused = false;
  updateHanoiUI();
  hanoiQueueNextSubStep();
}

function hanoiStop() {
  hanoiRunning = false;
  pendingExecution = null;
  clearPreviewPosition();
  hanoiPaused = hanoiHasPendingWork();
  appendLog("; Hanoi: paused. Press Resume to continue or switch mode.");
  updateHanoiUI();
}

// ─────────────────────────────────────────────
//  UI — RENDER QUEUE
// ─────────────────────────────────────────────

function renderHanoiQueue() {
  const container = document.getElementById("hanoiMoveList");
  if (!container) return;
  container.innerHTML = "";

  if (hanoiMoveQueue.length === 0) {
    container.innerHTML = `<div class="hanoi-empty">No move sequence computed yet.</div>`;
    return;
  }

  hanoiMoveQueue.forEach((move, mi) => {
    const isPast    = mi < hanoiCurrentMove;
    const isCurrent = mi === hanoiCurrentMove;
    const isFuture  = mi > hanoiCurrentMove;

    const card = document.createElement("div");
    card.className = `hanoi-move-card ${isPast ? "hanoi-done" : ""} ${isCurrent ? "hanoi-active" : ""}`;

    const diskColors = ["","#4caf50","#ffeb3b","#f44336","#e91e63","#2196f3"];
    const diskColor  = diskColors[move.disk] || "#ccc";

    card.innerHTML = `
      <div class="hanoi-move-header">
        <span class="hanoi-move-num">${mi + 1}</span>
        <span class="hanoi-disk-badge" style="background:${diskColor}">Disk ${move.disk}</span>
        <span class="hanoi-move-route">${uiPegLabel(move.from)} → ${uiPegLabel(move.to)}</span>
        ${isPast ? `<span class="hanoi-done-badge">✓</span>` : ""}
        ${move.error ? `<span class="hanoi-err-badge">⚠ ${escapeHtml(move.error)}</span>` : ""}
      </div>
      ${isCurrent ? `
        <div class="hanoi-steps">
          ${move.steps.map((s, si) => `
            <div class="hanoi-step ${si < hanoiCurrentStep ? "hanoi-step-done" : si === hanoiCurrentStep ? "hanoi-step-active" : ""}">
              <span class="hanoi-step-num">${si + 1}</span>
              <span class="hanoi-step-label">${escapeHtml(s.label)}</span>
              <code class="hanoi-step-gcode">${escapeHtml(s.gcode.replace(/\n/g, " | "))}</code>
            </div>`).join("")}
        </div>` : ""}
    `;
    container.appendChild(card);
  });

  // Scroll active card into view
  const active = container.querySelector(".hanoi-active");
  if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ─────────────────────────────────────────────
//  UI — STATE DISPLAY
// ─────────────────────────────────────────────

function renderHanoiState(state) {
  const pegLabels = ["Peg 0", "Peg 1", "Peg 2"];
  const diskColors = { 1:"#4caf50", 2:"#ffeb3b", 3:"#f44336", 4:"#e91e63", 5:"#2196f3" };
  const diskNames  = { 1:"green", 2:"yellow", 3:"red", 4:"pink", 5:"blue" };

  const container = document.getElementById("hanoiStateViz");
  if (!container) return;

  if (!state) { container.innerHTML = `<div class="hanoi-empty">No state detected yet.</div>`; return; }

  container.innerHTML = `<div class="hanoi-pegs-row">${state.map((peg, pi) => `
    <div class="hanoi-peg-col">
      <div class="hanoi-peg-label">${pegLabels[pi]}</div>
      <div class="hanoi-peg-disks">
        ${[...peg].reverse().map(d => `
          <div class="hanoi-disk-chip" style="background:${diskColors[d]||"#888"}">
            ${d} ${diskNames[d]||""}
          </div>`).join("") || "<div class='hanoi-peg-empty'>empty</div>"}
      </div>
      <div class="hanoi-peg-pole"></div>
    </div>`).join("")}
  </div>`;
}

// ─────────────────────────────────────────────
//  UI — BUTTON STATES
// ─────────────────────────────────────────────

function updateHanoiUI() {
  const hasMoves  = hanoiMoveQueue.length > 0;
  const isDone    = hanoiCurrentMove >= hanoiMoveQueue.length && hasMoves;
  const isPending = typeof pendingExecution === "function";

  const btn = id => document.getElementById(id);
  if (btn("hanoiRunBtn"))    btn("hanoiRunBtn").disabled    = !hasMoves || isDone;
  if (btn("hanoiApproveBtn")) btn("hanoiApproveBtn").disabled = !hasMoves || isDone;
  if (btn("hanoiResumeBtn")) btn("hanoiResumeBtn").disabled = !hanoiPaused;
  if (btn("hanoiStopBtn"))   btn("hanoiStopBtn").disabled   = !hanoiRunning && !isPending && !hanoiPaused;
  if (btn("hanoiResetBtn"))  btn("hanoiResetBtn").disabled  = false;
  if (btn("hanoiSolveBtn"))  btn("hanoiSolveBtn").disabled  = hanoiRunning;
  if (btn("hanoiDetectBtn")) btn("hanoiDetectBtn").disabled = hanoiRunning;
  if (btn("hanoiDetectSolveBtn")) btn("hanoiDetectSolveBtn").disabled = hanoiRunning;

  const statusEl = document.getElementById("hanoiStatus");
  if (statusEl) {
    if (isDone)             statusEl.textContent = "✓ Complete";
    else if (hanoiFullAuto && hanoiRunning) statusEl.textContent = `Running successively — move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}…`;
    else if (isPending)     statusEl.textContent = `Awaiting confirm — move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}`;
    else if (hanoiPaused)   statusEl.textContent = `Paused — move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}`;
    else if (hasMoves)      statusEl.textContent = `Ready — move ${hanoiCurrentMove + 1}/${hanoiMoveQueue.length}`;
    else                    statusEl.textContent = "Idle";
  }
}

// ─────────────────────────────────────────────
//  MANUAL STATE EDITOR
// ─────────────────────────────────────────────

function readManualState() {
  const state = [[], [], []];
  for (let p = 0; p < 3; p++) {
    const raw = document.getElementById(`hanoiPeg${p}Input`)?.value.trim();
    if (!raw) continue;
    raw.split(/[\s,]+/).filter(Boolean).forEach(token => {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= 5) state[p].push(n);
    });
  }
  return state;
}

// ─────────────────────────────────────────────
//  SETUP — called from app.js initApp()
// ─────────────────────────────────────────────

function setupHanoiSolver() {
  // Detect via camera
  document.getElementById("hanoiDetectBtn")?.addEventListener("click", async () => {
    appendLog("; Hanoi: capturing snapshot from ESP32-CAM…");
    const btn = document.getElementById("hanoiDetectBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Detecting…"; }
    try {
      const state = await detectStateFromCamera();
      if (state) {
        hanoiState = state;
        renderHanoiState(state);
        // Fill manual inputs too
        for (let p = 0; p < 3; p++) {
          const inp = document.getElementById(`hanoiPeg${p}Input`);
          if (inp) inp.value = state[p].join(" ");
        }
        appendLog(`; Hanoi detect OK: ${state.map((s,i)=>`Peg${i + 1}=[${s}]`).join(" ")}`);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Detect only"; }
    }
  });


  // Capture + solve: closest browser equivalent to pressing SPACE in the Python OpenCV demo.
  // It captures one frame, annotates it, fills the peg state, and builds the G-code queue.
  // It does not move the robot until the user confirms or starts automatic execution.
  document.getElementById("hanoiDetectSolveBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("hanoiDetectSolveBtn");
    appendLog("; Hanoi: capture + solve requested…");
    if (btn) { btn.disabled = true; btn.textContent = "Capturing…"; }
    try {
      const state = await detectStateFromCamera();
      if (!state) return;

      hanoiState = state;
      renderHanoiState(state);
      for (let p = 0; p < 3; p++) {
        const inp = document.getElementById(`hanoiPeg${p}Input`);
        if (inp) inp.value = state[p].join(" ");
      }

      const err = hanoiBuild(state);
      if (err) { appendLog(`! Hanoi: ${err}`); return; }

      appendLog(`; Hanoi: ${hanoiMoveQueue.length} moves computed from camera state. Confirm the first step or run automatically.`);
      renderHanoiState(state);
      renderHanoiQueue();
      hanoiRunning  = true;
      hanoiPaused   = false;
      hanoiFullAuto = false;
      updateHanoiUI();
      hanoiQueueNextSubStep();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Capture + solve"; }
    }
  });

  // Manual state entry → update viz
  for (let p = 0; p < 3; p++) {
    const inp = document.getElementById(`hanoiPeg${p}Input`);
    if (!inp) continue;
    const syncState = () => {
      hanoiState = readManualState();
      renderHanoiState(hanoiState);
    };
    inp.addEventListener("input", syncState);
    inp.addEventListener("change", syncState);
  }

  const initialState = readManualState();
  if (initialState.some(peg => peg.length > 0)) {
    hanoiState = initialState;
    renderHanoiState(initialState);
  }

  // Solve button — compute then start confirm-per-step sequence
  document.getElementById("hanoiSolveBtn")?.addEventListener("click", () => {
    const state = readManualState();
    const isEmpty = state.every(p => p.length === 0);
    if (isEmpty) { appendLog("! Hanoi: enter disk state first (use Detect or fill manually)."); return; }
    hanoiState = state;
    const err = hanoiBuild(state);
    if (err) { appendLog(`! Hanoi: ${err}`); return; }
    appendLog(`; Hanoi: ${hanoiMoveQueue.length} moves computed. Confirm each step in the preview banner.`);
    renderHanoiState(state);
    renderHanoiQueue();
    hanoiRunning  = true;
    hanoiPaused   = false;
    hanoiFullAuto = false;
    updateHanoiUI();
    hanoiQueueNextSubStep();
  });

  // Execute steps successively — fully automatic, 2-second gap between steps
  document.getElementById("hanoiRunBtn")?.addEventListener("click", hanoiExecuteSuccessively);

  // Execute steps after approval — confirm each step before sending
  document.getElementById("hanoiApproveBtn")?.addEventListener("click", hanoiExecuteAfterApproval);

  // Resume — continue an auto-run that was stopped mid-sequence
  document.getElementById("hanoiResumeBtn")?.addEventListener("click", hanoiResume);

  // Stop — abort current sequence (pending confirm or auto-run)
  document.getElementById("hanoiStopBtn")?.addEventListener("click", hanoiStop);

  // Reset
  document.getElementById("hanoiResetBtn")?.addEventListener("click", () => {
    if (hanoiMoveQueue.length > 0 && !confirm("Reset the Hanoi solver? This clears the move queue.")) return;
    hanoiReset();
    appendLog("; Hanoi: reset.");
    renderHanoiState(null);
    for (let p = 0; p < 3; p++) {
      const inp = document.getElementById(`hanoiPeg${p}Input`);
      if (inp) inp.value = "";
    }
  });

  updateHanoiUI();
  renderHanoiQueue();
}