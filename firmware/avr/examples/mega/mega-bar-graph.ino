// Bar graph on the Mega: the potentiometer on A8 lights 0 to 10 LEDs on pins 22 to 31.
void setup() {
  for (int pin = 22; pin <= 31; pin++) pinMode(pin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(A8);
  int lit = map(reading, 0, 1023, 0, 10);
  for (int i = 0; i < 10; i++) digitalWrite(22 + i, i < lit ? HIGH : LOW);
  Serial.print(F("A8 = "));
  Serial.print(reading);
  Serial.print(F("  LEDs lit: "));
  Serial.println(lit);
  delay(100);
}
