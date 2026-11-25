/*
 * Benchtop's small Arduino-style core for the RP2040 (Raspberry Pi Pico):
 * start-up, pins, time, analog input, PWM output, the serial port,
 * pin interrupts and tones.  SPDX-License-Identifier: MIT
 */
#include <Arduino.h>

#include "rp2040.h"

extern "C" {
extern uint32_t __StackTop, __etext, __data_start__, __data_end__, __bss_start__, __bss_end__;
extern void (*__preinit_array_start[])(void), (*__preinit_array_end[])(void);
extern void (*__init_array_start[])(void), (*__init_array_end[])(void);
void Reset_Handler(void);
void Default_Handler(void);
void isr_timer0(void);
void isr_timer1(void);
void isr_io_bank0(void);
int main(void);
void _init(void) {}
void _fini(void) {}
void __cxa_pure_virtual(void) { while (true) {} }
}

void Default_Handler(void) {
  while (true) __asm volatile("wfi");
}

typedef void (*Vector)(void);

/* The Cortex-M0+ vector table: stack, reset, the system exceptions, then the 32 peripheral interrupts. */
__attribute__((section(".vectors"), used)) const Vector vectors[48] = {
    reinterpret_cast<Vector>(&__StackTop),
    Reset_Handler,
    Default_Handler,
    Default_Handler,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    Default_Handler,
    nullptr,
    nullptr,
    Default_Handler,
    Default_Handler,
    isr_timer0,
    isr_timer1,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    isr_io_bank0,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
    Default_Handler,
};

void picoUnreset(uint32_t bits) {
  REG_CLR(RESETS_RESET) = bits;
  while ((REG(RESETS_DONE) & bits) != bits) {
  }
}

void Reset_Handler(void) {
  uint32_t *from = &__etext;
  for (uint32_t *to = &__data_start__; to < &__data_end__;) *to++ = *from++;
  for (uint32_t *to = &__bss_start__; to < &__bss_end__;) *to++ = 0;
  picoUnreset(RESET_IO_BANK0 | RESET_PADS_BANK0 | RESET_TIMER | RESET_PWM | RESET_ADC);
  // The timer's interrupt wakes delay() from sleep.
  TIMER_INTE = TIMER_INTE | 3u;
  NVIC_ISER = (1u << IRQ_TIMER0) | (1u << IRQ_TIMER1);
  for (Vector *f = __preinit_array_start; f < __preinit_array_end; f++) (*f)();
  for (Vector *f = __init_array_start; f < __init_array_end; f++) (*f)();
  main();
  while (true) __asm volatile("wfi");
}

/* Without the C++ library's exceptions: new and delete are malloc and free. */
void *operator new(size_t size) { return malloc(size); }
void *operator new[](size_t size) { return malloc(size); }
void operator delete(void *p) noexcept { free(p); }
void operator delete[](void *p) noexcept { free(p); }
void operator delete(void *p, size_t) noexcept { free(p); }
void operator delete[](void *p, size_t) noexcept { free(p); }

int main(void) {
  setup();
  while (true) loop();
}

/* -------------------------------------------------------------------- time -- */

uint64_t time_us_64(void) {
  uint32_t hi = TIMER_RAWH;
  uint32_t lo;
  uint32_t again;
  do {
    lo = TIMER_RAWL;
    again = hi;
    hi = TIMER_RAWH;
  } while (hi != again);
  return ((uint64_t)hi << 32) | lo;
}

unsigned long micros(void) { return (unsigned long)time_us_64(); }
unsigned long millis(void) { return (unsigned long)(time_us_64() / 1000u); }

void isr_timer0(void) { TIMER_INTR = 1u; }

/*
 * Sleeps until the 64-bit time `until`: the timer's alarm wakes the
 * processor, so the emulator can skip the wait.  The last microseconds are
 * spun: an alarm armed for the very next tick could fire before the WFI.
 */
static void sleepUntil(uint64_t until) {
  for (;;) {
    if (time_us_64() + 2 >= until) break;
    TIMER_ALARM(0) = (uint32_t)until;
    if (time_us_64() + 2 >= until) break;
    __asm volatile("wfi");
  }
  while (time_us_64() < until) {
  }
}

void delay(unsigned long ms) { sleepUntil(time_us_64() + (uint64_t)ms * 1000u); }

void delayMicroseconds(unsigned int us) {
  uint64_t until = time_us_64() + us;
  if (us > 50) sleepUntil(until);
  else
    while (time_us_64() < until) {
    }
}

void yield(void) {}

/* -------------------------------------------------------------------- pins -- */

