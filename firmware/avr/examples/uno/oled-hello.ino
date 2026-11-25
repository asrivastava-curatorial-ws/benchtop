// OLED display: text, a counter and a bouncing ball on a 128x64 SSD1306 (I2C address 0x3C, SDA on A4, SCL on A5).
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

int x = 64, y = 40, dx = 3, dy = 2;
unsigned long frames = 0;

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 not found: check SDA, SCL, VCC and GND"));
    for (;;) {
    }
  }
  Serial.println(F("OLED ready"));
}

void loop() {
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(4, 0);
  display.print(F("Benchtop"));
  display.setTextSize(1);
  display.setCursor(4, 20);
  display.print(F("Frame "));
  display.print(frames++);
  display.drawRect(0, 30, 128, 34, SSD1306_WHITE);
  display.fillCircle(x, y, 4, SSD1306_WHITE);
  display.display();
  x += dx;
  y += dy;
  if (x < 6 || x > 121) dx = -dx;
  if (y < 36 || y > 57) dy = -dy;
  delay(30);
}
