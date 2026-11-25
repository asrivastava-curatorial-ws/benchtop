/* Shapes by the usual integer algorithms (Bresenham lines, midpoint circles).  SPDX-License-Identifier: MIT */
#include "Adafruit_GFX.h"
#include "glcdfont.h"

#define swapValues(a, b) \
  do {                   \
    int16_t t = a;       \
    a = b;               \
    b = t;               \
  } while (0)

Adafruit_GFX::Adafruit_GFX(int16_t w, int16_t h) : WIDTH(w), HEIGHT(h), currentWidth(w), currentHeight(h) {}

void Adafruit_GFX::setRotation(uint8_t r) {
  rotation = r & 3;
  currentWidth = rotation & 1 ? HEIGHT : WIDTH;
  currentHeight = rotation & 1 ? WIDTH : HEIGHT;
}

void Adafruit_GFX::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
  bool steep = abs(y1 - y0) > abs(x1 - x0);
  if (steep) {
    swapValues(x0, y0);
    swapValues(x1, y1);
  }
  if (x0 > x1) {
    swapValues(x0, x1);
    swapValues(y0, y1);
  }
  int16_t dx = x1 - x0;
  int16_t dy = abs(y1 - y0);
  int16_t err = dx / 2;
  int16_t step = y0 < y1 ? 1 : -1;
  for (; x0 <= x1; x0++) {
    if (steep) drawPixel(y0, x0, color);
    else drawPixel(x0, y0, color);
    err -= dy;
    if (err < 0) {
      y0 += step;
      err += dx;
    }
  }
}

void Adafruit_GFX::drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) { drawLine(x, y, x, y + h - 1, color); }
void Adafruit_GFX::drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) { drawLine(x, y, x + w - 1, y, color); }

void Adafruit_GFX::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  for (int16_t i = x; i < x + w; i++) drawFastVLine(i, y, h, color);
}

void Adafruit_GFX::fillScreen(uint16_t color) { fillRect(0, 0, currentWidth, currentHeight, color); }

void Adafruit_GFX::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  drawFastHLine(x, y, w, color);
  drawFastHLine(x, y + h - 1, w, color);
  drawFastVLine(x, y, h, color);
  drawFastVLine(x + w - 1, y, h, color);
}

void Adafruit_GFX::drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  int16_t f = 1 - r;
  int16_t ddx = 1;
  int16_t ddy = -2 * r;
  int16_t x = 0;
  int16_t y = r;
  drawPixel(x0, y0 + r, color);
  drawPixel(x0, y0 - r, color);
  drawPixel(x0 + r, y0, color);
  drawPixel(x0 - r, y0, color);
  while (x < y) {
    if (f >= 0) {
      y--;
      ddy += 2;
      f += ddy;
    }
    x++;
    ddx += 2;
    f += ddx;
    drawPixel(x0 + x, y0 + y, color);
    drawPixel(x0 - x, y0 + y, color);
    drawPixel(x0 + x, y0 - y, color);
    drawPixel(x0 - x, y0 - y, color);
    drawPixel(x0 + y, y0 + x, color);
    drawPixel(x0 - y, y0 + x, color);
    drawPixel(x0 + y, y0 - x, color);
    drawPixel(x0 - y, y0 - x, color);
  }
}

void Adafruit_GFX::circleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t corners, uint16_t color) {
  int16_t f = 1 - r;
  int16_t ddx = 1;
  int16_t ddy = -2 * r;
  int16_t x = 0;
  int16_t y = r;
  while (x < y) {
    if (f >= 0) {
      y--;
      ddy += 2;
      f += ddy;
    }
    x++;
    ddx += 2;
    f += ddx;
    if (corners & 0x4) {
      drawPixel(x0 + x, y0 + y, color);
      drawPixel(x0 + y, y0 + x, color);
    }
    if (corners & 0x2) {
      drawPixel(x0 + x, y0 - y, color);
      drawPixel(x0 + y, y0 - x, color);
    }
    if (corners & 0x8) {
      drawPixel(x0 - y, y0 + x, color);
      drawPixel(x0 - x, y0 + y, color);
    }
    if (corners & 0x1) {
      drawPixel(x0 - y, y0 - x, color);
      drawPixel(x0 - x, y0 - y, color);
    }
  }
}

void Adafruit_GFX::fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  drawFastVLine(x0, y0 - r, 2 * r + 1, color);
  fillCircleHelper(x0, y0, r, 3, 0, color);
}

