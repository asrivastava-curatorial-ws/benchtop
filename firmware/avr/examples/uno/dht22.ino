// DHT22: temperature and humidity from the sensor on pin 2, every two seconds, in the serial monitor.
#include <DHT.h>

DHT dht(2, DHT22);

void setup() {
  Serial.begin(115200);
  dht.begin();
  Serial.println(F("DHT22 on pin 2"));
}

void loop() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println(F("No answer from the sensor: check its wiring and power"));
  } else {
    Serial.print(F("Temperature: "));
    Serial.print(temperature, 1);
    Serial.print(F(" C  Humidity: "));
    Serial.print(humidity, 1);
    Serial.print(F(" %  Feels like: "));
    Serial.print(dht.computeHeatIndex(temperature, humidity, false), 1);
    Serial.println(F(" C"));
  }
  delay(2000);
}
