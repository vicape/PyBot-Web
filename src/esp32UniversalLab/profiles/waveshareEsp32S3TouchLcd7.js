/**
 * Waveshare ESP32-S3-Touch-LCD-7 (800×480 RGB + GT911)
 * Pin map from Waveshare / Espressif Arduino variant waveshare_esp32_s3_touch_lcd_7
 * and NuttX board docs. CAN + RS485 present on this exact model via onboard
 * transceiver + CH422G USB/CAN select — listed UNVERIFIED until driven.
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";

export const WAVESHARE_ESP32_S3_TOUCH_LCD_7_ID =
  "waveshare-esp32-s3-touch-lcd-7";

export const waveshareEsp32S3TouchLcd7 = Object.freeze({
  id: WAVESHARE_ESP32_S3_TOUCH_LCD_7_ID,
  commercialName: "Waveshare ESP32-S3-Touch-LCD-7",
  manufacturer: "Waveshare",
  chipFamily: "esp32s3",
  mcu: "ESP32-S3",
  flashMb: 16,
  psramMb: 8,
  docsUrl:
    "https://docs.waveshare.com/docs/ESP32/ESP32-S3/ESP32-S3-Touch-LCD-7/Arduino/Arduino-RGB-LCD-Demo",
  pinoutSource: "waveshare-esp32-s3-touch-lcd-7-arduino-variant",
  display: Object.freeze({
    controller: "RGB565-panel",
    panelNote: "Parallel RGB565 (LCD_CAM); timing-driven panel (no SPI LCD IC).",
    width: 800,
    height: 480,
    interface: "rgb565",
    pins: Object.freeze({
      de: 5,
      vsync: 3,
      hsync: 46,
      pclk: 7,
      r: Object.freeze([1, 2, 42, 41, 40]),
      g: Object.freeze([39, 0, 45, 48, 47, 21]),
      b: Object.freeze([14, 38, 18, 17, 10]),
    }),
    ch422g: Object.freeze({
      touchRst: "EXIO1",
      backlight: "EXIO2",
      lcdRst: "EXIO3",
      sdCs: "EXIO4",
      usbCanSelect: "EXIO5",
    }),
  }),
  touch: Object.freeze({
    controller: "GT911",
    interface: "i2c",
    pins: Object.freeze({ sda: 8, scl: 9, int: 4, rst: "CH422G.EXIO1" }),
  }),
  buses: Object.freeze({
    i2cShared: Object.freeze({ sda: 8, scl: 9, devices: ["GT911", "CH422G"] }),
    tfSpi: Object.freeze({ sck: 12, mosi: 11, miso: 13, cs: "CH422G.EXIO4" }),
    rs485: Object.freeze({ rx: 16, tx: 15 }),
    can: Object.freeze({ rx: 19, tx: 20, enable: "CH422G.EXIO5" }),
  }),
  reservedPins: Object.freeze({
    rgb: Object.freeze([
      0, 1, 2, 3, 5, 7, 10, 14, 17, 18, 21, 38, 39, 40, 41, 42, 45, 46, 47, 48,
    ]),
    touchI2c: Object.freeze([8, 9]),
    touchInt: Object.freeze([4]),
    rs485: Object.freeze([15, 16]),
    canUsbShared: Object.freeze([19, 20]),
    tfSpi: Object.freeze([11, 12, 13]),
  }),
  firmware: Object.freeze({
    target: "esp32s3",
    runtimeFamily: "micropython-compatible",
    imageId: null,
    imageSha256: null,
    partitionScheme: null,
    status: CAPABILITY_STATUS.PLANNED,
    milestone: "M3",
  }),
  capabilities: Object.freeze({
    gpio: CAPABILITY_STATUS.PLANNED,
    pwm: CAPABILITY_STATUS.PLANNED,
    adc: CAPABILITY_STATUS.PLANNED,
    wifi: CAPABILITY_STATUS.PLANNED,
    ble: CAPABILITY_STATUS.PLANNED,
    display: CAPABILITY_STATUS.PLANNED,
    touch: CAPABILITY_STATUS.PLANNED,
    lvgl: CAPABILITY_STATUS.PLANNED,
    i2c: CAPABILITY_STATUS.PLANNED,
    spi: CAPABILITY_STATUS.PLANNED,
    uart: CAPABILITY_STATUS.PLANNED,
    tfCard: CAPABILITY_STATUS.PLANNED,
    can: CAPABILITY_STATUS.UNVERIFIED,
    rs485: CAPABILITY_STATUS.UNVERIFIED,
    imu: CAPABILITY_STATUS.UNSUPPORTED,
    audio: CAPABILITY_STATUS.UNSUPPORTED,
    zigbee: CAPABILITY_STATUS.UNSUPPORTED,
    thread: CAPABILITY_STATUS.UNSUPPORTED,
  }),
  capabilityNotes: Object.freeze({
    can:
      "Exact model includes CAN transceiver (GPIO19/20 + CH422G EXIO5). UNVERIFIED until Python binding + device test.",
    rs485:
      "Exact model includes RS485 (GPIO15/16). UNVERIFIED until Python binding + device test.",
    zigbee: "ESP32-S3 has no 802.15.4 radio — UNSUPPORTED.",
    thread: "ESP32-S3 has no 802.15.4 radio — UNSUPPORTED.",
  }),
});