void Adafruit_GFX::fillCircleHelper(int16_t x0, int16_t y0, int16_t r, uint8_t corners, int16_t delta, uint16_t color) {
  int16_t f = 1 - r;
  int16_t ddx = 1;
  int16_t ddy = -2 * r;
  int16_t x = 0;
  int16_t y = r;
  int16_t px = x;
  int16_t py = y;
  delta++;
  while (x < y) {
    if (f >= 0) {
      y--;
      ddy += 2;
      f += ddy;
    }
    x++;
    ddx += 2;
    f += ddx;
    if (x < y + 1) {
      if (corners & 1) drawFastVLine(x0 + x, y0 - y, 2 * y + delta, color);
      if (corners & 2) drawFastVLine(x0 - x, y0 - y, 2 * y + delta, color);
    }
    if (y != py) {
      if (corners & 1) drawFastVLine(x0 + py, y0 - px, 2 * px + delta, color);
      if (corners & 2) drawFastVLine(x0 - py, y0 - px, 2 * px + delta, color);
      py = y;
    }
    px = x;
  }
}

void Adafruit_GFX::drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  int16_t most = (w < h ? w : h) / 2;
  if (r > most) r = most;
  drawFastHLine(x + r, y, w - 2 * r, color);
  drawFastHLine(x + r, y + h - 1, w - 2 * r, color);
  drawFastVLine(x, y + r, h - 2 * r, color);
  drawFastVLine(x + w - 1, y + r, h - 2 * r, color);
  circleHelper(x + r, y + r, r, 1, color);
  circleHelper(x + w - r - 1, y + r, r, 2, color);
  circleHelper(x + w - r - 1, y + h - r - 1, r, 4, color);
  circleHelper(x + r, y + h - r - 1, r, 8, color);
}

void Adafruit_GFX::fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  int16_t most = (w < h ? w : h) / 2;
  if (r > most) r = most;
  fillRect(x + r, y, w - 2 * r, h, color);
  fillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, color);
  fillCircleHelper(x + r, y + r, r, 2, h - 2 * r - 1, color);
}

void Adafruit_GFX::drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color) {
  drawLine(x0, y0, x1, y1, color);
  drawLine(x1, y1, x2, y2, color);
  drawLine(x2, y2, x0, y0, color);
}

void Adafruit_GFX::fillTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color) {
  // Sort by y, then fill each scan line between the edges.
  if (y0 > y1) {
    swapValues(y0, y1);
    swapValues(x0, x1);
  }
  if (y1 > y2) {
    swapValues(y2, y1);
    swapValues(x2, x1);
  }
  if (y0 > y1) {
    swapValues(y0, y1);
    swapValues(x0, x1);
  }
  for (int16_t y = y0; y <= y2; y++) {
    int16_t a = y2 == y0 ? x0 : x0 + (int32_t)(x2 - x0) * (y - y0) / (y2 - y0);
    int16_t b;
    if (y < y1) b = y1 == y0 ? x1 : x0 + (int32_t)(x1 - x0) * (y - y0) / (y1 - y0);
    else b = y2 == y1 ? x1 : x1 + (int32_t)(x2 - x1) * (y - y1) / (y2 - y1);
    if (a > b) swapValues(a, b);
    drawFastHLine(a, y, b - a + 1, color);
  }
}

void Adafruit_GFX::drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color) {
  int16_t bytesPerRow = (w + 7) / 8;
  for (int16_t j = 0; j < h; j++)
    for (int16_t i = 0; i < w; i++)
      if (pgm_read_byte(&bitmap[j * bytesPerRow + i / 8]) & (128 >> (i & 7))) drawPixel(x + i, y + j, color);
}

void Adafruit_GFX::drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size) {
  if (x >= currentWidth || y >= currentHeight || x + 6 * size - 1 < 0 || y + 8 * size - 1 < 0) return;
  // The classic font skips one character above 175 unless code page 437 is asked for.
  if (!codePage437 && c >= 176) c++;
  for (int8_t i = 0; i < 5; i++) {
    uint8_t line = pgm_read_byte(&font[c * 5 + i]);
    for (int8_t j = 0; j < 8; j++, line >>= 1) {
      if (line & 1) {
        if (size == 1) drawPixel(x + i, y + j, color);
        else fillRect(x + i * size, y + j * size, size, size, color);
      } else if (bg != color) {
        if (size == 1) drawPixel(x + i, y + j, bg);
        else fillRect(x + i * size, y + j * size, size, size, bg);
      }
    }
  }
  if (bg != color) {
    if (size == 1) drawFastVLine(x + 5, y, 8, bg);
    else fillRect(x + 5 * size, y, size, 8 * size, bg);
  }
}

size_t Adafruit_GFX::write(uint8_t c) {
  if (c == '\n') {
    cursorX = 0;
    cursorY += textSize * 8;
  } else if (c != '\r') {
    if (wrap && cursorX + textSize * 6 > currentWidth) {
      cursorX = 0;
      cursorY += textSize * 8;
    }
    drawChar(cursorX, cursorY, c, textColor, textBackground, textSize);
    cursorX += textSize * 6;
  }
  return 1;
}
