/*
 * The Arduino SPI library's interface on the RP2040's SPI0 (PL022):
 * MISO GP16, CS GP17, SCK GP18, MOSI GP19.  Chip selects are ordinary pins
 * the sketch drives.  SPDX-License-Identifier: MIT
 */
#pragma once
#include <Arduino.h>

#define SPI_MODE0 0x00
#define SPI_MODE1 0x04
#define SPI_MODE2 0x08
#define SPI_MODE3 0x0C
#define SPI_CLOCK_DIV2 2
#define SPI_CLOCK_DIV4 4
#define SPI_CLOCK_DIV8 8
#define SPI_CLOCK_DIV16 16
#define SPI_CLOCK_DIV32 32
#define SPI_CLOCK_DIV64 64
#define SPI_CLOCK_DIV128 128

class SPISettings {
 public:
  SPISettings(uint32_t clock = 4000000, uint8_t order = MSBFIRST, uint8_t mode = SPI_MODE0) : clock(clock), order(order), mode(mode) {}
  uint32_t clock;
  uint8_t order;
  uint8_t mode;
};

class SPIClass {
 public:
  void begin(void);
  void end(void);
  void beginTransaction(SPISettings settings);
  void endTransaction(void) {}
  uint8_t transfer(uint8_t data);
  uint16_t transfer16(uint16_t data);
  void transfer(void *buffer, size_t count);
  void setBitOrder(uint8_t order) { lsbFirst = order == LSBFIRST; }
  void setDataMode(uint8_t mode);
  void setClockDivider(uint8_t divider);
  void setFrequency(uint32_t hz);

 private:
  bool lsbFirst = false;
};

extern SPIClass SPI;
