// ATtiny85: no serial port, so Serial sends by software on PB0 at 9600 baud (the simulator's serial
// monitor reads it); the LED on PB1 blinks with each line.
unsigned long count = 0;

void setup() {
  Serial.begin(9600);
  pinMode(1, OUTPUT);
}

void loop() {
  Serial.print(F("ATtiny85 count "));
  Serial.println(count++);
  digitalWrite(1, HIGH);
  delay(250);
  digitalWrite(1, LOW);
  delay(750);
}
