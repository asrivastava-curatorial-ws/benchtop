// Dimmer: the potentiometer on A0 sets the brightness of the LED on pin 9,
// and the reading is printed on the serial monitor.

unsigned long lastPrint = 0;

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(A0);          // 0 to 1023
  analogWrite(9, reading / 4);           // 0 to 255
  if (millis() - lastPrint >= 250) {
    lastPrint = millis();
    float volts = reading * 5.0 / 1023.0;
    Serial.print("A0 = ");
    Serial.print(reading);
    Serial.print("  (");
    Serial.print(volts, 2);
    Serial.println(" V)");
  }
}
