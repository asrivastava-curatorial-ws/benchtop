// 28BYJ-48 stepper motor on a ULN2003 driver board: IN1 to IN4 on pins 8 to 11.
// Half a turn one way, then back, at 15 revolutions a minute.
#include <Stepper.h>

const int STEPS = 2048;  // full steps for one turn of the geared shaft
// The library's pin order is IN1, IN3, IN2, IN4.
Stepper motor(STEPS, 8, 10, 9, 11);

void setup() {
  motor.setSpeed(15);
  Serial.begin(115200);
}

void loop() {
  Serial.println(F("Clockwise"));
  motor.step(STEPS / 2);
  delay(500);
  Serial.println(F("Counter-clockwise"));
  motor.step(-STEPS / 2);
  delay(500);
}
