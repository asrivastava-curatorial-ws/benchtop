// Rotary encoder (KY-040): CLK on pin 2, DT on pin 3, the push switch on pin 4.
// Turning it counts up or down; pressing the knob sets the count back to 0.
const int CLK = 2;
const int DT = 3;
const int SW = 4;

int position = 0;
int lastClk;

void setup() {
  pinMode(CLK, INPUT);
  pinMode(DT, INPUT);
  pinMode(SW, INPUT_PULLUP);
  lastClk = digitalRead(CLK);
  Serial.begin(115200);
  Serial.println(F("Turn the knob"));
}

void loop() {
  int clk = digitalRead(CLK);
  if (clk != lastClk && clk == LOW) {
    // DT still high when CLK falls: turning clockwise.
    if (digitalRead(DT) != clk) position++;
    else position--;
    Serial.print(F("Position: "));
    Serial.println(position);
  }
  lastClk = clk;
  if (digitalRead(SW) == LOW) {
    position = 0;
    Serial.println(F("Pressed: back to 0"));
    delay(300);
  }
}
