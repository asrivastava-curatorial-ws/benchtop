/* The functions of Benchtop's small Arduino-style core.  SPDX-License-Identifier: MIT */
#include "Arduino.h"

/* ------------------------------------------------------------------ time -- */

/* Timer 0 overflows every 64 × 256 clock cycles; millis() keeps the remainder as the Arduino core does. */
#define MICROS_PER_OVERFLOW (clockCyclesToMicroseconds(64UL * 256UL))
#define MILLIS_STEP (MICROS_PER_OVERFLOW / 1000)
#define FRACTION_STEP ((MICROS_PER_OVERFLOW % 1000) >> 3)
#define FRACTION_MAX (1000 >> 3)

#if defined(__AVR_ATtiny85__)
#define TIMER0_FLAGS TIFR
#define TIMER0_MASK TIMSK
#else
#define TIMER0_FLAGS TIFR0
#define TIMER0_MASK TIMSK0
#endif

static volatile unsigned long timer0Overflows = 0;
static volatile unsigned long timer0Millis = 0;
static volatile uint8_t timer0Fraction = 0;

ISR(TIMER0_OVF_vect) {
  unsigned long m = timer0Millis + MILLIS_STEP;
  uint8_t f = timer0Fraction + FRACTION_STEP;
  if (f >= FRACTION_MAX) {
    f -= FRACTION_MAX;
    m += 1;
  }
  timer0Fraction = f;
  timer0Millis = m;
  timer0Overflows++;
}

unsigned long millis(void) {
  uint8_t s = SREG;
  cli();
  unsigned long m = timer0Millis;
  SREG = s;
  return m;
}

unsigned long micros(void) {
  uint8_t s = SREG;
  cli();
  unsigned long overflows = timer0Overflows;
  uint8_t t = TCNT0;
  if ((TIMER0_FLAGS & _BV(TOV0)) && (t < 255)) overflows++;
  SREG = s;
  return ((overflows << 8) + t) * (64 / clockCyclesPerMicrosecond());
}

void yield(void) {}

void delay(unsigned long ms) {
  unsigned long start = micros();
  while (ms > 0) {
    yield();
    while (ms > 0 && (micros() - start) >= 1000) {
      ms--;
      start += 1000;
    }
  }
}

/* A busy loop of four cycles a turn, less the time the call takes. */
void delayMicroseconds(unsigned int us) {
#if F_CPU >= 16000000L
  if (us <= 1) return;
  us <<= 2;
  us -= 5;
#else
  if (us <= 2) return;
  us <<= 1;
  us -= 4;
#endif
  __asm__ __volatile__("1: sbiw %0,1\n\tbrne 1b" : "=w"(us) : "0"(us));
}

long map(long x, long inMin, long inMax, long outMin, long outMax) { return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin; }

long random(long howBig) { return howBig <= 0 ? 0 : (long)(::random() % howBig); }
long random(long howSmall, long howBig) { return howSmall >= howBig ? howSmall : howSmall + random(howBig - howSmall); }
void randomSeed(unsigned long seed) {
  if (seed != 0) srandom(seed);
}

/* ------------------------------------------------------------------ pins -- */

