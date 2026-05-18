"""
Tower of Hanoi solver for the SCARAnoi project.

Two operating modes:
  - autonomous: take a camera-derived state, return the full move sequence.
  - correction: validate the human's moves one at a time; on a bad move,
                provide both an undo instruction and a takeover plan.

Move strings look like:  MOVE d1 FROM p0 TO p2
"""

from copy import deepcopy
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

State = List[List[int]]   # exactly 3 pegs, each peg ordered bottom -> top


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_state(state: State, expected_disks: int) -> Tuple[bool, str]:
    """Check that `state` is a structurally valid Hanoi configuration.

    Returns (is_valid, error_message). Error messages are written for a
    non-technical demo audience, so they stay specific and concrete.
    """
    if not isinstance(state, list) or len(state) != 3:
        return False, "State must be a list of exactly 3 pegs."

    all_disks: List[int] = []
    for peg_idx, peg in enumerate(state):
        if not isinstance(peg, list):
            return False, f"Peg {peg_idx} is not a list."
        for level in range(1, len(peg)):
            below, above = peg[level - 1], peg[level]
            if above >= below:
                return False, (
                    f"Illegal stack on peg {peg_idx}: disk {above} sits on disk "
                    f"{below} — a disk can only sit on a strictly larger one."
                )
        all_disks.extend(peg)

    if len(all_disks) != expected_disks:
        return False, (
            f"Expected {expected_disks} disks, found {len(all_disks)} — "
            "the camera reading is likely wrong, please retake the picture."
        )

    expected = set(range(1, expected_disks + 1))
    actual = set(all_disks)
    if len(all_disks) != len(actual):
        duplicates = sorted({d for d in all_disks if all_disks.count(d) > 1})
        return False, f"Duplicate disk number(s) detected: {duplicates}."
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        parts = []
        if missing:
            parts.append(f"missing disks {missing}")
        if unexpected:
            parts.append(f"unexpected disk numbers {unexpected}")
        return False, "Disk numbering is wrong: " + ", ".join(parts) + "."

    return True, ""


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------

def _format_move(disk: int, src: int, tgt: int) -> str:
    """Format one robot instruction string."""
    return f"MOVE d{disk} FROM p{src} TO p{tgt}"


def solve_hanoi(state: State, num_disks: int, target_peg: int = 2) -> List[str]:
    """Compute the optimal move sequence from `state` to all disks on `target_peg`.

    Works for any valid starting configuration, not only the classic case of
    all disks already stacked on peg 0. Assumes `state` has been validated.
    """
    work_state: State = deepcopy(state)
    moves: List[str] = []

    def find_peg(disk: int) -> int:
        """Return the peg index currently holding `disk`."""
        for peg_idx, peg in enumerate(work_state):
            if disk in peg:
                return peg_idx
        raise RuntimeError(f"Disk {disk} not found in state.")  # invariant violation

    def move_top_disks(largest: int, target: int) -> None:
        """Bring disks 1..largest onto peg `target`, optimally.

        Key idea: the largest disk in scope moves at most once. Either it is
        already on `target` (zero moves), or every smaller disk must first
        clear out to the third peg so it can hop across in a single move.
        """
        if largest == 0:
            return
        current = find_peg(largest)
        if current == target:
            move_top_disks(largest - 1, target)
            return
        aux = 3 - current - target  # the unique third peg (pegs are {0,1,2})
        move_top_disks(largest - 1, aux)        # clear both `current` and `target`
        work_state[current].remove(largest)     # `largest` is now on top of `current`
        work_state[target].append(largest)
        moves.append(_format_move(largest, current, target))
        move_top_disks(largest - 1, target)     # rebuild the smaller stack on top

    move_top_disks(num_disks, target_peg)
    return moves


# ---------------------------------------------------------------------------
# Mode 1: autonomous
# ---------------------------------------------------------------------------

@dataclass
class AutonomousResult:
    success: bool
    instructions: List[str] = field(default_factory=list)
    error: str = ""


def solve_autonomous(state: State, num_disks: int, target_peg: int = 2) -> AutonomousResult:
    """Validate then solve in one shot. Returns an AutonomousResult."""
    is_valid, error = validate_state(state, num_disks)
    if not is_valid:
        return AutonomousResult(success=False, error=error)
    instructions = solve_hanoi(state, num_disks, target_peg)
    return AutonomousResult(success=True, instructions=instructions)


# ---------------------------------------------------------------------------
# Mode 2: human error correction
# ---------------------------------------------------------------------------

@dataclass
class CorrectionResult:
    """Outcome of feeding a new camera reading into a CorrectionSession."""
    valid: bool
    message: str = ""
    undo_instruction: Optional[str] = None
    takeover_instructions: List[str] = field(default_factory=list)


