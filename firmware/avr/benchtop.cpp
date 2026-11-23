/* SPDX-License-Identifier: MIT */
#include "benchtop.h"
#include <util/delay.h>

static volatile unsigned long timer0Overflows = 0;
static volatile unsigned long timer0Millis = 0;
static volatile uint8_t timer0Fraction = 0;

ISR(TIMER0_OVF_vect) {
  // One overflow every 1024 µs: add 1 ms and keep the 24 µs remainder (as the Arduino core does).
  unsigned long m = timer0Millis + 1;
  uint8_t f = timer0Fraction + 3;
  if (f >= 125) {
    f -= 125;
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
  if ((TIFR0 & _BV(TOV0)) && (t < 255)) overflows++;
  SREG = s;
  return ((overflows << 8) + t) * 4;
}

void delay(unsigned long ms) {
  unsigned long start = micros();
  while (ms > 0) {
    while (ms > 0 && (micros() - start) >= 1000) {
      ms--;
      start += 1000;
    }
  }
}

void delayMicroseconds(unsigned int us) {
  while (us--) _delay_us(1);
}

long map(long x, long inMin, long inMax, long outMin, long outMax) {
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

long random(long howBig) { return howBig <= 0 ? 0 : (long)(rand() % howBig); }
long random(long howSmall, long howBig) { return howSmall >= howBig ? howSmall : howSmall + random(howBig - howSmall); }
void randomSeed(unsigned long seed) { srand((unsigned int)seed); }

static volatile uint8_t *ddr(uint8_t pin) { return pin < 8 ? &DDRD : pin < 14 ? &DDRB : &DDRC; }
static volatile uint8_t *port(uint8_t pin) { return pin < 8 ? &PORTD : pin < 14 ? &PORTB : &PORTC; }
static volatile uint8_t *input(uint8_t pin) { return pin < 8 ? &PIND : pin < 14 ? &PINB : &PINC; }
static uint8_t bit(uint8_t pin) { return _BV(pin < 8 ? pin : pin < 14 ? pin - 8 : pin - 14); }

static void pwmOff(uint8_t pin) {
  switch (pin) {
    case 6: TCCR0A &= ~_BV(COM0A1); break;
    case 5: TCCR0A &= ~_BV(COM0B1); break;
    case 9: TCCR1A &= ~_BV(COM1A1); break;
    case 10: TCCR1A &= ~_BV(COM1B1); break;
    case 11: TCCR2A &= ~_BV(COM2A1); break;
    case 3: TCCR2A &= ~_BV(COM2B1); break;
  }
}

void pinMode(uint8_t pin, uint8_t mode) {
  if (pin > 19) return;
  uint8_t s = SREG;
  cli();
  if (mode == OUTPUT) {
    *ddr(pin) |= bit(pin);
  } else {
    *ddr(pin) &= ~bit(pin);
    if (mode == INPUT_PULLUP) *port(pin) |= bit(pin);
    else *port(pin) &= ~bit(pin);
  }
  SREG = s;
}

void digitalWrite(uint8_t pin, uint8_t value) {
  if (pin > 19) return;
  pwmOff(pin);
  uint8_t s = SREG;
  cli();
  if (value) *port(pin) |= bit(pin);
  else *port(pin) &= ~bit(pin);
  SREG = s;
}

int digitalRead(uint8_t pin) {
  if (pin > 19) return LOW;
  pwmOff(pin);
  return (*input(pin) & bit(pin)) ? HIGH : LOW;
}

int analogRead(uint8_t pin) {
  uint8_t channel = pin >= 14 ? pin - 14 : pin;
  ADMUX = _BV(REFS0) | (channel & 7);
  ADCSRA = _BV(ADEN) | _BV(ADSC) | _BV(ADPS2) | _BV(ADPS1) | _BV(ADPS0);
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
    case 6: TCCR0A |= _BV(COM0A1); OCR0A = value; break;
    case 5: TCCR0A |= _BV(COM0B1); OCR0B = value; break;
    case 9: TCCR1A |= _BV(COM1A1); OCR1A = value; break;
    case 10: TCCR1A |= _BV(COM1B1); OCR1B = value; break;
    case 11: TCCR2A |= _BV(COM2A1); OCR2A = value; break;
    case 3: TCCR2A |= _BV(COM2B1); OCR2B = value; break;
    default: digitalWrite(pin, value >= 128 ? HIGH : LOW); break;
  }
}

/* ------------------------------------------------------------------ Serial -- */

SerialPort Serial;
static volatile uint8_t rxBuffer[64];
static volatile uint8_t rxHead = 0;
static volatile uint8_t rxTail = 0;

ISR(USART_RX_vect) {
  uint8_t c = UDR0;
  uint8_t next = (rxHead + 1) & 63;
  if (next != rxTail) {
    rxBuffer[rxHead] = c;
    rxHead = next;
  }
}

void SerialPort::begin(unsigned long baud) {
  UCSR0A = _BV(U2X0);
  UBRR0 = (uint16_t)((F_CPU / 4 / baud - 1) / 2);
  UCSR0C = _BV(UCSZ01) | _BV(UCSZ00);
  UCSR0B = _BV(TXEN0) | _BV(RXEN0) | _BV(RXCIE0);
}

void SerialPort::write(uint8_t c) {
  while (!(UCSR0A & _BV(UDRE0))) {
  }
  UDR0 = c;
}

int SerialPort::available(void) { return (rxHead - rxTail) & 63; }

int SerialPort::read(void) {
  if (rxHead == rxTail) return -1;
  uint8_t c = rxBuffer[rxTail];
  rxTail = (rxTail + 1) & 63;
  return c;
}

void SerialPort::print(const char *text) {
  while (*text) write((uint8_t)*text++);
}
void SerialPort::print(char c) { write((uint8_t)c); }
void SerialPort::print(long value) {
  char buffer[12];
  ltoa(value, buffer, 10);
  print(buffer);
}
void SerialPort::print(unsigned long value) {
  char buffer[12];
  ultoa(value, buffer, 10);
  print(buffer);
}
void SerialPort::print(int value) { print((long)value); }
void SerialPort::print(unsigned int value) { print((unsigned long)value); }
void SerialPort::print(double value, int digits) {
  if (value < 0) {
    write('-');
    value = -value;
  }
  double rounding = 0.5;
  for (int i = 0; i < digits; i++) rounding /= 10.0;
  value += rounding;
  unsigned long whole = (unsigned long)value;
  print(whole);
  if (digits > 0) write('.');
  double rest = value - (double)whole;
  while (digits-- > 0) {
    rest *= 10.0;
    int d = (int)rest;
    write('0' + d);
    rest -= d;
  }
}
void SerialPort::println(void) { print("\r\n"); }
void SerialPort::println(const char *text) { print(text); println(); }
void SerialPort::println(char c) { print(c); println(); }
void SerialPort::println(int value) { print(value); println(); }
void SerialPort::println(unsigned int value) { print(value); println(); }
void SerialPort::println(long value) { print(value); println(); }
void SerialPort::println(unsigned long value) { print(value); println(); }
void SerialPort::println(double value, int digits) { print(value, digits); println(); }

/* -------------------------------------------------------------------- start -- */

int main(void) {
  // Timer 0: fast PWM, clock/64, overflow interrupt for millis().
  TCCR0A = _BV(WGM01) | _BV(WGM00);
  TCCR0B = _BV(CS01) | _BV(CS00);
  TIMSK0 = _BV(TOIE0);
  // Timers 1 and 2: 8-bit phase-correct PWM, clock/64 (about 490 Hz).
  TCCR1A = _BV(WGM10);
  TCCR1B = _BV(CS11) | _BV(CS10);
  TCCR2A = _BV(WGM20);
  TCCR2B = _BV(CS22);
  sei();
  setup();
  for (;;) loop();
}
