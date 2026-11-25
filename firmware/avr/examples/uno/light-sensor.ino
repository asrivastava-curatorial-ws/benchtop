// Light sensor: a light-dependent resistor from 5 V to A0 and 10 kOhm from A0 to ground.
// More light, higher voltage. The LED on pin 13 lights when it is dark.
void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(A0);
  bool dark = reading < 300;
  digitalWrite(13, dark ? HIGH : LOW);
  Serial.print(F("Light reading: "));
  Serial.print(reading);
  Serial.println(dark ? F("  dark: LED on") : F(""));
  delay(250);
}
