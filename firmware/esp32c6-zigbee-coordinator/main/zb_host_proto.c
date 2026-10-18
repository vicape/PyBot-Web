/*
 * Newline-delimited JSON host protocol over USB Serial/JTAG.
 * Intentionally tiny parser (no heap JSON library) for the M2A command set.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"

#include "zb_coord.h"
#include "zb_host_proto.h"

static const char *TAG = "PYBOT_ZB_HOST";

#define LINE_MAX 512

void pybot_zb_host_emit(const char *json_object_body)
{
    /* Single-line JSON event for the Python/JS host adapter. */
    printf("%s\n", json_object_body);
    fflush(stdout);
}

static const char *find_key(const char *line, const char *key)
{
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(line, pattern);
    if (!p) {
        return NULL;
    }
    p += strlen(pattern);
    while (*p && (isspace((unsigned char)*p) || *p == ':')) {
        p++;
    }
    return p;
}

static bool parse_string_value(const char *p, char *out, size_t out_len)
{
    if (!p || *p != '"') {
        return false;
    }
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < out_len) {
        out[i++] = *p++;
    }
    out[i] = '\0';
    return true;
}

static bool parse_uint_value(const char *p, unsigned long *out)
{
    if (!p) {
        return false;
    }
    char *end = NULL;
    unsigned long v = strtoul(p, &end, 0);
    if (end == p) {
        return false;
    }
    *out = v;
    return true;
}

