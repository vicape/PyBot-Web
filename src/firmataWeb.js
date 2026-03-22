/**
 * Firmata mínimo por Web Serial (StandardFirmata en Arduino).
 * Pin mode SERVO + Extended Analog (sysex 0x6F), alineado con firmata.js.
 */

export const PIN_MODE = 0xf4;
export const REPORT_VERSION = 0xf9;
export const START_SYSEX = 0xf0;
export const END_SYSEX = 0xf7;
export const EXTENDED_ANALOG = 0x6f;
export const MODE_SERVO = 4;

export function speedToServoAngle(speed) {
  const s = Math.max(-100, Math.min(100, speed));
  return Math.round(90 + (s * 90) / 100);
}

export function buildSetPinMode(pin, mode) {
  return new Uint8Array([PIN_MODE, pin & 0x7f, mode & 0x7f]);
}

export function buildExtendedAnalog(pin, value) {
  const v = Math.max(0, Math.min(0xffff, value));
  return new Uint8Array([
    START_SYSEX,
    EXTENDED_ANALOG,
    pin & 0x7f,
    v & 0x7f,
    (v >> 7) & 0x7f,
    END_SYSEX,
  ]);
}

export function buildServoFromSpeed(pin, speed) {
  return buildExtendedAnalog(pin, speedToServoAngle(speed));
}

/**
 * @returns {{ writer, close: () => Promise<void>, baudRate: number }}
 */
export async function openFirmata(port, servoPin, options = {}) {
  const baudRates = options.baudRates ?? [57600, 115200];
  let lastErr;

  for (const baudRate of baudRates) {
    try {
      if (port.readable || port.writable) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      }

      await port.open({ baudRate });
      const writer = port.writable.getWriter();
      const reader = port.readable.getReader();

      const sink = (async () => {
        try {
          for (;;) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          /* cancel() o cierre */
        }
      })();

      await new Promise((r) => setTimeout(r, 2200));
      await writer.write(new Uint8Array([REPORT_VERSION]));
      await new Promise((r) => setTimeout(r, 400));

      await writer.write(buildSetPinMode(servoPin, MODE_SERVO));
      await new Promise((r) => setTimeout(r, 100));
      await writer.write(buildExtendedAnalog(servoPin, 90));

      const close = async () => {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        try {
          await sink;
        } catch {
          /* ignore */
        }
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        try {
          writer.releaseLock();
        } catch {
          /* ignore */
        }
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      };

      return { writer, close, baudRate };
    } catch (e) {
      lastErr = e;
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    }
  }

  throw lastErr ?? new Error("No se pudo abrir el puerto serie");
}

export async function writeServoSpeed(writer, pin, speed) {
  await writer.write(buildServoFromSpeed(pin, speed));
}
