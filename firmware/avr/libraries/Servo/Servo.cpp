/* Servo pulses: timer 1 counts in half microseconds (clock/8) and each channel's pulse follows the last, every 20 ms.  SPDX-License-Identifier: MIT */
#include "Servo.h"

struct Channel {
  uint8_t pin;
  volatile uint16_t ticks;
  bool active;
};

static Channel channels[MAX_SERVOS];
static uint8_t channelCount = 0;
static volatile int8_t current = -1;

static uint16_t ticksOf(unsigned long us) { return (uint16_t)(clockCyclesPerMicrosecond() * us / 8); }
static unsigned long usOf(uint16_t ticks) { return (unsigned long)ticks * 8 / clockCyclesPerMicrosecond(); }

ISR(TIMER1_COMPA_vect) {
  if (current < 0) TCNT1 = 0;
  else if (current < channelCount && channels[current].active) digitalWrite(channels[current].pin, LOW);
  current++;
  if (current < channelCount) {
    OCR1A = TCNT1 + channels[current].ticks;
    if (channels[current].active) digitalWrite(channels[current].pin, HIGH);
  } else {
    uint16_t now = TCNT1 + 4;
    OCR1A = now < ticksOf(REFRESH_INTERVAL) ? ticksOf(REFRESH_INTERVAL) : now;
    current = -1;
  }
}

static void startTimer(void) {
  TCCR1A = 0;
  TCCR1B = _BV(CS11);
  TCNT1 = 0;
  TIFR1 |= _BV(OCF1A);
  TIMSK1 |= _BV(OCIE1A);
}

Servo::Servo() {
  if (channelCount < MAX_SERVOS) {
    index = channelCount++;
    channels[index].ticks = ticksOf(DEFAULT_PULSE_WIDTH);
  } else index = INVALID_SERVO;
}

uint8_t Servo::attach(int pin) { return attach(pin, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH); }

uint8_t Servo::attach(int pin, int min, int max) {
  if (index == INVALID_SERVO) return INVALID_SERVO;
  pinMode(pin, OUTPUT);
  channels[index].pin = pin;
  minimum = min;
  maximum = max;
  bool running = false;
  for (uint8_t i = 0; i < channelCount; i++) running |= channels[i].active;
  if (!running) startTimer();
  channels[index].active = true;
  return index;
}

void Servo::detach() {
  if (index == INVALID_SERVO) return;
  channels[index].active = false;
  bool any = false;
  for (uint8_t i = 0; i < channelCount; i++) any |= channels[i].active;
  if (!any) TIMSK1 &= ~_BV(OCIE1A);
}

void Servo::write(int value) {
  if (value < MIN_PULSE_WIDTH) {
    value = constrain(value, 0, 180);
    value = map(value, 0, 180, minimum, maximum);
  }
  writeMicroseconds(value);
}

void Servo::writeMicroseconds(int us) {
  if (index == INVALID_SERVO) return;
  us = constrain(us, minimum, maximum);
  uint16_t ticks = ticksOf(us);
  uint8_t s = SREG;
  cli();
  channels[index].ticks = ticks;
  SREG = s;
}

int Servo::readMicroseconds() { return index == INVALID_SERVO ? 0 : (int)usOf(channels[index].ticks) + 1; }

int Servo::read() { return map(readMicroseconds(), minimum, maximum, 0, 180); }

bool Servo::attached() { return index != INVALID_SERVO && channels[index].active; }
