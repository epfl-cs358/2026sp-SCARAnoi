// ─────────────────────────────────────────────
//  HANOI ALGORITHM  (ported from hanoi_solver.py)
// ─────────────────────────────────────────────

function hanoiMaxDisks() {
  return Math.max(1, Number(CONFIG.hanoi?.maxDisks ?? CONFIG.hanoi?.firmwareMaxLayers ?? CONFIG.hanoi?.numDisks ?? 5));
}

function hanoiRequiresExactDiskCount() {
  return Boolean(CONFIG.hanoi?.requireExactDiskCount);
}

function hanoiExpectedDiskCount() {
  return hanoiRequiresExactDiskCount() ? Number(CONFIG.hanoi?.numDisks ?? hanoiMaxDisks()) : null;
}

function hanoiDiskColor(diskId) {
  const defaults = { 1:"#4caf50", 2:"#ffeb3b", 3:"#f44336", 4:"#e91e63", 5:"#2196f3" };
  return CONFIG.hanoi?.diskColorsById?.[diskId] || defaults[diskId] || "#888";
}

function hanoiDiskWidthPercent(diskId) {
  const maxDisk = Math.max(1, hanoiMaxDisks());
  const disk = Math.min(Math.max(Number(diskId) || 1, 1), maxDisk);
  const minWidth = 45;
  const maxWidth = 92;
  if (maxDisk === 1) return maxWidth;
  return minWidth + ((disk - 1) / (maxDisk - 1)) * (maxWidth - minWidth);
}

function hanoiDiskName(diskId) {
  const defaults = { 1:"green", 2:"yellow", 3:"red", 4:"pink", 5:"blue" };
  return CONFIG.hanoi?.diskNamesById?.[diskId] || defaults[diskId] || "";
}

function cloneHanoiState(state) {
  return state.map(peg => [...peg]);
}

function sameHanoiState(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let p = 0; p < a.length; p++) {
    if (!Array.isArray(a[p]) || !Array.isArray(b[p]) || a[p].length !== b[p].length) return false;
    for (let i = 0; i < a[p].length; i++) {
      if (Number(a[p][i]) !== Number(b[p][i])) return false;
    }
  }
  return true;
}

function setManualInputsFromState(state) {
  if (!Array.isArray(state)) return;
  for (let p = 0; p < 3; p++) {
    const inp = document.getElementById(`hanoiPeg${p}Input`);
    if (inp) inp.value = Array.isArray(state[p]) ? state[p].join(" ") : "";
  }
}

