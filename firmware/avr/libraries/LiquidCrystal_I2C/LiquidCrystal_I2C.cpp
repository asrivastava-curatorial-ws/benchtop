/* The backpack's PCF8574 drives RS (P0), RW (P1), E (P2), the backlight (P3) and D4–D7 (P4–P7).  SPDX-License-Identifier: MIT */
#include "LiquidCrystal_I2C.h"

#define RS 0x01
#define EN 0x04

LiquidCrystal_I2C::LiquidCrystal_I2C(uint8_t address_, uint8_t columns_, uint8_t rows_) : address(address_), columns(columns_), rows(rows_) {}

void LiquidCrystal_I2C::init() {
  Wire.begin();
  delay(50);
  expanderWrite(light);
  delay(1000);
  write4bits(0x03 << 4);
  delayMicroseconds(4500);
  write4bits(0x03 << 4);
  delayMicroseconds(4500);
  write4bits(0x03 << 4);
  delayMicroseconds(150);
  write4bits(0x02 << 4);
  command(0x20 | (rows > 1 ? 0x08 : 0x00));
  control = 0x04;
  display();
  clear();
  mode = 0x02;
  command(0x04 | mode);
  home();
}

void LiquidCrystal_I2C::clear() {
  command(0x01);
  delayMicroseconds(2000);
}

void LiquidCrystal_I2C::home() {
  command(0x02);
  delayMicroseconds(2000);
}

void LiquidCrystal_I2C::setCursor(uint8_t column, uint8_t row) {
  static const uint8_t offsets[] = {0x00, 0x40, 0x14, 0x54};
  if (row >= rows) row = rows - 1;
  command(0x80 | (column + (columns == 16 && row > 1 ? (row == 2 ? 0x10 : 0x50) : offsets[row])));
}

void LiquidCrystal_I2C::noDisplay() { command(0x08 | (control &= ~0x04)); }
void LiquidCrystal_I2C::display() { command(0x08 | (control |= 0x04)); }
void LiquidCrystal_I2C::noCursor() { command(0x08 | (control &= ~0x02)); }
void LiquidCrystal_I2C::cursor() { command(0x08 | (control |= 0x02)); }
void LiquidCrystal_I2C::noBlink() { command(0x08 | (control &= ~0x01)); }
void LiquidCrystal_I2C::blink() { command(0x08 | (control |= 0x01)); }
void LiquidCrystal_I2C::scrollDisplayLeft() { command(0x10 | 0x08); }
void LiquidCrystal_I2C::scrollDisplayRight() { command(0x10 | 0x08 | 0x04); }
void LiquidCrystal_I2C::leftToRight() { command(0x04 | (mode |= 0x02)); }
void LiquidCrystal_I2C::rightToLeft() { command(0x04 | (mode &= ~0x02)); }
void LiquidCrystal_I2C::autoscroll() { command(0x04 | (mode |= 0x01)); }
void LiquidCrystal_I2C::noAutoscroll() { command(0x04 | (mode &= ~0x01)); }

void LiquidCrystal_I2C::noBacklight() {
  light = 0;
  expanderWrite(0);
}

void LiquidCrystal_I2C::backlight() {
  light = 0x08;
  expanderWrite(0);
}

void LiquidCrystal_I2C::createChar(uint8_t location, uint8_t charmap[]) {
  command(0x40 | ((location & 7) << 3));
  for (uint8_t i = 0; i < 8; i++) write(charmap[i]);
}

void LiquidCrystal_I2C::command(uint8_t value) { send(value, 0); }

size_t LiquidCrystal_I2C::write(uint8_t value) {
  send(value, RS);
  return 1;
}

void LiquidCrystal_I2C::send(uint8_t value, uint8_t rsBit) {
  write4bits((value & 0xf0) | rsBit);
  write4bits(((value << 4) & 0xf0) | rsBit);
}

void LiquidCrystal_I2C::write4bits(uint8_t value) {
  expanderWrite(value);
  pulseEnable(value);
}

void LiquidCrystal_I2C::expanderWrite(uint8_t data) {
  Wire.beginTransmission(address);
  Wire.write(data | light);
  Wire.endTransmission();
}

void LiquidCrystal_I2C::pulseEnable(uint8_t data) {
  expanderWrite(data | EN);
  delayMicroseconds(1);
  expanderWrite(data & ~EN);
  delayMicroseconds(50);
}
