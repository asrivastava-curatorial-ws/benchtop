/* Each column is driven low in turn and the rows, pulled up, read low where a key joins them.  SPDX-License-Identifier: MIT */
#include "Keypad.h"

Keypad::Keypad(char *keymap_, byte *rowPins_, byte *columnPins_, byte rows_, byte columns_) : keymap(keymap_), rowPins(rowPins_), columnPins(columnPins_), rows(rows_), columns(columns_) {}

char Keypad::scan() {
  char found = NO_KEY;
  for (byte r = 0; r < rows; r++) pinMode(rowPins[r], INPUT_PULLUP);
  for (byte c = 0; c < columns; c++) {
    pinMode(columnPins[c], OUTPUT);
    digitalWrite(columnPins[c], LOW);
    for (byte r = 0; r < rows; r++)
      if (found == NO_KEY && !digitalRead(rowPins[r])) found = keymap[r * columns + c];
    digitalWrite(columnPins[c], HIGH);
    pinMode(columnPins[c], INPUT);
  }
  return found;
}

char Keypad::getKey() {
  unsigned long now = millis();
  if (now - lastScan < debounce) return NO_KEY;
  lastScan = now;
  char key = scan();
  if (key == held) return NO_KEY;
  held = key;
  return key;
}

char Keypad::waitForKey() {
  char key;
  while ((key = getKey()) == NO_KEY) {
  }
  return key;
}

bool Keypad::isPressed(char key) { return scan() == key; }
