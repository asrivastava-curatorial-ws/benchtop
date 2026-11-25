// Raspberry Pi Pico: an SSD1306 OLED on I2C0 (SDA GP20, SCL GP21) shows the reading of the potentiometer on GP26 as a bar.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  Wire.setSDA(20);
  Wire.setSCL(21);
  Wire.setClock(400000);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 not found: check SDA (GP20), SCL (GP21), VCC and GND");
    for (;;) delay(1000);
  }
  Serial.println("OLED ready");
}

void loop() {
  int reading = analogRead(A0);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(4, 0);
  display.print("Pico");
  display.setTextSize(1);
  display.setCursor(4, 22);
  display.print("A0 = ");
  display.print(reading);
  display.drawRect(0, 40, 128, 16, SSD1306_WHITE);
  display.fillRect(2, 42, (long)reading * 124 / 1023, 12, SSD1306_WHITE);
  display.display();
  delay(50);
}
