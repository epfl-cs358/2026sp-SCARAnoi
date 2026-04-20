#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "SCARAnoi";
const char* password = "12345678";

WebServer server(80);

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

void handleOptions() {
  sendCorsHeaders();
  server.send(204);
}

void handleSend() {
  sendCorsHeaders();

  if (!server.hasArg("msg")) {
    server.send(400, "text/plain", "Missing msg");
    return;
  }

  String msg = server.arg("msg");

  Serial.print("Received message: ");
  Serial.println(msg);

  server.send(200, "text/plain", "ESP32 received: " + msg);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.softAP(ssid, password);

  Serial.println("Wi-Fi AP started");
  Serial.print("IP: ");
  Serial.println(WiFi.softAPIP());

  server.on("/send", HTTP_GET, handleSend);
  server.on("/send", HTTP_OPTIONS, handleOptions);
  server.begin();

  Serial.println("Server ready");
}

void loop() {
  server.handleClient();
}