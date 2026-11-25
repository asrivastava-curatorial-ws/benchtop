// Clock: a DS1307 real-time clock and an I2C LCD share the I2C bus (addresses 0x68 and 0x27).
// The clock keeps the computer's time when the simulation starts.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

byte fromBcd(byte v) { return (v >> 4) * 10 + (v & 0x0F); }

void two(int v) {
  if (v < 10) lcd.print('0');
  lcd.print(v);
}

void setup() {
  lcd.init();
  lcd.backlight();
}

void loop() {
  Wire.beginTransmission(0x68);
  Wire.write(0);
  Wire.endTransmission();
  if (Wire.requestFrom(0x68, 7) != 7) {
    lcd.setCursor(0, 0);
    lcd.print("No clock found  ");
    delay(500);
    return;
  }
  byte second = fromBcd(Wire.read() & 0x7F);
  byte minute = fromBcd(Wire.read());
  byte hour = fromBcd(Wire.read() & 0x3F);
  Wire.read();  // day of the week
  byte date = fromBcd(Wire.read());
  byte month = fromBcd(Wire.read());
  byte year = fromBcd(Wire.read());
  lcd.setCursor(0, 0);
  lcd.print("Date 20");
  two(year);
  lcd.print('-');
  two(month);
  lcd.print('-');
  two(date);
  lcd.setCursor(0, 1);
  lcd.print("Time ");
  two(hour);
  lcd.print(':');
  two(minute);
  lcd.print(':');
  two(second);
  delay(200);
}
