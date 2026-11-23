/*
 * benchtop-esp32: runs ESP32 firmware in lcgamboa's QEMU (the ESP32 machine
 * with PICSimLab hooks) and talks to Benchtop over stdin and stdout, one
 * line per message.  It replaces QEMU's own main() at link time; see
 * esp32-helper/build.sh.
 *
 * Out (stdout):
 *   P <pin> <0|1>     a pin's output level changed
 *   D <pin> <0|1>     a pin became an output (1) or an input (0)
 *   W <pin> <0-1000>  a pin carries PWM (LEDC) at this duty in tenths of a percent
 *   U <hex bytes>     bytes sent on UART0
 *   R                 the machine is running
 * In (stdin):
 *   I <pin> <0|1>     drive a pin's input level
 *   A <channel> <0-4095>  set an ADC1 channel reading
 *   S <hex bytes>     bytes received on UART0
 *   Q                 quit
 * Pins are numbered 0..N-1 in the order of PINS below (Benchtop's ESP32 board).
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
#include "qemu/osdep.h"
#include "qemu-main.h"
#include "qemu/main-loop.h"
#include "sysemu/runstate.h"
#include "sysemu/sysemu.h"
#include <pthread.h>

typedef struct {
    void (*write_pin)(int pin, int value);
    void (*dir_pin)(int pin, int value);
    int (*i2c_event)(const uint8_t id, const uint8_t addr, const uint16_t event);
    uint8_t (*spi_event)(const uint8_t id, const uint16_t event);
    void (*uart_tx_event)(const uint8_t id, const uint8_t value);
    const short int *pinmap;
    void (*rmt_event)(const uint8_t channel, const uint32_t config0, const uint32_t value);
} callbacks_t;

void qemu_picsimlab_register_callbacks(void *arg);
void qemu_picsimlab_set_pin(int pin, int value);
void qemu_picsimlab_set_apin(int chn, int value);
uint32_t *qemu_picsimlab_get_internals(int cfg);
void qemu_picsimlab_uart_receive(const int id, const uint8_t *buf, int size);

#define INTERNAL_GPIO_OUT_SEL 2
#define INTERNAL_LEDC_CHANNEL_DUTY 6

/* GPIO numbers of Benchtop's ESP32 board pins, in order (src/lib/circuit/boards.ts). */
static const short PINS[] = {2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
#define PIN_COUNT ((int)(sizeof(PINS) / sizeof(PINS[0])))
static short pinmap[PIN_COUNT + 1];

static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;
static int last_pwm[PIN_COUNT];

static void emit(const char *line)
{
    pthread_mutex_lock(&out_lock);
    fputs(line, stdout);
    fflush(stdout);
    pthread_mutex_unlock(&out_lock);
}

static void on_write_pin(int pin, int value)
{
    char line[32];
    if (pin < 1 || pin > PIN_COUNT) {
        return;
    }
    snprintf(line, sizeof line, "P %d %d\n", pin - 1, value ? 1 : 0);
    emit(line);
}

static void on_dir_pin(int pin, int value)
{
    char line[32];
    if (pin < 1 || pin > PIN_COUNT) {
        return; /* -1 is a configuration sync request */
    }
    snprintf(line, sizeof line, "D %d %d\n", pin - 1, value ? 1 : 0);
    emit(line);
}

static int on_i2c(const uint8_t id, const uint8_t addr, const uint16_t event) { return 0; }
static uint8_t on_spi(const uint8_t id, const uint16_t event) { return 0; }
static void on_rmt(const uint8_t channel, const uint32_t config0, const uint32_t value) {}

static void on_uart(const uint8_t id, const uint8_t value)
{
    char line[16];
    if (id != 0) {
        return;
    }
    snprintf(line, sizeof line, "U %02x\n", value);
    emit(line);
}

static callbacks_t callbacks = {
    .write_pin = on_write_pin,
    .dir_pin = on_dir_pin,
    .i2c_event = on_i2c,
    .spi_event = on_spi,
    .uart_tx_event = on_uart,
    .pinmap = pinmap,
    .rmt_event = on_rmt,
};

/* Reports LEDC (PWM) duty for pins routed to a LEDC output signal (71-86). */
static void poll_pwm(void)
{
    uint32_t *out_sel = qemu_picsimlab_get_internals(INTERNAL_GPIO_OUT_SEL);
    float *duty = (float *)qemu_picsimlab_get_internals(INTERNAL_LEDC_CHANNEL_DUTY);
    if (!out_sel || !duty) {
        return;
    }
    for (int i = 0; i < PIN_COUNT; i++) {
        int signal = out_sel[PINS[i]] & 0x1ff;
        int tenths = -1;
        if (signal >= 71 && signal <= 86) {
            float d = duty[signal - 71];
            tenths = (int)(d * 10.0f + 0.5f);
            if (tenths < 0) {
                tenths = 0;
            }
            if (tenths > 1000) {
                tenths = 1000;
            }
        }
        if (tenths != last_pwm[i]) {
            char line[32];
            last_pwm[i] = tenths;
            snprintf(line, sizeof line, "W %d %d\n", i, tenths);
            emit(line);
        }
    }
}

static int hex_bytes(const char *text, uint8_t *out, int max)
{
    int n = 0;
    while (*text && n < max) {
        unsigned value;
        while (*text == ' ') {
            text++;
        }
        if (sscanf(text, "%2x", &value) != 1) {
            break;
        }
        out[n++] = (uint8_t)value;
        text += 2;
    }
    return n;
}

static void *read_commands(void *unused)
{
    char line[4096];
    while (fgets(line, sizeof line, stdin)) {
        int a, b;
        if (line[0] == 'Q') {
            break;
        }
        if (line[0] == 'I' && sscanf(line + 1, "%d %d", &a, &b) == 2 && a >= 0 && a < PIN_COUNT) {
            bql_lock();
            qemu_picsimlab_set_pin(a + 1, b);
            bql_unlock();
        } else if (line[0] == 'A' && sscanf(line + 1, "%d %d", &a, &b) == 2 && a >= 0 && a < 8) {
            qemu_picsimlab_set_apin(a, b);
        } else if (line[0] == 'S') {
            uint8_t bytes[1024];
            int n = hex_bytes(line + 1, bytes, sizeof bytes);
            if (n > 0) {
                bql_lock();
                qemu_picsimlab_uart_receive(0, bytes, n);
                bql_unlock();
            }
        }
    }
    /* stdin closed or Q: stop the machine. */
    bql_lock();
    qemu_system_shutdown_request(SHUTDOWN_CAUSE_HOST_QMP_QUIT);
    bql_unlock();
    return NULL;
}

static void *watch_pwm(void *unused)
{
    for (;;) {
        g_usleep(20000);
        poll_pwm();
    }
    return NULL;
}

int qemu_default_main(void)
{
    int status = qemu_main_loop();
    qemu_cleanup(status);
    return status;
}

int (*qemu_main)(void) = qemu_default_main;

int main(int argc, char **argv)
{
    pthread_t reader, pwm;
    pinmap[0] = PIN_COUNT;
    for (int i = 0; i < PIN_COUNT; i++) {
        pinmap[i + 1] = PINS[i];
        last_pwm[i] = -1;
    }
    qemu_picsimlab_register_callbacks(&callbacks);
    qemu_init(argc, argv);
    emit("R\n");
    pthread_create(&reader, NULL, read_commands, NULL);
    pthread_create(&pwm, NULL, watch_pwm, NULL);
    return qemu_main();
}