/* Port numbers as the Arduino core counts them: A = 1, B = 2 … (no I), L = 12; and the address of each PORT register. */
#if defined(__AVR_ATmega2560__)
static const uint16_t PORT_REGISTERS[] PROGMEM = {0, 0x22, 0x25, 0x28, 0x2b, 0x2e, 0x31, 0x34, 0x102, 0, 0x105, 0x108, 0x10b};
static const uint8_t PIN_PORT[] PROGMEM = {
    5, 5, 5, 5, 7, 5, 8, 8, 8, 8, 2, 2, 2, 2, 10, 10, 8, 8, 4, 4, 4, 4,  // 0–21
    1, 1, 1, 1, 1, 1, 1, 1,                                            // 22–29
    3, 3, 3, 3, 3, 3, 3, 3,                                            // 30–37
    4, 7, 7, 7,                                                        // 38–41
    12, 12, 12, 12, 12, 12, 12, 12,                                    // 42–49
    2, 2, 2, 2,                                                        // 50–53
    6, 6, 6, 6, 6, 6, 6, 6,                                            // A0–A7
    11, 11, 11, 11, 11, 11, 11, 11,                                    // A8–A15
};
static const uint8_t PIN_BIT[] PROGMEM = {
    0, 1, 4, 5, 5, 3, 3, 4, 5, 6, 4, 5, 6, 7, 1, 0, 1, 0, 3, 2, 1, 0,  // 0–21
    0, 1, 2, 3, 4, 5, 6, 7,                                            // 22–29
    7, 6, 5, 4, 3, 2, 1, 0,                                            // 30–37
    7, 2, 1, 0,                                                        // 38–41
    7, 6, 5, 4, 3, 2, 1, 0,                                            // 42–49
    3, 2, 1, 0,                                                        // 50–53
    0, 1, 2, 3, 4, 5, 6, 7,                                            // A0–A7
    0, 1, 2, 3, 4, 5, 6, 7,                                            // A8–A15
};
#elif defined(__AVR_ATtiny85__)
static const uint16_t PORT_REGISTERS[] PROGMEM = {0, 0, 0x38};
static const uint8_t PIN_PORT[] PROGMEM = {2, 2, 2, 2, 2, 2};
static const uint8_t PIN_BIT[] PROGMEM = {0, 1, 2, 3, 4, 5};
#else
static const uint16_t PORT_REGISTERS[] PROGMEM = {0, 0, 0x25, 0x28, 0x2b};
/* Pins 20 and 21 (the Nano's A6 and A7) have no port. */
static const uint8_t PIN_PORT[] PROGMEM = {4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 0, 0};
static const uint8_t PIN_BIT[] PROGMEM = {0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 0};
#endif

uint8_t digitalPinToPort(uint8_t pin) { return pin < sizeof(PIN_PORT) ? pgm_read_byte(&PIN_PORT[pin]) : NOT_A_PORT; }
uint8_t digitalPinToBitMask(uint8_t pin) { return pin < sizeof(PIN_BIT) ? _BV(pgm_read_byte(&PIN_BIT[pin])) : 0; }
volatile uint8_t *portOutputRegister(uint8_t port) { return (volatile uint8_t *)pgm_read_word(&PORT_REGISTERS[port]); }
volatile uint8_t *portModeRegister(uint8_t port) { return portOutputRegister(port) - 1; }
volatile uint8_t *portInputRegister(uint8_t port) { return portOutputRegister(port) - 2; }

/* Turns off the PWM output on a pin, as digitalWrite and digitalRead do. */
static void pwmOff(uint8_t pin) {
  switch (pin) {
#if defined(__AVR_ATmega2560__)
    case 2: TCCR3A &= ~_BV(COM3B1); break;
    case 3: TCCR3A &= ~_BV(COM3C1); break;
    case 4: TCCR0A &= ~_BV(COM0B1); break;
    case 5: TCCR3A &= ~_BV(COM3A1); break;
    case 6: TCCR4A &= ~_BV(COM4A1); break;
    case 7: TCCR4A &= ~_BV(COM4B1); break;
    case 8: TCCR4A &= ~_BV(COM4C1); break;
    case 9: TCCR2A &= ~_BV(COM2B1); break;
    case 10: TCCR2A &= ~_BV(COM2A1); break;
    case 11: TCCR1A &= ~_BV(COM1A1); break;
    case 12: TCCR1A &= ~_BV(COM1B1); break;
    case 13: TCCR0A &= ~_BV(COM0A1); break;
    case 44: TCCR5A &= ~_BV(COM5C1); break;
    case 45: TCCR5A &= ~_BV(COM5B1); break;
    case 46: TCCR5A &= ~_BV(COM5A1); break;
#elif defined(__AVR_ATtiny85__)
    case 0: TCCR0A &= ~_BV(COM0A1); break;
    case 1: TCCR0A &= ~_BV(COM0B1); break;
    case 4: GTCCR &= ~_BV(COM1B1); break;
#else
    case 3: TCCR2A &= ~_BV(COM2B1); break;
    case 5: TCCR0A &= ~_BV(COM0B1); break;
    case 6: TCCR0A &= ~_BV(COM0A1); break;
    case 9: TCCR1A &= ~_BV(COM1A1); break;
    case 10: TCCR1A &= ~_BV(COM1B1); break;
    case 11: TCCR2A &= ~_BV(COM2A1); break;
#endif
    default: break;
  }
}

