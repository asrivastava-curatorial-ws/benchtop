/* Servo pulses from the RP2040's PWM: a 1 MHz count over a 20 ms period.  SPDX-License-Identifier: MIT */
#include "Servo.h"

#include "../../core/rp2040.h"

uint8_t Servo::attach(int p) { return attach(p, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH); }

uint8_t Servo::attach(int p, int min, int max) {
  if (p < 0 || p > 29) return INVALID_SERVO;
  pin = p;
  minimum = min;
  maximum = max;
  writeMicroseconds(pulse);
  return 0;
}

void Servo::detach() {
  if (pin >= 0) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  pin = -1;
}

void Servo::write(int value) {
  if (value < MIN_PULSE_WIDTH) {
    if (value < 0) value = 0;
    if (value > 180) value = 180;
    value = minimum + (int)((long)(maximum - minimum) * value / 180);
  }
  writeMicroseconds(value);
}

void Servo::writeMicroseconds(int us) {
  if (us < minimum) us = minimum;
  if (us > maximum) us = maximum;
  pulse = us;
  if (pin >= 0) pwmSet((uint8_t)pin, REFRESH_INTERVAL - 1, (uint32_t)us);
}

int Servo::read() { return (int)((long)(pulse - minimum) * 180 / (maximum - minimum)); }
int Servo::readMicroseconds() { return pulse; }
bool Servo::attached() { return pin >= 0; }
