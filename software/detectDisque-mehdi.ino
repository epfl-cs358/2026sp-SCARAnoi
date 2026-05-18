#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include "esp_http_server.h"

// --- Configuration du WiFi ---
const char* ssid = "SPOT-iot"; 
const char* password = "CurieuseAdjointFondante5449";
WebServer controlServer(80);

// --- Configuration du Serial Arduino ---
#define ARDUINO_RX_PIN 13   
#define ARDUINO_TX_PIN 14   
#define ARDUINO_BAUD 250000
HardwareSerial arduinoSerial(1);

// --- Configuration des broches de la Caméra (AI-Thinker) ---
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

// Variables flux MJPEG
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";
httpd_handle_t stream_httpd = NULL;

// --- Serveur de Contrôle (Port 80) ---
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
    controlServer.send(400, "text/plain", "missing msg");
    return;
  }
  String msg = controlServer.arg("msg");
  msg.trim();
  Serial.println("\n===== HTTP /send =====");
  Serial.print("Sending to Arduino: ");
  Serial.println(msg);
  arduinoSerial.println(msg);
  String response = "";
  unsigned long start = millis();
  while (millis() - start < 3000) {
    while (arduinoSerial.available()) {
      char c = arduinoSerial.read();
      response += c;
      Serial.write(c);
    }
  }
  if (response.length() == 0) response = "(no data received from Arduino)";
  Serial.println("\n===== END RESPONSE =====");
  controlServer.send(200, "text/plain", response);
}

// --- Serveur Vidéo (Port 81) ---
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[64];

  // Headers CORS pour permettre l'accès cross-origin
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  
  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Camera capture failed");
      res = ESP_FAIL;
      break;
    }

    // 1. Boundary
    res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

    // 2. Header de la partie
    size_t hlen = snprintf(part_buf, 64, _STREAM_PART, fb->len);
    res = httpd_resp_send_chunk(req, part_buf, hlen);
    if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

    // 3. Données JPEG
    res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  // ✅ FIX : ctrl_port doit être DIFFÉRENT de server_port
  config.ctrl_port = 32768;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("Stream server started on port 81");
  } else {
    Serial.println("Failed to start stream server!");
  }
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\nBooting SCARAnoi ESP32-CAM...");

  arduinoSerial.begin(ARDUINO_BAUD, SERIAL_8N1, ARDUINO_RX_PIN, ARDUINO_TX_PIN);
  Serial.println("Arduino serial bridge started");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;
  config.jpeg_quality = 10;
  config.fb_count     = 2;  // ✅ 2 buffers pour fluidité

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
  } else {
    Serial.println("Camera initialized successfully");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connexion au Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  IPAddress ip = WiFi.localIP();
  Serial.println("\nWi-Fi Connecté !");
  Serial.print("IP : ");
  Serial.println(ip);

  controlServer.on("/send",    HTTP_GET,     handleSend);
  controlServer.on("/send",    HTTP_OPTIONS, handleOptions);
  controlServer.begin();

  if (err == ESP_OK) {
    startCameraServer();
  }

  Serial.println("\n--- SERVEURS PRETS ---");
  Serial.printf("Contrôle : http://%s/send?msg=M114\n", ip.toString().c_str());
  Serial.printf("Stream   : http://%s:81/stream\n",     ip.toString().c_str());
}

void loop() {
  controlServer.handleClient();
}