void picoSetFunction(uint8_t pin, uint32_t function) {
  REG(PAD(pin)) = (REG(PAD(pin)) & ~PAD_OD) | PAD_IE;
  REG(GPIO_CTRL(pin)) = function;
}

void pinMode(uint8_t pin, uint8_t mode) {
  if (pin > 29) return;
  picoSetFunction(pin, FUNC_SIO);
  uint32_t pad = REG(PAD(pin)) & ~(PAD_PUE | PAD_PDE);
  if (mode == INPUT_PULLUP) pad |= PAD_PUE;
  else if (mode == INPUT_PULLDOWN) pad |= PAD_PDE;
  REG(PAD(pin)) = pad;
  if (mode == OUTPUT) SIO_GPIO_OE_SET = 1u << pin;
  else SIO_GPIO_OE_CLR = 1u << pin;
}

void digitalWrite(uint8_t pin, uint8_t value) {
  if (pin > 29) return;
  if (value) SIO_GPIO_OUT_SET = 1u << pin;
  else SIO_GPIO_OUT_CLR = 1u << pin;
}

int digitalRead(uint8_t pin) { return pin > 29 ? LOW : ((SIO_GPIO_IN >> pin) & 1u); }

/* ----------------------------------------------------------------- analog -- */

static int readBits = 10;
void analogReadResolution(int bits) { readBits = bits < 1 ? 1 : bits > 16 ? 16 : bits; }
void analogReference(uint8_t) {}

int analogRead(uint8_t pin) {
  uint8_t channel = pin >= 26 ? pin - 26 : pin;
  if (channel > 4) return 0;
  if (channel < 4) {
    uint8_t gpio = 26 + channel;
    REG(GPIO_CTRL(gpio)) = FUNC_NULL;
    REG(PAD(gpio)) = (REG(PAD(gpio)) & ~(PAD_IE | PAD_PUE | PAD_PDE)) | PAD_OD;
  }
  ADC_CS = ADC_CS_EN | ((uint32_t)channel << 12);
  while (!(ADC_CS & ADC_CS_READY)) {
  }
  ADC_CS = ADC_CS_EN | ((uint32_t)channel << 12) | ADC_CS_START_ONCE;
  while (!(ADC_CS & ADC_CS_READY)) {
  }
  uint32_t value = ADC_RESULT & 0xfffu;
  return readBits >= 12 ? (int)(value << (readBits - 12)) : (int)(value >> (12 - readBits));
}

/* PWM: a 1 MHz count (125 MHz ÷ 125); analogWrite runs at 1 kHz with values 0 to 255 unless told otherwise. */
static uint32_t writeRange = 255;
static uint32_t writeFreq = 1000;
void analogWriteRange(uint32_t range) { writeRange = range ? range : 1; }
void analogWriteResolution(int bits) { writeRange = (1u << (bits < 1 ? 1 : bits > 16 ? 16 : bits)) - 1; }
void analogWriteFreq(uint32_t hz) { writeFreq = hz < 10 ? 10 : hz > 100000 ? 100000 : hz; }

void pwmSet(uint8_t pin, uint32_t top, uint32_t level) {
  if (pin > 29) return;
  uint8_t slice = (pin >> 1) & 7;
  picoSetFunction(pin, FUNC_PWM);
  PWM_DIV(slice) = 125u << 4;
  PWM_TOP(slice) = top;
  uint32_t cc = PWM_CC(slice);
  if (pin & 1) cc = (cc & 0xffffu) | (level << 16);
  else cc = (cc & 0xffff0000u) | (level & 0xffffu);
  PWM_CC(slice) = cc;
  PWM_CSR(slice) = 1u;
}

void analogWrite(uint8_t pin, int value) {
  uint32_t top = 1000000u / writeFreq - 1;
  if (value <= 0) value = 0;
  uint32_t level = (uint32_t)value >= writeRange ? top + 1 : (uint32_t)(((uint64_t)value * (top + 1)) / writeRange);
  pwmSet(pin, top, level);
}

/* ----------------------------------------------------------------- tones -- */

static int8_t tonePin = -1;
void isr_timer1(void) {
  TIMER_INTR = 2u;
  if (tonePin >= 0) noTone((uint8_t)tonePin);
}

void tone(uint8_t pin, unsigned int frequency, unsigned long duration) {
  if (frequency < 16) frequency = 16;
  uint32_t top = 1000000u / frequency - 1;
  if (top > 65535) top = 65535;
  pwmSet(pin, top, (top + 1) / 2);
  tonePin = (int8_t)pin;
  if (duration) TIMER_ALARM(1) = (uint32_t)(time_us_64() + duration * 1000u);
}

