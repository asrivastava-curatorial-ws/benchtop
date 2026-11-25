// PIR motion sensor: OUT on pin 2. The LED on pin 13 shows motion, and changes are reported.
bool last = false;

void setup() {
  pinMode(2, INPUT);
  pinMode(13, OUTPUT);
  Serial.begin(115200);
  Serial.println(F("Watching for motion"));
}

void loop() {
  bool motion = digitalRead(2) == HIGH;
  digitalWrite(13, motion ? HIGH : LOW);
  if (motion != last) {
    Serial.println(motion ? F("Motion detected") : F("Motion ended"));
    last = motion;
  }
  delay(20);
}