static void handle_line(char *line)
{
    while (*line && isspace((unsigned char)*line)) {
        line++;
    }
    if (*line == '\0' || *line == '#') {
        return;
    }

    char cmd[32] = {0};
    const char *cmd_p = find_key(line, "cmd");
    if (!parse_string_value(cmd_p, cmd, sizeof(cmd))) {
        pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"BAD_CMD\"}");
        return;
    }

    if (strcmp(cmd, "ping") == 0) {
        char buf[160];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"pong\",\"fw\":\"%s\",\"ver\":\"%s\",\"role\":\"coordinator\"}",
                 PYBOT_ZB_FW_ID, PYBOT_ZB_FW_VER);
        pybot_zb_host_emit(buf);
        return;
    }

    if (strcmp(cmd, "status") == 0) {
        char buf[256];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"status\",\"formed\":%s,\"pan_id\":%u,\"channel\":%u,\"ext_pan\":\"0x%016llx\"}",
                 pybot_zb_network_is_formed() ? "true" : "false",
                 (unsigned)pybot_zb_get_pan_id(),
                 (unsigned)pybot_zb_get_channel(),
                 (unsigned long long)pybot_zb_get_ext_pan_id());
        pybot_zb_host_emit(buf);
        return;
    }

    if (strcmp(cmd, "net_start") == 0) {
        /* Network form is started by the stack on boot; status only. */
        if (pybot_zb_network_is_formed()) {
            char buf[256];
            snprintf(buf, sizeof(buf),
                     "{\"evt\":\"net_formed\",\"pan_id\":%u,\"channel\":%u,\"ext_pan\":\"0x%016llx\"}",
                     (unsigned)pybot_zb_get_pan_id(),
                     (unsigned)pybot_zb_get_channel(),
                     (unsigned long long)pybot_zb_get_ext_pan_id());
            pybot_zb_host_emit(buf);
        } else {
            pybot_zb_host_emit("{\"evt\":\"net_pending\",\"note\":\"forming_or_not_ready\"}");
        }
        return;
    }

    if (strcmp(cmd, "permit_join") == 0) {
        unsigned long timeout = CONFIG_PYBOT_ZB_DEFAULT_PERMIT_JOIN_S;
        const char *t = find_key(line, "timeout_s");
        if (t) {
            parse_uint_value(t, &timeout);
        }
        if (timeout < 1) {
            timeout = 1;
        }
        if (timeout > 254) {
            timeout = 254;
        }
        esp_err_t err = pybot_zb_permit_join((uint8_t)timeout);
        if (err != ESP_OK) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"PERMIT_JOIN_FAIL\"}");
            return;
        }
        char buf[96];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"permit_join\",\"open\":true,\"timeout_s\":%lu}", timeout);
        pybot_zb_host_emit(buf);
        return;
    }

    if (strcmp(cmd, "permit_join_close") == 0) {
        esp_err_t err = pybot_zb_permit_join_close();
        if (err != ESP_OK) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"PERMIT_CLOSE_FAIL\"}");
            return;
        }
        pybot_zb_host_emit("{\"evt\":\"permit_join\",\"open\":false,\"timeout_s\":0}");
        return;
    }

    if (strcmp(cmd, "zcl_onoff") == 0) {
        unsigned long short_addr = 0;
        unsigned long endpoint = 1;
        char action[16] = {0};
        if (!parse_uint_value(find_key(line, "short"), &short_addr) ||
            !parse_string_value(find_key(line, "action"), action, sizeof(action))) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"BAD_ZCL_ONOFF_ARGS\"}");
            return;
        }
        const char *ep = find_key(line, "endpoint");
        if (ep) {
            parse_uint_value(ep, &endpoint);
        }
        esp_err_t err = pybot_zb_zcl_onoff((uint16_t)short_addr, (uint8_t)endpoint, action);
        if (err != ESP_OK) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"ZCL_ONOFF_FAIL\"}");
            return;
        }
        char buf[128];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"zcl_sent\",\"cluster\":\"onoff\",\"short\":%lu,\"endpoint\":%lu,\"action\":\"%s\"}",
                 short_addr, endpoint, action);
        pybot_zb_host_emit(buf);
        return;
    }

    if (strcmp(cmd, "zcl_onoff_read") == 0) {
        unsigned long short_addr = 0;
        unsigned long endpoint = 1;
        if (!parse_uint_value(find_key(line, "short"), &short_addr)) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"BAD_ZCL_READ_ARGS\"}");
            return;
        }
        const char *ep = find_key(line, "endpoint");
        if (ep) {
            parse_uint_value(ep, &endpoint);
        }
        esp_err_t err = pybot_zb_zcl_onoff_read((uint16_t)short_addr, (uint8_t)endpoint);
        if (err != ESP_OK) {
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"ZCL_READ_FAIL\"}");
            return;
        }
        char buf[128];
        snprintf(buf, sizeof(buf),
                 "{\"evt\":\"zcl_read_sent\",\"cluster\":\"onoff\",\"short\":%lu,\"endpoint\":%lu,\"attr\":0}",
                 short_addr, endpoint);
        pybot_zb_host_emit(buf);
        return;
    }

    pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"UNKNOWN_CMD\"}");
}

static void host_proto_task(void *arg)
{
    (void)arg;
    char line[LINE_MAX];
    size_t idx = 0;

    pybot_zb_host_emit(
        "{\"evt\":\"ready\",\"fw\":\"" PYBOT_ZB_FW_ID "\",\"ver\":\"" PYBOT_ZB_FW_VER
        "\",\"role\":\"coordinator\",\"note\":\"opt-in-firmware-not-micropython\"}");

    while (1) {
        int c = fgetc(stdin);
        if (c == EOF) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        if (c == '\r') {
            continue;
        }
        if (c == '\n') {
            line[idx] = '\0';
            if (idx > 0) {
                handle_line(line);
            }
            idx = 0;
            continue;
        }
        if (idx + 1 < LINE_MAX) {
            line[idx++] = (char)c;
        } else {
            idx = 0;
            ESP_LOGW(TAG, "Line overflow; reset");
            pybot_zb_host_emit("{\"evt\":\"error\",\"code\":\"LINE_OVERFLOW\"}");
        }
    }
}

void pybot_zb_host_proto_start(void)
{
    xTaskCreate(host_proto_task, "zb_host", 4096, NULL, 4, NULL);
}
