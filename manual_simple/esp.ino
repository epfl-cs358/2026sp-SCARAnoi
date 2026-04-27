#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>

const char* ssid = "SCARAnoi";
const char* password = "12345678";

WebServer controlServer(80);

#define ARDUINO_RX_PIN 13   // ESP receives from Arduino TX2 pin 16
#define ARDUINO_TX_PIN 14   // ESP sends to Arduino RX2 pin 17
#define ARDUINO_BAUD 250000

HardwareSerial arduinoSerial(1);

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

  Serial.println();
  Serial.println("===== HTTP /send =====");
  Serial.print("Sending to Arduino: ");
  Serial.println(msg);

  arduinoSerial.println(msg);

  String response = "";
  unsigned long start = millis();

  // Read absolutely everything Arduino sends during 3 seconds
  while (millis() - start < 3000) {
    while (arduinoSerial.available()) {
      char c = arduinoSerial.read();
      response += c;
      Serial.write(c);
    }
  }

  if (response.length() == 0) {
    response = "(no data received from Arduino)";
  }

  Serial.println();
  Serial.println("===== END RESPONSE =====");

  controlServer.send(200, "text/plain", response);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("Booting ESP serial debug test...");

  arduinoSerial.begin(ARDUINO_BAUD, SERIAL_8N1, ARDUINO_RX_PIN, ARDUINO_TX_PIN);
  Serial.println("Arduino serial bridge started");

  WiFi.softAP(ssid, password);
  IPAddress ip = WiFi.softAPIP();

  Serial.println("Wi-Fi AP started");
  Serial.print("IP: ");
  Serial.println(ip);

  controlServer.on("/send", HTTP_GET, handleSend);
  controlServer.on("/send", HTTP_OPTIONS, handleOptions);

  controlServer.begin();

  Serial.println("Server ready");
  Serial.print("Test URL: http://");
  Serial.print(ip);
  Serial.println("/send?msg=M114");
}

void loop() {
  controlServer.handleClient();
}