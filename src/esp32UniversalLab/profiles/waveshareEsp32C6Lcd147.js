/**
 * Waveshare ESP32-C6-LCD-1.47 (SKU 28563 / 30381-M)
 * Pin map from Waveshare docs: https://docs.waveshare.com/ESP32-C6-LCD-1.47
 *
 * Zigbee/Thread: SoC has IEEE 802.15.4 radio; MicroPython/Python bindings are
 * NOT VERIFIED on this product path — exposed as UNSUPPORTED until real-device proof.
 */

import { CAPABILITY_STATUS } from "../capabilityStatus.js";

export const WAVESHARE_ESP32_C6_LCD_147_ID = "waveshare-esp32-c6-lcd-1.47";

export const waveshareEsp32C6Lcd147 = Object.freeze({
  id: WAVESHARE_ESP32_C6_LCD_147_ID,
  commercialName: "Waveshare ESP32-C6-LCD-1.47",
  manufacturer: "Waveshare",
  chipFamily: "esp32c6",
  mcu: "ESP32-C6FH4",
  flashMb: 4,
  psramMb: 0,
  docsUrl: "https://docs.waveshare.com/ESP32-C6-LCD-1.47",
  pinoutSource: "waveshare-docs-esp32-c6-lcd-1.47",
  display: Object.freeze({
    controller: "ST7789",
    width: 172,
    height: 320,
    interface: "spi",
    pins: Object.freeze({
      mosi: 6,
      sclk: 7,
      cs: 14,
      dc: 15,
      rst: 21,
      bl: 22,
    }),
  }),
  reservedPins: Object.freeze({
    lcd: Object.freeze([6, 7, 14, 15, 21, 22]),
    tfCard: Object.freeze([4, 5, 6, 7]),
    rgbLed: Object.freeze([8]),
    bootButton: Object.freeze([9]),
    usb: Object.freeze([12, 13]),
  }),
  availableGpioHeader: Object.freeze([0, 1, 2, 3, 10, 11, 18, 19, 20, 23]),
  peripherals: Object.freeze({
    tfCard: Object.freeze({
      interface: "spi",
      pins: Object.freeze({ miso: 5, mosi: 6, sclk: 7, cs: 4 }),
      note: "Shares SPI bus with LCD; independent CS.",
    }),
    rgbLed: Object.freeze({ din: 8 }),
    bootButton: Object.freeze({ gpio: 9, active: "low" }),
  }),
  firmware: Object.freeze({
    target: "esp32c6",
    runtimeFamily: "micropython-compatible",
    imageId: null,
    imageSha256: null,
    partitionScheme: null,
    status: CAPABILITY_STATUS.PLANNED,
    milestone: "M1",
  }),
  capabilities: Object.freeze({
    gpio: CAPABILITY_STATUS.PLANNED,
    pwm: CAPABILITY_STATUS.PLANNED,
    adc: CAPABILITY_STATUS.PLANNED,
    timers: CAPABILITY_STATUS.PLANNED,
    wifi: CAPABILITY_STATUS.PLANNED,
    wifiAp: CAPABILITY_STATUS.PLANNED,
    ble: CAPABILITY_STATUS.PLANNED,
    display: CAPABILITY_STATUS.PLANNED,
    touch: CAPABILITY_STATUS.UNSUPPORTED,
    imu: CAPABILITY_STATUS.UNSUPPORTED,
    audio: CAPABILITY_STATUS.UNSUPPORTED,
    i2c: CAPABILITY_STATUS.PLANNED,
    spi: CAPABILITY_STATUS.PLANNED,
    uart: CAPABILITY_STATUS.PLANNED,
    tfCard: CAPABILITY_STATUS.PLANNED,
    powerSleep: CAPABILITY_STATUS.PLANNED,
    zigbee: CAPABILITY_STATUS.UNSUPPORTED,
    thread: CAPABILITY_STATUS.UNSUPPORTED,
    can: CAPABILITY_STATUS.UNSUPPORTED,
    rs485: CAPABILITY_STATUS.UNSUPPORTED,
  }),
  capabilityNotes: Object.freeze({
    zigbee:
      "NOT VERIFIED / UNSUPPORTED until native stack + Python bindings are proven on this board firmware (M2).",
    thread:
      "NOT VERIFIED / UNSUPPORTED until native stack + Python bindings are proven on this board firmware (M2).",
    touch: "This commercial model has no touch controller.",
  }),
});
