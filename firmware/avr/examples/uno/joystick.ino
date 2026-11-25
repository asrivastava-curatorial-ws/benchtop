// Joystick: VRx on A0, VRy on A1 and the push switch on pin 2.
void setup() {
  pinMode(2, INPUT_PULLUP);
  Serial.begin(115200);
}

void loop() {
  int x = analogRead(A0);
  int y = analogRead(A1);
  bool pressed = digitalRead(2) == LOW;
  Serial.print(F("x = "));
  Serial.print(x);
  Serial.print(F("  y = "));
  Serial.print(y);
  Serial.println(pressed ? F("  pressed") : F(""));
  delay(200);
}
