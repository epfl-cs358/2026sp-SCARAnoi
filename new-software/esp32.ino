#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>

// Set to true only while debugging the camera stream.
// Keeping this false avoids slow Serial prints on every video frame.
#define STREAM_DEBUG false

// ================================================================
// ========================= NETWORK MODE ==========================
// ================================================================

// true  = ESP creates its own Wi-Fi network, like the old working code.
// false = ESP connects to your hotspot/router as a normal Wi-Fi client.
#define USE_SOFT_AP false

// SoftAP credentials, used when USE_SOFT_AP = true.
const char* AP_SSID = "SCARAnoi";
const char* AP_PASSWORD = "12345678";

// Station credentials, used when USE_SOFT_AP = false.
const char* STA_SSID = "SPOT-iot";
const char* STA_PASSWORD = "CurieuseAdjointFondante5449";

// ================================================================
// ========================= WEB SERVERS ===========================
// ================================================================

WebServer controlServer(80);
WiFiServer streamServer(81);

// ================================================================
// =================== Arduino serial bridge =======================
// ================================================================

#define ARDUINO_RX_PIN 13  // ESP RX: connect to Arduino Mega TX2 pin 16
#define ARDUINO_TX_PIN 14  // ESP TX: connect to Arduino Mega RX2 pin 17
#define ARDUINO_BAUD 250000
HardwareSerial arduinoSerial(2);

static const unsigned long COMMAND_TIMEOUT_MS = 120000;
static const unsigned long RESPONSE_SETTLE_MS = 80;

// ================================================================
// ================= ESP32-CAM AI Thinker pins =====================
// ================================================================

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ================================================================
// =========================== Helpers =============================
// ================================================================

void sendCorsHeaders() {
  controlServer.sendHeader("Access-Control-Allow-Origin", "*");
  controlServer.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  controlServer.sendHeader("Access-Control-Allow-Headers", "*");
}

void handleOptions() {
  sendCorsHeaders();
  controlServer.send(204);
}

String cleanCommandLine(String raw) {
  int semicolon = raw.indexOf(';');
  if (semicolon >= 0) raw = raw.substring(0, semicolon);

  raw.replace("\r", "");
  raw.trim();
  return raw;
}

bool isFirmwareOkLine(String line) {
  line.trim();
  line.toLowerCase();
  return line == "ok" || line.startsWith("ok ") || line.endsWith(" ok");
}

bool isFirmwareErrorLine(String line) {
  line.trim();
  line.toLowerCase();
  return line.startsWith("error") || line.startsWith("fatal");
}

bool lineContainsPositionReport(String line) {
  line.toUpperCase();
  return line.indexOf("X:") >= 0 && line.indexOf("Y:") >= 0;
}

bool queryValueLooksTrue(String value, bool defaultValue) {
  if (value.length() == 0) return defaultValue;
  value.trim();
  value.toLowerCase();
  return value == "1" || value == "true" || value == "yes" || value == "on" || value == "ok";
}

unsigned long queryTimeoutMs(unsigned long fallbackMs) {
  if (!controlServer.hasArg("timeout")) return fallbackMs;

  float seconds = controlServer.arg("timeout").toFloat();
  if (seconds <= 0.0f) return fallbackMs;

  unsigned long timeoutMs = (unsigned long)(seconds * 1000.0f);
  if (timeoutMs < 500) timeoutMs = 500;
  if (timeoutMs > 120000) timeoutMs = 120000;
  return timeoutMs;
}

static const int REPLY_OK = 0;
static const int REPLY_ERROR = 1;
static const int REPLY_TIMEOUT = 2;

String firmwareStatusName(int status) {
  if (status == REPLY_OK) return "ok";
  if (status == REPLY_ERROR) return "error";
  return "timeout";
}

