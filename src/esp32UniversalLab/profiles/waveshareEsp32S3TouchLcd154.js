/**
 * Waveshare ESP32-S3-Touch-LCD-1.54
 * Pin map cross-checked from Waveshare docs + schematic/demo references:
 * https://docs.waveshare.com/ESP32-S3-Touch-LCD-1.54
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";

export const WAVESHARE_ESP32_S3_TOUCH_LCD_154_ID =
  "waveshare-esp32-s3-touch-lcd-1.54";

export const waveshareEsp32S3TouchLcd154 = Object.freeze({
  id: WAVESHARE_ESP32_S3_TOUCH_LCD_154_ID,
  commercialName: "Waveshare ESP32-S3-Touch-LCD-1.54",
  manufacturer: "Waveshare",
  chipFamily: "esp32s3",
  mcu: "ESP32-S3R8",
  flashMb: 16,
  psramMb: 8,
  docsUrl: "https://docs.waveshare.com/ESP32-S3-Touch-LCD-1.54",
  pinoutSource: "waveshare-docs-esp32-s3-touch-lcd-1.54",
  display: Object.freeze({
    controller: "ST7789",
    width: 240,
    height: 240,
    interface: "spi",
    pins: Object.freeze({
      sclk: 38,
      mosi: 39,
      cs: 21,
      dc: 45,
      rst: 40,
      bl: 46,
    }),
  }),
  touch: Object.freeze({
    controller: "CST816",
    interface: "i2c",
    pins: Object.freeze({ sda: 42, scl: 41, rst: 47, int: 48 }),
  }),
  imu: Object.freeze({
    controller: "QMI8658",
    interface: "i2c",
    pins: Object.freeze({ sda: 42, scl: 41, int: 6 }),
    address: 0x6b,
  }),
  audio: Object.freeze({
    micCodec: "ES7210",
    speakerCodec: "ES8311",
    amp: "NS4150B",
    i2s: Object.freeze({
      mclk: 8,
      sclk: 9,
      lrck: 10,
      dout: 11,
      din: 12,
      paCtrl: 7,
    }),
    i2c: Object.freeze({ sda: 42, scl: 41 }),
  }),
  power: Object.freeze({
    batAdc: 1,
    batEn: 2,
    chgStat: 3,
  }),
  buttons: Object.freeze({
    keyMinus: 0,
    keyPlus: 4,
    keyPwr: 5,
  }),
  reservedPins: Object.freeze({
    display: Object.freeze([21, 38, 39, 40, 45, 46]),
    touchImuAudioI2c: Object.freeze([41, 42]),
    audioI2s: Object.freeze([7, 8, 9, 10, 11, 12]),
    touchCtrl: Object.freeze([47, 48]),
    imuInt: Object.freeze([6]),
    power: Object.freeze([1, 2, 3]),
    buttons: Object.freeze([0, 4, 5]),
    sdmmc: Object.freeze([13, 14, 15, 16, 17, 18]),
    usb: Object.freeze([19, 20]),
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
    imu: CAPABILITY_STATUS.PLANNED,
    audio: CAPABILITY_STATUS.PLANNED,
    i2c: CAPABILITY_STATUS.PLANNED,
    spi: CAPABILITY_STATUS.PLANNED,
    uart: CAPABILITY_STATUS.PLANNED,
    i2s: CAPABILITY_STATUS.PLANNED,
    tfCard: CAPABILITY_STATUS.PLANNED,
    battery: CAPABILITY_STATUS.PLANNED,
    zigbee: CAPABILITY_STATUS.UNSUPPORTED,
    thread: CAPABILITY_STATUS.UNSUPPORTED,
    can: CAPABILITY_STATUS.UNSUPPORTED,
    rs485: CAPABILITY_STATUS.UNSUPPORTED,
  }),
  capabilityNotes: Object.freeze({
    zigbee: "ESP32-S3 has no 802.15.4 radio — UNSUPPORTED.",
    thread: "ESP32-S3 has no 802.15.4 radio — UNSUPPORTED.",
  }),
});
