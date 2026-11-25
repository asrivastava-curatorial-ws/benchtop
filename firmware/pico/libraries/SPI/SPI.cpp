/* SPI on the RP2040's SPI0 (ARM PL022), polled.  SPDX-License-Identifier: MIT */
#include "SPI.h"

#include "../../core/rp2040.h"

SPIClass SPI;

#define R(off) REG(SPI0_BASE + (off))

static uint8_t reverse(uint8_t b) {
  b = (uint8_t)((b & 0xf0) >> 4 | (b & 0x0f) << 4);
  b = (uint8_t)((b & 0xcc) >> 2 | (b & 0x33) << 2);
  return (uint8_t)((b & 0xaa) >> 1 | (b & 0x55) << 1);
}

void SPIClass::begin(void) {
  picoUnreset(RESET_SPI0);
  R(SSP_CR1) = 0;
  setFrequency(4000000);
  R(SSP_CR0) = (R(SSP_CR0) & 0xff00u) | 7u;
  R(SSP_CR1) = 1u << 1;
  picoSetFunction(MISO, FUNC_SPI);
  picoSetFunction(SCK, FUNC_SPI);
  picoSetFunction(MOSI, FUNC_SPI);
}

void SPIClass::end(void) { R(SSP_CR1) = 0; }

void SPIClass::setFrequency(uint32_t hz) {
  if (!hz) hz = 1000000;
  // f = clk_peri / (prescale × (1 + scr)), prescale even 2…254.
  uint32_t prescale = 2;
  while (prescale < 254 && CLK_PERI / (prescale * 256u) > hz) prescale += 2;
  uint32_t scr = CLK_PERI / (prescale * hz);
  if (scr) scr--;
  if (scr > 255) scr = 255;
  R(SSP_CPSR) = prescale;
  R(SSP_CR0) = (R(SSP_CR0) & 0xffu) | (scr << 8);
}

void SPIClass::setDataMode(uint8_t mode) {
  uint32_t cr0 = R(SSP_CR0) & ~0xc0u;
  if (mode == SPI_MODE1 || mode == SPI_MODE3) cr0 |= 1u << 7;
  if (mode == SPI_MODE2 || mode == SPI_MODE3) cr0 |= 1u << 6;
  R(SSP_CR0) = cr0;
}

void SPIClass::setClockDivider(uint8_t divider) { setFrequency(F_CPU / (divider ? divider : 4)); }

void SPIClass::beginTransaction(SPISettings settings) {
  setFrequency(settings.clock);
  setDataMode(settings.mode);
  lsbFirst = settings.order == LSBFIRST;
}

uint8_t SPIClass::transfer(uint8_t data) {
  if (lsbFirst) data = reverse(data);
  while (!(R(SSP_SR) & SSP_SR_TNF)) {
  }
  R(SSP_DR) = data;
  while (!(R(SSP_SR) & SSP_SR_RNE)) {
  }
  uint8_t in = (uint8_t)R(SSP_DR);
  return lsbFirst ? reverse(in) : in;
}

uint16_t SPIClass::transfer16(uint16_t data) {
  uint8_t hi = transfer((uint8_t)(lsbFirst ? data : data >> 8));
  uint8_t lo = transfer((uint8_t)(lsbFirst ? data >> 8 : data));
  return lsbFirst ? (uint16_t)(hi | lo << 8) : (uint16_t)(hi << 8 | lo);
}

void SPIClass::transfer(void *buffer, size_t count) {
  uint8_t *p = static_cast<uint8_t *>(buffer);
  while (count--) {
    *p = transfer(*p);
    p++;
  }
}
