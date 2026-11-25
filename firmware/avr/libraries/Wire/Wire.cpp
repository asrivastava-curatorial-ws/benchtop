/* A blocking I²C controller on the AVR's TWI peripheral.  SPDX-License-Identifier: MIT */
#include "Wire.h"

TwoWire Wire;

#if defined(TWCR)
static uint8_t twiWait(void) {
  unsigned long start = micros();
  while (!(TWCR & _BV(TWINT))) {
    if (micros() - start > 25000) return 0xff;
  }
  return TWSR & 0xf8;
}

static uint8_t twiStart(void) {
  TWCR = _BV(TWINT) | _BV(TWSTA) | _BV(TWEN);
  uint8_t status = twiWait();
  return status == 0x08 || status == 0x10 ? 0 : 4;
}

static void twiStop(void) {
  TWCR = _BV(TWINT) | _BV(TWSTO) | _BV(TWEN);
  unsigned long start = micros();
  while ((TWCR & _BV(TWSTO)) && micros() - start < 25000) {
  }
}

static uint8_t twiSend(uint8_t value) {
  TWDR = value;
  TWCR = _BV(TWINT) | _BV(TWEN);
  return twiWait();
}

void TwoWire::begin(void) {
  // The bus's pull-ups (the modules usually have their own as well).
  digitalWrite(SDA, HIGH);
  digitalWrite(SCL, HIGH);
  TWSR = 0;
  setClock(100000);
  TWCR = _BV(TWEN);
}

void TwoWire::end(void) { TWCR = 0; }

void TwoWire::setClock(uint32_t hz) { TWBR = (uint8_t)(((F_CPU / hz) - 16) / 2); }

uint8_t TwoWire::endTransmission(bool stop) {
  transmitting = false;
  uint8_t result = 0;
  if (twiStart()) result = 4;
  else if (twiSend((uint8_t)(address << 1)) != 0x18) result = 2;
  else {
    for (uint8_t i = 0; i < txLength; i++) {
      if (twiSend(tx[i]) != 0x28) {
        result = 3;
        break;
      }
    }
  }
  txLength = 0;
  held = !stop && result == 0;
  if (stop || result) twiStop();
  return result;
}

uint8_t TwoWire::requestFrom(uint8_t from, uint8_t quantity, bool stop) {
  if (quantity > BUFFER_LENGTH) quantity = BUFFER_LENGTH;
  rxIndex = 0;
  rxLength = 0;
  held = false;
  if (twiStart() || twiSend((uint8_t)((from << 1) | 1)) != 0x40) {
    twiStop();
    return 0;
  }
  for (uint8_t i = 0; i < quantity; i++) {
    bool last = i + 1 == quantity;
    TWCR = _BV(TWINT) | _BV(TWEN) | (last ? 0 : _BV(TWEA));
    uint8_t status = twiWait();
    if (status != 0x50 && status != 0x58) break;
    rx[rxLength++] = TWDR;
  }
  if (stop) twiStop();
  return rxLength;
}
#else
/* The ATtiny85 has no TWI peripheral (its USI needs a different library). */
void TwoWire::begin(void) {}
void TwoWire::end(void) {}
void TwoWire::setClock(uint32_t) {}
uint8_t TwoWire::endTransmission(bool) {
  txLength = 0;
  return 4;
}
uint8_t TwoWire::requestFrom(uint8_t, uint8_t, bool) { return 0; }
#endif

void TwoWire::beginTransmission(uint8_t to) {
  address = to;
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

int TwoWire::available(void) { return rxLength - rxIndex; }
int TwoWire::read(void) { return rxIndex < rxLength ? rx[rxIndex++] : -1; }
int TwoWire::peek(void) { return rxIndex < rxLength ? rx[rxIndex] : -1; }
