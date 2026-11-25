/* The Arduino Servo library's interface: up to 12 servos timed by timer 1.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

#if defined(__AVR_ATtiny85__)
#error "This Servo library needs the 16-bit timer 1 of an ATmega (Uno, Nano or Mega)."
#endif

#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500
#define REFRESH_INTERVAL 20000
#define MAX_SERVOS 12
#define INVALID_SERVO 255

class Servo {
 public:
  Servo();
  uint8_t attach(int pin);
  uint8_t attach(int pin, int min, int max);
  void detach();
  /* An angle (0 to 180), or a pulse width in microseconds when 544 or more. */
  void write(int value);
  void writeMicroseconds(int us);
  int read();
  int readMicroseconds();
  bool attached();

 private:
  uint8_t index;
  int minimum = MIN_PULSE_WIDTH;
  int maximum = MAX_PULSE_WIDTH;
};
