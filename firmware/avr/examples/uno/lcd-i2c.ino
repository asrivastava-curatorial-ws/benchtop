// I2C LCD: a 16x2 character display with a PCF8574 backpack at address 0x27 (SDA on A4, SCL on A5).
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

// A custom character: a small heart.
byte heart[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, heart);
  lcd.setCursor(0, 0);
  lcd.print("Hello, world! ");
  lcd.write((uint8_t)0);
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("Up ");
  lcd.print(millis() / 1000);
  lcd.print(" s");
  delay(200);
}