function validateHanoiState(state, expectedDisks = hanoiExpectedDiskCount()) {
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

  if (expectedDisks !== null && expectedDisks !== undefined && all.length !== expectedDisks) {
    return { ok: false, error: `Expected exactly ${expectedDisks} disks, detected ${all.length}. Disable requireExactDiskCount for partial/variant setups.` };
  }

  const unique = new Set(all);
  if (unique.size !== all.length) {
    const dup = [...unique].filter(d => all.filter(x => x === d).length > 1);
    return { ok: false, error: `Duplicate disk number(s): ${dup.join(", ")}.` };
  }

  const maxDisk = hanoiMaxDisks();
  for (const d of all) {
    if (!Number.isInteger(d) || d < 1 || d > maxDisk) {
      return { ok: false, error: `Invalid disk id ${d}. Expected disk ids 1..${maxDisk}.` };
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

  const work = cloneHanoiState(state);
  const moves = [];
  const disks = work.flat();
  if (disks.length === 0) return [];

  // Do not assume the set is exactly 1..N.
  // Example: [5, 4, 3] is treated as a valid 3-disk puzzle where 3 is the smallest present disk.
  const orderedDisks = [...new Set(disks)].sort((a, b) => b - a);

  function findPeg(disk) {
    for (let peg = 0; peg < 3; peg++) {
      if (work[peg].includes(disk)) return peg;
    }
    throw new Error(`Disk ${disk} not found.`);
  }

  function auxiliaryPeg(a, b) {
    return [0, 1, 2].find(p => p !== a && p !== b);
  }

  function moveDiskAndSmaller(diskIndex, targetPeg) {
    if (diskIndex >= orderedDisks.length) return;

    const disk = orderedDisks[diskIndex];
    const currentPeg = findPeg(disk);

    if (currentPeg === targetPeg) {
      moveDiskAndSmaller(diskIndex + 1, targetPeg);
      return;
    }

    const auxPeg = auxiliaryPeg(currentPeg, targetPeg);
    moveDiskAndSmaller(diskIndex + 1, auxPeg);

    const diskLevel = work[currentPeg].indexOf(disk) + 1;
    work[currentPeg].splice(work[currentPeg].indexOf(disk), 1);
    work[targetPeg].push(disk);
    const toLevel = work[targetPeg].length;
    moves.push({ disk, from: currentPeg, to: targetPeg, diskLevel, toLevel });

    moveDiskAndSmaller(diskIndex + 1, targetPeg);
  }

  moveDiskAndSmaller(0, target);
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
  const n = Math.max(1, Math.min(hanoiMaxDisks(), Number(level) || 1));
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

  const maxLayer = hanoiMaxDisks();

  if (diskLevel < 1 || diskLevel > maxLayer) {
    return { steps: [], error: `Invalid source layer ${diskLevel}. Expected 1..${maxLayer}.` };
  }

  if (toLevel < 1 || toLevel > maxLayer) {
    return { steps: [], error: `Invalid target layer ${toLevel}. Expected 1..${maxLayer}.` };
  }

  const fromCmd = firmwarePegCommand(fromPeg);
  const toCmd = firmwarePegCommand(toPeg);
  const sourceLayerCmd = firmwareLayerCommand(diskLevel);
  const upCmd = firmwareSafeHeightCommand();
  const openCmd = firmwareOpenCommand();
  const closeCmd = firmwareCloseCommand();

  const steps = [
    {
      label: `Move above ${uiPegLabel(fromPeg)}`,
      gcode: fromCmd
    },
    {
      label: `Go down to Disk ${diskId} on ${uiPegLabel(fromPeg)} layer ${diskLevel}`,
      gcode: sourceLayerCmd
    },
    {
      label: `Grab Disk ${diskId}`,
      gcode: closeCmd
    },
    {
      label: `Lift Disk ${diskId}`,
      gcode: upCmd
    },
    {
      label: `Move to ${uiPegLabel(toPeg)}`,
      gcode: toCmd
    },
    {
      label: `Drop Disk ${diskId} on ${uiPegLabel(toPeg)}`,
      gcode: openCmd
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

// Browser-side HSV detection was removed. The active CV path is cv_server.py + detectDisque.py.

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
let hanoiVerificationPending = null;
const HANOI_STEP_DELAY_MS = CONFIG.hanoi?.autoStepDelayMs ?? 2000;
const HANOI_VERIFY_DELAY_MS = CONFIG.hanoi?.verifyDelayMs ?? HANOI_STEP_DELAY_MS;

function hanoiDelay(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, n));
}

function hanoiShouldVerifyAfterMove() {
  return CONFIG.hanoi?.verifyAfterEachMove !== false;
}

function computeExpectedStateAfterMove(stateBefore, move) {
  const next = cloneHanoiState(stateBefore);
  const fromStack = next[move.from];
  const toStack = next[move.to];
  const idx = fromStack.indexOf(move.disk);
  if (idx !== -1) fromStack.splice(idx, 1);
  toStack.push(move.disk);
  return next;
}

function updateHanoiVerificationPanel() {
  const panel = document.getElementById("hanoiVerificationPanel");
  if (!panel) return;

  const title = document.getElementById("hanoiVerificationTitle");
  const body = document.getElementById("hanoiVerificationBody");
  const redoBtn = document.getElementById("hanoiRedoMoveBtn");
  const ignoreBtn = document.getElementById("hanoiIgnoreVerificationBtn");

  if (!hanoiVerificationPending) {
    panel.hidden = true;
    if (redoBtn) redoBtn.disabled = true;
    if (ignoreBtn) ignoreBtn.disabled = true;
    return;
  }

  const { move, expectedState, detectedState, reason } = hanoiVerificationPending;
  panel.hidden = false;
  if (redoBtn) redoBtn.disabled = false;
  if (ignoreBtn) ignoreBtn.disabled = false;

  if (title) title.textContent = reason === "cv-error" ? "CV check failed after action" : "CV mismatch after action";
  if (body) {
    body.innerHTML = `
      <div><strong>Previous action:</strong> Disk ${move.disk} ${uiPegLabel(move.from)} → ${uiPegLabel(move.to)}</div>
      <div><strong>Expected:</strong> ${escapeHtml(formatDetectedState(expectedState))}</div>
      <div><strong>Detected:</strong> ${escapeHtml(detectedState ? formatDetectedState(detectedState) : "No usable CV state.")}</div>
    `;
  }
}

function clearHanoiVerification() {
  hanoiVerificationPending = null;
  updateHanoiVerificationPanel();
}

function pauseForHanoiVerification(move, expectedState, detectedState, reason, wasFullAuto) {
  hanoiVerificationPending = { move, expectedState, detectedState, reason, wasFullAuto };
  hanoiRunning = false;
  hanoiPaused = true;
  hanoiFullAuto = false;
  pendingExecution = null;
  clearPreviewPosition();
  updateHanoiVerificationPanel();
  updateHanoiUI();
}

async function verifyHanoiMoveIfNeeded(move, expectedState) {
  if (!hanoiShouldVerifyAfterMove()) return true;

  const wasFullAuto = hanoiFullAuto;
  appendLog("; Hanoi: checking camera after completed action…");
  const detected = await detectStateFromCamera();

  if (detected && sameHanoiState(detected, expectedState)) {
    appendLog("; ✓ CV check OK. Detected state matches the expected state.");
    setManualInputsFromState(detected);
    return true;
  }

  const reason = detected ? "mismatch" : "cv-error";
  if (detected) {
    appendLog(`! CV mismatch after action. Expected ${formatDetectedState(expectedState)} but detected ${formatDetectedState(detected)}.`);
    renderHanoiState(detected);
    setManualInputsFromState(detected);
  } else {
    appendLog("! CV check failed after action. Choose whether to redo the previous action or ignore and proceed.");
  }

  pauseForHanoiVerification(move, expectedState, detected, reason, wasFullAuto);
  return false;
}

function hanoiRedoPreviousMove() {
  if (!hanoiVerificationPending) return;

  const { move, wasFullAuto } = hanoiVerificationPending;
  clearHanoiVerification();

  hanoiCurrentStep = move.steps[0]?.label === "Initialize arm from home" ? 1 : 0;
  hanoiRunning = true;
  hanoiPaused = false;
  hanoiFullAuto = wasFullAuto;

  appendLog(`; Hanoi: redoing previous action — Disk ${move.disk} ${uiPegLabel(move.from)} → ${uiPegLabel(move.to)}.`);
  renderHanoiQueue();
  updateHanoiUI();
  hanoiQueueNextSubStep();
}

function hanoiIgnoreVerificationAndProceed() {
  if (!hanoiVerificationPending) return;

  const { expectedState, wasFullAuto } = hanoiVerificationPending;
  clearHanoiVerification();

  hanoiLiveState = cloneHanoiState(expectedState);
  hanoiCurrentMove++;
  hanoiCurrentStep = 0;
  hanoiRunning = true;
  hanoiPaused = false;
  hanoiFullAuto = wasFullAuto;

  appendLog("; Hanoi: CV warning ignored. Continuing from the expected solver state.");
  renderHanoiState(hanoiLiveState);
  renderHanoiQueue();
  updateHanoiUI();
  hanoiQueueNextSubStep();
}

function hanoiHasPendingWork() {
  return hanoiMoveQueue.length > 0 && hanoiCurrentMove < hanoiMoveQueue.length;
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
  hanoiVerificationPending = null;
  clearPreviewPosition();
  updateHanoiVerificationPanel();
  renderHanoiQueue();
  updateHanoiUI();
}

/**
 * Build the full move queue from a given state.
 * Returns error string if prerequisites are missing, null on success.
 */
function hanoiBuild(state) {
  const validity = validateHanoiState(state, hanoiExpectedDiskCount());
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
  hanoiLiveState   = cloneHanoiState(state);
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

  // Most Hanoi substeps wait for one firmware ok.
  // START is different: the current Arduino macro internally prints more than
  // one ok, so the ESP bridge waits for a configured number of ok lines before
  // the UI sends M400/M114. This prevents M114 from being sent while START is
  // still moving and getting swallowed by the firmware emergency-only reader.
  const isInitStep = step.label === "Initialize arm from home";
  const sentOk = await sendRawGcode(step.gcode, `Hanoi ${step.label}`, {
    expectOk: true,
    waitForOkCount: isInitStep ? Number(CONFIG.hanoi?.startOkCount ?? 2) : 0,
    timeoutSeconds: isInitStep
      ? Number(CONFIG.hanoi?.startTimeoutSeconds ?? 90)
      : Number(CONFIG.hanoi?.substepTimeoutSeconds ?? 45)
  });

  if (!sentOk) {
    hanoiRunning = false;
    hanoiPaused = hanoiHasPendingWork();
    hanoiFullAuto = false;
    pendingExecution = null;
    appendLog("! Hanoi paused because this step was not acknowledged by the firmware.");
    updateHanoiUI();
    return false;
  }

  if (isInitStep) {
    if (CONFIG.hanoi?.syncAfterStart) {
      const synced = await syncWorkspaceAfterHanoiMove();
      if (!synced) {
        hanoiRunning = false;
        hanoiPaused = hanoiHasPendingWork();
        hanoiFullAuto = false;
        pendingExecution = null;
        appendLog("! Hanoi paused because START could not be synced with M400/M114.");
        updateHanoiUI();
        return false;
      }
    } else {
      appendLog("; START acknowledged. Skipping immediate M400/M114 sync to avoid sending M114 while START output is still flushing.");
    }
  }

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
      const expectedState = computeExpectedStateAfterMove(hanoiLiveState, move);

      const synced = await syncWorkspaceAfterHanoiMove();
      if (!synced) {
        hanoiRunning = false;
        hanoiPaused = true;
        hanoiFullAuto = false;
        pendingExecution = null;
        appendLog("! Hanoi paused because the firmware did not confirm motion completion / M114 sync.");
        updateHanoiUI();
        return;
      }

      if (hanoiShouldVerifyAfterMove() && HANOI_VERIFY_DELAY_MS > 0) {
        appendLog(`; Hanoi: waiting ${HANOI_VERIFY_DELAY_MS} ms for camera settling before CV verification…`);
        await hanoiDelay(HANOI_VERIFY_DELAY_MS);
        if (!hanoiRunning) return;
      }

      const verified = await verifyHanoiMoveIfNeeded(move, expectedState);
      if (!verified) return;

      hanoiLiveState = expectedState;
      renderHanoiState(hanoiLiveState);
      setManualInputsFromState(hanoiLiveState);
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
    const sentOk = await hanoiExecuteCurrentStep();
    if (!sentOk || !hanoiRunning) return;

    // Between substeps, use the normal movement gap. After the final substep,
    // hanoiQueueNextSubStep() will apply HANOI_VERIFY_DELAY_MS before CV.
    const justFinishedMove = hanoiCurrentStep >= move.steps.length;
    if (!justFinishedMove) await hanoiDelay(HANOI_STEP_DELAY_MS);

    if (!hanoiRunning) return;
    await hanoiQueueNextSubStep();
  } else {
    pendingExecution = async () => {
      const sentOk = await hanoiExecuteCurrentStep();
      if (!sentOk) return;
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

async function syncWorkspaceAfterHanoiMove() {
  if (typeof sendRawGcode !== "function") return true;

  const timeoutSeconds = Number(CONFIG.hanoi?.completionTimeoutSeconds ?? 45);

  appendLog("; Hanoi: waiting for firmware completion with M400…");
  const barrierOk = await sendRawGcode("M400", "Hanoi completion barrier", {
    expectOk: true,
    timeoutSeconds
  });
  if (!barrierOk) return false;

  appendLog("; Hanoi: syncing graph with M114…");
  return await sendRawGcode("M114", "Hanoi position sync", {
    expectOk: true,
    waitForPosition: true,
    timeoutSeconds: Number(CONFIG.system?.positionSyncTimeoutSeconds ?? 10)
  });
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

    const diskColor = hanoiDiskColor(move.disk);

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

  const container = document.getElementById("hanoiStateViz");
  if (!container) return;

  if (!state) { container.innerHTML = `<div class="hanoi-empty">No state detected yet.</div>`; return; }

  container.innerHTML = `<div class="hanoi-pegs-row">${state.map((peg, pi) => `
    <div class="hanoi-peg-col">
      <div class="hanoi-peg-label">${pegLabels[pi]}</div>
      <div class="hanoi-peg-disks">
        ${[...peg].reverse().map(d => `
          <div class="hanoi-disk-chip" style="background:${hanoiDiskColor(d)}; width:${hanoiDiskWidthPercent(d)}%">
            ${d} ${hanoiDiskName(d)}
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
  const needsVerificationDecision = Boolean(hanoiVerificationPending);

  const btn = id => document.getElementById(id);
  if (btn("hanoiRunBtn"))    btn("hanoiRunBtn").disabled    = !hasMoves || isDone || needsVerificationDecision;
  if (btn("hanoiApproveBtn")) btn("hanoiApproveBtn").disabled = !hasMoves || isDone || needsVerificationDecision;
  if (btn("hanoiResumeBtn")) btn("hanoiResumeBtn").disabled = !hanoiPaused || needsVerificationDecision;
  if (btn("hanoiStopBtn"))   btn("hanoiStopBtn").disabled   = (!hanoiRunning && !isPending && !hanoiPaused) || needsVerificationDecision;
  if (btn("hanoiResetBtn"))  btn("hanoiResetBtn").disabled  = false;
  if (btn("hanoiSolveBtn"))  btn("hanoiSolveBtn").disabled  = hanoiRunning || needsVerificationDecision;
  if (btn("hanoiDetectBtn")) btn("hanoiDetectBtn").disabled = hanoiRunning || needsVerificationDecision;
  if (btn("hanoiDetectSolveBtn")) btn("hanoiDetectSolveBtn").disabled = hanoiRunning || needsVerificationDecision;

  const statusEl = document.getElementById("hanoiStatus");
  if (statusEl) {
    if (needsVerificationDecision) statusEl.textContent = "CV check needs decision";
    else if (isDone)        statusEl.textContent = "✓ Complete";
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
      // Keep invalid tokens as NaN so validateHanoiState() can show an error
      // instead of silently dropping the user's input.
      const n = Number(token);
      state[p].push(Number.isInteger(n) ? n : NaN);
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
        setManualInputsFromState(state);
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
      setManualInputsFromState(state);

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

  // Execute steps successively — fully automatic; timing is controlled by CONFIG.hanoi
  document.getElementById("hanoiRunBtn")?.addEventListener("click", hanoiExecuteSuccessively);

  // Execute steps after approval — confirm each step before sending
  document.getElementById("hanoiApproveBtn")?.addEventListener("click", hanoiExecuteAfterApproval);

  // Resume — continue an auto-run that was stopped mid-sequence
  document.getElementById("hanoiResumeBtn")?.addEventListener("click", hanoiResume);

  // Stop — abort current sequence (pending confirm or auto-run)
  document.getElementById("hanoiStopBtn")?.addEventListener("click", hanoiStop);

  document.getElementById("hanoiRedoMoveBtn")?.addEventListener("click", hanoiRedoPreviousMove);
  document.getElementById("hanoiIgnoreVerificationBtn")?.addEventListener("click", hanoiIgnoreVerificationAndProceed);
  updateHanoiVerificationPanel();

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