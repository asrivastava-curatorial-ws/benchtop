/* Four-wire full steps: 1010, 0110, 0101, 1001 on pins 1 to 4.  SPDX-License-Identifier: MIT */
#include "Stepper.h"

Stepper::Stepper(int steps_, int pin1, int pin2, int pin3, int pin4) : steps(steps_), pins{pin1, pin2, pin3, pin4} {
  for (int i = 0; i < 4; i++) pinMode(pins[i], OUTPUT);
}

void Stepper::setSpeed(long rpm) { delay = 60L * 1000L * 1000L / steps / rpm; }

void Stepper::energise(int phase) {
  static const byte pattern[] = {0b1010, 0b0110, 0b0101, 0b1001};
  for (int i = 0; i < 4; i++) digitalWrite(pins[i], (pattern[phase] >> (3 - i)) & 1);
}

void Stepper::step(int count) {
  int left = abs(count);
  while (left > 0) {
    unsigned long now = micros();
    if (now - last >= delay) {
      last = now;
      if (count > 0) number = number == steps - 1 ? 0 : number + 1;
      else number = number == 0 ? steps - 1 : number - 1;
      left--;
      energise(number % 4);
    }
  }
}
