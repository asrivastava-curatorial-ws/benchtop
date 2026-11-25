// Servo knob: the potentiometer on A0 sets the angle of the servo on pin 9.
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(A0);
  int angle = map(reading, 0, 1023, 0, 180);
  servo.write(angle);
  Serial.print(F("A0 = "));
  Serial.print(reading);
  Serial.print(F("  angle = "));
  Serial.println(angle);
  delay(100);
}
