/**
 * Modelo declarativo de capacidades de placa (familia / perfil / transportes).
 * No sustituye el selector pedagógico actual; prepara backends futuros (Pico, etc.).
 */

export const BOARD_FAMILY = Object.freeze({
  ARDUINO: "arduino",
  MICROPYTHON: "micropython",
});

export const MICROPYTHON_BOARD_PROFILES = Object.freeze({
  ESP32_DEVKIT: "esp32-devkit",
  WEMOS_EDA6: "wemos-eda6",
});

export const ESP32_MICROPYTHON_CAPABILITIES = Object.freeze({
  family: BOARD_FAMILY.MICROPYTHON,
  gpio: true,
  pwm: true,
  adc: true,
  i2c: true,
  wifi: true,
  bluetooth: true,
  micropython: true,
  standalone: true,
  http: true,
  transports: Object.freeze(["serial", "ble"]),
});

export const ARDUINO_FIRMATA_CAPABILITIES = Object.freeze({
  family: BOARD_FAMILY.ARDUINO,
  gpio: true,
  pwm: true,
  adc: true,
  i2c: false,
  wifi: false,
  bluetooth: false,
  micropython: false,
  standalone: true,
  http: false,
  transports: Object.freeze(["serial"]),
});

/**
 * @param {string} boardType  localStorage pybot_board_type
 * @param {string} [eda6Profile]
 */
export function capabilitiesForBoardType(boardType, eda6Profile = "WEMOS") {
  if (boardType === "esp32-eda6") {
    return {
      ...ESP32_MICROPYTHON_CAPABILITIES,
      profile:
        eda6Profile === "ESP32"
          ? MICROPYTHON_BOARD_PROFILES.ESP32_DEVKIT
          : MICROPYTHON_BOARD_PROFILES.WEMOS_EDA6,
      eda6: true,
    };
  }
  if (boardType === "esp32-micropython" || boardType === "esp32-serial") {
    return {
      ...ESP32_MICROPYTHON_CAPABILITIES,
      profile: MICROPYTHON_BOARD_PROFILES.ESP32_DEVKIT,
      eda6: false,
    };
  }
  return {
    ...ARDUINO_FIRMATA_CAPABILITIES,
    profile: "arduino-uno",
    eda6: false,
  };
}
