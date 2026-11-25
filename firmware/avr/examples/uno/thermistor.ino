// Thermometer: a 10 kOhm NTC thermistor (B = 3950) from 5 V to A0 and 10 kOhm from A0 to ground.
const float BETA = 3950;
const float R25 = 10000;
const float FIXED = 10000;

void setup() {
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(A0);
  // The thermistor's resistance from the divider, then the temperature from the B equation.
  float resistance = FIXED * (1023.0 / reading - 1);
  float kelvin = 1 / (1 / 298.15 + log(resistance / R25) / BETA);
  Serial.print(F("Temperature: "));
  Serial.print(kelvin - 273.15, 1);
  Serial.println(F(" C"));
  delay(500);
}
