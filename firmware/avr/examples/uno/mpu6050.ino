// MPU-6050 motion sensor at I2C address 0x68 (SDA on A4, SCL on A5): acceleration in g,
// rotation in degrees a second and the chip's temperature, read straight from its registers.
#include <Wire.h>

const uint8_t MPU = 0x68;

int16_t next16() {
  int16_t high = Wire.read();
  return (high << 8) | Wire.read();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.beginTransmission(MPU);
  Wire.write(0x6B);  // PWR_MGMT_1: wake up
  Wire.write(0);
  if (Wire.endTransmission() != 0) Serial.println(F("MPU6050 not found at 0x68"));
}

void loop() {
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);  // ACCEL_XOUT_H, then the rest in order
  Wire.endTransmission(false);
  Wire.requestFrom(MPU, (uint8_t)14);
  int16_t ax = next16(), ay = next16(), az = next16();
  int16_t raw = next16();
  int16_t gx = next16(), gy = next16(), gz = next16();
  Serial.print(F("a = "));
  Serial.print(ax / 16384.0, 2);
  Serial.print(F(", "));
  Serial.print(ay / 16384.0, 2);
  Serial.print(F(", "));
  Serial.print(az / 16384.0, 2);
  Serial.print(F(" g  rotation = "));
  Serial.print(gx / 131.0, 1);
  Serial.print(F(", "));
  Serial.print(gy / 131.0, 1);
  Serial.print(F(", "));
  Serial.print(gz / 131.0, 1);
  Serial.print(F(" deg/s  "));
  Serial.print(raw / 340.0 + 36.53, 1);
  Serial.println(F(" C"));
  delay(500);
}
