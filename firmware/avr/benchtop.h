/*
 * A small Arduino-compatible core for the ATmega328P (Arduino Uno), used to
 * build Benchtop's example sketches for the circuit simulator.  It covers
 * pinMode, digitalWrite, digitalRead, analogRead, analogWrite, millis,
 * micros, delay, map, random and Serial.  Real projects should be built with
 * the Arduino IDE or Arduino CLI; Benchtop can compile them with the CLI.
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include <avr/interrupt.h>
#include <avr/io.h>
#include <stdint.h>
#include <stdlib.h>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define LED_BUILTIN 13
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19

typedef uint8_t byte;
typedef bool boolean;

#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))
#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogWrite(uint8_t pin, int value);
unsigned long millis(void);
unsigned long micros(void);
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
long map(long x, long inMin, long inMax, long outMin, long outMax);
long random(long howBig);
long random(long howSmall, long howBig);
void randomSeed(unsigned long seed);

class SerialPort {
 public:
  void begin(unsigned long baud);
  void write(uint8_t c);
  int available(void);
  int read(void);
  void print(const char *text);
  void print(char c);
  void print(int value);
  void print(unsigned int value);
  void print(long value);
  void print(unsigned long value);
  void print(double value, int digits = 2);
  void println(void);
  void println(const char *text);
  void println(char c);
  void println(int value);
  void println(unsigned int value);
  void println(long value);
  void println(unsigned long value);
  void println(double value, int digits = 2);
};

extern SerialPort Serial;

void setup(void);
void loop(void);
