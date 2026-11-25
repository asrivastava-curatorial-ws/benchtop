// ATtiny85: PWM on PB1 (pin 1) fades the LED up and down.
int level = 0;
int step = 5;

void setup() {
  pinMode(1, OUTPUT);
}

void loop() {
  analogWrite(1, level);
  level += step;
  if (level <= 0 || level >= 255) step = -step;
  delay(20);
}
