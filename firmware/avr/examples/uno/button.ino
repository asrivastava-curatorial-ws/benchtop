// Button: pressing the button on pin 2 lights the LED on pin 13.
// The button connects the pin to GND, so the pin uses its pull-up resistor.

const int BUTTON = 2;
const int LED = 13;
int last = HIGH;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Press the button.");
}

void loop() {
  int now = digitalRead(BUTTON);
  digitalWrite(LED, now == LOW ? HIGH : LOW);
  if (now != last) {
    Serial.println(now == LOW ? "Pressed" : "Released");
    last = now;
  }
  delay(10);
}
