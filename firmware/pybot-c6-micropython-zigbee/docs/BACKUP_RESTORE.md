# Backup / restore — stock MicroPython C6 (verified LCD path)

The user’s physically verified default is **official MicroPython ESP32_GENERIC_C6 v1.27.0**
with PyBot Universal Lab `pybot.*` modules and **ST7789 172×320** graphics.

Flashing the custom MicroPython+Zigbee image **erases** that environment.

## Before any opt-in Zigbee firmware flash

1. Connect via PyBot IDE / WebSerial (stock MicroPython path).
2. Copy off the board (mpremote, Thonny, or IDE save):
   - `/main.py` (user program)
   - `/boot.py` if customized
   - `/pybot/` tree
   - any `/assets/` or other user files
3. Keep a local folder named e.g. `c6-stock-backup-YYYYMMDD/`.
4. Confirm the stock firmware SHA matches:

   - File: `/firmware/micropython/ESP32_GENERIC_C6-20251209-v1.27.0.bin`
   - SHA-256: `111ca6322520f56ca44c41b6993d56ff75d7c1c0c3939991e53463024bb0e183`

## Restore stock MicroPython (recovery)

1. Put the board in download / bootloader mode per Waveshare docs if needed.
2. Flash the official image at the MicroPython-documented full-image offset (merged stock image @ `0`):

   ```bash
   esptool.py --chip esp32c6 write_flash 0 ESP32_GENERIC_C6-20251209-v1.27.0.bin
   ```

   Or use PyBot Universal Lab **Install MicroPython (C6)** (M1 path) — never auto-flash Zigbee.
3. Reinstall `/pybot` modules via Lab Connect / install.
4. Restore backed-up `main.py` and assets.
5. Re-run the graphics diagnostic example to confirm the zero-error LCD path.

## Notes

- `autoFlash` is **false** for the custom Zigbee MicroPython mode.
- Mode remains **NOT READY** until a real multi-offset/merged artifact exists **and** boot+partition layout is validated.
- Hardware Zigbee remains **UNVERIFIED** even after a successful compile.
