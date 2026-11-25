/*
 * The Arduino Servo library's interface on the RP2040: each servo is a PWM
 * channel at 50 Hz, so pulses keep coming without the processor's help.
 * Both pins of a PWM slice (GP0/GP1, GP2/GP3 …) share its period.
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include <Arduino.h>

#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500
#define REFRESH_INTERVAL 20000
#define MAX_SERVOS 16
#define INVALID_SERVO 255

class Servo {
 public:
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
  int pin = -1;
  int pulse = DEFAULT_PULSE_WIDTH;
  int minimum = MIN_PULSE_WIDTH;
  int maximum = MAX_PULSE_WIDTH;
};