void pinMode(uint8_t pin, uint8_t mode) {
  uint8_t port = digitalPinToPort(pin);
  if (port == NOT_A_PORT) return;
  uint8_t mask = digitalPinToBitMask(pin);
  volatile uint8_t *ddr = portModeRegister(port);
  volatile uint8_t *out = portOutputRegister(port);
  uint8_t s = SREG;
  cli();
  if (mode == OUTPUT) {
    *ddr |= mask;
  } else {
    *ddr &= ~mask;
    if (mode == INPUT_PULLUP) *out |= mask;
    else *out &= ~mask;
  }
  SREG = s;
}

void digitalWrite(uint8_t pin, uint8_t value) {
  uint8_t port = digitalPinToPort(pin);
  if (port == NOT_A_PORT) return;
  pwmOff(pin);
  uint8_t mask = digitalPinToBitMask(pin);
  volatile uint8_t *out = portOutputRegister(port);
  uint8_t s = SREG;
  cli();
  if (value) *out |= mask;
  else *out &= ~mask;
  SREG = s;
}

int digitalRead(uint8_t pin) {
  uint8_t port = digitalPinToPort(pin);
  if (port == NOT_A_PORT) return LOW;
  pwmOff(pin);
  return (*portInputRegister(port) & digitalPinToBitMask(pin)) ? HIGH : LOW;
}

/* ---------------------------------------------------------------- analog -- */

void analogReference(uint8_t) {}

int analogRead(uint8_t pin) {
#if defined(__AVR_ATmega2560__)
  uint8_t channel = pin >= 54 ? pin - 54 : pin;
  ADCSRB = (ADCSRB & ~_BV(MUX5)) | (((channel >> 3) & 1) << MUX5);
  ADMUX = _BV(REFS0) | (channel & 7);
#elif defined(__AVR_ATtiny85__)
  uint8_t channel;
  if (pin & 0x80) channel = pin & 3;
  else channel = pin == 5 ? 0 : pin == 2 ? 1 : pin == 4 ? 2 : pin == 3 ? 3 : 0;
  ADMUX = channel;
#else
  uint8_t channel = pin >= 14 ? pin - 14 : pin;
  ADMUX = _BV(REFS0) | (channel & 7);
#endif
  ADCSRA |= _BV(ADSC);
  while (ADCSRA & _BV(ADSC)) {
  }
  uint8_t low = ADCL;
  uint8_t high = ADCH;
  return (high << 8) | low;
}

void analogWrite(uint8_t pin, int value) {
  pinMode(pin, OUTPUT);
  if (value <= 0) {
    digitalWrite(pin, LOW);
    return;
  }
  if (value >= 255) {
    digitalWrite(pin, HIGH);
    return;
  }
  switch (pin) {
#if defined(__AVR_ATmega2560__)
    case 2: TCCR3A |= _BV(COM3B1); OCR3B = value; break;
    case 3: TCCR3A |= _BV(COM3C1); OCR3C = value; break;
    case 4: TCCR0A |= _BV(COM0B1); OCR0B = value; break;
    case 5: TCCR3A |= _BV(COM3A1); OCR3A = value; break;
    case 6: TCCR4A |= _BV(COM4A1); OCR4A = value; break;
    case 7: TCCR4A |= _BV(COM4B1); OCR4B = value; break;
    case 8: TCCR4A |= _BV(COM4C1); OCR4C = value; break;
    case 9: TCCR2A |= _BV(COM2B1); OCR2B = value; break;
    case 10: TCCR2A |= _BV(COM2A1); OCR2A = value; break;
    case 11: TCCR1A |= _BV(COM1A1); OCR1A = value; break;
    case 12: TCCR1A |= _BV(COM1B1); OCR1B = value; break;
    case 13: TCCR0A |= _BV(COM0A1); OCR0A = value; break;
    case 44: TCCR5A |= _BV(COM5C1); OCR5C = value; break;
    case 45: TCCR5A |= _BV(COM5B1); OCR5B = value; break;
    case 46: TCCR5A |= _BV(COM5A1); OCR5A = value; break;
#elif defined(__AVR_ATtiny85__)
    case 0: TCCR0A |= _BV(COM0A1); OCR0A = value; break;
    case 1: TCCR0A |= _BV(COM0B1); OCR0B = value; break;
    case 4: GTCCR |= _BV(PWM1B) | _BV(COM1B1); OCR1B = value; break;
#else
    case 3: TCCR2A |= _BV(COM2B1); OCR2B = value; break;
    case 5: TCCR0A |= _BV(COM0B1); OCR0B = value; break;
    case 6: TCCR0A |= _BV(COM0A1); OCR0A = value; break;
    case 9: TCCR1A |= _BV(COM1A1); OCR1A = value; break;
    case 10: TCCR1A |= _BV(COM1B1); OCR1B = value; break;
    case 11: TCCR2A |= _BV(COM2A1); OCR2A = value; break;
#endif
    default: digitalWrite(pin, value >= 128 ? HIGH : LOW); break;
  }
}

