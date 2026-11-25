/* Wire on the RP2040's I²C controllers (Synopsys DesignWare), polled.  SPDX-License-Identifier: MIT */
#include "Wire.h"

#include "../../core/rp2040.h"

TwoWire Wire(I2C0_BASE, 4, 5);
TwoWire Wire1(I2C1_BASE, 26, 27);

#define R(off) REG(base + (off))

/* I2C0 serves pins 0, 1, 4, 5, 8, 9 … (pin % 4 < 2); I2C1 the others.  SDA pins are even, SCL odd. */
static bool serves(uint32_t base, uint8_t pin) { return pin < 30 && ((pin % 4 < 2) == (base == I2C0_BASE)); }

bool TwoWire::setSDA(uint8_t pin) {
  if (started || !serves(base, pin) || (pin & 1)) return false;
  sda = pin;
  return true;
}

bool TwoWire::setSCL(uint8_t pin) {
  if (started || !serves(base, pin) || !(pin & 1)) return false;
  scl = pin;
  return true;
}

void TwoWire::begin(void) {
  picoUnreset(base == I2C0_BASE ? RESET_I2C0 : RESET_I2C1);
  R(IC_ENABLE) = 0;
  // Controller, fast mode, restarts allowed, no target mode, TX_EMPTY when the byte is sent.
  R(IC_CON) = (1u << 0) | (2u << 1) | (1u << 5) | (1u << 6) | (1u << 8);
  R(IC_RX_TL) = 0;
  R(IC_TX_TL) = 0;
  setClock(hz);
  picoSetFunction(sda, FUNC_I2C);
  picoSetFunction(scl, FUNC_I2C);
  REG(PAD(sda)) |= PAD_PUE;
  REG(PAD(scl)) |= PAD_PUE;
  R(IC_ENABLE) = 1;
  started = true;
}

void TwoWire::end(void) {
  R(IC_ENABLE) = 0;
  started = false;
}

void TwoWire::setClock(uint32_t clock) {
  hz = clock ? clock : 100000;
  uint32_t period = (CLK_PERI + hz / 2) / hz;
  uint32_t low = period * 3 / 5;
  uint32_t high = period - low;
  bool enabled = R(IC_ENABLE) & 1u;
  R(IC_ENABLE) = 0;
  R(IC_FS_SCL_HCNT) = high;
  R(IC_FS_SCL_LCNT) = low;
  R(IC_FS_SPKLEN) = low < 16 ? 1 : low / 16;
  if (enabled) R(IC_ENABLE) = 1;
}

void TwoWire::target(uint8_t addr) {
  R(IC_ENABLE) = 0;
  R(IC_TAR) = addr;
  R(IC_ENABLE) = 1;
}

void TwoWire::beginTransmission(uint8_t addr) {
  address = addr;
  txLength = 0;
  transmitting = true;
}

size_t TwoWire::write(uint8_t value) {
  if (!transmitting || txLength >= BUFFER_LENGTH) return 0;
  tx[txLength++] = value;
  return 1;
}

size_t TwoWire::write(const uint8_t *data, size_t length) {
  size_t n = 0;
  while (length--) n += write(*data++);
  return n;
}

/* Waits for the controller to finish: a stop if one was asked for. Returns the abort reasons, 0 for none. */
static uint32_t finish(uint32_t base, bool stop) {
  uint32_t abort = R(IC_TX_ABRT_SOURCE);
  if (abort) (void)R(IC_CLR_TX_ABRT);
  if (stop || abort) {
    uint32_t guard = 0;
    while (!(R(IC_RAW_INTR_STAT) & IC_INTR_STOP_DET) && ++guard < 1000000u) {
    }
    (void)R(IC_CLR_STOP_DET);
  }
  return abort;
}

uint8_t TwoWire::endTransmission(bool stop) {
  transmitting = false;
  if (!started) return 4;
  target(address);
  if (txLength == 0) {
    // An address check (as I²C scanners do): read one byte and see whether it was acknowledged.
    R(IC_DATA_CMD) = (1u << 8) | (1u << 9) | (restart ? 1u << 10 : 0);
    uint32_t guard = 0;
    while (!R(IC_RXFLR) && !(R(IC_RAW_INTR_STAT) & IC_INTR_TX_ABRT) && ++guard < 1000000u) {
    }
    while (R(IC_RXFLR)) (void)R(IC_DATA_CMD);
    restart = false;
    return finish(base, true) ? 2 : 0;
  }
  uint32_t abort = 0;
  for (uint8_t i = 0; i < txLength && !abort; i++) {
    bool first = i == 0;
    bool last = i == txLength - 1;
    R(IC_DATA_CMD) = (first && restart ? 1u << 10 : 0) | (last && stop ? 1u << 9 : 0) | tx[i];
    uint32_t guard = 0;
    while (!(R(IC_RAW_INTR_STAT) & IC_INTR_TX_EMPTY) && ++guard < 1000000u) {
    }
    abort = R(IC_TX_ABRT_SOURCE);
  }
  abort = finish(base, stop) | abort;
  restart = !stop;
  if (abort & 1u) return 2;
  if (abort) return 3;
  return 0;
}

uint8_t TwoWire::requestFrom(uint8_t addr, uint8_t quantity, bool stop) {
  rxIndex = 0;
  rxLength = 0;
  if (!started || !quantity) return 0;
  if (quantity > BUFFER_LENGTH) quantity = BUFFER_LENGTH;
  target(addr);
  for (uint8_t i = 0; i < quantity; i++) {
    bool first = i == 0;
    bool last = i == quantity - 1;
    R(IC_DATA_CMD) = (1u << 8) | (first && restart ? 1u << 10 : 0) | (last && stop ? 1u << 9 : 0);
    uint32_t guard = 0;
    while (!R(IC_RXFLR) && !(R(IC_RAW_INTR_STAT) & IC_INTR_TX_ABRT) && ++guard < 1000000u) {
    }
    if (R(IC_TX_ABRT_SOURCE)) break;
    rx[rxLength++] = (uint8_t)(R(IC_DATA_CMD) & 0xffu);
  }
  uint32_t abort = finish(base, stop);
  restart = !stop;
  if (abort) rxLength = 0;
  return rxLength;
}

int TwoWire::available(void) { return rxLength - rxIndex; }
int TwoWire::read(void) { return rxIndex < rxLength ? rx[rxIndex++] : -1; }
int TwoWire::peek(void) { return rxIndex < rxLength ? rx[rxIndex] : -1; }
