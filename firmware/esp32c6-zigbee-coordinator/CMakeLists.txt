# PyBot native Zigbee 3.x coordinator for Waveshare ESP32-C6-LCD-1.47 (4MB, no PSRAM).
# Isolated ESP-IDF project — does NOT replace stock MicroPython unless explicitly flashed.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(pybot_esp32c6_zigbee_coordinator)
