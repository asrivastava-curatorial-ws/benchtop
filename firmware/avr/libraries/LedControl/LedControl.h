/* The LedControl library's interface: MAX7219 matrices and digit displays, sent bit by bit.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

class LedControl {
 public:
  LedControl(int dataPin, int clkPin, int csPin, int numDevices = 1);
  int getDeviceCount() { return devices; }
  void shutdown(int addr, bool off);
  void setScanLimit(int addr, int limit);
  void setIntensity(int addr, int intensity);
  void clearDisplay(int addr);
  void setLed(int addr, int row, int column, boolean state);
  void setRow(int addr, int row, byte value);
  void setColumn(int addr, int column, byte value);
  void setDigit(int addr, int digit, byte value, boolean dp);
  void setChar(int addr, int digit, char value, boolean dp);

 private:
  void send(int addr, byte opcode, byte data);
  byte status[64];
  int dataPin;
  int clockPin;
  int loadPin;
  int devices;
};
