"""
Visual simulator for Tower of Hanoi instruction sequences.

Reads a list of MOVE-strings produced by the solver (Script 1) and steps
through them in a terminal UI: one frame per move, with the puzzle redrawn
as ASCII art after each step.
"""

import re
import sys
import time
from copy import deepcopy
from typing import List, Optional, Tuple

from hanoi_solver import State, validate_state


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

AUTO_DELAY_SECONDS = 0.4
MOVE_PATTERN = re.compile(r"^MOVE d(\d+) FROM p(\d+) TO p(\d+)$")


# ---------------------------------------------------------------------------
# Parsing & move application
# ---------------------------------------------------------------------------

def parse_instruction(instruction: str) -> Optional[Tuple[int, int, int]]:
    """Parse a move string into (disk, source_peg, target_peg). None on failure."""
    match = MOVE_PATTERN.match(instruction.strip())
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def apply_move(state: State, disk: int, src: int, tgt: int) -> Tuple[bool, str]:
    """Apply a single move to `state` in-place if legal. Returns (ok, error_msg)."""
    if not (0 <= src < 3) or not (0 <= tgt < 3):
        return False, f"peg index out of range (got src={src}, tgt={tgt})."
    if src == tgt:
        return False, f"source and target peg are both {src}."
    if not state[src]:
        return False, f"peg {src} is empty — cannot move disk {disk} from it."
    top = state[src][-1]
    if top != disk:
        return False, f"top of peg {src} is disk {top}, not disk {disk}."
    if state[tgt] and state[tgt][-1] < disk:
        return False, (
            f"cannot place disk {disk} on top of disk {state[tgt][-1]} on peg {tgt} — "
            "a disk can only sit on a strictly larger one."
        )
    state[src].pop()
    state[tgt].append(disk)
    return True, ""


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render_board(state: State, num_disks: int) -> str:
    """Return an ASCII-art picture of the current state."""
    slot_width = 2 * num_disks + 1
    gap = "   "  # space between pegs
    lines: List[str] = []

    # Draw from the top of the stack down to the base.
    for level in range(num_disks - 1, -1, -1):
        row_parts = []
        for peg in state:
            if level < len(peg):
                disk = peg[level]
                pad = num_disks - disk
                row_parts.append(" " * pad + "█" * (2 * disk + 1) + " " * pad)
            else:
                pad = num_disks
                row_parts.append(" " * pad + "│" + " " * pad)
        lines.append(gap.join(row_parts))

    # Base line and peg labels.
    base_segment = "─" * slot_width
    lines.append(gap.join([base_segment] * 3))

    label_parts = []
    for peg_idx in range(3):
        label = f"p{peg_idx}"
        left = (slot_width - len(label)) // 2
        right = slot_width - left - len(label)
        label_parts.append(" " * left + label + " " * right)
    lines.append(gap.join(label_parts))

    return "\n".join(lines)


def clear_screen() -> None:
    """Clear the terminal using an ANSI escape sequence."""
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def print_frame(
    state: State,
    num_disks: int,
    last_move: Optional[str],
    move_num: int,
    total_moves: int,
) -> None:
    """Print a single frame: header + move info + board."""
    clear_screen()
    print("=" * 60)
    print("  Tower of Hanoi — SCARAnoi Simulator")
    print("=" * 60)
    print()
    if last_move is None:
        print(f"  Initial state (0 of {total_moves} move(s) to execute)")
    else:
        print(f"  Move {move_num} of {total_moves}:  {last_move}")
    print()
    print(render_board(state, num_disks))
    print()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run_simulator(
    initial_state: State,
    instructions: List[str],
    num_disks: int,
    target_peg: int = 2,
) -> None:
    """Step through `instructions`, redrawing the board after each one."""
    is_valid, error = validate_state(initial_state, num_disks)
    if not is_valid:
        print(f"Initial state rejected: {error}")
        return

    state: State = deepcopy(initial_state)
    auto = False
    total = len(instructions)

    print_frame(state, num_disks, last_move=None, move_num=0, total_moves=total)
    if total > 0:
        cmd = input("Press Enter to start, or type 'run' to auto-play: ").strip().lower()
        if cmd == "run":
            auto = True

    for step_idx, instruction in enumerate(instructions, start=1):
        parsed = parse_instruction(instruction)
        if parsed is None:
            print(
                f"\nFAILED at step {step_idx}: could not parse instruction "
                f"{instruction!r}. Expected form: 'MOVE d<disk> FROM p<src> TO p<tgt>'."
            )
            return
        disk, src, tgt = parsed
        ok, error = apply_move(state, disk, src, tgt)
        if not ok:
            print(f"\nFAILED at step {step_idx} ({instruction}): {error}")
            return

        print_frame(state, num_disks, last_move=instruction, move_num=step_idx, total_moves=total)

        if step_idx < total:
            if auto:
                time.sleep(AUTO_DELAY_SECONDS)
            else:
                cmd = input("Press Enter for next, or type 'run' to auto-play: ").strip().lower()
                if cmd == "run":
                    auto = True

    # Summary.
    solved = (
        len(state[target_peg]) == num_disks
        and state[target_peg] == list(range(num_disks, 0, -1))
    )
    print()
    print("=" * 60)
    print(f"  Executed {total} move(s).")
    if solved:
        print(f"  ✓ Puzzle solved — all {num_disks} disks on peg {target_peg} in correct order.")
    else:
        print(f"  ⚠ Puzzle NOT solved. Final state: {state}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import ast
    from hanoi_solver import solve_autonomous

    # (label, initial state, num_disks) — covers classic, scrambled, partial, edge cases.
    scenarios = [
        ("Classic 3-disk solve (7 moves)",         [[3, 2, 1], [], []],          3),
        ("Classic 5-disk solve (31 moves)",        [[5, 4, 3, 2, 1], [], []],    5),
        ("Classic 7-disk solve (127 moves)",       [[7, 6, 5, 4, 3, 2, 1], [], []], 7),
        ("Scrambled: one disk on each peg",        [[3], [2], [1]],              3),
        ("Partial tower: split across all pegs",   [[5, 4], [3], [2, 1]],        5),
        ("Mid-solve: tower built on the wrong peg",[[5], [4, 3, 2, 1], []],      5),
        ("Already solved (0 moves)",               [[], [], [3, 2, 1]],          3),
    ]

    print("Pick a scenario:")
    for idx, (label, _, _) in enumerate(scenarios):
        print(f"  {idx}: {label}")
    print("  c: custom — enter your own initial state")
    raw = input("\nEnter number or 'c' (default 0): ").strip().lower()

    if raw == "c":
        try:
            num_disks = int(input("Number of disks: ").strip())
            state_str = input(
                "Initial state as a Python list, e.g. [[3,2,1],[],[]]: "
            ).strip()
            initial = ast.literal_eval(state_str)
        except (ValueError, SyntaxError) as exc:
            print(f"Couldn't parse input: {exc}")
            sys.exit(1)
        label = "Custom state"
    elif raw.isdigit() and int(raw) < len(scenarios):
        label, initial, num_disks = scenarios[int(raw)]
    else:
        label, initial, num_disks = scenarios[0]

    print(f"\n>>> {label}\n")
    result = solve_autonomous(initial, num_disks=num_disks)
    if not result.success:
        print("Solver rejected the state:", result.error)
        sys.exit(1)
    run_simulator(initial, result.instructions, num_disks=num_disks)
