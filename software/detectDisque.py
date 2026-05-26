"""
SCARAnoi — Computer Vision Module
==================================
Détection des 5 disques colorés du Tower of Hanoi via ESP32-CAM.

Disques :
  1. Vert       (green)      — le plus petit
  2. Jaune      (yellow)
  3. Rouge      (red)
  4. Bleu foncé (dark_blue)
  5. Turquoise  (turquoise)  — le plus grand

Principe :
  - Segmentation HSV par couleur (chaque disque a une couleur unique).
  - ROI : le bas de l'image (base du plateau) est ignoré.
  - Filtre d'aspect ratio : rejette les barres verticales (w/h trop petit).
  - Attribution à la tige : selon la position X du centre du disque.
    Convention : droite=0, milieu=1, gauche=2 (numérotation inversée
    par rapport à l'ordre image).
    Pas besoin de détecter les tiges elles-mêmes — la position de la tige
    est déduite des centres des disques qui sont posés dessus.
  - Ordre dans la pile : tri par Y du centre (Y image augmente vers le bas,
    donc grand cy = disque en bas de la pile).

Usage :
    python scaranoi_vision.py                         # live stream par défaut
    python scaranoi_vision.py image.jpg               # image fichier
    python scaranoi_vision.py --calibrate image.jpg   # outil HSV interactif

Contrôles en mode live :
    ESPACE  → capture et analyse
    R       → reprend le live
    S       → sauvegarde l'image annotée
    Q / ESC → quitte
"""

import cv2
import numpy as np
import urllib.request
from dataclasses import dataclass
from typing import Optional


# ============================================================
#  CONFIGURATION
# ============================================================
DEFAULT_STREAM_URL = "http://172.21.76.162:81/stream"

# Plages HSV (H ∈ [0,180], S ∈ [0,255], V ∈ [0,255])
HSV_RANGES = {
    "green":  [(np.array([35, 80, 60]), np.array([85, 255, 255]))],
    "yellow": [(np.array([18, 50, 130]), np.array([35, 255, 255]))],
    "red":    [(np.array([0, 140, 80]), np.array([10, 255, 255])),
               (np.array([170, 140, 80]), np.array([180, 255, 255]))],

    # Disk 4
    "dark_blue": [
        (np.array([100, 120, 40]), np.array([130, 255, 200]))
    ],

    # Disk 5, biggest
    # You may need to tune this with the real camera image.
    "turquoise": [
        (np.array([83, 60, 70]), np.array([100, 255, 255]))
    ],
}

# 1 = smallest, 5 = biggest
DISK_ID = {
    "green": 1,
    "yellow": 2,
    "red": 3,
    "dark_blue": 4,
    "turquoise": 5,
}

ID_TO_COLOR = {v: k for k, v in DISK_ID.items()}
DISK_COLORS = ("green", "yellow", "red", "dark_blue", "turquoise")

NUM_TOWERS = 3
MIN_CONTOUR_AREA = 300
KERNEL = np.ones((5, 5), np.uint8)

ROI_BOTTOM_PCT = 0.38
ROI_TOP_PCT    = 0.00
MIN_W_OVER_H   = 0.8

PEG_LABEL_Y_FRAC = 0.10

_BGR = {
    "green":     (0, 200, 0),
    "yellow":    (0, 220, 220),
    "red":       (0, 0, 230),
    "dark_blue": (230, 80, 0),
    "turquoise": (208, 224, 64),
}
_BGR_PEG = (0, 255, 255)

# ============================================================
#  STRUCTURE DE DONNÉES
# ============================================================
@dataclass
class Disk:
    disk_id: int
    color: str
    cx: int
    cy: int
    w: int
    h: int

    def __repr__(self):
        return f"Disk(id={self.disk_id}, {self.color}, center=({self.cx},{self.cy}))"


# ============================================================
#  ACQUISITION
# ============================================================
def capture_from_url(url: str, timeout: float = 5.0) -> Optional[np.ndarray]:
    try:
        resp = urllib.request.urlopen(url, timeout=timeout)
        arr = np.asarray(bytearray(resp.read()), dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception as e:
        print(f"[ERREUR] {e}")
        return None


def load_frame(src: str) -> Optional[np.ndarray]:
    if src.startswith("http"):
        return capture_from_url(src)
    return cv2.imread(src)


# ============================================================
#  DÉTECTION
# ============================================================
def color_mask(hsv: np.ndarray, color: str) -> np.ndarray:
    mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for low, high in HSV_RANGES[color]:
        mask |= cv2.inRange(hsv, low, high)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, KERNEL)
    return mask


def roi_mask(shape):
    h, w = shape[:2]
    y_top    = int(h * ROI_TOP_PCT)
    y_bottom = int(h * (1.0 - ROI_BOTTOM_PCT))
    m = np.zeros((h, w), dtype=np.uint8)
    m[y_top:y_bottom, :] = 255
    return m, y_top, y_bottom