/* ------------------------------------------------------------ advanced IO -- */

unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  uint8_t port = digitalPinToPort(pin);
  if (port == NOT_A_PORT) return 0;
  uint8_t mask = digitalPinToBitMask(pin);
  volatile uint8_t *in = portInputRegister(port);
  uint8_t want = state ? mask : 0;
  unsigned long start = micros();
  // Wait for a pulse in progress to end, then for the pulse to start.
  while ((*in & mask) == want)
    if (micros() - start >= timeout) return 0;
  while ((*in & mask) != want)
    if (micros() - start >= timeout) return 0;
  unsigned long began = micros();
  while ((*in & mask) == want)
    if (micros() - start >= timeout) return 0;
  return micros() - began;
}

void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value) {
  for (uint8_t i = 0; i < 8; i++) {
    if (bitOrder == LSBFIRST) digitalWrite(dataPin, value & (1 << i));
    else digitalWrite(dataPin, value & (1 << (7 - i)));
    digitalWrite(clockPin, HIGH);
    digitalWrite(clockPin, LOW);
  }
}

uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder) {
  uint8_t value = 0;
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(clockPin, HIGH);
    if (bitOrder == LSBFIRST) value |= digitalRead(dataPin) << i;
    else value |= digitalRead(dataPin) << (7 - i);
    digitalWrite(clockPin, LOW);
  }
  return value;
}

/* ------------------------------------------------------------ interrupts -- */

#if defined(__AVR_ATmega2560__)
#define EXTERNAL_COUNT 8
#elif defined(__AVR_ATtiny85__)
#define EXTERNAL_COUNT 1
#else
#define EXTERNAL_COUNT 2
#endif

static void (*volatile handlers[EXTERNAL_COUNT])(void);

#if defined(__AVR_ATmega2560__)
/* Arduino interrupt numbers 0 to 5 are INT4, INT5, INT0, INT1, INT2 and INT3. */
static uint8_t externalOf(uint8_t interrupt) {
  static const uint8_t order[] = {4, 5, 0, 1, 2, 3};
  return interrupt < 6 ? order[interrupt] : 0xff;
}
#else
static uint8_t externalOf(uint8_t interrupt) { return interrupt < EXTERNAL_COUNT ? interrupt : 0xff; }
#endif

void attachInterrupt(uint8_t interrupt, void (*handler)(void), int mode) {
  uint8_t n = externalOf(interrupt);
  if (n == 0xff) return;
  handlers[n] = handler;
#if defined(__AVR_ATtiny85__)
  MCUCR = (MCUCR & ~(_BV(ISC01) | _BV(ISC00))) | (mode & 3);
  GIMSK |= _BV(INT0);
#elif defined(__AVR_ATmega2560__)
  if (n < 4) EICRA = (EICRA & ~(3 << (2 * n))) | ((mode & 3) << (2 * n));
  else EICRB = (EICRB & ~(3 << (2 * (n - 4)))) | ((mode & 3) << (2 * (n - 4)));
  EIMSK |= _BV(n);
#else
  EICRA = (EICRA & ~(3 << (2 * n))) | ((mode & 3) << (2 * n));
  EIMSK |= _BV(n);
#endif
}

void detachInterrupt(uint8_t interrupt) {
  uint8_t n = externalOf(interrupt);
  if (n == 0xff) return;
#if defined(__AVR_ATtiny85__)
  GIMSK &= ~_BV(INT0);
#else
  EIMSK &= ~_BV(n);
#endif
  handlers[n] = 0;
}

