/* A subset of the Adafruit NeoPixel library's interface: WS2812B LEDs at 800 kHz.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

typedef uint16_t neoPixelType;
#define NEO_RGB ((0 << 6) | (0 << 4) | (1 << 2) | (2))
#define NEO_RBG ((0 << 6) | (0 << 4) | (2 << 2) | (1))
#define NEO_GRB ((1 << 6) | (1 << 4) | (0 << 2) | (2))
#define NEO_GBR ((2 << 6) | (2 << 4) | (0 << 2) | (1))
#define NEO_BRG ((1 << 6) | (1 << 4) | (2 << 2) | (0))
#define NEO_BGR ((2 << 6) | (2 << 4) | (1 << 2) | (0))
#define NEO_KHZ800 0x0000

class Adafruit_NeoPixel {
 public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800);
  ~Adafruit_NeoPixel();
  void begin(void);
  void show(void);
  void setPin(int16_t p);
  void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b);
  void setPixelColor(uint16_t n, uint32_t c);
  void fill(uint32_t c = 0, uint16_t first = 0, uint16_t count = 0);
  void setBrightness(uint8_t b);
  uint8_t getBrightness(void) const { return brightness - 1; }
  void clear(void);
  uint16_t numPixels(void) const { return count; }
  uint32_t getPixelColor(uint16_t n) const;
  bool canShow(void) { return micros() - endTime >= 300L; }
  void rainbow(uint16_t firstHue = 0, int8_t reps = 1, uint8_t saturation = 255, uint8_t brightness = 255, bool gammify = true);
  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) { return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }
  static uint32_t ColorHSV(uint16_t hue, uint8_t sat = 255, uint8_t val = 255);
  static uint8_t gamma8(uint8_t x);
  static uint32_t gamma32(uint32_t x);

 private:
  uint16_t count;
  int16_t pin;
  uint8_t brightness = 0;
  uint8_t *pixels = 0;
  uint8_t rOffset;
  uint8_t gOffset;
  uint8_t bOffset;
  uint32_t endTime = 0;
};