def largest_disk_contour(mask: np.ndarray):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    best, best_area = None, MIN_CONTOUR_AREA
    for c in contours:
        area = cv2.contourArea(c)
        if area < MIN_CONTOUR_AREA:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if h == 0 or (w / h) < MIN_W_OVER_H:
            continue
        if area > best_area:
            best, best_area = c, area
    return best


def detect_disks(frame: np.ndarray) -> list[Disk]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    roi, _, _ = roi_mask(frame.shape)

    disks = []
    for color in DISK_COLORS:
        m = cv2.bitwise_and(color_mask(hsv, color), roi)
        c = largest_disk_contour(m)
        if c is None:
            continue
        x, y, w, h = cv2.boundingRect(c)
        disks.append(Disk(
            disk_id=DISK_ID[color],
            color=color,
            cx=x + w // 2,
            cy=y + h // 2,
            w=w, h=h,
        ))
    return disks


# ============================================================
#  ÉTAT DU JEU
# ============================================================
def assign_to_towers(disks: list[Disk], frame_width: int):
    third = frame_width / NUM_TOWERS
    buckets: list[list[Disk]] = [[] for _ in range(NUM_TOWERS)]
    for d in disks:
        zone = min(int(d.cx // third), NUM_TOWERS - 1)
        peg_idx = (NUM_TOWERS - 1) - zone
        buckets[peg_idx].append(d)

    state = []
    peg_xs = []
    for b in buckets:
        b.sort(key=lambda d: -d.cy)
        state.append([d.disk_id for d in b])
        if b:
            peg_xs.append(int(np.mean([d.cx for d in b])))
        else:
            peg_xs.append(None)
    return state, peg_xs


# ============================================================
#  VISUALISATION
# ============================================================
def annotate(frame: np.ndarray, disks: list[Disk],
             peg_xs: Optional[list] = None) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]
    _, y_top, y_bot = roi_mask(out.shape)

    cv2.line(out, (0, y_bot), (w, y_bot), (60, 60, 60), 1, cv2.LINE_AA)
    cv2.putText(out, "base (ignored)", (8, min(y_bot + 18, h - 4)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1, cv2.LINE_AA)
    if y_top > 0:
        cv2.line(out, (0, y_top), (w, y_top), (60, 60, 60), 1, cv2.LINE_AA)

    for i in range(1, NUM_TOWERS):
        x = int(i * w / NUM_TOWERS)
        cv2.line(out, (x, 0), (x, y_bot), (80, 80, 80), 1, cv2.LINE_AA)

    if peg_xs:
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.9
        thick = 2
        label_y = int(h * PEG_LABEL_Y_FRAC)

        for i, x in enumerate(peg_xs):
            if x is None:
                continue
            cv2.line(out, (x, 0), (x, y_bot), _BGR_PEG, 2, cv2.LINE_AA)
            label = f"PEG {i}"
            (tw, th), _ = cv2.getTextSize(label, font, scale, thick)
            tx = max(2, min(w - tw - 2, x - tw // 2))
            ty = label_y
            cv2.rectangle(out,
                          (tx - 4, ty - th - 4),
                          (tx + tw + 4, ty + 4),
                          (0, 0, 0), -1)
            cv2.putText(out, label, (tx, ty), font, scale,
                        _BGR_PEG, thick, cv2.LINE_AA)

    for d in disks:
        c = _BGR[d.color]
        x1, y1 = d.cx - d.w // 2, d.cy - d.h // 2
        x2, y2 = d.cx + d.w // 2, d.cy + d.h // 2
        cv2.rectangle(out, (x1, y1), (x2, y2), c, 2)
        cv2.circle(out, (d.cx, d.cy), 4, c, -1)
        label = f"{d.color} #{d.disk_id}"
        pos = (x1, max(y1 - 8, 15))
        cv2.putText(out, label, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(out, label, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    c, 1, cv2.LINE_AA)
    return out


# ============================================================
#  CALIBRATION HSV
# ============================================================
def calibrate(frame: np.ndarray):
    win = "Calibration HSV (q/ESC pour quitter)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    for name, val, maxv in [("Hmin", 0, 180), ("Hmax", 180, 180),
                            ("Smin", 0, 255), ("Smax", 255, 255),
                            ("Vmin", 0, 255), ("Vmax", 255, 255)]:
        cv2.createTrackbar(name, win, val, maxv, lambda _: None)

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    while True:
        low  = np.array([cv2.getTrackbarPos(n, win) for n in ("Hmin", "Smin", "Vmin")])
        high = np.array([cv2.getTrackbarPos(n, win) for n in ("Hmax", "Smax", "Vmax")])
        mask = cv2.inRange(hsv, low, high)
        result = cv2.bitwise_and(frame, frame, mask=mask)
        stacked = np.hstack([frame, cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR), result])
        cv2.imshow(win, stacked)
        if cv2.waitKey(30) & 0xFF in (27, ord('q')):
            break
    cv2.destroyAllWindows()
    print(f"\nPlage finale :  low = {low.tolist()}   high = {high.tolist()}")


# ============================================================
#  PIPELINE
# ============================================================
def analyze(frame: np.ndarray):
    disks = detect_disks(frame)
    state, peg_xs = assign_to_towers(disks, frame.shape[1])
    vis = annotate(frame, disks, peg_xs)
    return disks, state, vis, peg_xs


def print_state(disks, state, peg_xs=None):
    print("\n" + "=" * 50)
    if peg_xs:
        readable = [str(x) if x is not None else "vide" for x in peg_xs]
        print(f"Pegs (X déduits des disques) : {readable}")
    print("Disques détectés :")
    for d in disks:
        print(" ", d)
    print("\nÉtat des tours (bas → sommet, droite → gauche) :")
    for i, t in enumerate(state):
        symbols = " · ".join(ID_TO_COLOR[x] for x in t) if t else "(vide)"
        print(f"  Peg {i}:  {t}    [{symbols}]")
    print("=" * 50)


# ============================================================
#  MODE LIVE — stream MJPEG
# ============================================================
def live_mode(stream_url: str, save_dir: str = "."):
    print(f"[INFO] Connexion : {stream_url}")
    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        print("[ERREUR] Impossible d'ouvrir le flux.")
        return None
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    window = "SCARAnoi — LIVE (ESPACE=capture, R=reprendre, S=save, Q=quit)"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)

    frozen = None
    frozen_raw = None
    capture_count = 0
    last_state = None

    try:
        while True:
            if frozen is None:
                ok, frame = cap.read()
                if not ok:
                    continue
                cv2.rectangle(frame, (0, 0), (frame.shape[1], 28),
                              (0, 0, 0), -1)
                cv2.putText(frame, "LIVE - ESPACE: capture | Q: quit",
                            (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                            (255, 255, 255), 1, cv2.LINE_AA)
                cv2.imshow(window, frame)
            else:
                cv2.imshow(window, frozen)

            key = cv2.waitKey(1) & 0xFF

            if key in (ord('q'), 27):
                break

            elif key == 32:                           # ESPACE
                if frozen is None:
                    cap.read()
                    ok, shot = cap.read()
                    if not ok:
                        continue
                    disks, state, vis, peg_xs = analyze(shot)  # FIX : 4 valeurs
                    print_state(disks, state, peg_xs)           # FIX : state passé
                    last_state = state                          # FIX : sauvegarde
                    cv2.rectangle(vis, (0, 0), (vis.shape[1], 28),
                                  (0, 0, 0), -1)
                    cv2.putText(vis, "CAPTURE - R: live | S: save | Q: quit",
                                (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                                (0, 255, 0), 1, cv2.LINE_AA)
                    frozen = vis
                    frozen_raw = shot
                    capture_count += 1

            elif key in (ord('r'), ord('R')):
                frozen = None
                frozen_raw = None

            elif key in (ord('s'), ord('S')) and frozen is not None:
                import os, time
                ts = time.strftime("%Y%m%d_%H%M%S")
                out_vis = os.path.join(save_dir, f"scaranoi_{ts}_annot.png")
                out_raw = os.path.join(save_dir, f"scaranoi_{ts}_raw.png")
                cv2.imwrite(out_vis, frozen)
                cv2.imwrite(out_raw, frozen_raw)
                print(f"[SAVED] {out_vis}\n[SAVED] {out_raw}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print(f"\n[INFO] {capture_count} capture(s) effectuée(s).")
        if last_state is not None:
            print(f"[INFO] Dernier état capturé : {last_state}")

    return last_state


# ============================================================
#  CLI
# ============================================================
if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    calib_mode = "--calibrate" in args
    live_flag  = "--live" in args
    args = [a for a in args if a not in ("--calibrate", "--live")]
    src = args[0] if args else DEFAULT_STREAM_URL

    is_stream = src.startswith("http") and ("/stream" in src or live_flag)

    if is_stream and not calib_mode:
        state = live_mode(src)
        sys.exit(0)

    frame = load_frame(src)
    if frame is None:
        print(f"Impossible de charger '{src}'")
        sys.exit(1)

    if calib_mode:
        calibrate(frame)
        sys.exit(0)

    disks, state, vis, peg_xs = analyze(frame)
    print_state(disks, state, peg_xs)
    print(f"\n[OUTPUT] state = {state}")
    cv2.imshow("SCARAnoi - detection", vis)
    print("\n(Appuie sur une touche dans la fenêtre pour quitter)")
    cv2.waitKey(0)
    cv2.destroyAllWindows()
