// Seven-segment counter: segments a to g on pins 8 down to 2 (a on pin 8,
// g on pin 2) of a common-cathode display count from 0 to 9, a digit a second.

const byte DIGITS[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111,
};

void setup() {
  for (int pin = 2; pin <= 8; pin++) pinMode(pin, OUTPUT);
}

void show(int digit) {
  for (int segment = 0; segment < 7; segment++) {
    digitalWrite(8 - segment, (DIGITS[digit] >> segment) & 1);
  }
}

void loop() {
  for (int digit = 0; digit < 10; digit++) {
    show(digit);
    delay(1000);
  }
}