int waitForArduinoOkCount(String &response, unsigned long timeoutMs, int targetOkCount) {
  String line = "";
  int okCount = 0;

  unsigned long start = millis();

  while (millis() - start < timeoutMs) {
    while (arduinoSerial.available()) {
      char c = arduinoSerial.read();
      response += c;
      Serial.write(c);

      if (c == '\n' || c == '\r') {
        String finishedLine = line;
        finishedLine.trim();

        if (finishedLine.length() > 0) {
          if (isFirmwareErrorLine(finishedLine)) {
            return REPLY_ERROR;
          }

          if (isFirmwareOkLine(finishedLine)) {
            okCount++;
            if (okCount >= targetOkCount) {
              // Give the firmware a tiny moment to flush any trailing text.
              unsigned long settleStart = millis();
              while (millis() - settleStart < RESPONSE_SETTLE_MS) {
                while (arduinoSerial.available()) {
                  char extra = arduinoSerial.read();
                  response += extra;
                  Serial.write(extra);
                  settleStart = millis();
                }
                delay(2);
              }
              return REPLY_OK;
            }
          }
        }

        line = "";
      } else {
        line += c;
      }
    }

    delay(2);
  }

  if (response.length() == 0) {
    response = "(no data received from Arduino)\n";
  }

  response += "\n(warning: timeout waiting for ";
  response += String(targetOkCount);
  response += " ok line(s) from Arduino)\n";
  return REPLY_TIMEOUT;
}

int waitForSingleArduinoReply(String &response, unsigned long timeoutMs, String waitFor) {
  String line = "";
  int status = REPLY_TIMEOUT;
  bool gotTerminalLine = false;
  bool sawPositionReport = false;

  unsigned long start = millis();
  unsigned long lastByte = millis();

  while (millis() - start < timeoutMs) {
    while (arduinoSerial.available()) {
      char c = arduinoSerial.read();
      response += c;
      Serial.write(c);
      lastByte = millis();

      if (c == '\n' || c == '\r') {
        String finishedLine = line;
        finishedLine.trim();

        if (finishedLine.length() > 0) {
          if (waitFor == "position" && lineContainsPositionReport(finishedLine)) {
            sawPositionReport = true;
          }

          if (isFirmwareErrorLine(finishedLine)) {
            status = REPLY_ERROR;
            gotTerminalLine = true;
          } else if (isFirmwareOkLine(finishedLine)) {
            if (waitFor == "position") {
              if (sawPositionReport) {
                status = REPLY_OK;
                gotTerminalLine = true;
              }
              // Ignore ok lines before the M114 position report.
            } else {
              status = REPLY_OK;
              gotTerminalLine = true;
            }
          }
        }

        line = "";
      } else {
        line += c;
      }
    }

    if (gotTerminalLine && millis() - lastByte > RESPONSE_SETTLE_MS) {
      return status;
    }

    delay(2);
  }

  if (line.length() > 0) {
    line.trim();
    if (waitFor == "position" && lineContainsPositionReport(line)) sawPositionReport = true;
    if (isFirmwareErrorLine(line)) return REPLY_ERROR;
    if (isFirmwareOkLine(line) && (waitFor != "position" || sawPositionReport)) return REPLY_OK;
  }

  if (response.length() == 0) {
    response = "(no data received from Arduino)\n";
  }

  if (waitFor == "position") {
    response += "\n(warning: timeout waiting for M114 position report + ok from Arduino)\n";
  } else {
    response += "\n(warning: timeout waiting for ok/error from Arduino)\n";
  }
  return REPLY_TIMEOUT;
}

// Write a full binary buffer to a WiFiClient.
// This version avoids Serial spam and sends data in TCP-friendly chunks.
bool writeClientFully(
  WiFiClient &client,
  const uint8_t *buf,
  size_t len,
  const char *label,
  unsigned long stallTimeoutMs = 2000
) {
  size_t sent = 0;
  unsigned long lastProgress = millis();

  while (sent < len && client.connected()) {
    size_t remaining = len - sent;

    // 1460 bytes is close to one TCP payload on Wi-Fi.
    // It is faster than tiny chunks, but safer than one huge write.
    size_t chunkSize = remaining > 1460 ? 1460 : remaining;

    size_t written = client.write(buf + sent, chunkSize);

    if (written > 0) {
      sent += written;
      lastProgress = millis();
    } else {
      delay(1);

      if (millis() - lastProgress > stallTimeoutMs) {
        if (STREAM_DEBUG) {
          Serial.printf("[%s] stalled at %u/%u bytes\n", label, sent, len);
        }
        return false;
      }
    }

    yield();
  }

  if (STREAM_DEBUG) {
    if (sent == len) {
      Serial.printf("[%s] sent %u/%u bytes\n", label, sent, len);
    } else {
      Serial.printf("[%s] disconnected at %u/%u bytes\n", label, sent, len);
    }
  }

  return sent == len;
}

