# ESP32 Universal Lab — MicroPython + native Zigbee (uZigbee v1.6 PoC)

**Scope:** `vicape/PyBot-Web` branch `feature/esp32-universal-lab` only
**Path:** `firmware/pybot-c6-micropython-zigbee/`
**Decision:** `PIN_UZIGBEE_V1_6_AS_POC`
**Hardware Zigbee:** UNVERIFIED
**Mode:** NOT READY until READY multi-offset/merged artifact + validated boot

## Relation to M2A interim coordinator

| Path | Role |
| --- | --- |
| `firmware/esp32c6-zigbee-coordinator/` | Interim **NON-MicroPython** ESP-IDF v2 host-controlled target |
| `firmware/pybot-c6-micropython-zigbee/` | **Desired** same-board Python + Zigbee coordinator (this doc) |

Do not present the interim path as the standalone Python solution. Do not mix
ZBOSS/v1.6 with esp-zigbee-lib ~2.0.0.

## Operator pointers

- Build / pins / licenses: firmware README + `DECISION.md` + `LICENSE_ATTRIBUTION.md`
- Backup stock C6: `firmware/pybot-c6-micropython-zigbee/docs/BACKUP_RESTORE.md`
- OnOff / Tuya / Smart Life limits: `docs/LIMITATIONS.md`
- Bench plan: `docs/BENCH_COMMISSIONING.md`
- On-device API: `onboard/pybot_zigbee.py` → installed as `pybot/zigbee.py`
