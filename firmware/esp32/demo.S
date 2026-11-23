/*
 * Benchtop's ESP32 demo firmware.  It needs no SDK: the chip's ROM loads it
 * the way it loads a second-stage bootloader (flash offset 0x1000) and jumps
 * to _start, which runs with the ROM's 40 MHz clock.
 *
 *   GPIO2   blinks every half second
 *   GPIO16  is high while the button on GPIO14 pulls GPIO14 low
 *   GPIO19  fades up and down (LEDC PWM, high-speed channel 0)
 *   UART0   prints a banner, button changes and the uptime (115200 baud)
 *
 * Built with build.sh.  SPDX-License-Identifier: MIT
 */

    .section .rodata
banner:
    .asciz "\r\nBenchtop ESP32 demo\r\nGPIO2 blinks, GPIO16 follows the button on GPIO14, GPIO19 fades with PWM.\r\n"
pressed:
    .asciz "button pressed\r\n"
released:
    .asciz "button released\r\n"
uptime:
    .asciz "uptime "
seconds:
    .asciz " s\r\n"

    .section .data
counter:
    .byte 48, 48, 48, 48, 48, 0

    .text
    .literal_position
    .literal .Ldport, 0x3FF00000
    .literal .Lledcclk, 0x00000800
    .literal .Liomux, 0x3FF49000
    .literal .Lmuxout, 0x00002800
    .literal .Lmuxin, 0x00002A00
    .literal .Lsel2, 0x3FF44538
    .literal .Lsel16, 0x3FF44570
    .literal .Lsel19, 0x3FF4457C
    .literal .Lledc, 0x3FF59000
    .literal .Ltimerrst, 0x0301F40A
    .literal .Ltimer, 0x0201F40A
    .literal .Lconf1, 0xC0100400
    .literal .Lgpio, 0x3FF44000
    .literal .Lenable, 0x00090004
    .literal .Lfollow, 0x00010000
    .literal .Luart, 0x3FF40000
    .literal .Lsettle, 8000000
    .literal .Lhalf, 20000000
    .literal .Lsecond, 40000000
    .literal .Lramp, 800000
    .literal .Lbanner, banner
    .literal .Lpressed, pressed
    .literal .Lreleased, released
    .literal .Luptime, uptime
    .literal .Lseconds, seconds
    .literal .Lcounter, counter

    .align 4
    .global _start
_start:
    rsil a2, 15                 /* no interrupts: the ROM's handlers are not ours */

    /* LEDC clock on, out of reset (DPORT_PERIP_CLK_EN / DPORT_PERIP_RST_EN bit 11) */
    l32r a2, .Ldport
    l32r a3, .Lledcclk
    l32i a4, a2, 0xC0
    or a4, a4, a3
    s32i a4, a2, 0xC0
    l32i a4, a2, 0xC4
    movi a5, -1
    xor a5, a5, a3
    and a4, a4, a5
    s32i a4, a2, 0xC4
    memw

    /* IO_MUX: GPIO2, GPIO16 and GPIO19 as GPIO outputs, GPIO14 as a GPIO input */
    l32r a2, .Liomux
    l32r a3, .Lmuxout
    s32i a3, a2, 0x40
    s32i a3, a2, 0x4C
    s32i a3, a2, 0x74
    l32r a3, .Lmuxin
    s32i a3, a2, 0x30

    /* GPIO matrix: GPIO2 and GPIO16 plain outputs, GPIO19 from LEDC_HS_SIG_OUT0 (signal 71) */
    movi a3, 0x100
    l32r a2, .Lsel2
    s32i a3, a2, 0
    l32r a2, .Lsel16
    s32i a3, a2, 0
    movi a3, 71
    l32r a2, .Lsel19
    s32i a3, a2, 0

    /* LEDC high-speed timer 0 with 10-bit duty; channel 0 on timer 0, duty 0 */
    l32r a2, .Lledc
    l32r a3, .Ltimerrst
    s32i a3, a2, 0x140
    l32r a3, .Ltimer
    s32i a3, a2, 0x140
    movi a3, 0
    s32i a3, a2, 0x04
    s32i a3, a2, 0x08
    movi a3, 4
    s32i a3, a2, 0x00
    l32r a3, .Lconf1
    s32i a3, a2, 0x0C

    /* Outputs on */
    l32r a12, .Lgpio
    l32r a3, .Lenable
    s32i a3, a12, 0x24
    memw

    l32r a2, .Lbanner
    call0 print

    /* Give the circuit 200 ms to set the button's level */
    rsr a7, ccount
    l32r a8, .Lsettle
    add a8, a7, a8