// ================================================================
// ========================== /status ==============================
// ================================================================

String currentBaseUrl() {
  IPAddress ip = USE_SOFT_AP ? WiFi.softAPIP() : WiFi.localIP();
  return String("http://") + ip.toString();
}

void handleStatus() {
  sendCorsHeaders();

  IPAddress ip = USE_SOFT_AP ? WiFi.softAPIP() : WiFi.localIP();

  String body = "SCARAnoi ESP32-CAM bridge\n";
  body += "Mode: ";
  body += USE_SOFT_AP ? "SoftAP\n" : "Station\n";
  body += "IP: " + ip.toString() + "\n";

  if (!USE_SOFT_AP) {
    body += "RSSI: " + String(WiFi.RSSI()) + " dBm\n";
  }

  body += "Control: http://" + ip.toString() + "/send?msg=M114\n";
  body += "Capture: http://" + ip.toString() + "/capture\n";
  body += "Stream: http://" + ip.toString() + ":81/stream\n";

  controlServer.send(200, "text/plain", body);
}

// ================================================================
// ============================ /send ==============================
// ================================================================

void handleSend() {
  sendCorsHeaders();

  if (!controlServer.hasArg("msg")) {
    controlServer.send(400, "text/plain", "missing msg");
    return;
  }

  String msg = controlServer.arg("msg");
  msg.replace("\r\n", "\n");
  msg.replace("\r", "\n");

  if (cleanCommandLine(msg).length() == 0 && msg.indexOf('\n') < 0) {
    controlServer.send(400, "text/plain", "empty msg");
    return;
  }

  bool waitForOk = true;
  if (controlServer.hasArg("wait")) {
    waitForOk = queryValueLooksTrue(controlServer.arg("wait"), true);
  }

  String waitFor = "ok";
  if (controlServer.hasArg("wait_for")) {
    waitFor = controlServer.arg("wait_for");
    waitFor.trim();
    waitFor.toLowerCase();
    if (waitFor != "ok" && waitFor != "position" && waitFor != "ok_count") waitFor = "ok";
  }

  int requestedOkCount = 1;
  if (controlServer.hasArg("ok_count")) {
    requestedOkCount = controlServer.arg("ok_count").toInt();
    if (requestedOkCount < 1) requestedOkCount = 1;
    if (requestedOkCount > 10) requestedOkCount = 10;
  }

  unsigned long timeoutMs = queryTimeoutMs(COMMAND_TIMEOUT_MS);

  // Clear old noise before starting a new HTTP command block.
  while (arduinoSerial.available()) arduinoSerial.read();

  Serial.println("\n===== HTTP /send =====");
  Serial.print("wait=");
  Serial.print(waitForOk ? "1" : "0");
  Serial.print(" wait_for=");
  Serial.print(waitFor);
  if (waitFor == "ok_count") {
    Serial.print(" ok_count=");
    Serial.print(requestedOkCount);
  }
  Serial.print(" timeout_ms=");
  Serial.println(timeoutMs);
  Serial.println("Received command block:");
  Serial.println(msg);

  String fullResponse = "";
  int sentLines = 0;

  String lines[32];
  int lineCount = 0;

  int start = 0;
  while (start <= msg.length() && lineCount < 32) {
    int newline = msg.indexOf('\n', start);
    String rawLine;

    if (newline < 0) {
      rawLine = msg.substring(start);
      start = msg.length() + 1;
    } else {
      rawLine = msg.substring(start, newline);
      start = newline + 1;
    }

    String line = cleanCommandLine(rawLine);
    if (line.length() == 0) continue;
    lines[lineCount++] = line;
  }

  if (lineCount == 0) {
    controlServer.send(400, "text/plain", "empty command block after removing comments");
    return;
  }

  if (waitForOk && waitFor == "ok_count") {
    // Used for firmware macros such as START that print several ok lines.
    // Send exactly one command line, then wait until the requested number of
    // ok lines has been seen. This prevents the UI from sending M114 while the
    // macro is still executing.
    if (lineCount != 1) {
      controlServer.send(400, "text/plain", "wait_for=ok_count expects exactly one command line");
      return;
    }

    sentLines++;
    String line = lines[0];

    Serial.print("\n>>> Arduino line ");
    Serial.print(sentLines);
    Serial.print(": ");
    Serial.println(line);

    fullResponse += ">>> ";
    fullResponse += line;
    fullResponse += "\n";

    arduinoSerial.print(line);
    arduinoSerial.print('\n');
    arduinoSerial.flush();

    String lineResponse = "";
    int status = waitForArduinoOkCount(lineResponse, timeoutMs, requestedOkCount);
    fullResponse += lineResponse;
    if (!fullResponse.endsWith("\n")) fullResponse += "\n";
    fullResponse += "<<< ";
    fullResponse += firmwareStatusName(status);
    fullResponse += "\n";
  } else if (waitForOk && waitFor == "position") {
    // Used by the UI for M400\nM114. Write the full block first, then ignore
    // any ok before the actual M114 position report appears.
    for (int i = 0; i < lineCount; i++) {
      sentLines++;
      String line = lines[i];

      Serial.print("\n>>> Arduino line ");
      Serial.print(sentLines);
      Serial.print(": ");
      Serial.println(line);

      fullResponse += ">>> ";
      fullResponse += line;
      fullResponse += "\n";

      arduinoSerial.print(line);
      arduinoSerial.print('\n');
      arduinoSerial.flush();
      delay(30);
    }

    String lineResponse = "";
    int status = waitForSingleArduinoReply(lineResponse, timeoutMs, "position");
    fullResponse += lineResponse;
    if (!fullResponse.endsWith("\n")) fullResponse += "\n";
    fullResponse += "<<< ";
    fullResponse += firmwareStatusName(status);
    fullResponse += "\n";
  } else {
    for (int i = 0; i < lineCount; i++) {
      sentLines++;
      String line = lines[i];

      Serial.print("\n>>> Arduino line ");
      Serial.print(sentLines);
      Serial.print(": ");
      Serial.println(line);

      fullResponse += ">>> ";
      fullResponse += line;
      fullResponse += "\n";

      arduinoSerial.print(line);
      arduinoSerial.print('\n');
      arduinoSerial.flush();

      if (waitForOk) {
        String lineResponse = "";
        int status = waitForSingleArduinoReply(lineResponse, timeoutMs, "ok");
        fullResponse += lineResponse;
        if (!fullResponse.endsWith("\n")) fullResponse += "\n";

        fullResponse += "<<< ";
        fullResponse += firmwareStatusName(status);
        fullResponse += "\n";

        if (status != REPLY_OK) {
          fullResponse += "(stopped: not sending remaining lines after ";
          fullResponse += firmwareStatusName(status);
          fullResponse += ")\n";
          break;
        }
      } else {
        delay(30);
      }
    }

    if (!waitForOk) {
      fullResponse += "<<< sent without waiting for ok\n";
    }
  }

  Serial.println("\n===== END RESPONSE =====");
  controlServer.send(200, "text/plain", fullResponse);
}

