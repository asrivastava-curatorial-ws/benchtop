// NeoPixel ring: a rainbow turns round the 16 LEDs on pin 6.
#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel ring(16, 6, NEO_GRB + NEO_KHZ800);
uint16_t hue = 0;

void setup() {
  ring.begin();
  ring.setBrightness(80);
}

void loop() {
  for (uint16_t i = 0; i < ring.numPixels(); i++) {
    uint16_t pixelHue = hue + i * 65536L / ring.numPixels();
    ring.setPixelColor(i, ring.gamma32(ring.ColorHSV(pixelHue)));
  }
  ring.show();
  hue += 1024;
  delay(20);
}
