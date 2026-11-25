/* The Arduino Stepper library's interface, for four-wire motors such as the 28BYJ-48 on a ULN2003.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

class Stepper {
 public:
  Stepper(int steps, int pin1, int pin2, int pin3, int pin4);
  void setSpeed(long rpm);
  /* Turns by so many steps (negative for the other way); returns when done. */
  void step(int count);
  int version(void) { return 5; }

 private:
  void energise(int phase);
  unsigned long delay = 0;
  int steps;
  int number = 0;
  int pins[4];
  unsigned long last = 0;
};
