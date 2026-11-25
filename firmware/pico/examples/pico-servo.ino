// Raspberry Pi Pico: the potentiometer on GP26 (A0) sets the angle of the servo on GP18 (50 Hz PWM).
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(18);
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(A0);
  int angle = map(reading, 0, 1023, 0, 180);
  servo.write(angle);
  Serial.print("A0 = ");
  Serial.print(reading);
  Serial.print("  angle = ");
  Serial.println(angle);
  delay(100);
}
