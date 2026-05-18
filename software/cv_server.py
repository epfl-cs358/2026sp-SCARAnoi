"""
SCARAnoi OpenCV bridge
----------------------

This server is the link between the ESP32-CAM and the browser UI:

    ESP32-CAM raw stream  ->  Python OpenCV detection  ->  annotated stream in browser

Run it from the project folder:

    python cv_server.py --esp-ip 172.21.76.162

Then open:

    http://localhost:5000
"""

from __future__ import annotations

import argparse
import os
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory

from detectDisque import analyze

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_ESP_IP = os.environ.get("SCARANOI_ESP_IP", "172.21.76.162")

app = Flask(__name__, static_folder=str(PROJECT_DIR))

state_lock = threading.Lock()

esp_ip = DEFAULT_ESP_IP
stream_url = f"http://{esp_ip}:81/stream"

latest_raw_frame: np.ndarray | None = None
latest_annotated_frame: np.ndarray | None = None
latest_state: list[list[int]] | None = None
latest_peg_xs: list[int | None] | None = None
latest_error: str | None = "Waiting for first camera frame."
latest_frame_time: float | None = None


def normalize_state(state: Any) -> list[list[int]]:
    return [[int(x) for x in peg] for peg in state]


def normalize_peg_xs(peg_xs: Any) -> list[int | None]:
    out: list[int | None] = []
    for x in peg_xs:
        out.append(None if x is None else int(x))
    return out


def analyze_frame(frame: np.ndarray):
    disks, state, annotated, peg_xs = analyze(frame)
    return disks, normalize_state(state), annotated, normalize_peg_xs(peg_xs)


def make_placeholder_frame(message: str) -> np.ndarray:
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:] = (18, 18, 18)
    cv2.putText(frame, "SCARAnoi OpenCV", (32, 80), cv2.FONT_HERSHEY_SIMPLEX,
                1.0, (0, 140, 255), 2, cv2.LINE_AA)
    y = 145
    for line in message.split("\n"):
        cv2.putText(frame, line[:62], (32, y), cv2.FONT_HERSHEY_SIMPLEX,
                    0.62, (235, 235, 235), 1, cv2.LINE_AA)
        y += 34
    return frame


def encode_jpeg(frame: np.ndarray) -> bytes | None:
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        return None
    return buffer.tobytes()


def camera_worker() -> None:
    global latest_raw_frame, latest_annotated_frame, latest_state
    global latest_peg_xs, latest_error, latest_frame_time

    cap: cv2.VideoCapture | None = None
    opened_url: str | None = None

    while True:
        with state_lock:
            wanted_url = stream_url

        if opened_url != wanted_url:
            if cap is not None:
                cap.release()
            opened_url = wanted_url
            cap = cv2.VideoCapture(opened_url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            with state_lock:
                latest_error = f"Connecting to {opened_url} ..."
            time.sleep(0.2)

        if cap is None or not cap.isOpened():
            with state_lock:
                latest_error = f"Could not open ESP32 stream: {opened_url}"
            if cap is not None:
                cap.release()
            cap = None
            opened_url = None
            time.sleep(1.0)
            continue

        ok, frame = cap.read()
        if not ok or frame is None:
            with state_lock:
                latest_error = "Could not read a frame from the ESP32 stream. Retrying..."
            cap.release()
            cap = None
            opened_url = None
            time.sleep(0.8)
            continue

        try:
            _, state, annotated, peg_xs = analyze_frame(frame)
            with state_lock:
                latest_raw_frame = frame
                latest_annotated_frame = annotated
                latest_state = state
                latest_peg_xs = peg_xs
                latest_error = None
                latest_frame_time = time.time()
        except Exception as exc:
            with state_lock:
                latest_raw_frame = frame
                latest_error = f"OpenCV detection error: {exc}"

        time.sleep(0.03)


def mjpeg_generator():
    while True:
        with state_lock:
            frame = None if latest_annotated_frame is None else latest_annotated_frame.copy()
            err = latest_error
            url = stream_url

        if frame is None:
            frame = make_placeholder_frame(
                f"Waiting for OpenCV frames.\nESP stream: {url}\n{err or ''}"
            )

        jpg = encode_jpeg(frame)
        if jpg is None:
            time.sleep(0.05)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Cache-Control: no-cache\r\n\r\n" + jpg + b"\r\n"
        )
        time.sleep(0.03)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response


