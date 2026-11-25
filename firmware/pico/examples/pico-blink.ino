// Raspberry Pi Pico: the LED on the board (GP25) and an LED on GP16 blink in turn, and the serial port says so.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(16, OUTPUT);
  Serial.begin(115200);
  Serial.println("Hello from the Raspberry Pi Pico");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  digitalWrite(16, LOW);
  Serial.println("Board LED on");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  digitalWrite(16, HIGH);
  Serial.println("GP16 LED on");
  delay(500);
}
