"""
SCARAnoi - detection robuste des disques avec zones manuelles par peg.

But :
  - detecter les 5 disques du Tower of Hanoi
  - eviter de regarder tout le fond
  - chercher seulement dans les rectangles autour des 3 pegs
  - permettre de regler ces rectangles manuellement

Ordre des disques :
  1 = light_green   : vert clair, plus petit
  2 = yellow        : jaune
  3 = red           : rouge, remplace l'ancien magenta
  4 = turquoise     : turquoise
  5 = dark_blue     : dark_blue, plus grand

Touches live :
  ESPACE : capture et analyse
  R      : retour live
  S      : sauvegarde image annotee
  Q/ESC  : quitter
"""

import cv2
import numpy as np
import urllib.request
from dataclasses import dataclass
from typing import Optional


# ============================================================
#  CONFIGURATION GENERALE
# ============================================================
DEFAULT_STREAM_URL = "http://172.21.76.162:81/stream"

NUM_TOWERS = 3

# Active ou desactive les zones manuelles.
# True  : le code cherche uniquement dans les rectangles PEG_ZONES.
# False : le code cherche dans toute la ROI globale.
USE_PEG_ZONES = True

# ROI globale en pourcentage de l'image.
# Elle sert comme securite generale.
# OpenCV : y augmente vers le bas.
ROI_TOP_PCT = 0.08
ROI_BOTTOM_PCT = 0.4

# Zones manuelles des pegs.
# Format : peg_id: (x1, y1, x2, y2)
# Les valeurs sont en pourcentage de l'image.
# x1 = bord gauche, y1 = bord haut, x2 = bord droit, y2 = bord bas.
# Convention de ton projet : peg 0 = droite, peg 1 = milieu, peg 2 = gauche.
#
# Regle surtout ces lignes si un disque est ignore ou si le robot est detecte.
PEG_ZONES = { 
    2: (0.02, 0.35, 0.27, 0.65), # peg gauche 
    1: (0.35, 0.35, 0.55, 0.65), # peg milieu 
    0: (0.65, 0.35, 0.82, 0.65), # peg droite 
    }

# Filtres de formes.
# Les disques doivent ressembler a des rectangles horizontaux.
MIN_CONTOUR_AREA = 280
MIN_W_OVER_H = 1.35
MAX_H_OVER_FRAME = 0.16
MIN_FILL_RATIO = 0.18

KERNEL_OPEN = np.ones((3, 3), np.uint8)
KERNEL_CLOSE = np.ones((9, 5), np.uint8)

PEG_LABEL_Y_FRAC = 0.10


# ============================================================
#  COULEURS HSV
# ============================================================
# H in [0,180], S in [0,255], V in [0,255]
# Ces plages sont un point de depart. Tu peux les regler avec --calibrate.
HSV_RANGES = {
    # Disque 1 : vert clair
    "light_green": [
        (np.array([45, 45, 45]), np.array([88, 255, 255])),
    ],

    # Disque 2 : jaune
    # On demarre a H=20 pour eviter une partie de l'orange du robot.
    "yellow": [
        # Jaune plus tolerant aux variations de lumiere.
        # Ton crop jaune est souvent autour de H=16-25, S=90-165, V=140-220.
        # On elargit surtout V min et S min pour accepter les zones pales/sombres.
        (np.array([15, 35, 70]), np.array([38, 255, 255])),
    ],

    # Disque 3 : rouge
    # Rouge = deux zones HSV, car le rouge est coupe autour de H=0.
    "red": [
        (np.array([0, 70, 50]), np.array([10, 255, 255])),
        (np.array([170, 70, 50]), np.array([180, 255, 255])),
    ],

    # Si tu n'as pas encore remplace le magenta par du rouge,
    # remplace temporairement le bloc "red" ci-dessus par celui-ci :
    # "red": [
    #     (np.array([145, 55, 70]), np.array([179, 255, 255])),
    #     (np.array([0, 70, 70]), np.array([8, 255, 255])),
    # ],

    # Disque 4 : turquoise
    "turquoise": [
        (np.array([82, 40, 55]), np.array([105, 255, 255])),
    ],

    # Disque 5 : dark_blue
    # Le nom reste dark_blue, mais on le detecte comme un bleu.
    # HSV OpenCV pour un bleu fonce : H autour de 100-130.
    # Si le disque n'est pas detecte, baisse S min ou elargis H.
    # Si le fond/robot est detecte, augmente S min ou baisse V max.
    "dark_blue": [
        (np.array([100, 120, 40]), np.array([130, 255, 200])),
    ],
}

