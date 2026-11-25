/* The Arduino SPI library's interface (controller on the AVR's SPI peripheral).  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

#define SPI_MODE0 0x00
#define SPI_MODE1 0x04
#define SPI_MODE2 0x08
#define SPI_MODE3 0x0C
#define SPI_CLOCK_DIV4 0x00
#define SPI_CLOCK_DIV16 0x01
#define SPI_CLOCK_DIV64 0x02
#define SPI_CLOCK_DIV128 0x03
#define SPI_CLOCK_DIV2 0x04
#define SPI_CLOCK_DIV8 0x05
#define SPI_CLOCK_DIV32 0x06

class SPISettings {
 public:
  SPISettings(uint32_t clock = 4000000, uint8_t order = MSBFIRST, uint8_t mode = SPI_MODE0) {
    uint8_t div = 0;
    uint32_t speed = F_CPU / 2;
    while (div < 6 && clock < speed) {
      speed /= 2;
      div++;
    }
    // Dividers 2, 4, 8 … 128 as SPCR rate bits with SPI2X.
    static const uint8_t rates[] = {0x04, 0x00, 0x05, 0x01, 0x06, 0x02, 0x03};
    uint8_t r = rates[div];
#if defined(SPCR)
    spcr = _BV(SPE) | _BV(MSTR) | (order == LSBFIRST ? _BV(DORD) : 0) | (mode & 0x0C) | (r & 0x03);
    spsr = (r & 0x04) ? _BV(SPI2X) : 0;
#else
    (void)order;
    (void)mode;
    (void)r;
#endif
  }
  uint8_t spcr = 0;
  uint8_t spsr = 0;
};

class SPIClass {
 public:
  static void begin(void) {
#if defined(SPCR)
    digitalWrite(SS, HIGH);
    pinMode(SS, OUTPUT);
    pinMode(SCK, OUTPUT);
    pinMode(MOSI, OUTPUT);
    SPCR = _BV(SPE) | _BV(MSTR);
#endif
  }
  static void end(void) {
#if defined(SPCR)
    SPCR = 0;
#endif
  }
  static void beginTransaction(SPISettings settings) {
#if defined(SPCR)
    SPCR = settings.spcr;
    SPSR = settings.spsr;
#else
    (void)settings;
#endif
  }
  static void endTransaction(void) {}
  static void setClockDivider(uint8_t div) {
#if defined(SPCR)
    SPCR = (SPCR & ~0x03) | (div & 0x03);
    SPSR = (SPSR & ~_BV(SPI2X)) | ((div & 0x04) ? _BV(SPI2X) : 0);
#else
    (void)div;
#endif
  }
  static void setBitOrder(uint8_t order) {
#if defined(SPCR)
    if (order == LSBFIRST) SPCR |= _BV(DORD);
    else SPCR &= ~_BV(DORD);
#else
    (void)order;
#endif
  }
  static void setDataMode(uint8_t mode) {
#if defined(SPCR)
    SPCR = (SPCR & ~0x0C) | mode;
#else
    (void)mode;
#endif
  }
  static uint8_t transfer(uint8_t value) {
#if defined(SPDR)
    SPDR = value;
    while (!(SPSR & _BV(SPIF))) {
    }
    return SPDR;
#else
    return value;
#endif
  }
  static uint16_t transfer16(uint16_t value) {
    uint16_t high = transfer(value >> 8);
    return (high << 8) | transfer(value & 0xff);
  }
  static void transfer(void *buffer, size_t count) {
    uint8_t *p = (uint8_t *)buffer;
    while (count--) {
      *p = transfer(*p);
      p++;
    }
  }
};

extern SPIClass SPI;
