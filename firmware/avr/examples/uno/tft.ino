// ILI9341 colour TFT (240x320) on hardware SPI: CS on 10, D/C on 9, MOSI 11, SCK 13.
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>

Adafruit_ILI9341 tft(10, 9);

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(ILI9341_YELLOW);
  tft.setTextSize(3);
  tft.setCursor(30, 12);
  tft.print("Benchtop");
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(30, 44);
  tft.print("ILI9341 240 x 320, 16-bit colour");
  // Colour bars.
  const uint16_t colours[] = {ILI9341_RED, ILI9341_ORANGE, ILI9341_YELLOW, ILI9341_GREEN, ILI9341_CYAN, ILI9341_BLUE, ILI9341_MAGENTA, ILI9341_WHITE};
  for (int i = 0; i < 8; i++) tft.fillRect(i * 30, 64, 30, 40, colours[i]);
  tft.drawCircle(70, 170, 40, ILI9341_GREEN);
  tft.fillCircle(70, 170, 20, ILI9341_GREEN);
  tft.fillTriangle(140, 210, 220, 210, 180, 130, ILI9341_CYAN);
  tft.drawRoundRect(10, 230, 220, 70, 10, ILI9341_WHITE);
  Serial.println(F("Drawn"));
}

void loop() {
  // Seconds running, written over the old number with a background colour.
  tft.setTextSize(4);
  tft.setTextColor(ILI9341_WHITE, ILI9341_NAVY);
  tft.setCursor(30, 248);
  tft.print(millis() / 1000);
  tft.print(" s ");
  delay(500);
}