DISK_ID = {
    "light_green": 1,
    "yellow": 2,
    "red": 3,
    "dark_blue": 4,
    "turquoise": 5,
}

ID_TO_COLOR = {v: k for k, v in DISK_ID.items()}
DISK_COLORS = ("light_green", "yellow", "red", "dark_blue", "turquoise")

# Couleurs d'affichage BGR, pas les couleurs de detection.
_BGR = {
    "light_green": (0, 230, 0),
    "yellow":      (0, 220, 220),
    "red":         (0, 0, 230),
    "turquoise":   (220, 220, 0),
    "dark_blue":   (230, 80, 0),
}

_BGR_PEG = (0, 255, 255)
_BGR_ZONE = (255, 255, 0)


# ============================================================
#  STRUCTURE DE DONNEES
# ============================================================
@dataclass
class Disk:
    disk_id: int
    color: str
    cx: int
    cy: int
    w: int
    h: int
    area: float
    peg_id: Optional[int] = None

    @property
    def bottom(self) -> int:
        return self.cy + self.h // 2

    def __repr__(self):
        peg = "?" if self.peg_id is None else self.peg_id
        return (
            f"Disk(id={self.disk_id}, {self.color}, peg={peg}, "
            f"center=({self.cx},{self.cy}), size=({self.w}x{self.h}))"
        )


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
#  PRETRAITEMENT
# ============================================================
def preprocess(frame: np.ndarray) -> np.ndarray:
    """
    Normalise un peu la luminosite.
    Si ca change trop tes couleurs, tu peux retourner directement frame.copy().
    """
    b, g, r = cv2.split(frame.astype(np.float32))
    avg_global = (b.mean() + g.mean() + r.mean()) / 3.0

    b = np.clip(b * (avg_global / (b.mean() + 1e-6)), 0, 255)
    g = np.clip(g * (avg_global / (g.mean() + 1e-6)), 0, 255)
    r = np.clip(r * (avg_global / (r.mean() + 1e-6)), 0, 255)
    balanced = cv2.merge([b, g, r]).astype(np.uint8)

    lab = cv2.cvtColor(balanced, cv2.COLOR_BGR2LAB)
    l, a, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
    lab = cv2.merge([clahe.apply(l), a, b_ch])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


# ============================================================
#  MASQUES ROI ET ZONES
# ============================================================
def roi_mask(shape):
    h, w = shape[:2]

    y_top = int(h * ROI_TOP_PCT)
    y_bottom = int(h * (1.0 - ROI_BOTTOM_PCT))

    y_top = max(0, min(y_top, h - 1))
    y_bottom = max(y_top + 1, min(y_bottom, h))

    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y_top:y_bottom, :] = 255
    return mask, y_top, y_bottom


def peg_zones_mask(shape):
    h, w = shape[:2]

    mask = np.zeros((h, w), dtype=np.uint8)
    rects = []

    for peg_id, (x1p, y1p, x2p, y2p) in PEG_ZONES.items():
        x1 = int(x1p * w)
        y1 = int(y1p * h)
        x2 = int(x2p * w)
        y2 = int(y2p * h)

        x1 = max(0, min(x1, w - 1))
        x2 = max(x1 + 1, min(x2, w))
        y1 = max(0, min(y1, h - 1))
        y2 = max(y1 + 1, min(y2, h))

        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
        rects.append((peg_id, x1, y1, x2, y2))

    return mask, rects


def get_search_mask(shape):
    """
    Masque final de recherche.
    Si USE_PEG_ZONES = True : ROI globale ET zones manuelles des pegs.
    Sinon : ROI globale seulement.
    """
    roi, _, _ = roi_mask(shape)

    if not USE_PEG_ZONES:
        return roi

    peg_mask, _ = peg_zones_mask(shape)
    return cv2.bitwise_and(roi, peg_mask)


