// Raspberry Pi Pico: a button from GP17 to ground (internal pull-up) lights the LED on GP16 and is counted.
int presses = 0;
bool was = false;

void setup() {
  pinMode(17, INPUT_PULLUP);
  pinMode(16, OUTPUT);
  Serial.begin(115200);
  Serial.println("Press the button on GP17");
}

void loop() {
  bool pressed = digitalRead(17) == LOW;
  digitalWrite(16, pressed ? HIGH : LOW);
  if (pressed && !was) {
    presses++;
    Serial.print("Pressed ");
    Serial.print(presses);
    Serial.println(presses == 1 ? " time" : " times");
  }
  was = pressed;
  delay(10);
}
