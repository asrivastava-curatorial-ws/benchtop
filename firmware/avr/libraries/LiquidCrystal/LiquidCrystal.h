/* The Arduino LiquidCrystal library's interface: HD44780 character LCDs wired in parallel.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

class LiquidCrystal : public Print {
 public:
  LiquidCrystal(uint8_t rs, uint8_t enable, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7);
  LiquidCrystal(uint8_t rs, uint8_t rw, uint8_t enable, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7);
  LiquidCrystal(uint8_t rs, uint8_t enable, uint8_t d0, uint8_t d1, uint8_t d2, uint8_t d3, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7);
  void begin(uint8_t columns, uint8_t rows);
  void clear();
  void home();
  void noDisplay();
  void display();
  void noBlink();
  void blink();
  void noCursor();
  void cursor();
  void scrollDisplayLeft();
  void scrollDisplayRight();
  void leftToRight();
  void rightToLeft();
  void autoscroll();
  void noAutoscroll();
  void createChar(uint8_t location, uint8_t charmap[]);
  void setCursor(uint8_t column, uint8_t row);
  size_t write(uint8_t value) override;
  using Print::write;
  void command(uint8_t value);

 private:
  void send(uint8_t value, uint8_t mode);
  void write4bits(uint8_t value);
  void write8bits(uint8_t value);
  void pulseEnable();
  uint8_t rs;
  uint8_t rw;
  uint8_t enable;
  uint8_t data[8];
  bool eightBit;
  uint8_t control = 0x04;
  uint8_t mode = 0x02;
  uint8_t rows = 2;
  uint8_t offsets[4];
};