# ============================================================
#  MASQUES COULEURS
# ============================================================
def remove_robot_like_colors(mask: np.ndarray, hsv: np.ndarray, color: str) -> np.ndarray:
    """
    Enleve surtout l'orange du robot et les zones peu saturees.
    Pour red, on ne supprime pas l'orange ici de facon trop forte,
    sinon un vrai disque rouge pourrait etre abime.
    """
    h_ch, s_ch, v_ch = cv2.split(hsv)

    low_saturation = cv2.inRange(s_ch, 0, 30)
    mask = cv2.bitwise_and(mask, cv2.bitwise_not(low_saturation))

    # Important : ne pas supprimer l'orange pour yellow.
    # Le jaune vu par la camera tombe parfois vers H=15-18.
    # Si on supprime H=0-18, on casse une partie du disque jaune.
    if color not in ("red", "yellow"):
        orange_1 = cv2.inRange(hsv, np.array([0, 60, 40]), np.array([14, 255, 255]))
        orange_2 = cv2.inRange(hsv, np.array([170, 60, 40]), np.array([180, 255, 255]))
        orange = cv2.bitwise_or(orange_1, orange_2)
        mask = cv2.bitwise_and(mask, cv2.bitwise_not(orange))

    return mask


def color_mask(hsv: np.ndarray, color: str) -> np.ndarray:
    mask = np.zeros(hsv.shape[:2], dtype=np.uint8)

    for low, high in HSV_RANGES[color]:
        mask = cv2.bitwise_or(mask, cv2.inRange(hsv, low, high))

    mask = remove_robot_like_colors(mask, hsv, color)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, KERNEL_OPEN)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, KERNEL_CLOSE)
    return mask


# ============================================================
#  DETECTION DES CONTOURS
# ============================================================
def find_peg_for_point(cx: int, cy: int, shape) -> Optional[int]:
    h, w = shape[:2]

    for peg_id, (x1p, y1p, x2p, y2p) in PEG_ZONES.items():
        x1 = int(x1p * w)
        y1 = int(y1p * h)
        x2 = int(x2p * w)
        y2 = int(y2p * h)

        if x1 <= cx <= x2 and y1 <= cy <= y2:
            return peg_id

    return None


def contour_to_disk(contour, color: str, frame_shape) -> Optional[Disk]:
    h_img, w_img = frame_shape[:2]
    area = cv2.contourArea(contour)

    if area < MIN_CONTOUR_AREA:
        return None

    x, y, w, h = cv2.boundingRect(contour)
    if h <= 0:
        return None

    if (w / h) < MIN_W_OVER_H:
        return None

    if h > h_img * MAX_H_OVER_FRAME:
        return None

    fill_ratio = area / float(w * h)
    if fill_ratio < MIN_FILL_RATIO:
        return None

    cx = x + w // 2
    cy = y + h // 2
    peg_id = find_peg_for_point(cx, cy, frame_shape)

    if USE_PEG_ZONES and peg_id is None:
        return None

    return Disk(
        disk_id=DISK_ID[color],
        color=color,
        cx=cx,
        cy=cy,
        w=w,
        h=h,
        area=area,
        peg_id=peg_id,
    )


def best_disk_for_color(mask: np.ndarray, color: str, frame_shape) -> Optional[Disk]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    for c in contours:
        d = contour_to_disk(c, color, frame_shape)
        if d is not None:
            candidates.append(d)

    if not candidates:
        return None

    # On choisit le plus gros candidat valide de cette couleur.
    candidates.sort(key=lambda d: (d.area, d.w), reverse=True)
    return candidates[0]


def detect_disks(frame: np.ndarray) -> list[Disk]:
    prepared = preprocess(frame)
    hsv = cv2.cvtColor(prepared, cv2.COLOR_BGR2HSV)

    search_mask = get_search_mask(frame.shape)

    disks = []
    for color in DISK_COLORS:
        m = color_mask(hsv, color)
        m = cv2.bitwise_and(m, search_mask)

        d = best_disk_for_color(m, color, frame.shape)
        if d is not None:
            disks.append(d)

    return disks


