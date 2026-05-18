

"""
SCARAnoi — Pipeline complet
============================
detectDisque  →  hanoi_solver  →  hanoi_simulator

Usage :
    python scaranoi_pipeline.py                        # live stream (défaut)
    python scaranoi_pipeline.py image.jpg              # image fichier
    python scaranoi_pipeline.py http://IP/stream       # URL stream

Le script :
  1. Acquiert/analyse une frame via detectDisque.analyze()
  2. Déduit le peg cible (règle Hanoi : cible ≠ peg actuel du plus grand disque)
  3. Valide et résout via hanoi_solver.solve_autonomous()
  4. Lance la simulation ASCII via hanoi_simulator.run_simulator()
"""

import sys
import cv2

# ── Imports locaux (les 3 fichiers doivent être dans le même dossier) ────────
from detectDisque    import load_frame, analyze, print_state, live_mode, \
                            DEFAULT_STREAM_URL
from hanoi_solver    import solve_autonomous
from hanoi_simulator import run_simulator


# ── Constantes ────────────────────────────────────────────────────────────────
NUM_DISKS = 5   # SCARAnoi utilise 5 disques (blue=1 … green=5)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _infer_target_peg(state, num_disks):
    """
    Détermine le peg cible selon la règle Hanoi :
    la tour doit toujours être DÉPLACÉE → cible ≠ peg actuel du plus grand disque.

      - Grand disque sur peg 0 → cible peg 2
      - Grand disque sur peg 1 → cible peg 2  (convention projet)
      - Grand disque sur peg 2 → cible peg 0  (déjà à droite, on repart à gauche)
    """
    for peg_idx, peg in enumerate(state):
        if num_disks in peg:
            current = peg_idx
            target  = 0 if current == 2 else 2
            print(f"[PIPELINE] Disque {num_disks} sur peg {current} → cible = peg {target}")
            return target

    # Disque introuvable → le solver le signalera comme état invalide
    print("[PIPELINE] Disque le plus grand introuvable, cible par défaut = peg 2")
    return 2


def _reorder_for_solver(vision_state):
    """
    Réordonne les pegs si la convention caméra ≠ convention solver.

    detectDisque  : peg0=droite, peg1=milieu, peg2=gauche
    hanoi_solver  : même convention — aucun remapping nécessaire.

    Si ton setup physique est différent, c'est ici qu'il faut adapter.
    """
    return vision_state


def run_from_frame(frame):
    """Analyse une frame OpenCV et lance le pipeline complet."""
    # 1. Détection
    disks, vision_state, vis, peg_xs = analyze(frame)
    print_state(disks, vision_state, peg_xs)
    print(f"\n[PIPELINE] État brut détecté   : {vision_state}")

    # Affiche l'image annotée (non bloquant)
    cv2.imshow("SCARAnoi — détection", vis)
    cv2.waitKey(1)

    # 2. Remapping (no-op par défaut)
    solver_state = _reorder_for_solver(vision_state)

    # 3. Inférence du peg cible (règle Hanoi)
    target_peg = _infer_target_peg(solver_state, NUM_DISKS)

    # 4. Résolution
    result = solve_autonomous(solver_state, num_disks=NUM_DISKS, target_peg=target_peg)
    if not result.success:
        print(f"\n[ERREUR SOLVER] {result.error}")
        return False

    print(f"[PIPELINE] {len(result.instructions)} coup(s) nécessaire(s).")

    input("\nAppuie sur Entrée pour lancer la simulation…")
    cv2.destroyAllWindows()

    # 5. Simulation — même target_peg que le solver → check "solved" cohérent
    run_simulator(solver_state, result.instructions,
                  num_disks=NUM_DISKS, target_peg=target_peg)
    return True


# ── Point d'entrée ────────────────────────────────────────────────────────────

def main():
    args = [a for a in sys.argv[1:] if a != "--live"]
    src  = args[0] if args else DEFAULT_STREAM_URL

    is_stream = src.startswith("http") and ("/stream" in src or "--live" in sys.argv)

    if is_stream:
        print(f"[INFO] Mode stream — {src}")
        print("[INFO] ESPACE = capturer l'état courant, Q = quitter")
        vision_state = live_mode(src)

        if vision_state is None:
            print("[PIPELINE] Aucune capture effectuée. Abandon.")
            sys.exit(0)

        print(f"\n[PIPELINE] État retenu : {vision_state}")
        solver_state = _reorder_for_solver(vision_state)
        target_peg   = _infer_target_peg(solver_state, NUM_DISKS)

        result = solve_autonomous(solver_state, num_disks=NUM_DISKS, target_peg=target_peg)
        if not result.success:
            print(f"[ERREUR SOLVER] {result.error}")
            sys.exit(1)

        print(f"[PIPELINE] {len(result.instructions)} coup(s) nécessaire(s).")
        input("\nAppuie sur Entrée pour lancer la simulation…")
        run_simulator(solver_state, result.instructions,
                      num_disks=NUM_DISKS, target_peg=target_peg)

    else:
        frame = load_frame(src)
        if frame is None:
            print(f"[ERREUR] Impossible de charger '{src}'")
            sys.exit(1)

        success = run_from_frame(frame)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
