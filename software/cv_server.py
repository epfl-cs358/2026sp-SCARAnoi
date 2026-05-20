"""
SCARAnoi OpenCV bridge

This server is now mainly the camera/CV side of the interface:

    ESP32-CAM raw stream  ->  Python OpenCV detection  ->  annotated stream in browser

Robot commands are normally sent by the browser directly to the ESP32 /send
endpoint, then the ESP32 forwards them to the Arduino over UART. The old
computer-to-Arduino USB /send route is left as a fallback, but it is not opened
at startup anymore.

Run it from the project folder:

    python cv_server.py --esp-ip 172.21.76.162

Then open:

    http://localhost:5000
"""

from __future__ import annotations

import argparse
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

try:
    import serial
except ImportError:  # handled at runtime with a clear error
    serial = None

from flask import Flask, Response, jsonify, request, send_from_directory

from detectDisque import analyze

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_ESP_IP = os.environ.get("SCARANOI_ESP_IP", "172.21.76.162")
DEFAULT_ARDUINO_PORT = os.environ.get("SCARANOI_ARDUINO_PORT", "/dev/ttyUSB0")
DEFAULT_ARDUINO_BAUD = int(os.environ.get("SCARANOI_ARDUINO_BAUD", "250000"))


app = Flask(__name__, static_folder=str(PROJECT_DIR))

state_lock = threading.Lock()

esp_ip = DEFAULT_ESP_IP
stream_url = f"http://{esp_ip}:81/stream"

arduino_port = DEFAULT_ARDUINO_PORT
arduino_baud = DEFAULT_ARDUINO_BAUD
arduino_serial = None
arduino_lock = threading.Lock()


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


def clean_command_line(raw: str) -> str:
    # Match the ESP bridge behavior: ignore comments after ';'
    # and do not send empty/comment-only lines to the firmware.
    line = raw.split(";", 1)[0].replace("\r", "").strip()
    return line


def firmware_status_from_line(line: str) -> str | None:
    cleaned = line.strip().lower()

    # Accept the normal Marlin-style "ok", but also tolerate bridge-ish lines
    # such as "<<< ok" or "ok T:..." when wait=1 is explicitly requested.
    if re.search(r"(^|[<\s])ok($|\s)", cleaned):
        return "ok"

    if cleaned.startswith("error") or cleaned.startswith("fatal"):
        return "error"
    return None


def open_arduino_serial():
    global arduino_serial

    if serial is None:
        raise RuntimeError(
            "pyserial is not installed. Install it with: pip install pyserial"
        )

    if arduino_serial is not None and arduino_serial.is_open:
        return arduino_serial

    arduino_serial = serial.Serial(
        arduino_port,
        arduino_baud,
        timeout=0.05,
        write_timeout=2.0,
    )

    # Opening the Arduino USB serial port can reset the Mega.
    # Give the firmware a short moment to boot, then clear startup text.
    time.sleep(2.0)
    arduino_serial.reset_input_buffer()
    arduino_serial.reset_output_buffer()
    return arduino_serial


def line_contains_position_report(line: str) -> bool:
    return bool(re.search(r"\bX:\s*-?\d+(?:\.\d+)?\s+\bY:\s*-?\d+(?:\.\d+)?", line, re.IGNORECASE))


