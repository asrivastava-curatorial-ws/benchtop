// 74HC595 shift register: eight LEDs count in binary using three pins.
// DS (data) on pin 4, STCP (latch) on pin 5, SHCP (clock) on pin 6.
const int DATA = 4;
const int LATCH = 5;
const int CLOCK = 6;

void setup() {
  pinMode(DATA, OUTPUT);
  pinMode(LATCH, OUTPUT);
  pinMode(CLOCK, OUTPUT);
}

void loop() {
  for (int value = 0; value < 256; value++) {
    digitalWrite(LATCH, LOW);
    shiftOut(DATA, CLOCK, MSBFIRST, value);
    digitalWrite(LATCH, HIGH);
    delay(150);
  }
}
