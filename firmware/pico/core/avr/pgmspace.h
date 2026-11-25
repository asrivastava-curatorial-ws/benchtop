/* On the RP2040 constants are read straight from flash: PROGMEM and pgm_read_* are plain reads.  SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>
#include <string.h>
#define PROGMEM
#define PSTR(s) (s)
#define pgm_read_byte(addr) (*(const uint8_t *)(addr))
#define pgm_read_word(addr) (*(const uint16_t *)(addr))
#define pgm_read_dword(addr) (*(const uint32_t *)(addr))
#define pgm_read_ptr(addr) (*(void *const *)(addr))
#define strlen_P strlen
#define strcpy_P strcpy
#define memcpy_P memcpy
