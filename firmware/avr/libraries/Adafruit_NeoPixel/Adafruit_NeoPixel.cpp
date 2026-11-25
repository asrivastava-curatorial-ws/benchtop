/*
 * WS2812B timing by counted cycles: each bit starts high; a 0 falls after a
 * single store (an eighth to a quarter of a microsecond) and a 1 after about
 * 0.9 µs.  SPDX-License-Identifier: MIT
 */
#include "Adafruit_NeoPixel.h"
#include "gamma.h"

Adafruit_NeoPixel::Adafruit_NeoPixel(uint16_t n, int16_t p, neoPixelType type) : count(n), pin(p) {
  rOffset = (type >> 4) & 0x03;
  gOffset = (type >> 2) & 0x03;
  bOffset = type & 0x03;
  pixels = (uint8_t *)calloc(n, 3);
  if (!pixels) count = 0;
}

Adafruit_NeoPixel::~Adafruit_NeoPixel() { free(pixels); }

void Adafruit_NeoPixel::begin(void) {
  if (pin < 0) return;
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
}

void Adafruit_NeoPixel::setPin(int16_t p) {
  pin = p;
  begin();
}

void Adafruit_NeoPixel::show(void) {
  if (!pixels || pin < 0) return;
  // The LEDs take the new colours after the line has stayed low for 50 µs.
  while (!canShow()) {
  }
  volatile uint8_t *port = portOutputRegister(digitalPinToPort(pin));
  uint8_t mask = digitalPinToBitMask(pin);
  uint8_t s = SREG;
  cli();
  uint8_t high = *port | mask;
  uint8_t low = *port & ~mask;
  const uint8_t *p = pixels;
  for (uint16_t i = count * 3; i; i--) {
    uint8_t value = *p++;
    for (uint8_t b = 0; b < 8; b++) {
      // High, then at once the bit (a 0 falls after one store), and low after the long part.
      uint8_t next = (value & 0x80) ? high : low;
      __asm__ __volatile__("st %a[port], %[high]\n\tst %a[port], %[next]" : : [port] "e"(port), [high] "r"(high), [next] "r"(next) : "memory");
      __builtin_avr_delay_cycles(F_CPU / 1600000);
      *port = low;
      value <<= 1;
    }
  }
  SREG = s;
  endTime = micros();
}

void Adafruit_NeoPixel::setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b) {
  if (n >= count) return;
  if (brightness) {
    r = (r * brightness) >> 8;
    g = (g * brightness) >> 8;
    b = (b * brightness) >> 8;
  }
  uint8_t *p = &pixels[n * 3];
  p[rOffset] = r;
  p[gOffset] = g;
  p[bOffset] = b;
}

void Adafruit_NeoPixel::setPixelColor(uint16_t n, uint32_t c) { setPixelColor(n, (uint8_t)(c >> 16), (uint8_t)(c >> 8), (uint8_t)c); }

void Adafruit_NeoPixel::fill(uint32_t c, uint16_t first, uint16_t n) {
  if (first >= count) return;
  uint16_t end = n == 0 ? count : first + n;
  if (end > count) end = count;
  for (uint16_t i = first; i < end; i++) setPixelColor(i, c);
}

/* Brightness scales the colours already set, as the Adafruit library does. */
void Adafruit_NeoPixel::setBrightness(uint8_t b) {
  uint8_t next = b + 1;
  if (next == brightness) return;
  uint8_t old = brightness - 1;
  uint16_t scale = old == 0 ? 0 : (b == 255 ? 65535 / old : (((uint16_t)next << 8) - 1) / old);
  for (uint16_t i = 0; i < count * 3; i++) pixels[i] = (pixels[i] * scale) >> 8;
  brightness = next;
}

void Adafruit_NeoPixel::clear(void) { memset(pixels, 0, count * 3); }

uint32_t Adafruit_NeoPixel::getPixelColor(uint16_t n) const {
  if (n >= count) return 0;
  const uint8_t *p = &pixels[n * 3];
  if (brightness) return ((uint32_t)((p[rOffset] << 8) / brightness) << 16) | ((uint32_t)((p[gOffset] << 8) / brightness) << 8) | (uint32_t)((p[bOffset] << 8) / brightness);
  return ((uint32_t)p[rOffset] << 16) | ((uint32_t)p[gOffset] << 8) | p[bOffset];
}

/* Hue 0–65535 round the colour wheel (red, yellow, green, cyan, blue, magenta), then saturation and value. */
uint32_t Adafruit_NeoPixel::ColorHSV(uint16_t hue, uint8_t sat, uint8_t val) {
  uint8_t r, g, b;
  hue = (hue * 1530L + 32768) / 65536;
  if (hue < 510) {
    b = 0;
    if (hue < 255) {
      r = 255;
      g = hue;
    } else {
      r = 510 - hue;
      g = 255;
    }
  } else if (hue < 1020) {
    r = 0;
    if (hue < 765) {
      g = 255;
      b = hue - 510;
    } else {
      g = 1020 - hue;
      b = 255;
    }
  } else if (hue < 1530) {
    g = 0;
    if (hue < 1275) {
      r = hue - 1020;
      b = 255;
    } else {
      r = 255;
      b = 1530 - hue;
    }
  } else {
    r = 255;
    g = b = 0;
  }
  uint32_t v1 = 1 + val;
  uint16_t s1 = 1 + sat;
  uint8_t s2 = 255 - sat;
  return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) | (((((g * s1) >> 8) + s2) * v1) & 0xff00) | (((((b * s1) >> 8) + s2) * v1) >> 8);
}

uint8_t Adafruit_NeoPixel::gamma8(uint8_t x) { return pgm_read_byte(&GAMMA_TABLE[x]); }

uint32_t Adafruit_NeoPixel::gamma32(uint32_t x) { return ((uint32_t)gamma8(x >> 16) << 16) | ((uint32_t)gamma8(x >> 8) << 8) | gamma8(x); }

void Adafruit_NeoPixel::rainbow(uint16_t firstHue, int8_t reps, uint8_t saturation, uint8_t value, bool gammify) {
  for (uint16_t i = 0; i < count; i++) {
    uint16_t hue = firstHue + (i * reps * 65536L) / count;
    uint32_t c = ColorHSV(hue, saturation, value);
    setPixelColor(i, gammify ? gamma32(c) : c);
  }
}
