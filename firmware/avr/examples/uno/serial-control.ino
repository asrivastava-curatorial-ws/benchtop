// Serial control: type 1 in the serial monitor to light the LED on pin 13,
// 0 to turn it off.  The board counts the seconds while you do.

const int LED = 13;
unsigned long lastSecond = 0;
int seconds = 0;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Type 1 or 0 and press Send.");
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '1') {
      digitalWrite(LED, HIGH);
      Serial.println("LED on");
    } else if (c == '0') {
      digitalWrite(LED, LOW);
      Serial.println("LED off");
    }
  }
  if (millis() - lastSecond >= 1000) {
    lastSecond += 1000;
    seconds++;
    Serial.print("Running for ");
    Serial.print(seconds);
    Serial.println(" s");
  }
}