// ================================================================
// =========================== /capture ============================
// ================================================================

void handleCapture() {
  if (STREAM_DEBUG) Serial.println("[CAPTURE] Requesting single frame...");
  camera_fb_t *fb = esp_camera_fb_get();

  if (!fb) {
    Serial.println("[CAPTURE] Camera capture failed");
    sendCorsHeaders();
    controlServer.send(503, "text/plain", "camera capture failed");
    return;
  }

  if (STREAM_DEBUG) {
    Serial.printf("[CAPTURE] Got frame, size=%u bytes\n", fb->len);
  }

  WiFiClient client = controlServer.client();
  client.setNoDelay(true);

  client.print("HTTP/1.1 200 OK\r\n");
  client.print("Content-Type: image/jpeg\r\n");
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Cache-Control: no-store, no-cache, must-revalidate, max-age=0\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Length: ");
  client.print(fb->len);
  client.print("\r\n\r\n");

  writeClientFully(client, fb->buf, fb->len, "CAPTURE");

  esp_camera_fb_return(fb);
  client.stop();
}

// ================================================================
// ======================= Old style stream ========================
// ================================================================

void handleStreamClient(WiFiClient client) {
  client.setNoDelay(true);

  String request = client.readStringUntil('\r');
  client.readStringUntil('\n');

  if (STREAM_DEBUG) {
    Serial.print("[STREAM] Request: ");
    Serial.println(request);
  }

  if (request.indexOf("GET /stream") < 0) {
    client.println("HTTP/1.1 404 Not Found");
    client.println("Content-Type: text/plain");
    client.println("Connection: close");
    client.println();
    client.println("Not found");
    client.stop();
    return;
  }

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Cache-Control: no-cache");
  client.println("Connection: close");
  client.println();

  unsigned long frameCount = 0;

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();

    if (!fb) {
      if (STREAM_DEBUG) Serial.println("[STREAM] Camera capture failed during stream");
      break;
    }

    frameCount++;

    if (STREAM_DEBUG && frameCount % 30 == 1) {
      Serial.printf("[STREAM] Frame %lu, size=%u bytes\n", frameCount, fb->len);
    }

    client.println("--frame");
    client.println("Content-Type: image/jpeg");
    client.print("Content-Length: ");
    client.println(fb->len);
    client.println();

    bool ok = writeClientFully(client, fb->buf, fb->len, "STREAM");

    client.println();
    esp_camera_fb_return(fb);

    if (!ok || !client.connected()) {
      break;
    }

    // Small delay gives Wi-Fi/control server time without killing FPS.
    delay(5);
  }

  client.stop();

  if (STREAM_DEBUG) {
    Serial.printf("[STREAM] Client disconnected after %lu frame(s)\n", frameCount);
  }
}

