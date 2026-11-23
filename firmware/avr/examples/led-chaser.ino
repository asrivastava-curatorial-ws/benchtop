// LED chaser: eight LEDs on pins 2 to 9 light one after another, back and forth.

void setup() {
  for (int pin = 2; pin <= 9; pin++) pinMode(pin, OUTPUT);
}

void light(int pin) {
  digitalWrite(pin, HIGH);
  delay(80);
  digitalWrite(pin, LOW);
}

void loop() {
  for (int pin = 2; pin <= 9; pin++) light(pin);
  for (int pin = 8; pin >= 3; pin--) light(pin);
}
