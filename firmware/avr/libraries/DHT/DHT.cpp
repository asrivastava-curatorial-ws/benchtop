/* The board asks by holding DATA low, then times each bit's high against its low.  SPDX-License-Identifier: MIT */
#include "DHT.h"

#define MIN_INTERVAL 2000
#define TIMEOUT UINT32_MAX

DHT::DHT(uint8_t pin_, uint8_t type_, uint8_t) : pin(pin_), type(type_) { maxCycles = microsecondsToClockCycles(1000); }

void DHT::begin(uint8_t usec) {
  pinMode(pin, INPUT_PULLUP);
  pullTime = usec;
  // The first reading is taken at once.
  lastReadTime = millis() - MIN_INTERVAL;
}

uint32_t DHT::expectPulse(bool level) {
  uint32_t count = 0;
  while (digitalRead(pin) == level)
    if (count++ >= maxCycles) return TIMEOUT;
  return count;
}

bool DHT::read(bool force) {
  uint32_t now = millis();
  if (!force && now - lastReadTime < MIN_INTERVAL) return lastResult;
  lastReadTime = now;
  memset(data, 0, sizeof(data));
  pinMode(pin, INPUT_PULLUP);
  delay(1);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  if (type == DHT11) delay(20);
  else delayMicroseconds(1100);
  uint32_t cycles[80];
  pinMode(pin, INPUT_PULLUP);
  delayMicroseconds(pullTime);
  uint8_t s = SREG;
  cli();
  bool ok = expectPulse(LOW) != TIMEOUT && expectPulse(HIGH) != TIMEOUT;
  if (ok)
    for (uint8_t i = 0; i < 80; i += 2) {
      cycles[i] = expectPulse(LOW);
      cycles[i + 1] = expectPulse(HIGH);
    }
  SREG = s;
  if (!ok) return lastResult = false;
  for (uint8_t i = 0; i < 40; i++) {
    uint32_t low = cycles[2 * i];
    uint32_t high = cycles[2 * i + 1];
    if (low == TIMEOUT || high == TIMEOUT) return lastResult = false;
    data[i / 8] <<= 1;
    if (high > low) data[i / 8] |= 1;
  }
  return lastResult = data[4] == ((data[0] + data[1] + data[2] + data[3]) & 0xFF);
}

float DHT::readTemperature(bool fahrenheit, bool force) {
  if (!read(force)) return NAN;
  float t;
  if (type == DHT11) {
    t = data[2];
    if (data[3] & 0x80) t = -1 - t;
    t += (data[3] & 0x0f) * 0.1f;
  } else {
    t = (((uint16_t)(data[2] & 0x7F)) << 8 | data[3]) * 0.1f;
    if (data[2] & 0x80) t = -t;
  }
  return fahrenheit ? convertCtoF(t) : t;
}

float DHT::readHumidity(bool force) {
  if (!read(force)) return NAN;
  if (type == DHT11) return data[0] + data[1] * 0.1f;
  return (((uint16_t)data[0]) << 8 | data[1]) * 0.1f;
}

/* The heat index of the US National Weather Service (Rothfusz regression, with Steadman's formula for mild weather). */
float DHT::computeHeatIndex(float temperature, float humidity, bool fahrenheit) {
  float t = fahrenheit ? temperature : convertCtoF(temperature);
  float hi = 0.5f * (t + 61.0f + ((t - 68.0f) * 1.2f) + (humidity * 0.094f));
  if (hi > 79) {
    hi = -42.379f + 2.04901523f * t + 10.14333127f * humidity - 0.22475541f * t * humidity - 0.00683783f * t * t - 0.05481717f * humidity * humidity + 0.00122874f * t * t * humidity +
         0.00085282f * t * humidity * humidity - 0.00000199f * t * t * humidity * humidity;
    if (humidity < 13 && t >= 80 && t <= 112) hi -= ((13 - humidity) * 0.25f) * sqrt((17 - fabs(t - 95)) * 0.05882f);
    else if (humidity > 85 && t >= 80 && t <= 87) hi += ((humidity - 85) * 0.1f) * ((87 - t) * 0.2f);
  }
  return fahrenheit ? hi : convertFtoC(hi);
}
