// OLED on the Mega: its I2C pins are SDA 20 and SCL 21 (not A4 and A5 as on the Uno).
// Shows the reading of A0 as a number and a bar.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 not found on pins 20 and 21"));
    for (;;) {
    }
  }
}

void loop() {
  int reading = analogRead(A0);
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("Mega 2560  A0"));
  display.setTextSize(3);
  display.setCursor(0, 16);
  display.print(reading);
  display.drawRect(0, 48, 128, 12, SSD1306_WHITE);
  display.fillRect(2, 50, map(reading, 0, 1023, 0, 124), 8, SSD1306_WHITE);
  display.display();
  delay(50);
}
