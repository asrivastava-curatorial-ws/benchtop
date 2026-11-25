// MAX7219 8x8 LED matrix with the LedControl library: DIN on 12, CLK on 11, CS on 10.
#include <LedControl.h>

LedControl matrix(12, 11, 10, 1);

const byte heart[8] = {0b00000000, 0b01100110, 0b11111111, 0b11111111, 0b01111110, 0b00111100, 0b00011000, 0b00000000};
const byte smile[8] = {0b00111100, 0b01000010, 0b10100101, 0b10000001, 0b10100101, 0b10011001, 0b01000010, 0b00111100};

void show(const byte picture[8]) {
  for (int row = 0; row < 8; row++) matrix.setRow(0, row, picture[row]);
}

void setup() {
  matrix.shutdown(0, false);
  matrix.setIntensity(0, 8);
  matrix.clearDisplay(0);
}

void loop() {
  show(heart);
  delay(800);
  show(smile);
  delay(800);
  // A dot runs round the edge.
  matrix.clearDisplay(0);
  for (int i = 0; i < 28; i++) {
    int row = i < 8 ? 0 : i < 14 ? i - 7 : i < 22 ? 7 : 28 - i;
    int col = i < 8 ? i : i < 14 ? 7 : i < 22 ? 21 - i : 0;
    matrix.setLed(0, row, col, true);
    delay(30);
    matrix.setLed(0, row, col, false);
  }
}