#define EXTERNAL(n)                \
  ISR(INT##n##_vect) {             \
    if (handlers[n]) handlers[n](); \
  }
EXTERNAL(0)
#if EXTERNAL_COUNT > 1
EXTERNAL(1)
#endif
#if EXTERNAL_COUNT > 2
EXTERNAL(2)
EXTERNAL(3)
EXTERNAL(4)
EXTERNAL(5)
EXTERNAL(6)
EXTERNAL(7)
#endif

/* ------------------------------------------------------------------ tone -- */

static volatile uint8_t *tonePort;
static uint8_t toneMask;
static volatile long toneToggles;

#if defined(__AVR_ATtiny85__)
/* Timer 1 in CTC mode toggles the pin; its prescaler doubles at each step (1 to 16384). */
void tone(uint8_t pin, unsigned int frequency, unsigned long duration) {
  if (!frequency) return;
  pinMode(pin, OUTPUT);
  tonePort = portOutputRegister(digitalPinToPort(pin));
  toneMask = digitalPinToBitMask(pin);
  uint8_t cs = 1;
  unsigned long top = F_CPU / 2 / frequency;
  while (top > 256 && cs < 15) {
    top >>= 1;
    cs++;
  }
  toneToggles = duration ? (long)(2UL * frequency * duration / 1000) : -1;
  TCCR1 = _BV(CTC1) | cs;
  OCR1C = top - 1;
  OCR1A = top - 1;
  TIMSK |= _BV(OCIE1A);
}

void noTone(uint8_t pin) {
  TIMSK &= ~_BV(OCIE1A);
  TCCR1 = _BV(CS12) | _BV(CS11) | _BV(CS10);
  OCR1C = 255;
  digitalWrite(pin, LOW);
}

