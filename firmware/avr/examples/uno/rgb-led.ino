// RGB LED (common cathode): red on pin 9, green on 10, blue on 11, each through 220 Ohm.
// PWM mixes the colours round the colour wheel.
void setColour(int hue) {
  // Hue 0-359 to red, green and blue (full saturation and brightness).
  int sector = hue / 60;
  int rise = (hue % 60) * 255 / 60;
  int r = 0, g = 0, b = 0;
  switch (sector) {
    case 0: r = 255; g = rise; break;
    case 1: r = 255 - rise; g = 255; break;
    case 2: g = 255; b = rise; break;
    case 3: g = 255 - rise; b = 255; break;
    case 4: r = rise; b = 255; break;
    default: r = 255; b = 255 - rise; break;
  }
  analogWrite(9, r);
  analogWrite(10, g);
  analogWrite(11, b);
}

void setup() {}

void loop() {
  for (int hue = 0; hue < 360; hue += 2) {
    setColour(hue);
    delay(20);
  }
}
