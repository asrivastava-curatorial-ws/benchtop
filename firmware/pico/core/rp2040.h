/* RP2040 registers used by Benchtop's small Arduino-style core.  SPDX-License-Identifier: MIT */
#pragma once
#include <stdint.h>

#define REG(addr) (*(volatile uint32_t *)(addr))
/* Atomic aliases: write to set or clear bits without a read. */
#define REG_SET(addr) REG((addr) + 0x2000)
#define REG_CLR(addr) REG((addr) + 0x3000)

#define RESETS_BASE 0x4000c000u
#define RESETS_RESET (RESETS_BASE + 0x0)
#define RESETS_DONE (RESETS_BASE + 0x8)
#define RESET_ADC (1u << 0)
#define RESET_I2C0 (1u << 3)
#define RESET_I2C1 (1u << 4)
#define RESET_IO_BANK0 (1u << 5)
#define RESET_PADS_BANK0 (1u << 8)
#define RESET_PWM (1u << 14)
#define RESET_SPI0 (1u << 16)
#define RESET_SPI1 (1u << 17)
#define RESET_TIMER (1u << 21)
#define RESET_UART0 (1u << 22)
#define RESET_UART1 (1u << 23)

#define IO_BANK0_BASE 0x40014000u
#define GPIO_CTRL(n) (IO_BANK0_BASE + 8u * (n) + 4u)
#define IO_INTR(n) (IO_BANK0_BASE + 0xf0u + 4u * (n))
#define IO_PROC0_INTE(n) (IO_BANK0_BASE + 0x100u + 4u * (n))
#define IO_PROC0_INTS(n) (IO_BANK0_BASE + 0x120u + 4u * (n))
#define FUNC_SPI 1
#define FUNC_UART 2
#define FUNC_I2C 3
#define FUNC_PWM 4
#define FUNC_SIO 5
#define FUNC_NULL 0x1f

#define PADS_BANK0_BASE 0x4001c000u
#define PAD(n) (PADS_BANK0_BASE + 4u + 4u * (n))
#define PAD_PDE (1u << 2)
#define PAD_PUE (1u << 3)
#define PAD_IE (1u << 6)
#define PAD_OD (1u << 7)

#define SIO_BASE 0xd0000000u
#define SIO_GPIO_IN REG(SIO_BASE + 0x004)
#define SIO_GPIO_OUT_SET REG(SIO_BASE + 0x014)
#define SIO_GPIO_OUT_CLR REG(SIO_BASE + 0x018)
#define SIO_GPIO_OUT_XOR REG(SIO_BASE + 0x01c)
#define SIO_GPIO_OE_SET REG(SIO_BASE + 0x024)
#define SIO_GPIO_OE_CLR REG(SIO_BASE + 0x028)

#define TIMER_BASE 0x40054000u
#define TIMER_ALARM(n) REG(TIMER_BASE + 0x10u + 4u * (n))
#define TIMER_RAWH REG(TIMER_BASE + 0x24)
#define TIMER_RAWL REG(TIMER_BASE + 0x28)
#define TIMER_INTR REG(TIMER_BASE + 0x34)
#define TIMER_INTE REG(TIMER_BASE + 0x38)

#define UART0_BASE 0x40034000u
#define UART_DR(b) REG((b) + 0x00)
#define UART_FR(b) REG((b) + 0x18)
#define UART_IBRD(b) REG((b) + 0x24)
#define UART_FBRD(b) REG((b) + 0x28)
#define UART_LCR_H(b) REG((b) + 0x2c)
#define UART_CR(b) REG((b) + 0x30)
#define UART_FR_RXFE (1u << 4)
#define UART_FR_TXFF (1u << 5)

#define I2C0_BASE 0x40044000u
#define I2C1_BASE 0x40048000u
#define IC_CON 0x00
#define IC_TAR 0x04
#define IC_DATA_CMD 0x10
#define IC_SS_SCL_HCNT 0x14
#define IC_SS_SCL_LCNT 0x18
#define IC_FS_SCL_HCNT 0x1c
#define IC_FS_SCL_LCNT 0x20
#define IC_RAW_INTR_STAT 0x34
#define IC_RX_TL 0x38
#define IC_TX_TL 0x3c
#define IC_CLR_TX_ABRT 0x54
#define IC_CLR_STOP_DET 0x60
#define IC_ENABLE 0x6c
#define IC_STATUS 0x70
#define IC_RXFLR 0x78
#define IC_TX_ABRT_SOURCE 0x80
#define IC_FS_SPKLEN 0xa0
#define IC_INTR_TX_EMPTY (1u << 4)
#define IC_INTR_TX_ABRT (1u << 6)
#define IC_INTR_STOP_DET (1u << 9)

#define SPI0_BASE 0x4003c000u
#define SPI1_BASE 0x40040000u
#define SSP_CR0 0x00
#define SSP_CR1 0x04
#define SSP_DR 0x08
#define SSP_SR 0x0c
#define SSP_CPSR 0x10
#define SSP_SR_TNF (1u << 1)
#define SSP_SR_RNE (1u << 2)
#define SSP_SR_BSY (1u << 4)

#define ADC_BASE 0x4004c000u
#define ADC_CS REG(ADC_BASE + 0x00)
#define ADC_RESULT REG(ADC_BASE + 0x04)
#define ADC_CS_EN (1u << 0)
#define ADC_CS_START_ONCE (1u << 2)
#define ADC_CS_READY (1u << 8)

#define PWM_BASE 0x40050000u
#define PWM_CSR(s) REG(PWM_BASE + 0x14u * (s) + 0x00)
#define PWM_DIV(s) REG(PWM_BASE + 0x14u * (s) + 0x04)
#define PWM_CC(s) REG(PWM_BASE + 0x14u * (s) + 0x0c)
#define PWM_TOP(s) REG(PWM_BASE + 0x14u * (s) + 0x10)

#define NVIC_ISER REG(0xe000e100u)
#define NVIC_ICPR REG(0xe000e280u)
#define IRQ_TIMER0 0
#define IRQ_TIMER1 1
#define IRQ_IO_BANK0 13

/* Peripherals run from clk_peri; the emulator, like the Pico SDK, has it at clk_sys = 125 MHz. */
#define CLK_PERI 125000000u

/* Helpers from core.cpp for the libraries. */
void picoUnreset(uint32_t bits);
/* Routes a pin to a peripheral (FUNC_*), enabling its input. */
void picoSetFunction(uint8_t pin, uint32_t function);
/* Runs a pin's PWM channel with a 1 MHz count: period top + 1 microseconds, high for `level` of them. */
void pwmSet(uint8_t pin, uint32_t top, uint32_t level);
