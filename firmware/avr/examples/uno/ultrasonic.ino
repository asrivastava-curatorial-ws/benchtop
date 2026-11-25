// HC-SR04 distance sensor: a 10 microsecond pulse on TRIG (pin 9) sends a ping, and the length of
// the pulse that comes back on ECHO (pin 10) is the time the sound took there and back.
const int TRIG = 9;
const int ECHO = 10;

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long echo = pulseIn(ECHO, HIGH, 30000);
  if (echo == 0) {
    Serial.println(F("Nothing in range"));
  } else {
    // Sound travels 0.0343 cm a microsecond; halve it for the way there.
    float cm = echo * 0.0343 / 2;
    Serial.print(F("Distance: "));
    Serial.print(cm, 1);
    Serial.println(F(" cm"));
  }
  delay(250);
}
