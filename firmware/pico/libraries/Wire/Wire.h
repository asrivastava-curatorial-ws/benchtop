/*
 * The Arduino Wire library's interface (I²C controller) on the RP2040's
 * I²C blocks: Wire is I2C0 on GP4 (SDA) and GP5 (SCL), Wire1 is I2C1 on
 * GP26 and GP27; setSDA() and setSCL() move them to other pins of the same
 * block before begin().  SPDX-License-Identifier: MIT
 */
#pragma once
#include <Arduino.h>

#define BUFFER_LENGTH 32
#define WIRE_HAS_END 1

class TwoWire : public Stream {
 public:
  TwoWire(uint32_t base, uint8_t sda, uint8_t scl) : base(base), sda(sda), scl(scl) {}
  void begin(void);
  void end(void);
  bool setSDA(uint8_t pin);
  bool setSCL(uint8_t pin);
  void setClock(uint32_t hz);
  void beginTransmission(uint8_t address);
  void beginTransmission(int address) { beginTransmission((uint8_t)address); }
  /* 0 sent; 1 too long; 2 address not acknowledged; 3 data not acknowledged; 4 other error. */
  uint8_t endTransmission(bool stop = true);
  uint8_t requestFrom(uint8_t address, uint8_t quantity, bool stop = true);
  uint8_t requestFrom(int address, int quantity, int stop = 1) { return requestFrom((uint8_t)address, (uint8_t)quantity, stop != 0); }
  size_t write(uint8_t value) override;
  size_t write(const uint8_t *data, size_t length) override;
  size_t write(unsigned long n) { return write((uint8_t)n); }
  size_t write(long n) { return write((uint8_t)n); }
  size_t write(unsigned int n) { return write((uint8_t)n); }
  size_t write(int n) { return write((uint8_t)n); }
  using Print::write;
  int available(void) override;
  int read(void) override;
  int peek(void) override;
  void flush(void) {}

 private:
  void target(uint8_t address);
  uint32_t base;
  uint8_t sda;
  uint8_t scl;
  uint32_t hz = 100000;
  bool started = false;
  /* The last transfer ended without a stop: the next one starts with a repeated start. */
  bool restart = false;
  uint8_t address = 0;
  uint8_t tx[BUFFER_LENGTH];
  uint8_t txLength = 0;
  bool transmitting = false;
  uint8_t rx[BUFFER_LENGTH];
  uint8_t rxIndex = 0;
  uint8_t rxLength = 0;
};

extern TwoWire Wire;
extern TwoWire Wire1;
