/*
 * Second stage boot loader for Benchtop's Pico examples: sets the flash
 * interface up for plain 03h serial reads (slow, but it works with any
 * flash chip) and enters the program through its vector table.  It follows
 * the Raspberry Pi Pico SDK's boot2_generic_03h.  SPDX-License-Identifier: MIT
 */
  .syntax unified
  .cpu cortex-m0plus
  .thumb

  .section .boot2, "ax"
  .global _stage2_boot
  .type _stage2_boot, %function
  .thumb_func
_stage2_boot:
  push {lr}
  ldr r3, =0x18000000          /* XIP_SSI */
  movs r1, #0
  str r1, [r3, #0x08]          /* SSIENR: off while it is set up */
  movs r1, #4
  str r1, [r3, #0x14]          /* BAUDR: clock divided by 4 */
  ldr r1, =((31 << 16) | (3 << 8))
  str r1, [r3, #0x00]          /* CTRLR0: 32-bit frames, EEPROM read mode */
  ldr r0, =0x180000f4
  ldr r1, =((0x03 << 24) | (2 << 8) | (6 << 2))
  str r1, [r0]                 /* SPI_CTRLR0: command 03h, 8-bit command, 24-bit address */
  movs r1, #0
  str r1, [r3, #0x04]          /* CTRLR1: one frame per read */
  movs r1, #1
  str r1, [r3, #0x08]          /* SSIENR: on */
  /* From the boot ROM lr was 0: go through the vector table at 0x100. */
  pop {r0}
  cmp r0, #0
  beq 1f
  bx r0
1:
  ldr r0, =0x10000100
  ldr r1, =0xe000ed08          /* VTOR */
  str r0, [r1]
  ldmia r0, {r0, r1}
  msr msp, r0
  bx r1
  .ltorg
