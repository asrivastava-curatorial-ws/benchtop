// Traffic lights: red on pin 2, yellow on pin 3, green on pin 4.

const int RED = 2;
const int YELLOW = 3;
const int GREEN = 4;

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void show(int red, int yellow, int green, unsigned long ms) {
  digitalWrite(RED, red);
  digitalWrite(YELLOW, yellow);
  digitalWrite(GREEN, green);
  delay(ms);
}

void loop() {
  show(HIGH, LOW, LOW, 3000);   // stop
  show(HIGH, HIGH, LOW, 1000);  // get ready
  show(LOW, LOW, HIGH, 3000);   // go
  show(LOW, HIGH, LOW, 1000);   // stop if you can
}