ISR(TIMER1_COMPA_vect) {
#else
/* Timer 2 in CTC mode toggles the pin (PWM on timer 2's pins stops meanwhile, as on an Arduino). */
void tone(uint8_t pin, unsigned int frequency, unsigned long duration) {
  if (!frequency) return;
  pinMode(pin, OUTPUT);
  tonePort = portOutputRegister(digitalPinToPort(pin));
  toneMask = digitalPinToBitMask(pin);
  static const uint16_t prescalers[] = {1, 8, 32, 64, 128, 256, 1024};
  uint8_t cs = 0;
  unsigned long top = F_CPU / 2 / frequency;
  while (cs < 6 && top / prescalers[cs] > 256) cs++;
  top /= prescalers[cs];
  toneToggles = duration ? (long)(2UL * frequency * duration / 1000) : -1;
  TCCR2A = _BV(WGM21);
  TCCR2B = cs + 1;
  OCR2A = top ? top - 1 : 0;
  TIMSK2 |= _BV(OCIE2A);
}

void noTone(uint8_t pin) {
  TIMSK2 &= ~_BV(OCIE2A);
  TCCR2A = _BV(WGM20);
  TCCR2B = _BV(CS22);
  digitalWrite(pin, LOW);
}

ISR(TIMER2_COMPA_vect) {
#endif
  if (toneToggles != 0) {
    *tonePort ^= toneMask;
    if (toneToggles > 0) toneToggles--;
  } else {
#if defined(__AVR_ATtiny85__)
    TIMSK &= ~_BV(OCIE1A);
#else
    TIMSK2 &= ~_BV(OCIE2A);
#endif
    *tonePort &= ~toneMask;
  }
}

/* ----------------------------------------------------------------- print -- */

size_t Print::write(const uint8_t *buffer, size_t size) {
  size_t n = 0;
  while (size--) n += write(*buffer++);
  return n;
}

size_t Print::print(const __FlashStringHelper *text) {
  const char *p = reinterpret_cast<const char *>(text);
  size_t n = 0;
  for (char c = pgm_read_byte(p); c; c = pgm_read_byte(++p)) n += write((uint8_t)c);
  return n;
}
size_t Print::print(const char text[]) { return write(text); }
size_t Print::print(char c) { return write((uint8_t)c); }
size_t Print::print(unsigned char value, int base) { return print((unsigned long)value, base); }
size_t Print::print(int value, int base) { return print((long)value, base); }
size_t Print::print(unsigned int value, int base) { return print((unsigned long)value, base); }
size_t Print::print(long value, int base) {
  if (base == 0) return write((uint8_t)value);
  if (base == 10 && value < 0) return write('-') + printNumber(-value, 10);
  return printNumber(value, base);
}
size_t Print::print(unsigned long value, int base) {
  if (base == 0) return write((uint8_t)value);
  return printNumber(value, base);
}
size_t Print::print(double value, int digits) { return printFloat(value, digits); }
size_t Print::println(void) { return write('\r') + write('\n'); }
size_t Print::println(const __FlashStringHelper *text) { return print(text) + println(); }
size_t Print::println(const char text[]) { return print(text) + println(); }
size_t Print::println(char c) { return print(c) + println(); }
size_t Print::println(unsigned char value, int base) { return print(value, base) + println(); }
size_t Print::println(int value, int base) { return print(value, base) + println(); }
size_t Print::println(unsigned int value, int base) { return print(value, base) + println(); }
size_t Print::println(long value, int base) { return print(value, base) + println(); }
size_t Print::println(unsigned long value, int base) { return print(value, base) + println(); }
size_t Print::println(double value, int digits) { return print(value, digits) + println(); }

size_t Print::printNumber(unsigned long value, uint8_t base) {
  char buffer[8 * sizeof(long) + 1];
  char *p = &buffer[sizeof(buffer) - 1];
  *p = '\0';
  if (base < 2) base = 10;
  do {
    char digit = value % base;
    value /= base;
    *--p = digit < 10 ? digit + '0' : digit + 'A' - 10;
  } while (value);
  return write(p);
}

size_t Print::printFloat(double value, uint8_t digits) {
  if (isnan(value)) return print("nan");
  if (isinf(value)) return print("inf");
  if (value > 4294967040.0 || value < -4294967040.0) return print("ovf");
  size_t n = 0;
  if (value < 0.0) {
    n += write('-');
    value = -value;
  }
  double rounding = 0.5;
  for (uint8_t i = 0; i < digits; i++) rounding /= 10.0;
  value += rounding;
  unsigned long whole = (unsigned long)value;
  double rest = value - (double)whole;
  n += print(whole);
  if (digits > 0) n += write('.');
  while (digits-- > 0) {
    rest *= 10.0;
    unsigned int d = (unsigned int)rest;
    n += write('0' + d);
    rest -= d;
  }
  return n;
}

/* ---------------------------------------------------------------- stream -- */

int Stream::timedRead(void) {
  unsigned long start = millis();
  do {
    int c = read();
    if (c >= 0) return c;
  } while (millis() - start < timeout);
  return -1;
}

int Stream::timedPeek(void) {
  unsigned long start = millis();
  do {
    int c = peek();
    if (c >= 0) return c;
  } while (millis() - start < timeout);
  return -1;
}

long Stream::parseInt(void) {
  int c;
  do {
    c = timedPeek();
    if (c < 0) return 0;
    if (c == '-' || (c >= '0' && c <= '9')) break;
    read();
  } while (true);
  bool negative = false;
  long value = 0;
  while ((c = timedPeek()) >= 0) {
    if (c == '-' && !negative && value == 0) negative = true;
    else if (c >= '0' && c <= '9') value = value * 10 + c - '0';
    else break;
    read();
  }
  return negative ? -value : value;
}

float Stream::parseFloat(void) {
  long whole = parseInt();
  if (peek() != '.') return whole;
  read();
  float fraction = 0;
  float scale = 0.1f;
  int c;
  while ((c = timedPeek()) >= '0' && c <= '9') {
    fraction += (c - '0') * scale;
    scale /= 10;
    read();
  }
  return whole < 0 ? whole - fraction : whole + fraction;
}

size_t Stream::readBytesUntil(char terminator, char *buffer, size_t length) {
  size_t n = 0;
  while (n < length) {
    int c = timedRead();
    if (c < 0 || c == terminator) break;
    buffer[n++] = (char)c;
  }
  return n;
}

/* ---------------------------------------------------------------- serial -- */

HardwareSerial Serial;

#if defined(__AVR_ATtiny85__)
/* No serial port: Serial sends on PB0 by software at the speed begin() is given (the simulator reads it at 9600 baud). */
static uint16_t serialLoops = 0;

void HardwareSerial::begin(unsigned long baud) {
  serialLoops = (uint16_t)((F_CPU / baud - 30) / 4);
  PORTB |= _BV(PB0);
  DDRB |= _BV(PB0);
}
void HardwareSerial::end(void) { serialLoops = 0; }
int HardwareSerial::available(void) { return 0; }
int HardwareSerial::read(void) { return -1; }
int HardwareSerial::peek(void) { return -1; }
void HardwareSerial::flush(void) {}

static inline void bitWait(uint16_t loops) {
  __asm__ __volatile__("1: sbiw %0,1\n\tbrne 1b" : "=w"(loops) : "0"(loops));
}

size_t HardwareSerial::write(uint8_t c) {
  if (!serialLoops) return 0;
  uint8_t s = SREG;
  cli();
  PORTB &= ~_BV(PB0);
  bitWait(serialLoops);
  for (uint8_t i = 0; i < 8; i++) {
    if (c & 1) PORTB |= _BV(PB0);
    else PORTB &= ~_BV(PB0);
    c >>= 1;
    bitWait(serialLoops);
  }
  PORTB |= _BV(PB0);
  bitWait(serialLoops);
  SREG = s;
  return 1;
}
#else
static volatile uint8_t rxBuffer[64];
static volatile uint8_t rxHead = 0;
static volatile uint8_t rxTail = 0;

#if defined(__AVR_ATmega2560__)
ISR(USART0_RX_vect) {
#else
ISR(USART_RX_vect) {
#endif
  uint8_t c = UDR0;
  uint8_t next = (rxHead + 1) & 63;
  if (next != rxTail) {
    rxBuffer[rxHead] = c;
    rxHead = next;
  }
}

void HardwareSerial::begin(unsigned long baud) {
  UCSR0A = _BV(U2X0);
  UBRR0 = (uint16_t)((F_CPU / 4 / baud - 1) / 2);
  UCSR0C = _BV(UCSZ01) | _BV(UCSZ00);
  UCSR0B = _BV(TXEN0) | _BV(RXEN0) | _BV(RXCIE0);
}

void HardwareSerial::end(void) { UCSR0B = 0; }

size_t HardwareSerial::write(uint8_t c) {
  while (!(UCSR0A & _BV(UDRE0))) {
  }
  UDR0 = c;
  return 1;
}

void HardwareSerial::flush(void) {
  while (!(UCSR0A & _BV(UDRE0))) {
  }
}

int HardwareSerial::available(void) { return (rxHead - rxTail) & 63; }

int HardwareSerial::peek(void) { return rxHead == rxTail ? -1 : rxBuffer[rxTail]; }

int HardwareSerial::read(void) {
  if (rxHead == rxTail) return -1;
  uint8_t c = rxBuffer[rxTail];
  rxTail = (rxTail + 1) & 63;
  return c;
}
#endif

/* -------------------------------------------------------------------- C++ -- */

/* A pure virtual function was called (a bug in the sketch): stop here. */
extern "C" void __cxa_pure_virtual(void) {
  cli();
  for (;;) {
  }
}

/* ----------------------------------------------------------------- start -- */

int main(void) {
  // Timer 0: fast PWM, clock/64, overflow interrupt for millis().
  TCCR0A = _BV(WGM01) | _BV(WGM00);
  TCCR0B = _BV(CS01) | _BV(CS00);
  TIMER0_MASK |= _BV(TOIE0);
#if defined(__AVR_ATtiny85__)
  // Timer 1: PWM on PB4, clock/64.
  TCCR1 = _BV(CS12) | _BV(CS11) | _BV(CS10);
  OCR1C = 255;
  ADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1);
#else
  // The other timers: 8-bit phase-correct PWM, clock/64 (about 490 Hz).
  TCCR1A = _BV(WGM10);
  TCCR1B = _BV(CS11) | _BV(CS10);
  TCCR2A = _BV(WGM20);
  TCCR2B = _BV(CS22);
#if defined(__AVR_ATmega2560__)
  TCCR3A = _BV(WGM30);
  TCCR3B = _BV(CS31) | _BV(CS30);
  TCCR4A = _BV(WGM40);
  TCCR4B = _BV(CS41) | _BV(CS40);
  TCCR5A = _BV(WGM50);
  TCCR5B = _BV(CS51) | _BV(CS50);
#endif
  ADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1) | _BV(ADPS0);
#endif
  sei();
  setup();
  for (;;) loop();
}
