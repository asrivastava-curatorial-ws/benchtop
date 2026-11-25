/* The interface of Adafruit's DHT sensor library: DHT11 and DHT22 temperature and humidity.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

#define DHT11 11
#define DHT12 12
#define DHT21 21
#define DHT22 22
#define AM2301 21

class DHT {
 public:
  DHT(uint8_t pin, uint8_t type, uint8_t count = 6);
  void begin(uint8_t usec = 55);
  /* Degrees Celsius (Fahrenheit when asked); not a number when the sensor did not answer. */
  float readTemperature(bool fahrenheit = false, bool force = false);
  float readHumidity(bool force = false);
  float convertCtoF(float c) { return c * 1.8f + 32; }
  float convertFtoC(float f) { return (f - 32) * 0.55555f; }
  float computeHeatIndex(float temperature, float humidity, bool fahrenheit = true);
  bool read(bool force = false);

 private:
  uint32_t expectPulse(bool level);
  uint8_t data[5];
  uint8_t pin;
  uint8_t type;
  uint8_t pullTime = 55;
  uint32_t maxCycles;
  uint32_t lastReadTime = 0;
  bool lastResult = false;
};
