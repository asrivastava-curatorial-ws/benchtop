// Raspberry Pi Pico: PWM on GP16 fades an LED up and down (analogWrite at 1 kHz, 0 to 255).
void setup() {}

void loop() {
  for (int level = 0; level <= 255; level += 5) {
    analogWrite(16, level);
    delay(20);
  }
  for (int level = 255; level >= 0; level -= 5) {
    analogWrite(16, level);
    delay(20);
  }
}
