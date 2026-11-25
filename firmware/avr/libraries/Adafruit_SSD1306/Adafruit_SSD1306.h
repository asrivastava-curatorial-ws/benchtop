/* A subset of the Adafruit SSD1306 library's interface: 128×64 and 128×32 OLEDs on I²C.  SPDX-License-Identifier: MIT */
#pragma once
#include <Adafruit_GFX.h>
#include <Wire.h>

#define SSD1306_BLACK 0
#define SSD1306_WHITE 1
#define SSD1306_INVERSE 2
#define BLACK SSD1306_BLACK
#define WHITE SSD1306_WHITE
#define INVERSE SSD1306_INVERSE
#define SSD1306_SWITCHCAPVCC 0x02
#define SSD1306_EXTERNALVCC 0x01

class Adafruit_SSD1306 : public Adafruit_GFX {
 public:
  Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *twi = &Wire, int8_t resetPin = -1);
  /* False when there is no memory for the picture or nothing answers at the address. */
  bool begin(uint8_t vcc = SSD1306_SWITCHCAPVCC, uint8_t address = 0x3C, bool reset = true, bool periphBegin = true);
  void display(void);
  void clearDisplay(void);
  void invertDisplay(bool on);
  void dim(bool dim);
  void drawPixel(int16_t x, int16_t y, uint16_t color) override;
  bool getPixel(int16_t x, int16_t y);
  uint8_t *getBuffer(void) { return buffer; }
  void startscrollright(uint8_t start, uint8_t stop);
  void startscrollleft(uint8_t start, uint8_t stop);
  void stopscroll(void);
  void ssd1306_command(uint8_t c);

 private:
  void commands(const uint8_t *list, uint8_t count);
  TwoWire *wire;
  uint8_t *buffer = 0;
  uint8_t address = 0x3C;
  uint8_t vcc = SSD1306_SWITCHCAPVCC;
  uint8_t contrast = 0xCF;
};