def wait_for_single_arduino_reply(
    ser,
    timeout_s: float = 2.0,
    *,
    wait_for: str = "ok",
) -> tuple[str, str]:
    """Read Arduino output until the requested terminal condition is reached.

    wait_for="ok":
        Stop on the first standalone ok/error.

    wait_for="position":
        Ignore earlier ok lines and stop only after an M114-style position
        report has been seen and then followed by ok. This is important after
        fire-and-forget motion commands, because old ok lines from queued moves
        may still arrive before the M114 response.
    """
    response_parts: list[str] = []
    line_bytes = bytearray()
    deadline = time.time() + timeout_s
    terminal_status = "timeout"
    saw_position = False

    while time.time() < deadline:
        chunk = ser.read(1)
        if not chunk:
            continue

        c = chunk[0]
        if c in (10, 13):  # LF or CR
            if not line_bytes:
                continue

            line = line_bytes.decode(errors="replace").strip()
            line_bytes.clear()
            if not line:
                continue

            response_parts.append(line + "\n")

            if wait_for == "position" and line_contains_position_report(line):
                saw_position = True

            status = firmware_status_from_line(line)

            if status == "error":
                terminal_status = "error"
                break

            if status == "ok":
                if wait_for == "position":
                    if saw_position:
                        terminal_status = "ok"
                        break
                    # Ignore ok lines from older queued movement commands.
                    continue

                terminal_status = "ok"
                break
        else:
            line_bytes.append(c)

    if line_bytes:
        line = line_bytes.decode(errors="replace").strip()
        if line:
            response_parts.append(line + "\n")
            if wait_for == "position" and line_contains_position_report(line):
                saw_position = True
            status = firmware_status_from_line(line)
            if status == "ok" and (wait_for != "position" or saw_position):
                terminal_status = "ok"
            elif status == "error":
                terminal_status = "error"

    response = "".join(response_parts)
    if not response:
        response = "(no data received from Arduino)\n"

    if terminal_status == "timeout":
        if wait_for == "position":
            response += "\n(warning: timeout waiting for M114 position report + ok from Arduino)\n"
        else:
            response += "\n(warning: timeout waiting for ok/error from Arduino)\n"

    return terminal_status, response

