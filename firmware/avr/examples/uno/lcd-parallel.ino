// Character LCD wired in parallel (4-bit): RS 12, E 11, D4 5, D5 4, D6 3, D7 2, as in the Arduino tutorial.
#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  lcd.begin(16, 2);
  lcd.print("hello, world!");
}

void loop() {
  // Seconds since the sketch started, on the second line.
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  delay(100);
}
