// Keypad lock: rows on pins 9 to 6, columns on 5 to 2. Type 1234 then # to light the LED on pin 13;
// * clears what was typed.
#include <Keypad.h>

const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {{'1', '2', '3', 'A'}, {'4', '5', '6', 'B'}, {'7', '8', '9', 'C'}, {'*', '0', '#', 'D'}};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

char typed[8];
byte length = 0;

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(115200);
  Serial.println(F("Type the code and press #"));
}

void loop() {
  char key = keypad.getKey();
  if (!key) return;
  Serial.print(F("Key "));
  Serial.println(key);
  if (key == '*') {
    length = 0;
  } else if (key == '#') {
    typed[length] = '\0';
    bool right = strcmp(typed, "1234") == 0;
    Serial.println(right ? F("Unlocked") : F("Wrong code"));
    digitalWrite(13, right ? HIGH : LOW);
    length = 0;
  } else if (length < sizeof(typed) - 1) {
    typed[length++] = key;
  }
}