def is_truthy_query_value(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on", "ok"}


def send_command_block_to_arduino(
    msg: str,
    *,
    wait_for_ok: bool = False,
    wait_for: str = "ok",
    timeout_s: float = 2.0,
    inter_line_delay_s: float = 0.03,
) -> tuple[str, int]:
    msg = msg.replace("\r\n", "\n").replace("\r", "\n")
    lines = [clean_command_line(raw) for raw in msg.split("\n")]
    lines = [line for line in lines if line]

    if not lines:
        return "empty command block after removing comments\n", 400

    t0 = time.perf_counter()

    # Fire-and-forget commands should not sit silently behind an old blocking request.
    # If the bridge is busy, return immediately so the UI/user knows nothing was sent.
    lock_timeout_s = max(0.05, min(timeout_s + 0.5, 5.0)) if wait_for_ok else 0.25
    acquired = arduino_lock.acquire(timeout=lock_timeout_s)
    lock_ms = round((time.perf_counter() - t0) * 1000)

    if not acquired:
        return (
            f"error: Arduino serial bridge is busy with a previous command.\n"
            f"Nothing was sent to Arduino.\n"
            f"; bridge_wait_ms={lock_ms}\n",
            409,
        )

    try:
        ser = open_arduino_serial()

        # For wait commands, clear stale old responses before starting.
        # For fire-and-forget commands, do not wait: just push the whole block to serial.
        if wait_for_ok:
            ser.reset_input_buffer()

        full_response = [f"; bridge_wait_ms={lock_ms}\n"]

        if wait_for_ok and wait_for == "position":
            # Special sync mode used for "M400\nM114".
            # Write the whole block first, then ignore all old ok lines until an M114
            # position report appears. This prevents an old ok from a queued move from
            # being mistaken for the M400/M114 completion.
            for line in lines:
                write_start = time.perf_counter()
                full_response.append(f">>> {line}\n")
                ser.write((line + "\n").encode("utf-8"))
                ser.flush()
                write_ms = round((time.perf_counter() - write_start) * 1000)
                full_response.append(f"; serial_write_ms={write_ms}\n")
                if inter_line_delay_s > 0:
                    time.sleep(inter_line_delay_s)

            status, line_response = wait_for_single_arduino_reply(
                ser,
                timeout_s=timeout_s,
                wait_for="position",
            )
            full_response.append(line_response)
            if not full_response[-1].endswith("\n"):
                full_response.append("\n")
            full_response.append(f"<<< {status}\n")
        else:
            for line in lines:
                write_start = time.perf_counter()
                full_response.append(f">>> {line}\n")

                ser.write((line + "\n").encode("utf-8"))
                ser.flush()

                write_ms = round((time.perf_counter() - write_start) * 1000)
                full_response.append(f"; serial_write_ms={write_ms}\n")

                if wait_for_ok:
                    status, line_response = wait_for_single_arduino_reply(
                        ser,
                        timeout_s=timeout_s,
                        wait_for="ok",
                    )
                    full_response.append(line_response)
                    if not full_response[-1].endswith("\n"):
                        full_response.append("\n")

                    full_response.append(f"<<< {status}\n")

                    if status != "ok":
                        full_response.append(
                            f"(stopped: not sending remaining lines after {status})\n"
                        )
                        break
                else:
                    # Very small gap so the USB/serial buffers are not hammered, but still immediate.
                    if inter_line_delay_s > 0:
                        time.sleep(inter_line_delay_s)

        total_ms = round((time.perf_counter() - t0) * 1000)
        if not wait_for_ok:
            full_response.append("<<< sent without waiting for ok\n")
        full_response.append(f"; total_bridge_ms={total_ms}\n")

        return "".join(full_response), 200
    finally:
        arduino_lock.release()


@app.route("/send", methods=["GET", "OPTIONS"])
def send_to_arduino():
    if request.method == "OPTIONS":
        return "", 204

    msg = request.args.get("msg", "")
    if not msg:
        return "missing msg", 400

    wait_for_ok = is_truthy_query_value(request.args.get("wait"), default=False)
    wait_for = request.args.get("wait_for", "ok").strip().lower()
    if wait_for not in {"ok", "position"}:
        wait_for = "ok"

    try:
        timeout_s = float(request.args.get("timeout", "2.0"))
    except ValueError:
        timeout_s = 2.0

    try:
        response_text, status_code = send_command_block_to_arduino(
            msg,
            wait_for_ok=wait_for_ok,
            wait_for=wait_for,
            timeout_s=timeout_s,
        )
        # Keep 200 for firmware errors/timeouts so the UI can display the text.
        return Response(response_text, status=status_code, mimetype="text/plain")
    except Exception as exc:
        return Response(
            f"error: Arduino USB bridge failed: {exc}\n"
            f"port={arduino_port}, baud={arduino_baud}\n",
            status=500,
            mimetype="text/plain",
        )



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
            "arduinoPort": arduino_port,
            "arduinoBaud": arduino_baud,
            "arduinoSerialOpen": arduino_serial is not None and arduino_serial.is_open,
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
    parser.add_argument("--arduino-port", default=DEFAULT_ARDUINO_PORT,
                        help="Arduino USB serial port, e.g. /dev/ttyACM0 or COM5")
    parser.add_argument("--arduino-baud", type=int, default=DEFAULT_ARDUINO_BAUD,
                        help="Arduino firmware baud rate. Default: 250000")
    return parser.parse_args()


def main() -> None:
    global esp_ip, stream_url, arduino_port, arduino_baud

    args = parse_args()
    esp_ip = args.esp_ip.strip()
    stream_url = f"http://{esp_ip}:81/stream"
    arduino_port = args.arduino_port.strip()
    arduino_baud = args.arduino_baud

    thread = threading.Thread(target=camera_worker, daemon=True)
    thread.start()

    print("[SCARAnoi CV] ESP32 stream:", stream_url)
    print(f"[SCARAnoi CV] Open interface: http://localhost:{args.port}")
    print(f"[SCARAnoi CV] OpenCV stream: http://localhost:{args.port}/cv-stream")
    print(f"[SCARAnoi CV] Robot commands: browser -> ESP32 http://{esp_ip}/send -> Arduino UART")
    print("[SCARAnoi CV] USB /send route is only a fallback and is not opened at startup.")

    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()