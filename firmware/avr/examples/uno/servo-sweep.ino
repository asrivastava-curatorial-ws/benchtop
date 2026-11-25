// Servo sweep: the servo on pin 9 turns from 0 to 180 degrees and back.
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 2) {
    servo.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle -= 2) {
    servo.write(angle);
    delay(15);
  }
}