@app.route("/")
def index():
    return send_from_directory(PROJECT_DIR, "index.html")


@app.route("/cv-stream")
def cv_stream():
    return Response(
        mjpeg_generator(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/cv-snapshot")
def cv_snapshot():
    with state_lock:
        frame = None if latest_annotated_frame is None else latest_annotated_frame.copy()
        err = latest_error
        url = stream_url

    if frame is None:
        frame = make_placeholder_frame(
            f"No annotated frame yet.\nESP stream: {url}\n{err or ''}"
        )

    jpg = encode_jpeg(frame)
    if jpg is None:
        return jsonify({"ok": False, "error": "Could not encode snapshot."}), 500

    return Response(jpg, mimetype="image/jpeg")


@app.route("/detect")
def detect():
    global latest_annotated_frame, latest_state, latest_peg_xs, latest_error, latest_frame_time

    with state_lock:
        frame = None if latest_raw_frame is None else latest_raw_frame.copy()
        err = latest_error
        url = stream_url

    if frame is None:
        return jsonify({
            "ok": False,
            "error": f"No camera frame available yet. ESP stream: {url}. {err or ''}".strip()
        }), 503

    try:
        _, state, annotated, peg_xs = analyze_frame(frame)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"OpenCV detection failed: {exc}"}), 500

    with state_lock:
        latest_annotated_frame = annotated
        latest_state = state
        latest_peg_xs = peg_xs
        latest_error = None
        latest_frame_time = time.time()

    return jsonify({
        "ok": True,
        "state": state,
        "pegXs": peg_xs,
        "espIp": esp_ip,
        "streamUrl": url,
        "timestamp": latest_frame_time,
    })


@app.route("/set-esp")
def set_esp():
    global esp_ip, stream_url, latest_error

    ip = request.args.get("ip", "").strip()
    if not ip:
        return jsonify({"ok": False, "error": "Missing ip parameter."}), 400

    ip = ip.replace("http://", "").replace("https://", "").strip("/")
    esp_ip = ip
    stream_url = f"http://{esp_ip}:81/stream"

    with state_lock:
        latest_error = f"ESP IP changed to {esp_ip}. Reconnecting..."

    return jsonify({
        "ok": True,
        "espIp": esp_ip,
        "streamUrl": stream_url,
    })


@app.route("/health")
def health():
    with state_lock:
        return jsonify({
            "ok": latest_error is None,
            "espIp": esp_ip,
            "streamUrl": stream_url,
            "hasFrame": latest_raw_frame is not None,
            "state": latest_state,
            "pegXs": latest_peg_xs,
            "error": latest_error,
            "lastFrameAgeSeconds": None if latest_frame_time is None else round(time.time() - latest_frame_time, 2),
        })


@app.route("/<path:path>")
def static_files(path: str):
    return send_from_directory(PROJECT_DIR, path)


def parse_args():
    parser = argparse.ArgumentParser(description="SCARAnoi OpenCV web bridge")
    parser.add_argument("--esp-ip", default=DEFAULT_ESP_IP,
                        help="ESP32 IP address on SPOT-iot, e.g. 172.21.76.162")
    parser.add_argument("--host", default="0.0.0.0",
                        help="Host for the web server. Default: 0.0.0.0")
    parser.add_argument("--port", type=int, default=5000,
                        help="Port for the web server. Default: 5000")
    return parser.parse_args()


def main() -> None:
    global esp_ip, stream_url

    args = parse_args()
    esp_ip = args.esp_ip.strip()
    stream_url = f"http://{esp_ip}:81/stream"

    thread = threading.Thread(target=camera_worker, daemon=True)
    thread.start()

    print("[SCARAnoi CV] ESP32 stream:", stream_url)
    print(f"[SCARAnoi CV] Open interface: http://localhost:{args.port}")
    print(f"[SCARAnoi CV] OpenCV stream: http://localhost:{args.port}/cv-stream")

    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
