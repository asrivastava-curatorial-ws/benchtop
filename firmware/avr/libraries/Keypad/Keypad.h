/* The Keypad library's interface: a matrix keypad scanned column by column.  SPDX-License-Identifier: MIT */
#pragma once
#include <Arduino.h>

#define makeKeymap(x) ((char *)(x))
#define NO_KEY '\0'

class Keypad {
 public:
  Keypad(char *keymap, byte *rowPins, byte *columnPins, byte rows, byte columns);
  /* The key just pressed, or NO_KEY. */
  char getKey();
  char waitForKey();
  bool isPressed(char key);
  void setDebounceTime(unsigned int ms) { debounce = ms < 1 ? 1 : ms; }

 private:
  char scan();
  char *keymap;
  byte *rowPins;
  byte *columnPins;
  byte rows;
  byte columns;
  char held = NO_KEY;
  unsigned long lastScan = 0;
  unsigned int debounce = 10;
};
