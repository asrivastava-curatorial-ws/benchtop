/* HD44780 in 4-bit or 8-bit mode, initialised as the datasheet's figure 24 shows.  SPDX-License-Identifier: MIT */
#include "LiquidCrystal.h"

LiquidCrystal::LiquidCrystal(uint8_t rs_, uint8_t enable_, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7) : rs(rs_), rw(255), enable(enable_), data{d4, d5, d6, d7, 0, 0, 0, 0}, eightBit(false) {}

LiquidCrystal::LiquidCrystal(uint8_t rs_, uint8_t rw_, uint8_t enable_, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7) : rs(rs_), rw(rw_), enable(enable_), data{d4, d5, d6, d7, 0, 0, 0, 0}, eightBit(false) {}

LiquidCrystal::LiquidCrystal(uint8_t rs_, uint8_t enable_, uint8_t d0, uint8_t d1, uint8_t d2, uint8_t d3, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7)
    : rs(rs_), rw(255), enable(enable_), data{d0, d1, d2, d3, d4, d5, d6, d7}, eightBit(true) {}

void LiquidCrystal::begin(uint8_t columns, uint8_t lines) {
  rows = lines;
  offsets[0] = 0x00;
  offsets[1] = 0x40;
  offsets[2] = columns;
  offsets[3] = 0x40 + columns;
  pinMode(rs, OUTPUT);
  if (rw != 255) pinMode(rw, OUTPUT);
  pinMode(enable, OUTPUT);
  for (uint8_t i = 0; i < (eightBit ? 8 : 4); i++) pinMode(data[i], OUTPUT);
  delay(50);
  digitalWrite(rs, LOW);
  digitalWrite(enable, LOW);
  if (rw != 255) digitalWrite(rw, LOW);
  uint8_t function = (lines > 1 ? 0x08 : 0x00);
  if (!eightBit) {
    write4bits(0x03);
    delayMicroseconds(4500);
    write4bits(0x03);
    delayMicroseconds(4500);
    write4bits(0x03);
    delayMicroseconds(150);
    write4bits(0x02);
    command(0x20 | function);
  } else {
    function |= 0x10;
    command(0x20 | function);
    delayMicroseconds(4500);
    command(0x20 | function);
    delayMicroseconds(150);
    command(0x20 | function);
  }
  control = 0x04;
  display();
  clear();
  mode = 0x02;
  command(0x04 | mode);
}

void LiquidCrystal::clear() {
  command(0x01);
  delayMicroseconds(2000);
}

void LiquidCrystal::home() {
  command(0x02);
  delayMicroseconds(2000);
}

void LiquidCrystal::setCursor(uint8_t column, uint8_t row) {
  if (row >= rows) row = rows - 1;
  command(0x80 | (column + offsets[row]));
}

void LiquidCrystal::noDisplay() { command(0x08 | (control &= ~0x04)); }
void LiquidCrystal::display() { command(0x08 | (control |= 0x04)); }
void LiquidCrystal::noCursor() { command(0x08 | (control &= ~0x02)); }
void LiquidCrystal::cursor() { command(0x08 | (control |= 0x02)); }
void LiquidCrystal::noBlink() { command(0x08 | (control &= ~0x01)); }
void LiquidCrystal::blink() { command(0x08 | (control |= 0x01)); }
void LiquidCrystal::scrollDisplayLeft() { command(0x10 | 0x08); }
void LiquidCrystal::scrollDisplayRight() { command(0x10 | 0x08 | 0x04); }
void LiquidCrystal::leftToRight() { command(0x04 | (mode |= 0x02)); }
void LiquidCrystal::rightToLeft() { command(0x04 | (mode &= ~0x02)); }
void LiquidCrystal::autoscroll() { command(0x04 | (mode |= 0x01)); }
void LiquidCrystal::noAutoscroll() { command(0x04 | (mode &= ~0x01)); }

void LiquidCrystal::createChar(uint8_t location, uint8_t charmap[]) {
  command(0x40 | ((location & 7) << 3));
  for (uint8_t i = 0; i < 8; i++) write(charmap[i]);
}

void LiquidCrystal::command(uint8_t value) { send(value, LOW); }

size_t LiquidCrystal::write(uint8_t value) {
  send(value, HIGH);
  return 1;
}

void LiquidCrystal::send(uint8_t value, uint8_t rsLevel) {
  digitalWrite(rs, rsLevel);
  if (rw != 255) digitalWrite(rw, LOW);
  if (eightBit) write8bits(value);
  else {
    write4bits(value >> 4);
    write4bits(value);
  }
}

void LiquidCrystal::pulseEnable() {
  digitalWrite(enable, LOW);
  delayMicroseconds(1);
  digitalWrite(enable, HIGH);
  delayMicroseconds(1);
  digitalWrite(enable, LOW);
  delayMicroseconds(100);
}

void LiquidCrystal::write4bits(uint8_t value) {
  for (uint8_t i = 0; i < 4; i++) digitalWrite(data[i], (value >> i) & 0x01);
  pulseEnable();
}

void LiquidCrystal::write8bits(uint8_t value) {
  for (uint8_t i = 0; i < 8; i++) digitalWrite(data[i], (value >> i) & 0x01);
  pulseEnable();
}
