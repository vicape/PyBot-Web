/*
 * USB Serial/JTAG line protocol for PyBot host control.
 * Newline-delimited JSON; see docs/ESP32_UNIVERSAL_LAB_M2A.md
 */
#pragma once

#include "esp_err.h"

void pybot_zb_host_proto_start(void);
void pybot_zb_host_emit(const char *json_object_body);
