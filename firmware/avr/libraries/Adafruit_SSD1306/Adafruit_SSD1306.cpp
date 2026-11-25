/* The SSD1306's start-up commands and its picture sent page by page.  SPDX-License-Identifier: MIT */
#include "Adafruit_SSD1306.h"

Adafruit_SSD1306::Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *twi, int8_t) : Adafruit_GFX(w, h), wire(twi) {}

void Adafruit_SSD1306::commands(const uint8_t *list, uint8_t count) {
  wire->beginTransmission(address);
  wire->write((uint8_t)0x00);
  uint8_t sent = 1;
  while (count--) {
    if (sent >= BUFFER_LENGTH) {
      wire->endTransmission();
      wire->beginTransmission(address);
      wire->write((uint8_t)0x00);
      sent = 1;
    }
    wire->write(*list++);
    sent++;
  }
  wire->endTransmission();
}

void Adafruit_SSD1306::ssd1306_command(uint8_t c) { commands(&c, 1); }

bool Adafruit_SSD1306::begin(uint8_t vccSource, uint8_t addr, bool, bool periphBegin) {
  if (!buffer && !(buffer = (uint8_t *)malloc(WIDTH * ((HEIGHT + 7) / 8)))) return false;
  clearDisplay();
  vcc = vccSource;
  address = addr ? addr : (HEIGHT == 32 ? 0x3C : 0x3D);
  if (periphBegin) wire->begin();
  // Is anything there?
  wire->beginTransmission(address);
  if (wire->endTransmission() != 0) return false;
  bool tall = HEIGHT == 64;
  contrast = tall ? (vcc == SSD1306_EXTERNALVCC ? 0x9F : 0xCF) : 0x8F;
  const uint8_t init[] = {
      0xAE, 0xD5, 0x80, 0xA8, (uint8_t)(HEIGHT - 1), 0xD3, 0x00, 0x40, 0x8D, (uint8_t)(vcc == SSD1306_EXTERNALVCC ? 0x10 : 0x14), 0x20, 0x00, 0xA1, 0xC8,
      0xDA,  (uint8_t)(tall ? 0x12 : 0x02), 0x81, contrast, 0xD9, (uint8_t)(vcc == SSD1306_EXTERNALVCC ? 0x22 : 0xF1), 0xDB, 0x40, 0xA4, 0xA6, 0x2E, 0xAF,
  };
  commands(init, sizeof(init));
  return true;
}

void Adafruit_SSD1306::clearDisplay(void) {
  if (buffer) memset(buffer, 0, WIDTH * ((HEIGHT + 7) / 8));
}

void Adafruit_SSD1306::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (!buffer || x < 0 || x >= width() || y < 0 || y >= height()) return;
  switch (getRotation()) {
    case 1: {
      int16_t t = x;
      x = WIDTH - y - 1;
      y = t;
      break;
    }
    case 2:
      x = WIDTH - x - 1;
      y = HEIGHT - y - 1;
      break;
    case 3: {
      int16_t t = x;
      x = y;
      y = HEIGHT - t - 1;
      break;
    }
  }
  uint8_t *p = &buffer[x + (y / 8) * WIDTH];
  uint8_t mask = 1 << (y & 7);
  if (color == SSD1306_WHITE) *p |= mask;
  else if (color == SSD1306_BLACK) *p &= ~mask;
  else *p ^= mask;
}

bool Adafruit_SSD1306::getPixel(int16_t x, int16_t y) {
  if (!buffer || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return false;
  return buffer[x + (y / 8) * WIDTH] & (1 << (y & 7));
}

void Adafruit_SSD1306::display(void) {
  if (!buffer) return;
  const uint8_t window[] = {0x22, 0x00, 0xFF, 0x21, 0x00, (uint8_t)(WIDTH - 1)};
  commands(window, sizeof(window));
  uint16_t count = WIDTH * ((HEIGHT + 7) / 8);
  const uint8_t *p = buffer;
  wire->beginTransmission(address);
  wire->write((uint8_t)0x40);
  uint8_t sent = 1;
  while (count--) {
    if (sent >= BUFFER_LENGTH) {
      wire->endTransmission();
      wire->beginTransmission(address);
      wire->write((uint8_t)0x40);
      sent = 1;
    }
    wire->write(*p++);
    sent++;
  }
  wire->endTransmission();
}

void Adafruit_SSD1306::invertDisplay(bool on) { ssd1306_command(on ? 0xA7 : 0xA6); }

void Adafruit_SSD1306::dim(bool dim) {
  const uint8_t list[] = {0x81, (uint8_t)(dim ? 0 : contrast)};
  commands(list, sizeof(list));
}

void Adafruit_SSD1306::startscrollright(uint8_t start, uint8_t stop) {
  const uint8_t list[] = {0x26, 0x00, start, 0x00, stop, 0x00, 0xFF, 0x2F};
  commands(list, sizeof(list));
}

void Adafruit_SSD1306::startscrollleft(uint8_t start, uint8_t stop) {
  const uint8_t list[] = {0x27, 0x00, start, 0x00, stop, 0x00, 0xFF, 0x2F};
  commands(list, sizeof(list));
}

void Adafruit_SSD1306::stopscroll(void) { ssd1306_command(0x2E); }
