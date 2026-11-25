/*
 * Memory map for Benchtop's Raspberry Pi Pico examples: a 256-byte second
 * stage boot loader at the start of flash, the vector table at 0x100, code
 * and constants after it, data and stack in SRAM.  SPDX-License-Identifier: MIT
 */
MEMORY
{
  FLASH (rx) : ORIGIN = 0x10000000, LENGTH = 2048k
  RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 256k
}

ENTRY(Reset_Handler)

SECTIONS
{
  .boot2 :
  {
    KEEP(*(.boot2))
    /* Padded to 256 bytes; the last four hold the checksum the boot ROM checks. */
    . = 0x100;
  } > FLASH

  .text :
  {
    KEEP(*(.vectors))
    *(.text*)
    *(.rodata*)
    . = ALIGN(4);
    KEEP(*(.init))
    KEEP(*(.fini))
    . = ALIGN(4);
    __preinit_array_start = .;
    KEEP(*(.preinit_array))
    __preinit_array_end = .;
    __init_array_start = .;
    KEEP(*(SORT(.init_array.*)))
    KEEP(*(.init_array))
    __init_array_end = .;
    __fini_array_start = .;
    KEEP(*(SORT(.fini_array.*)))
    KEEP(*(.fini_array))
    __fini_array_end = .;
  } > FLASH

  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } > FLASH
  .ARM.exidx :
  {
    __exidx_start = .;
    *(.ARM.exidx* .gnu.linkonce.armexidx.*)
    __exidx_end = .;
  } > FLASH

  . = ALIGN(4);
  __etext = .;

  .data : AT(__etext)
  {
    __data_start__ = .;
    *(.data*)
    . = ALIGN(4);
    __data_end__ = .;
  } > RAM

  .bss (NOLOAD) :
  {
    __bss_start__ = .;
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    __bss_end__ = .;
  } > RAM

  end = .;
  __end__ = .;
  __HeapLimit = ORIGIN(RAM) + LENGTH(RAM) - 8k;
  __StackTop = ORIGIN(RAM) + LENGTH(RAM);
}
