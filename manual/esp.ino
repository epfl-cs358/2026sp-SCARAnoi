#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "SCARAnoi";
const char* password = "12345678";

WebServer controlServer(80);

WiFiServer streamServer(81);

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

void sendCorsHeaders() {
  controlServer.sendHeader("Access-Control-Allow-Origin", "*");
  controlServer.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  controlServer.sendHeader("Access-Control-Allow-Headers", "*");
}

void handleOptions() {
  sendCorsHeaders();
  controlServer.send(204);
}

void handleSend() {
  sendCorsHeaders();

  if (!controlServer.hasArg("msg")) {
    controlServer.send(400, "text/plain", "Missing msg");
    return;
  }

  String msg = controlServer.arg("msg");

  Serial.print("Received message: ");
  Serial.println(msg);

  controlServer.send(200, "text/plain", "ESP32 received: " + msg);
}

void handleCapture() {
  WiFiClient client = controlServer.client();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    controlServer.send(500, "text/plain", "Camera capture failed");
    return;
  }

  controlServer.sendHeader("Access-Control-Allow-Origin", "*");
  controlServer.setContentLength(fb->len);
  controlServer.send(200, "image/jpeg", "");

  WiFiClient responseClient = controlServer.client();
  responseClient.write(fb->buf, fb->len);

  esp_camera_fb_return(fb);
}


void handleStreamClient(WiFiClient client) {
  String request = client.readStringUntil('\r');
  client.readStringUntil('\n');

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

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Camera capture failed during stream");
      break;
    }

    client.println("--frame");
    client.println("Content-Type: image/jpeg");
    client.print("Content-Length: ");
    client.println(fb->len);
    client.println();

    client.write(fb->buf, fb->len);
    client.println();

    esp_camera_fb_return(fb);

    if (!client.connected()) {
      break;
    }

    delay(30);
  }

  client.stop();
  Serial.println("Stream client disconnected");
}

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

  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 15;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.print("Camera init failed with error 0x");
    Serial.println(err, HEX);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_framesize(s, psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA);
  }

  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("Booting...");

  if (!initCamera()) {
    Serial.println("Camera setup failed");
    while (true) {
      delay(1000);
    }
  }

  WiFi.softAP(ssid, password);
  IPAddress ip = WiFi.softAPIP();

  Serial.println("Wi-Fi AP started");
  Serial.print("Control IP: ");
  Serial.println(ip);
  Serial.print("Control endpoint: http://");
  Serial.print(ip);
  Serial.println("/send?msg=G28");

  Serial.print("Still image: http://");
  Serial.print(ip);
  Serial.println(":81/capture");

  Serial.print("Stream: http://");
  Serial.print(ip);
  Serial.println(":81/stream");

  controlServer.on("/send", HTTP_GET, handleSend);
  controlServer.on("/send", HTTP_OPTIONS, handleOptions);
  controlServer.on("/capture", HTTP_GET, handleCapture);
  controlServer.begin();

  streamServer.begin();

  Serial.println("Servers ready");
}


void loop() {
  controlServer.handleClient();

  WiFiClient streamClient = streamServer.available();
  if (streamClient) {
    Serial.println("Stream client connected");
    handleStreamClient(streamClient);
  }
}