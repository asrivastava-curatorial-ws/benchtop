/* Each device takes 16 bits (register, then data); the device nearest DIN gets the last 16 shifted.  SPDX-License-Identifier: MIT */
#include "LedControl.h"

#define OP_NOOP 0
#define OP_DECODEMODE 9
#define OP_INTENSITY 10
#define OP_SCANLIMIT 11
#define OP_SHUTDOWN 12
#define OP_DISPLAYTEST 15

LedControl::LedControl(int data, int clock, int load, int count) : dataPin(data), clockPin(clock), loadPin(load), devices(count < 1 ? 1 : count > 8 ? 8 : count) {
  pinMode(dataPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(loadPin, OUTPUT);
  digitalWrite(loadPin, HIGH);
  memset(status, 0, sizeof(status));
  for (int i = 0; i < devices; i++) {
    send(i, OP_DISPLAYTEST, 0);
    setScanLimit(i, 7);
    send(i, OP_DECODEMODE, 0);
    clearDisplay(i);
    shutdown(i, true);
  }
}

void LedControl::send(int addr, byte opcode, byte data) {
  byte bytes[16];
  memset(bytes, 0, sizeof(bytes));
  bytes[addr * 2 + 1] = opcode;
  bytes[addr * 2] = data;
  digitalWrite(loadPin, LOW);
  for (int i = devices * 2; i > 0; i--) shiftOut(dataPin, clockPin, MSBFIRST, bytes[i - 1]);
  digitalWrite(loadPin, HIGH);
}

void LedControl::shutdown(int addr, bool off) {
  if (addr >= 0 && addr < devices) send(addr, OP_SHUTDOWN, off ? 0 : 1);
}

void LedControl::setScanLimit(int addr, int limit) {
  if (addr >= 0 && addr < devices && limit >= 0 && limit < 8) send(addr, OP_SCANLIMIT, limit);
}

void LedControl::setIntensity(int addr, int intensity) {
  if (addr >= 0 && addr < devices && intensity >= 0 && intensity < 16) send(addr, OP_INTENSITY, intensity);
}

void LedControl::clearDisplay(int addr) {
  if (addr < 0 || addr >= devices) return;
  for (int i = 0; i < 8; i++) {
    status[addr * 8 + i] = 0;
    send(addr, i + 1, 0);
  }
}

void LedControl::setLed(int addr, int row, int column, boolean state) {
  if (addr < 0 || addr >= devices || row < 0 || row > 7 || column < 0 || column > 7) return;
  byte bit = 0x80 >> column;
  if (state) status[addr * 8 + row] |= bit;
  else status[addr * 8 + row] &= ~bit;
  send(addr, row + 1, status[addr * 8 + row]);
}

void LedControl::setRow(int addr, int row, byte value) {
  if (addr < 0 || addr >= devices || row < 0 || row > 7) return;
  status[addr * 8 + row] = value;
  send(addr, row + 1, value);
}

void LedControl::setColumn(int addr, int column, byte value) {
  for (int row = 0; row < 8; row++) setLed(addr, row, column, (value >> (7 - row)) & 1);
}

/* Segments (DP A B C D E F G as bits 7 to 0) for digits, hex letters and a few signs. */
static byte segments(char c) {
  static const byte digits[] = {0x7E, 0x30, 0x6D, 0x79, 0x33, 0x5B, 0x5F, 0x70, 0x7F, 0x7B, 0x77, 0x1F, 0x0D, 0x3D, 0x4F, 0x47};
  if (c >= '0' && c <= '9') return digits[c - '0'];
  if (c >= 'a' && c <= 'f') return digits[c - 'a' + 10];
  if (c >= 'A' && c <= 'F') return digits[c - 'A' + 10];
  switch (c) {
    case '-': return 0x01;
    case '_': return 0x08;
    case 'H': case 'h': return 0x37;
    case 'L': case 'l': return 0x0E;
    case 'P': case 'p': return 0x67;
    case 'U': case 'u': return 0x3E;
    case 'o': return 0x1D;
    case '.': return 0x80;
    default: return 0x00;
  }
}

void LedControl::setDigit(int addr, int digit, byte value, boolean dp) {
  if (addr < 0 || addr >= devices || digit < 0 || digit > 7 || value > 15) return;
  byte v = segments(value < 10 ? '0' + value : 'a' + value - 10) | (dp ? 0x80 : 0);
  status[addr * 8 + digit] = v;
  send(addr, digit + 1, v);
}

void LedControl::setChar(int addr, int digit, char value, boolean dp) {
  if (addr < 0 || addr >= devices || digit < 0 || digit > 7) return;
  byte v = segments(value) | (dp ? 0x80 : 0);
  status[addr * 8 + digit] = v;
  send(addr, digit + 1, v);
}
