// Raspberry Pi Pico: a potentiometer on GP26 (A0) sets the brightness of the LED on GP16 and is reported in volts.
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}

void loop() {
  int reading = analogRead(A0);
  analogWrite(16, reading / 16);
  Serial.print("A0 = ");
  Serial.print(reading);
  Serial.print("  (");
  Serial.print(reading * 3.3 / 4095, 2);
  Serial.println(" V)");
  delay(200);
}
