/* Commands go with D/C low, their data and the pixels with D/C high.  SPDX-License-Identifier: MIT */
#include "Adafruit_ILI9341.h"

Adafruit_ILI9341::Adafruit_ILI9341(int8_t cs_, int8_t dc_, int8_t rst_) : Adafruit_GFX(ILI9341_TFTWIDTH, ILI9341_TFTHEIGHT), cs(cs_), dc(dc_), rst(rst_) {}

void Adafruit_ILI9341::command(uint8_t c, const uint8_t *data, uint8_t count) {
  select(true);
  digitalWrite(dc, LOW);
  SPI.transfer(c);
  digitalWrite(dc, HIGH);
  while (count--) SPI.transfer(*data++);
  select(false);
}

void Adafruit_ILI9341::begin(uint32_t) {
  pinMode(cs, OUTPUT);
  digitalWrite(cs, HIGH);
  pinMode(dc, OUTPUT);
  SPI.begin();
  SPI.beginTransaction(SPISettings(8000000, MSBFIRST, SPI_MODE0));
  if (rst >= 0) {
    pinMode(rst, OUTPUT);
    digitalWrite(rst, HIGH);
    delay(10);
    digitalWrite(rst, LOW);
    delay(10);
    digitalWrite(rst, HIGH);
    delay(120);
  }
  command(0x01);
  delay(150);
  const uint8_t pixelFormat = 0x55;
  command(0x3A, &pixelFormat, 1);
  setRotation(0);
  command(0x11);
  delay(120);
  command(0x29);
  delay(20);
}

void Adafruit_ILI9341::setRotation(uint8_t r) {
  Adafruit_GFX::setRotation(r);
  // MADCTL: row/column order and exchange, BGR panel.
  static const uint8_t madctl[] = {0x48, 0x28, 0x88, 0xE8};
  command(0x36, &madctl[getRotation()], 1);
}

void Adafruit_ILI9341::invertDisplay(bool on) { command(on ? 0x21 : 0x20); }

void Adafruit_ILI9341::setAddrWindow(uint16_t x, uint16_t y, uint16_t w, uint16_t h) {
  uint16_t x2 = x + w - 1;
  uint16_t y2 = y + h - 1;
  const uint8_t columns[] = {(uint8_t)(x >> 8), (uint8_t)x, (uint8_t)(x2 >> 8), (uint8_t)x2};
  const uint8_t rows[] = {(uint8_t)(y >> 8), (uint8_t)y, (uint8_t)(y2 >> 8), (uint8_t)y2};
  command(0x2A, columns, 4);
  command(0x2B, rows, 4);
}

void Adafruit_ILI9341::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (x < 0 || y < 0 || x >= width() || y >= height()) return;
  fillRect(x, y, 1, 1, color);
}

void Adafruit_ILI9341::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  if (x >= width() || y >= height() || w <= 0 || h <= 0) return;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > width()) w = width() - x;
  if (y + h > height()) h = height() - y;
  if (w <= 0 || h <= 0) return;
  setAddrWindow(x, y, w, h);
  select(true);
  digitalWrite(dc, LOW);
  SPI.transfer(0x2C);
  digitalWrite(dc, HIGH);
  uint8_t high = color >> 8;
  uint8_t low = color & 0xff;
  for (uint32_t n = (uint32_t)w * h; n; n--) {
    SPI.transfer(high);
    SPI.transfer(low);
  }
  select(false);
}