class CorrectionSession:
    """Tracks the last valid state while a human plays the puzzle.

    Workflow: after every button press, call `process_new_state(new_state)`.
    A valid move silently advances the session. A bad move returns both an
    undo instruction and a full takeover plan from the last valid state — the
    UI layer decides which to execute.
    """

    def __init__(self, initial_state: State, num_disks: int, target_peg: int = 2):
        is_valid, error = validate_state(initial_state, num_disks)
        if not is_valid:
            raise ValueError(f"Initial state is invalid: {error}")
        self.num_disks = num_disks
        self.target_peg = target_peg
        self.last_valid_state: State = deepcopy(initial_state)

    def process_new_state(self, new_state: State) -> CorrectionResult:
        """Compare `new_state` to the last valid state and react."""
        is_valid, validator_error = validate_state(new_state, self.num_disks)
        move_info = self._diff_states(self.last_valid_state, new_state)
        no_change = (self.last_valid_state == new_state)

        accepted = is_valid and (
            no_change
            or (move_info is not None and self._move_is_legal(move_info))
        )

        if accepted:
            self.last_valid_state = deepcopy(new_state)
            return CorrectionResult(
                valid=True,
                message=self._describe_move(move_info, no_change),
            )

        message = self._explain_failure(validator_error, move_info, no_change)
        undo = self._compute_undo(move_info)
        takeover = solve_hanoi(self.last_valid_state, self.num_disks, self.target_peg)
        return CorrectionResult(
            valid=False,
            message=message,
            undo_instruction=undo,
            takeover_instructions=takeover,
        )

    # ---- internal helpers -------------------------------------------------

    @staticmethod
    def _diff_states(prev: State, new: State) -> Optional[Tuple[int, int, int]]:
        """If exactly one disk changed pegs, return (disk, source, target). Else None."""
        changed = [i for i in range(3) if prev[i] != new[i]]
        if len(changed) != 2:
            return None
        peg_a, peg_b = changed
        lost_a = set(prev[peg_a]) - set(new[peg_a])
        lost_b = set(prev[peg_b]) - set(new[peg_b])
        gained_a = set(new[peg_a]) - set(prev[peg_a])
        gained_b = set(new[peg_b]) - set(prev[peg_b])
        if len(lost_a) == 1 and not lost_b and not gained_a and gained_b == lost_a:
            return lost_a.pop(), peg_a, peg_b
        if len(lost_b) == 1 and not lost_a and not gained_b and gained_a == lost_b:
            return lost_b.pop(), peg_b, peg_a
        return None

    def _move_is_legal(self, move_info: Tuple[int, int, int]) -> bool:
        """Check that move_info is a legal Hanoi move out of the last valid state."""
        disk, src, tgt = move_info
        prev = self.last_valid_state
        if not prev[src] or prev[src][-1] != disk:
            return False  # took a disk that was buried, not on top
        if prev[tgt] and prev[tgt][-1] < disk:
            return False  # placed on top of a smaller disk
        return True

    @staticmethod
    def _describe_move(move_info: Optional[Tuple[int, int, int]], no_change: bool) -> str:
        if no_change:
            return "No change since last reading."
        assert move_info is not None  # any other case lands in the failure branch
        disk, src, tgt = move_info
        return f"Disk {disk} moved from peg {src} to peg {tgt}."

    def _explain_failure(
        self,
        validator_error: str,
        move_info: Optional[Tuple[int, int, int]],
        no_change: bool,
    ) -> str:
        """Pick the most specific human-readable explanation we can produce."""
        # If we can pin the error to a single attempted move, that's most useful.
        if move_info is not None:
            disk, src, tgt = move_info
            prev = self.last_valid_state
            if not prev[src] or prev[src][-1] != disk:
                return (
                    f"Disk {disk} was taken from peg {src}, but it was not the top disk there — "
                    "only the top disk on a peg may be moved."
                )
            if prev[tgt] and prev[tgt][-1] < disk:
                covered = prev[tgt][-1]
                return (
                    f"Disk {disk} was placed on top of disk {covered} on peg {tgt} — "
                    "a disk can only sit on a strictly larger one."
                )
        # Otherwise fall back to validator output, or report a multi-disk move.
        if not no_change:
            if validator_error:
                return validator_error
            return (
                "More than one disk appears to have changed position. "
                "Please move only one disk at a time."
            )
        return validator_error or "The new state is invalid."

    @staticmethod
    def _compute_undo(move_info: Optional[Tuple[int, int, int]]) -> Optional[str]:
        """Return the single instruction that reverses the offending move, if known."""
        if move_info is None:
            return None
        disk, src, tgt = move_info
        return _format_move(disk, tgt, src)


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # 1. Classic 3-disk solve.
    classic = [[3, 2, 1], [], []]
    result = solve_autonomous(classic, num_disks=3)
    print("Autonomous solve from classic start [[3,2,1],[],[]]:")
    for step in result.instructions:
        print(" ", step)
    print(f"  -> {len(result.instructions)} moves\n")

    # 2. Solve from a non-classic position.
    arbitrary = [[3], [2], [1]]
    result = solve_autonomous(arbitrary, num_disks=3)
    print("Autonomous solve from arbitrary state [[3],[2],[1]]:")
    for step in result.instructions:
        print(" ", step)
    print(f"  -> {len(result.instructions)} moves\n")

    # 3. Validation error: wrong disk count.
    bad_count = solve_autonomous([[3, 2, 1], [], []], num_disks=4)
    print("Autonomous with wrong expected count:")
    print(" ", bad_count.error, "\n")

    # 4. Correction mode: human plays, then makes a bad move.
    print("Correction mode demo:")
    session = CorrectionSession(initial_state=[[3, 2, 1], [], []], num_disks=3)

    after_legal_move = [[3, 2], [], [1]]
    res = session.process_new_state(after_legal_move)
    print(" After legal move ->", res.message)

    # Bad move: place disk 3 on top of disk 1.
    after_bad_move = [[2], [], [1, 3]]
    bad = session.process_new_state(after_bad_move)
    print(" After bad move    ->", bad.message)
    print("   undo:    ", bad.undo_instruction)
    print("   takeover:", bad.takeover_instructions)
