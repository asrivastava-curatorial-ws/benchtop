/* The LiquidCrystal_I2C library's interface: an HD44780 LCD behind a PCF8574 I²C expander.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>
#include <Wire.h>

class LiquidCrystal_I2C : public Print {
 public:
  LiquidCrystal_I2C(uint8_t address, uint8_t columns, uint8_t rows);
  void init();
  void begin() { init(); }
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
  void noBacklight();
  void backlight();
  void createChar(uint8_t location, uint8_t charmap[]);
  void setCursor(uint8_t column, uint8_t row);
  size_t write(uint8_t value) override;
  using Print::write;
  void command(uint8_t value);

 private:
  void send(uint8_t value, uint8_t mode);
  void write4bits(uint8_t value);
  void expanderWrite(uint8_t data);
  void pulseEnable(uint8_t data);
  uint8_t address;
  uint8_t columns;
  uint8_t rows;
  uint8_t light = 0x08;
  uint8_t control = 0x04;
  uint8_t mode = 0x02;
};
