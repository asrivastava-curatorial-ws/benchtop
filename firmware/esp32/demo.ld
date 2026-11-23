/* IRAM and DRAM where the ROM loads a second-stage bootloader. */
ENTRY(_start)
SECTIONS
{
  .text 0x40080400 : { *(.literal .text) }
  .data 0x3FFF0000 : { *(.rodata) *(.data) }
}