# ============================================================
#  ETAT DU JEU
# ============================================================
def assign_to_towers(disks: list[Disk], frame_width: int):
    buckets: list[list[Disk]] = [[] for _ in range(NUM_TOWERS)]

    for d in disks:
        if d.peg_id is not None:
            peg_idx = d.peg_id
        else:
            third = frame_width / NUM_TOWERS
            zone = min(int(d.cx // third), NUM_TOWERS - 1)
            peg_idx = (NUM_TOWERS - 1) - zone

        buckets[peg_idx].append(d)

    state = []
    peg_xs = []

    for peg_idx, b in enumerate(buckets):
        # Bas vers sommet : plus cy est grand, plus le disque est bas.
        b.sort(key=lambda d: -d.cy)
        state.append([d.disk_id for d in b])

        if b:
            peg_xs.append(int(np.mean([d.cx for d in b])))
        elif USE_PEG_ZONES and peg_idx in PEG_ZONES:
            x1p, _, x2p, _ = PEG_ZONES[peg_idx]
            peg_xs.append(int(((x1p + x2p) / 2) * frame_width))
        else:
            third = frame_width / NUM_TOWERS
            visual_zone = (NUM_TOWERS - 1) - peg_idx
            peg_xs.append(int((visual_zone + 0.5) * third))

    return state, peg_xs


# ============================================================
#  VISUALISATION
# ============================================================
def annotate(frame: np.ndarray, disks: list[Disk], peg_xs: Optional[list] = None) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]

    _, y_top, y_bot = roi_mask(out.shape)

    # ROI globale
    cv2.line(out, (0, y_top), (w, y_top), (80, 80, 80), 1, cv2.LINE_AA)
    cv2.line(out, (0, y_bot), (w, y_bot), (80, 80, 80), 1, cv2.LINE_AA)
    cv2.putText(
        out,
        "limite basse ROI",
        (8, min(y_bot + 18, h - 4)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (140, 140, 140),
        1,
        cv2.LINE_AA,
    )

    # Rectangles manuels des pegs
    if USE_PEG_ZONES:
        _, rects = peg_zones_mask(out.shape)

        for peg_id, x1, y1, x2, y2 in rects:
            cv2.rectangle(out, (x1, y1), (x2, y2), _BGR_ZONE, 2, cv2.LINE_AA)
            cv2.putText(
                out,
                f"ZONE PEG {peg_id}",
                (x1 + 5, y1 + 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 0, 0),
                3,
                cv2.LINE_AA,
            )
            cv2.putText(
                out,
                f"ZONE PEG {peg_id}",
                (x1 + 5, y1 + 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                _BGR_ZONE,
                1,
                cv2.LINE_AA,
            )

    # Lignes verticales des pegs
    if peg_xs:
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.9
        thick = 2
        label_y = int(h * PEG_LABEL_Y_FRAC)

        for i, x in enumerate(peg_xs):
            cv2.line(out, (x, y_top), (x, y_bot), _BGR_PEG, 2, cv2.LINE_AA)
            label = f"PEG {i}"
            (tw, th), _ = cv2.getTextSize(label, font, scale, thick)
            tx = max(2, min(w - tw - 2, x - tw // 2))
            ty = label_y
            cv2.rectangle(out, (tx - 4, ty - th - 4), (tx + tw + 4, ty + 4), (0, 0, 0), -1)
            cv2.putText(out, label, (tx, ty), font, scale, _BGR_PEG, thick, cv2.LINE_AA)

    # Boites des disques detectes
    for d in disks:
        c = _BGR[d.color]
        x1, y1 = d.cx - d.w // 2, d.cy - d.h // 2
        x2, y2 = d.cx + d.w // 2, d.cy + d.h // 2

        cv2.rectangle(out, (x1, y1), (x2, y2), c, 2, cv2.LINE_AA)
        cv2.circle(out, (d.cx, d.cy), 4, c, -1)

        label = f"{d.color} #{d.disk_id}"
        pos = (x1, max(y1 - 8, 16))
        cv2.putText(out, label, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(out, label, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.55, c, 1, cv2.LINE_AA)

    return out


# ============================================================
#  CALIBRATION HSV
# ============================================================
def calibrate(frame: np.ndarray):
    prepared = preprocess(frame)
    hsv = cv2.cvtColor(prepared, cv2.COLOR_BGR2HSV)
    search_mask = get_search_mask(frame.shape)

    win = "Calibration HSV"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    for name, val, maxv in [
        ("Hmin", 0, 180),
        ("Hmax", 180, 180),
        ("Smin", 0, 255),
        ("Smax", 255, 255),
        ("Vmin", 0, 255),
        ("Vmax", 255, 255),
    ]:
        cv2.createTrackbar(name, win, val, maxv, lambda _: None)

    while True:
        low = np.array([
            cv2.getTrackbarPos("Hmin", win),
            cv2.getTrackbarPos("Smin", win),
            cv2.getTrackbarPos("Vmin", win),
        ])
        high = np.array([
            cv2.getTrackbarPos("Hmax", win),
            cv2.getTrackbarPos("Smax", win),
            cv2.getTrackbarPos("Vmax", win),
        ])

        mask = cv2.inRange(hsv, low, high)
        mask = cv2.bitwise_and(mask, search_mask)
        result = cv2.bitwise_and(prepared, prepared, mask=mask)

        zone_vis = annotate(prepared, [], None)
        stacked = np.hstack([zone_vis, cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR), result])
        cv2.imshow(win, stacked)

        if cv2.waitKey(30) & 0xFF in (27, ord("q")):
            break

    cv2.destroyAllWindows()
    print(f"\nPlage finale : low = {low.tolist()} high = {high.tolist()}")


# ============================================================
#  PIPELINE
# ============================================================
def analyze(frame: np.ndarray):
    disks = detect_disks(frame)
    state, peg_xs = assign_to_towers(disks, frame.shape[1])
    vis = annotate(frame, disks, peg_xs)
    return disks, state, vis, peg_xs


def print_state(disks, state, peg_xs=None):
    print("\n" + "=" * 60)

    if peg_xs:
        print(f"Pegs X : {peg_xs}")

    print("Disques detectes :")
    for d in sorted(disks, key=lambda x: x.disk_id):
        print(" ", d)

    missing = [name for name in DISK_COLORS if DISK_ID[name] not in [d.disk_id for d in disks]]
    if missing:
        print(f"\nDisques non detectes : {missing}")

    print("\nEtat des tours, bas vers sommet, droite vers gauche :")
    for i, tower in enumerate(state):
        names = " | ".join(ID_TO_COLOR[x] for x in tower) if tower else "vide"
        print(f"  Peg {i}: {tower} [{names}]")

    print("=" * 60)


# ============================================================
#  MODE LIVE
# ============================================================
def live_mode(stream_url: str, save_dir: str = "."):
    print(f"[INFO] Connexion : {stream_url}")
    cap = cv2.VideoCapture(stream_url)

    if not cap.isOpened():
        print("[ERREUR] Impossible d'ouvrir le flux.")
        return None

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    window = "SCARAnoi LIVE"
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

                cv2.rectangle(frame, (0, 0), (frame.shape[1], 28), (0, 0, 0), -1)
                cv2.putText(
                    frame,
                    "LIVE - ESPACE: capture | Q: quit",
                    (10, 20),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )
                cv2.imshow(window, frame)
            else:
                cv2.imshow(window, frozen)

            key = cv2.waitKey(1) & 0xFF

            if key in (ord("q"), 27):
                break

            if key == 32 and frozen is None:
                # On saute une frame pour eviter une image vieille du buffer.
                cap.read()
                ok, shot = cap.read()
                if not ok:
                    continue

                disks, state, vis, peg_xs = analyze(shot)
                print_state(disks, state, peg_xs)
                last_state = state

                cv2.rectangle(vis, (0, 0), (vis.shape[1], 28), (0, 0, 0), -1)
                cv2.putText(
                    vis,
                    "CAPTURE - R: live | S: save | Q: quit",
                    (10, 20),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (0, 255, 0),
                    1,
                    cv2.LINE_AA,
                )
                frozen = vis
                frozen_raw = shot
                capture_count += 1

            elif key in (ord("r"), ord("R")):
                frozen = None
                frozen_raw = None

            elif key in (ord("s"), ord("S")) and frozen is not None:
                import os
                import time

                ts = time.strftime("%Y%m%d_%H%M%S")
                out_vis = os.path.join(save_dir, f"scaranoi_{ts}_annot.png")
                out_raw = os.path.join(save_dir, f"scaranoi_{ts}_raw.png")

                cv2.imwrite(out_vis, frozen)
                cv2.imwrite(out_raw, frozen_raw)
                print(f"[SAVED] {out_vis}\n[SAVED] {out_raw}")

    finally:
        cap.release()
        cv2.destroyAllWindows()
        print(f"\n[INFO] {capture_count} capture(s) effectuee(s).")
        if last_state is not None:
            print(f"[INFO] Dernier etat capture : {last_state}")

    return last_state


# ============================================================
#  CLI
# ============================================================
if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    calib_mode = "--calibrate" in args
    live_flag = "--live" in args
    debug_save = "--debug-save" in args

    args = [a for a in args if a not in ("--calibrate", "--live", "--debug-save")]
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

    if debug_save:
        cv2.imwrite("debug_detection.png", vis)
        print("[SAVED] debug_detection.png")

    cv2.imshow("SCARAnoi detection", vis)
    print("\nAppuie sur une touche dans la fenetre pour quitter")
    cv2.waitKey(0)
    cv2.destroyAllWindows()