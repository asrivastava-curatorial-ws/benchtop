/*
 * A small Arduino-compatible core for the Raspberry Pi Pico (RP2040), used
 * to build Benchtop's Pico examples for the circuit simulator.  It covers
 * the same functions as the AVR core (digital, analog, PWM, time, serial,
 * interrupts) with the Pico's pin numbers (GP0 to GP28, LED on GP25,
 * A0 to A2 on GP26 to GP28).  Real projects are better built with the
 * Arduino-Pico core through the Arduino IDE or CLI; Benchtop can compile
 * them with the CLI.
 *
 * SPDX-License-Identifier: MIT
 */
#pragma once
#include <avr/pgmspace.h>
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef F_CPU
#define F_CPU 125000000UL
#endif

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#define INPUT_PULLDOWN 0x3
#define LSBFIRST 0
#define MSBFIRST 1
#define CHANGE 1
#define FALLING 2
#define RISING 3
#define DEC 10
#define HEX 16
#define OCT 8
#undef BIN
#define BIN 2
#define DEFAULT 1

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105

typedef uint8_t byte;
typedef bool boolean;
typedef unsigned int word;

#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif
#undef abs
#define abs(x) ((x) > 0 ? (x) : -(x))
#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bitRead(value, b) (((value) >> (b)) & 0x01)
#define bitSet(value, b) ((value) |= (1UL << (b)))
#define bitClear(value, b) ((value) &= ~(1UL << (b)))
#define bitWrite(value, b, v) ((v) ? bitSet(value, b) : bitClear(value, b))
#define bit(b) (1UL << (b))
#define interrupts() __asm volatile("cpsie i" ::: "memory")
#define noInterrupts() __asm volatile("cpsid i" ::: "memory")
#define clockCyclesPerMicrosecond() (F_CPU / 1000000L)
#define clockCyclesToMicroseconds(a) ((a) / clockCyclesPerMicrosecond())
#define microsecondsToClockCycles(a) ((a) * clockCyclesPerMicrosecond())
#define NOT_AN_INTERRUPT -1

#define NUM_DIGITAL_PINS 30
#define NUM_ANALOG_INPUTS 4
#define A0 26
#define A1 27
#define A2 28
#define A3 29
#define LED_BUILTIN 25
#define PIN_LED 25
/* SPI0 and I2C0 (Wire) on their Arduino-Pico default pins. */
#define MISO 16
#define SS 17
#define SCK 18
#define MOSI 19
#define SDA 4
#define SCL 5
#define digitalPinToInterrupt(p) (p)

#define NOT_A_PIN 0
#define NOT_A_PORT 0


void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogReference(uint8_t mode);
void analogReadResolution(int bits);
void analogWriteResolution(int bits);
void analogWriteRange(uint32_t range);
void analogWriteFreq(uint32_t hz);
void analogWrite(uint8_t pin, int value);
unsigned long millis(void);
unsigned long micros(void);
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
/* Microseconds since start-up, 64 bits. */
uint64_t time_us_64(void);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000L);
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value);
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);
void attachInterrupt(uint8_t interrupt, void (*handler)(void), int mode);
void detachInterrupt(uint8_t interrupt);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
void noTone(uint8_t pin);
long map(long x, long inMin, long inMax, long outMin, long outMax);
long random(long howBig);
long random(long howSmall, long howBig);
void randomSeed(unsigned long seed);
void yield(void);

/* Strings kept in flash: Serial.println(F("text")). */
class __FlashStringHelper;
#define F(literal) (reinterpret_cast<const __FlashStringHelper *>(literal))

class Print {
 public:
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size);
  size_t write(const char *text) { return text ? write(reinterpret_cast<const uint8_t *>(text), strlen(text)) : 0; }
  size_t write(const char *buffer, size_t size) { return write(reinterpret_cast<const uint8_t *>(buffer), size); }
  size_t print(const __FlashStringHelper *text);
  size_t print(const char text[]);
  size_t print(char c);
  size_t print(unsigned char value, int base = DEC);
  size_t print(int value, int base = DEC);
  size_t print(unsigned int value, int base = DEC);
  size_t print(long value, int base = DEC);
  size_t print(unsigned long value, int base = DEC);
  size_t print(double value, int digits = 2);
  size_t println(void);
  size_t println(const __FlashStringHelper *text);
  size_t println(const char text[]);
  size_t println(char c);
  size_t println(unsigned char value, int base = DEC);
  size_t println(int value, int base = DEC);
  size_t println(unsigned int value, int base = DEC);
  size_t println(long value, int base = DEC);
  size_t println(unsigned long value, int base = DEC);
  size_t println(double value, int digits = 2);

 private:
  size_t printNumber(unsigned long value, uint8_t base);
  size_t printFloat(double value, uint8_t digits);
};

/* What can be read a byte at a time (the serial port). */
class Stream : public Print {
 public:
  virtual int available(void) = 0;
  virtual int read(void) = 0;
  virtual int peek(void) = 0;
  long parseInt(void);
  float parseFloat(void);
  size_t readBytesUntil(char terminator, char *buffer, size_t length);
  void setTimeout(unsigned long ms) { timeout = ms; }

 protected:
  int timedRead(void);
  int timedPeek(void);
  unsigned long timeout = 1000;
};

class HardwareSerial : public Stream {
 public:
  void begin(unsigned long baud);
  void end(void);
  int available(void) override;
  int read(void) override;
  int peek(void) override;
  void flush(void);
  size_t write(uint8_t c) override;
  size_t write(unsigned long n) { return write((uint8_t)n); }
  size_t write(long n) { return write((uint8_t)n); }
  size_t write(unsigned int n) { return write((uint8_t)n); }
  size_t write(int n) { return write((uint8_t)n); }
  using Print::write;
  operator bool() { return true; }

 private:
  int peeked = -1;
};

/* Serial is UART0 on GP0 (TX) and GP1 (RX); Serial1 names the same port, as Arduino-Pico's UART is called. */
extern HardwareSerial Serial;
#define Serial1 Serial

void setup(void);
void loop(void);