void streamTask(void *parameter) {
  while (true) {
    WiFiClient streamClient = streamServer.available();

    if (streamClient) {
      if (STREAM_DEBUG) Serial.println("[STREAM] Client connected");
      handleStreamClient(streamClient);
    }

    delay(2);
  }
}

// ================================================================
// ========================= Camera setup ==========================
// ================================================================

bool initCamera() {
  camera_config_t config;

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;

  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Old working camera settings.
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);

  if (err != ESP_OK) {
    Serial.print("Camera init failed with error 0x");
    Serial.println(err, HEX);
    return false;
  }

  Serial.println("Camera initialized successfully");

  sensor_t *s = esp_camera_sensor_get();

  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_framesize(s, psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA);
  }

  return true;
}

// ================================================================
// ============================== Setup ============================
// ================================================================

void setup() {
  Serial.begin(250000);
  delay(1000);

  Serial.println();
  Serial.println("Booting SCARAnoi ESP32-CAM bridge...");

  arduinoSerial.begin(ARDUINO_BAUD, SERIAL_8N1, ARDUINO_RX_PIN, ARDUINO_TX_PIN);
  Serial.println("Arduino serial bridge started");

  if (!initCamera()) {
    Serial.println("Camera setup failed");
    while (true) {
      delay(1000);
    }
  }

  if (USE_SOFT_AP) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);

    IPAddress ip = WiFi.softAPIP();

    Serial.println("Wi-Fi SoftAP started");
    Serial.print("SSID: ");
    Serial.println(AP_SSID);
    Serial.print("IP: ");
    Serial.println(ip);
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(STA_SSID, STA_PASSWORD);

    Serial.print("Connecting to Wi-Fi");
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }

    IPAddress ip = WiFi.localIP();

    Serial.println();
    Serial.println("Wi-Fi connected");
    Serial.print("IP: ");
    Serial.println(ip);
    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }

  IPAddress ip = USE_SOFT_AP ? WiFi.softAPIP() : WiFi.localIP();

  controlServer.on("/",        HTTP_GET,     handleStatus);
  controlServer.on("/status",  HTTP_GET,     handleStatus);
  controlServer.on("/send",    HTTP_GET,     handleSend);
  controlServer.on("/send",    HTTP_OPTIONS, handleOptions);
  controlServer.on("/capture", HTTP_GET,     handleCapture);
  controlServer.on("/capture", HTTP_OPTIONS, handleOptions);

  controlServer.begin();
  streamServer.begin();

  xTaskCreatePinnedToCore(
    streamTask,
    "Stream Task",
    8192,
    NULL,
    1,
    NULL,
    0
  );

  Serial.println();
  Serial.println("--- SERVERS READY ---");
  Serial.printf("Control : http://%s/send?msg=M114\n", ip.toString().c_str());
  Serial.printf("Status  : http://%s/status\n",        ip.toString().c_str());
  Serial.printf("Capture : http://%s/capture\n",       ip.toString().c_str());
  Serial.printf("Stream  : http://%s:81/stream\n",     ip.toString().c_str());
}

// ================================================================
// =============================== Loop ============================
// ================================================================

void loop() {
  controlServer.handleClient();
  delay(2);
}