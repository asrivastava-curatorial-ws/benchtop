/* A subset of the Adafruit ILI9341 library's interface: the 240×320 colour TFT on hardware SPI.  SPDX-License-Identifier: MIT */
#pragma once
#include <Adafruit_GFX.h>
#include <SPI.h>

#define ILI9341_TFTWIDTH 240
#define ILI9341_TFTHEIGHT 320
#define ILI9341_BLACK 0x0000
#define ILI9341_NAVY 0x000F
#define ILI9341_DARKGREEN 0x03E0
#define ILI9341_DARKCYAN 0x03EF
#define ILI9341_MAROON 0x7800
#define ILI9341_PURPLE 0x780F
#define ILI9341_OLIVE 0x7BE0
#define ILI9341_LIGHTGREY 0xC618
#define ILI9341_DARKGREY 0x7BEF
#define ILI9341_BLUE 0x001F
#define ILI9341_GREEN 0x07E0
#define ILI9341_CYAN 0x07FF
#define ILI9341_RED 0xF800
#define ILI9341_MAGENTA 0xF81F
#define ILI9341_YELLOW 0xFFE0
#define ILI9341_WHITE 0xFFFF
#define ILI9341_ORANGE 0xFD20
#define ILI9341_GREENYELLOW 0xAFE5
#define ILI9341_PINK 0xFC18

class Adafruit_ILI9341 : public Adafruit_GFX {
 public:
  Adafruit_ILI9341(int8_t cs, int8_t dc, int8_t rst = -1);
  void begin(uint32_t freq = 0);
  void setRotation(uint8_t r) override;
  void invertDisplay(bool on);
  void drawPixel(int16_t x, int16_t y, uint16_t color) override;
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) override;
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) override { fillRect(x, y, 1, h, color); }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) override { fillRect(x, y, w, 1, color); }
  void fillScreen(uint16_t color) override { fillRect(0, 0, width(), height(), color); }
  void setAddrWindow(uint16_t x, uint16_t y, uint16_t w, uint16_t h);
  static uint16_t color565(uint8_t r, uint8_t g, uint8_t b) { return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3); }

 private:
  void command(uint8_t c, const uint8_t *data = 0, uint8_t count = 0);
  void select(bool on) { digitalWrite(cs, on ? LOW : HIGH); }
  int8_t cs;
  int8_t dc;
  int8_t rst;
};
