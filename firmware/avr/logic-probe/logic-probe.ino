// Benchtop Logic Probe 1.0
//
// Turns an Arduino Uno or Nano (ATmega328P at 16 MHz) into a six-channel
// logic analyser for Benchtop's Logic Analyser.  It speaks the SUMP protocol
// at 115200 baud, so other programs that know SUMP devices can use it too.
//
//   Channel 0 to 5  =  pins 8 to 13 (pin 13 also has the board's LED on it)
//   Up to 1536 samples a capture, at 10 Hz to 2 MHz
//   Trigger: a pattern of high and low on any of the six pins
//
// Connect the board's GND to the ground of the circuit you measure, and
// measure 5 V logic only (3.3 V outputs are read correctly by a 5 V Uno;
// never feed more than the board's own supply voltage into a pin).
//
// SPDX-License-Identifier: MIT

#include <avr/interrupt.h>
#include <avr/io.h>
#include <stdint.h>

#define SAMPLES 1536

static uint8_t samples[SAMPLES];
// The sample clock as SUMP gives it: 100 MHz / (divider + 1).  99 is 1 MHz.
static uint32_t divider = 99;
static uint16_t readCount = SAMPLES;
static uint8_t triggerMask = 0;
static uint8_t triggerValue = 0;

static void put(uint8_t value) {
  while (!(UCSR0A & _BV(UDRE0))) {
  }
  UDR0 = value;
}

static uint8_t waiting(void) { return UCSR0A & _BV(RXC0); }

static uint8_t get(void) {
  while (!waiting()) {
  }
  return UDR0;
}

static void text(const char *s) {
  while (*s) put((uint8_t)*s++);
  put(0);
}

static void number(uint8_t key, uint32_t value) {
  put(key);
  put((uint8_t)(value >> 24));
  put((uint8_t)(value >> 16));
  put((uint8_t)(value >> 8));
  put((uint8_t)value);
}

// What the device is, in SUMP's own list of keys and values.
static void metadata(void) {
  put(0x01);
  text("Benchtop Logic Probe");
  put(0x02);
  text("1.0");
  number(0x21, SAMPLES);
  number(0x23, 2000000UL);
  put(0x40);
  put(6);
  put(0x41);
  put(2);
  put(0x00);
}

// One sample every 8 processor cycles: 2 MHz.
static void sampleEvery8(uint8_t *buffer, uint16_t count) {
  __asm__ __volatile__(
      "1: in r18, %[pins]\n"
      "   andi r18, 0x3F\n"
      "   st X+, r18\n"
      "   sbiw r24, 1\n"
      "   brne 1b\n"
      : "+x"(buffer), "+w"(count)
      : [pins] "I"(_SFR_IO_ADDR(PINB))
      : "r18");
}

// One sample every 16 cycles: 1 MHz.
static void sampleEvery16(uint8_t *buffer, uint16_t count) {
  __asm__ __volatile__(
      "1: in r18, %[pins]\n"
      "   andi r18, 0x3F\n"
      "   st X+, r18\n"
      "   rjmp .+0\n"
      "   rjmp .+0\n"
      "   rjmp .+0\n"
      "   rjmp .+0\n"
      "   sbiw r24, 1\n"
      "   brne 1b\n"
      : "+x"(buffer), "+w"(count)
      : [pins] "I"(_SFR_IO_ADDR(PINB))
      : "r18");
}

// One sample at every tick of timer 1, for 500 kHz and slower.
static void sampleOnTimer(uint8_t *buffer, uint16_t count) {
  __asm__ __volatile__(
      "1: sbis %[flags], %[match]\n"
      "   rjmp 1b\n"
      "   in r18, %[pins]\n"
      "   sbi %[flags], %[match]\n"
      "   andi r18, 0x3F\n"
      "   st X+, r18\n"
      "   sbiw r24, 1\n"
      "   brne 1b\n"
      : "+x"(buffer), "+w"(count)
      : [pins] "I"(_SFR_IO_ADDR(PINB)), [flags] "I"(_SFR_IO_ADDR(TIFR1)), [match] "I"(OCF1A)
      : "r18");
}

