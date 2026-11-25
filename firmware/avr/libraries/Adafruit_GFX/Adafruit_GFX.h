/* A subset of the Adafruit GFX library's interface (shapes, bitmaps and the classic font), for Benchtop's examples.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

class Adafruit_GFX : public Print {
 public:
  Adafruit_GFX(int16_t w, int16_t h);
  virtual void drawPixel(int16_t x, int16_t y, uint16_t color) = 0;
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color);
  virtual void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color);
  virtual void fillScreen(uint16_t color);
  virtual void setRotation(uint8_t r);
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  void drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  void fillTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  /* A one-bit picture in flash, eight pixels a byte, highest bit leftmost. */
  void drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color);
  void drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size);
  void setCursor(int16_t x, int16_t y) {
    cursorX = x;
    cursorY = y;
  }
  void setTextColor(uint16_t c) { textColor = textBackground = c; }
  void setTextColor(uint16_t c, uint16_t bg) {
    textColor = c;
    textBackground = bg;
  }
  void setTextSize(uint8_t s) { textSize = s ? s : 1; }
  void setTextWrap(bool w) { wrap = w; }
  void cp437(bool on = true) { codePage437 = on; }
  int16_t width() const { return currentWidth; }
  int16_t height() const { return currentHeight; }
  uint8_t getRotation() const { return rotation; }
  int16_t getCursorX() const { return cursorX; }
  int16_t getCursorY() const { return cursorY; }
  size_t write(uint8_t c) override;
  using Print::write;

 protected:
  void circleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t corners, uint16_t color);
  void fillCircleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t corners, int16_t delta, uint16_t color);
  const int16_t WIDTH;
  const int16_t HEIGHT;
  int16_t currentWidth;
  int16_t currentHeight;
  int16_t cursorX = 0;
  int16_t cursorY = 0;
  uint16_t textColor = 0xffff;
  uint16_t textBackground = 0xffff;
  uint8_t textSize = 1;
  uint8_t rotation = 0;
  bool wrap = true;
  bool codePage437 = false;
};
