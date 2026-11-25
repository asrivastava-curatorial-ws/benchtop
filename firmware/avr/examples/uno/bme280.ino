// BME280 weather sensor at I2C address 0x76 (SDA on A4, SCL on A5), read with Wire and the
// datasheet's integer compensation formulas, so no library is needed.
#include <Wire.h>

const uint8_t BME = 0x76;
uint16_t T1, P1;
int16_t T2, T3, P2, P3, P4, P5, P6, P7, P8, P9, H2, H4, H5;
uint8_t H1, H3;
int8_t H6;
int32_t tFine;

void readBytes(uint8_t reg, uint8_t *buffer, uint8_t count) {
  Wire.beginTransmission(BME);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(BME, count);
  for (uint8_t i = 0; i < count; i++) buffer[i] = Wire.read();
}

void write8(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(BME);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  uint8_t id;
  readBytes(0xD0, &id, 1);
  if (id != 0x60) {
    Serial.println(F("BME280 not found at 0x76"));
    for (;;) {
    }
  }
  uint8_t c[26];
  readBytes(0x88, c, 26);
  T1 = c[1] << 8 | c[0];
  T2 = c[3] << 8 | c[2];
  T3 = c[5] << 8 | c[4];
  P1 = c[7] << 8 | c[6];
  P2 = c[9] << 8 | c[8];
  P3 = c[11] << 8 | c[10];
  P4 = c[13] << 8 | c[12];
  P5 = c[15] << 8 | c[14];
  P6 = c[17] << 8 | c[16];
  P7 = c[19] << 8 | c[18];
  P8 = c[21] << 8 | c[20];
  P9 = c[23] << 8 | c[22];
  H1 = c[25];
  uint8_t h[7];
  readBytes(0xE1, h, 7);
  H2 = h[1] << 8 | h[0];
  H3 = h[2];
  H4 = ((int8_t)h[3] << 4) | (h[4] & 0x0F);
  H5 = ((int8_t)h[5] << 4) | (h[4] >> 4);
  H6 = (int8_t)h[6];
  write8(0xF2, 0x01);  // humidity oversampling x1
  write8(0xF4, 0x27);  // temperature and pressure x1, normal mode
  write8(0xF5, 0xA0);  // a reading every second
}

int32_t temperature(int32_t adc) {  // hundredths of a degree
  int32_t var1 = ((((adc >> 3) - ((int32_t)T1 << 1))) * ((int32_t)T2)) >> 11;
  int32_t var2 = (((((adc >> 4) - ((int32_t)T1)) * ((adc >> 4) - ((int32_t)T1))) >> 12) * ((int32_t)T3)) >> 14;
  tFine = var1 + var2;
  return (tFine * 5 + 128) >> 8;
}

uint32_t pressure(int32_t adc) {  // pascals times 256
  int64_t var1 = ((int64_t)tFine) - 128000;
  int64_t var2 = var1 * var1 * (int64_t)P6;
  var2 = var2 + ((var1 * (int64_t)P5) << 17);
  var2 = var2 + (((int64_t)P4) << 35);
  var1 = ((var1 * var1 * (int64_t)P3) >> 8) + ((var1 * (int64_t)P2) << 12);
  var1 = (((((int64_t)1) << 47) + var1)) * ((int64_t)P1) >> 33;
  if (var1 == 0) return 0;
  int64_t p = 1048576 - adc;
  p = (((p << 31) - var2) * 3125) / var1;
  var1 = (((int64_t)P9) * (p >> 13) * (p >> 13)) >> 25;
  var2 = (((int64_t)P8) * p) >> 19;
  return (uint32_t)(((p + var1 + var2) >> 8) + (((int64_t)P7) << 4));
}

uint32_t humidity(int32_t adc) {  // percent times 1024
  int32_t v = tFine - ((int32_t)76800);
  v = (((((adc << 14) - (((int32_t)H4) << 20) - (((int32_t)H5) * v)) + ((int32_t)16384)) >> 15) *
       (((((((v * ((int32_t)H6)) >> 10) * (((v * ((int32_t)H3)) >> 11) + ((int32_t)32768))) >> 10) + ((int32_t)2097152)) * ((int32_t)H2) + 8192) >> 14));
  v = v - (((((v >> 15) * (v >> 15)) >> 7) * ((int32_t)H1)) >> 4);
  v = v < 0 ? 0 : v;
  v = v > 419430400 ? 419430400 : v;
  return (uint32_t)(v >> 12);
}

void loop() {
  uint8_t d[8];
  readBytes(0xF7, d, 8);
  int32_t adcP = ((uint32_t)d[0] << 12) | ((uint32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adcT = ((uint32_t)d[3] << 12) | ((uint32_t)d[4] << 4) | (d[5] >> 4);
  int32_t adcH = ((uint32_t)d[6] << 8) | d[7];
  float t = temperature(adcT) / 100.0;
  float p = pressure(adcP) / 25600.0;
  float h = humidity(adcH) / 1024.0;
  Serial.print(F("Temperature "));
  Serial.print(t, 2);
  Serial.print(F(" C  Pressure "));
  Serial.print(p, 2);
  Serial.print(F(" hPa  Humidity "));
  Serial.print(h, 1);
  Serial.println(F(" %"));
  delay(1000);
}
