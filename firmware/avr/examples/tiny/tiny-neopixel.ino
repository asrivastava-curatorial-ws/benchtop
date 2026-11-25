// ATtiny85: eight NeoPixels on PB3 (pin 3) chase round in colour.
#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel strip(8, 3, NEO_GRB + NEO_KHZ800);
uint8_t lead = 0;

void setup() {
  strip.begin();
}

void loop() {
  strip.clear();
  for (uint8_t i = 0; i < 3; i++) {
    uint16_t hue = (lead + i) * 8192;
    strip.setPixelColor((lead + i) % 8, strip.ColorHSV(hue, 255, 120 - i * 40));
  }
  strip.show();
  lead = (lead + 1) % 8;
  delay(120);
}