// The same, for slow captures: a byte from the computer stops it.  Returns 0 when it was stopped.
static uint8_t sampleSlowly(uint8_t *buffer, uint16_t count) {
  while (count) {
    while (!(TIFR1 & _BV(OCF1A))) {
      if (waiting()) return 0;
    }
    uint8_t value = PINB & 0x3F;
    TIFR1 = _BV(OCF1A);
    *buffer++ = value;
    count--;
  }
  return 1;
}

static void capture(void) {
  // Processor cycles to a sample: 16 MHz / (100 MHz / (divider + 1)).
  uint32_t cycles = ((divider + 1) * 4) / 25;
  uint16_t count = readCount;
  uint8_t done = 1;
  cli();
  if (triggerMask) {
    while ((PINB & triggerMask) != triggerValue) {
      if (waiting()) {
        sei();
        return;
      }
    }
  }
  if (cycles <= 8) {
    sampleEvery8(samples, count);
  } else if (cycles < 32) {
    sampleEvery16(samples, count);
  } else {
    // Timer 1 counts cycles (or every 8th, 64th or 256th for slow rates) and starts again at the top.
    uint8_t clock = _BV(CS10);
    uint32_t top = cycles;
    if (top > 65536UL) {
      top = cycles / 8;
      clock = _BV(CS11);
    }
    if (top > 65536UL) {
      top = cycles / 64;
      clock = _BV(CS11) | _BV(CS10);
    }
    if (top > 65536UL) {
      top = cycles / 256;
      clock = _BV(CS12);
    }
    if (top > 65536UL) top = 65536UL;
    TCCR1A = 0;
    TCCR1B = 0;
    TCNT1 = 0;
    OCR1A = (uint16_t)(top - 1);
    TIFR1 = _BV(OCF1A);
    TCCR1B = _BV(WGM12) | clock;
    if (cycles < 1600) {
      sampleOnTimer(samples, count);
    } else {
      done = sampleSlowly(samples, count);
    }
    TCCR1B = 0;
  }
  sei();
  if (!done) return;
  // SUMP sends the newest sample first.
  for (uint16_t i = count; i > 0; i--) put(samples[i - 1]);
}

void setup() {
  // Pins 8 to 13 listen, without pull-ups.
  DDRB &= ~0x3F;
  PORTB &= ~0x3F;
  // 115200 baud, eight bits, no parity, one stop bit; bytes are fetched when asked for, without interrupts.
  UCSR0A = _BV(U2X0);
  UBRR0 = 16;
  UCSR0C = _BV(UCSZ01) | _BV(UCSZ00);
  UCSR0B = _BV(TXEN0) | _BV(RXEN0);
}

void loop() {
  uint8_t command = get();
  if (command == 0x01) {
    capture();
  } else if (command == 0x02) {
    put('1');
    put('A');
    put('L');
    put('S');
  } else if (command == 0x04) {
    metadata();
  } else if (command & 0x80) {
    // Long commands bring four more bytes.
    uint8_t a = get();
    uint8_t b = get();
    uint8_t c = get();
    get();
    if (command == 0x80) {
      divider = (uint32_t)a | ((uint32_t)b << 8) | ((uint32_t)c << 16);
    } else if (command == 0x81) {
      // The number of samples to send, in fours, less one.
      uint32_t wanted = ((uint32_t)((uint16_t)a | ((uint16_t)b << 8)) + 1) * 4;
      readCount = wanted > SAMPLES ? SAMPLES : (uint16_t)wanted;
    } else if (command == 0xC0) {
      triggerMask = a & 0x3F;
    } else if (command == 0xC1) {
      triggerValue = a & 0x3F;
    }
    // Flags (0x82), the trigger's configuration (0xC2) and further trigger stages are taken and not used.
  }
  // 0x00 (reset) and anything else: nothing to do.
}
