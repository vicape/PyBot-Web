# Short bench commissioning plan (after READY artifact)

Hardware Zigbee remains **UNVERIFIED** until these steps succeed on the real board.

1. **Backup** stock MicroPython + `main.py` + `/pybot` (`BACKUP_RESTORE.md`).
2. Flash **multi-offset** bundle (bootloader @ `0x0`, partition-table @ `0x8000`,
   app @ `0x10000`) or validated merged-raw — **never** app-only at `0`.
3. Confirm USB REPL boots; `import _uzigbee` succeeds; `import pybot.zigbee`;
   `pybot.zigbee.diagnose()["ok"] is True`.
4. Install boot-safe `main.py` (join **OFF** by default); power-cycle **without PC**.
5. From REPL (supervised): `start_coordinator()`; `permit_join(60)`; put switch in pairing mode.
6. Read `last_joined_short_addr()`; `discover_active_endpoints(addr)` — use **returned**
   endpoints only (dual-channel switch may expose two OnOff EPs).
7. For each OnOff EP: `onoff_on` / `onoff_off`; observe load; optional reporting + `onoff_read`.
8. `close_join()`; power-cycle; confirm pairing persistence if SDK NVRAM retained.
9. Measure LCD draw + Zigbee traffic for coexistence; record heap free.
10. If recovering: re-flash stock ESP32_GENERIC_C6 v1.27.0 and restore backup.