1:  rsr a7, ccount
    sub a9, a7, a8
    bltz a9, 1b

    l32i a15, a12, 0x3C
    extui a15, a15, 14, 1       /* a15: button level */
    movi a6, 0                  /* a6: GPIO2 state */
    movi a11, 0                 /* a11: duty, 0-1008 */
    movi a10, 16                /* a10: duty step */
    rsr a13, ccount             /* a13: next blink */
    mov a9, a13                 /* a9: next fade step */
    l32r a8, .Lsecond
    add a14, a13, a8            /* a14: next uptime line */

loop:
    rsr a7, ccount

    /* Blink GPIO2 */
    sub a8, a7, a13
    bltz a8, 2f
    l32r a8, .Lhalf
    add a13, a13, a8
    movi a8, 4
    xor a6, a6, a8
    beqz a6, 3f
    s32i a8, a12, 0x08
    j 4f
3:  s32i a8, a12, 0x0C
4:  memw
2:

    /* The button on GPIO14 drives GPIO16 and prints a line */
    l32i a8, a12, 0x3C
    extui a8, a8, 14, 1
    beq a8, a15, 5f
    mov a15, a8
    l32r a8, .Lfollow
    bnez a15, 6f
    s32i a8, a12, 0x08
    memw
    l32r a2, .Lpressed
    call0 print
    j 5f
6:  s32i a8, a12, 0x0C
    memw
    l32r a2, .Lreleased
    call0 print
5:

    /* Fade GPIO19 every 20 ms */
    rsr a7, ccount
    sub a8, a7, a9
    bltz a8, 7f
    l32r a8, .Lramp
    add a9, a9, a8
    add a11, a11, a10
    bgez a11, 8f
    movi a11, 0
    neg a10, a10
8:  movi a8, 1008
    blt a11, a8, 9f
    mov a11, a8
    neg a10, a10
9:  slli a8, a11, 4
    l32r a2, .Lledc
    s32i a8, a2, 0x08
    l32r a3, .Lconf1
    s32i a3, a2, 0x0C
    memw
7:

    /* Uptime every second */
    sub a8, a7, a14
    bltz a8, loop
    l32r a8, .Lsecond
    add a14, a14, a8
    call0 tick
    j loop

/* Prints the NUL-terminated string at a2 on UART0.  Uses a2-a5. */
print:
    l32r a3, .Luart
1:  l8ui a4, a2, 0
    beqz a4, 3f
2:  l32i a5, a3, 0x1C
    extui a5, a5, 16, 8
    bgei a5, 64, 2b
    s32i a4, a3, 0
    memw
    addi a2, a2, 1
    j 1b
3:  ret

/* Adds one to the decimal uptime counter and prints "uptime N s".  Uses a2-a5 and a8. */
tick:
    mov a8, a0
    l32r a2, .Lcounter
    addi a3, a2, 4
1:  l8ui a4, a3, 0
    movi a5, 57
    blt a4, a5, 2f
    movi a4, 48
    s8i a4, a3, 0
    addi a3, a3, -1
    bgeu a3, a2, 1b
    j 3f
2:  addi a4, a4, 1
    s8i a4, a3, 0
3:  l32r a2, .Luptime
    call0 print
    l32r a2, .Lcounter
    movi a5, 48
4:  l8ui a4, a2, 0
    bne a4, a5, 5f
    l8ui a4, a2, 1
    beqz a4, 5f
    addi a2, a2, 1
    j 4b
5:  call0 print
    l32r a2, .Lseconds
    call0 print
    mov a0, a8
    ret