void noTone(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  if (tonePin == (int8_t)pin) tonePin = -1;
}

/* ------------------------------------------------------------- interrupts -- */

static void (*handlers[30])(void);
static uint8_t edges[30];

void attachInterrupt(uint8_t pin, void (*handler)(void), int mode) {
  if (pin > 29) return;
  handlers[pin] = handler;
  edges[pin] = mode == RISING ? 0x8 : mode == FALLING ? 0x4 : 0xc;
  uint32_t shift = 4u * (pin % 8u);
  REG(IO_INTR(pin / 8u)) = 0xfu << shift;
  REG(IO_PROC0_INTE(pin / 8u)) = (REG(IO_PROC0_INTE(pin / 8u)) & ~(0xfu << shift)) | ((uint32_t)edges[pin] << shift);
  NVIC_ISER = 1u << IRQ_IO_BANK0;
}

void detachInterrupt(uint8_t pin) {
  if (pin > 29) return;
  handlers[pin] = nullptr;
  REG(IO_PROC0_INTE(pin / 8u)) &= ~(0xfu << (4u * (pin % 8u)));
}

void isr_io_bank0(void) {
  for (uint8_t bank = 0; bank < 4; bank++) {
    uint32_t status = REG(IO_PROC0_INTS(bank));
    if (!status) continue;
    REG(IO_INTR(bank)) = status;
    for (uint8_t i = 0; i < 8; i++) {
      uint8_t pin = bank * 8 + i;
      if (pin < 30 && ((status >> (4 * i)) & 0xfu) && handlers[pin]) handlers[pin]();
    }
  }
}

/* --------------------------------------------------------------- helpers -- */

unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  uint64_t start = time_us_64();
  while (digitalRead(pin) == state)
    if (time_us_64() - start > timeout) return 0;
  while (digitalRead(pin) != state)
    if (time_us_64() - start > timeout) return 0;
  uint64_t began = time_us_64();
  while (digitalRead(pin) == state)
    if (time_us_64() - start > timeout) return 0;
  return (unsigned long)(time_us_64() - began);
}

void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(dataPin, bitOrder == LSBFIRST ? (value >> i) & 1 : (value >> (7 - i)) & 1);
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

long map(long x, long inMin, long inMax, long outMin, long outMax) { return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin; }

static uint32_t seed = 1;
void randomSeed(unsigned long s) {
  if (s) seed = s;
}
long random(long howBig) {
  if (howBig <= 0) return 0;
  seed = seed * 1103515245u + 12345u;
  return (long)((seed >> 1) % (uint32_t)howBig);
}
long random(long howSmall, long howBig) { return howSmall >= howBig ? howSmall : howSmall + random(howBig - howSmall); }

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

void HardwareSerial::begin(unsigned long baud) {
  picoUnreset(RESET_UART0);
  uint32_t div = (8u * CLK_PERI) / (uint32_t)baud;
  uint32_t ibrd = div >> 7;
  uint32_t fbrd = ((div & 0x7fu) + 1u) / 2u;
  if (ibrd == 0) {
    ibrd = 1;
    fbrd = 0;
  }
  UART_IBRD(UART0_BASE) = ibrd;
  UART_FBRD(UART0_BASE) = fbrd;
  UART_LCR_H(UART0_BASE) = (3u << 5) | (1u << 4);
  UART_CR(UART0_BASE) = (1u << 0) | (1u << 8) | (1u << 9);
  picoSetFunction(0, FUNC_UART);
  picoSetFunction(1, FUNC_UART);
}

void HardwareSerial::end(void) { UART_CR(UART0_BASE) = 0; }

int HardwareSerial::available(void) { return peeked >= 0 || !(UART_FR(UART0_BASE) & UART_FR_RXFE) ? 1 : 0; }

int HardwareSerial::read(void) {
  if (peeked >= 0) {
    int c = peeked;
    peeked = -1;
    return c;
  }
  if (UART_FR(UART0_BASE) & UART_FR_RXFE) return -1;
  return (int)(UART_DR(UART0_BASE) & 0xffu);
}

int HardwareSerial::peek(void) {
  if (peeked < 0 && !(UART_FR(UART0_BASE) & UART_FR_RXFE)) peeked = (int)(UART_DR(UART0_BASE) & 0xffu);
  return peeked;
}

void HardwareSerial::flush(void) {
  while (UART_FR(UART0_BASE) & (1u << 3)) {
  }
}

size_t HardwareSerial::write(uint8_t c) {
  while (UART_FR(UART0_BASE) & UART_FR_TXFF) {
  }
  UART_DR(UART0_BASE) = c;
  return 1;
}
