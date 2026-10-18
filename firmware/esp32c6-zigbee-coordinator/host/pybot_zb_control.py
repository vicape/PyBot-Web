#!/usr/bin/env python3
"""
Executable PyBot host control flow for the native Zigbee coordinator firmware.

Requires the board to be flashed with the opt-in Zigbee coordinator image
(NOT stock MicroPython). Uses USB CDC / Serial-JTAG.

Usage:
  python3 pybot_zb_control.py --port /dev/ttyACM0 ping
  python3 pybot_zb_control.py --port /dev/ttyACM0 status
  python3 pybot_zb_control.py --port /dev/ttyACM0 permit-join --timeout 60
  python3 pybot_zb_control.py --port /dev/ttyACM0 onoff --short 0x1234 --endpoint 1 --action on
  python3 pybot_zb_control.py --port /dev/ttyACM0 read-onoff --short 0x1234 --endpoint 1

Physical Zigbee pairing is UNVERIFIED until run against real hardware.
"""

from __future__ import annotations

import argparse
import json
import sys
import time


PROTOCOL_VERSION = 1


def encode_cmd(cmd: str, **fields) -> str:
    payload = {"cmd": cmd, **fields}
    return json.dumps(payload, separators=(",", ":"))


def decode_event(line: str) -> dict:
    line = line.strip()
    if not line:
        raise ValueError("empty line")
    data = json.loads(line)
    if not isinstance(data, dict) or "evt" not in data:
        raise ValueError(f"not an event: {line!r}")
    return data


def open_serial(port: str, baud: int = 115200):
    try:
        import serial  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "pyserial is required for live USB control: pip install pyserial"
        ) from exc
    ser = serial.Serial(port, baudrate=baud, timeout=1.0)
    time.sleep(0.2)
    return ser


def transact(ser, cmd_line: str, expect_evt: str | None = None, wait_s: float = 3.0):
    ser.reset_input_buffer()
    ser.write((cmd_line + "\n").encode("utf-8"))
    ser.flush()
    deadline = time.time() + wait_s
    events = []
    while time.time() < deadline:
        raw = ser.readline().decode("utf-8", errors="replace")
        if not raw:
            continue
        try:
            evt = decode_event(raw)
        except (ValueError, json.JSONDecodeError):
            continue
        events.append(evt)
        if expect_evt is None or evt.get("evt") == expect_evt:
            return evt, events
    return None, events


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PyBot Zigbee coordinator host control")
    parser.add_argument("--port", required=True, help="USB serial port, e.g. /dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=115200)
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("ping")
    sub.add_parser("status")
    sub.add_parser("net-start")
    p_join = sub.add_parser("permit-join")
    p_join.add_argument("--timeout", type=int, default=60)
    sub.add_parser("permit-join-close")
    p_on = sub.add_parser("onoff")
    p_on.add_argument("--short", required=True, type=lambda s: int(s, 0))
    p_on.add_argument("--endpoint", type=int, default=1)
    p_on.add_argument("--action", choices=("on", "off", "toggle"), required=True)
    p_rd = sub.add_parser("read-onoff")
    p_rd.add_argument("--short", required=True, type=lambda s: int(s, 0))
    p_rd.add_argument("--endpoint", type=int, default=1)

    args = parser.parse_args(argv)
    ser = open_serial(args.port, args.baud)
    try:
        if args.action == "ping":
            line = encode_cmd("ping")
            evt, _ = transact(ser, line, expect_evt="pong")
        elif args.action == "status":
            line = encode_cmd("status")
            evt, _ = transact(ser, line, expect_evt="status")
        elif args.action == "net-start":
            line = encode_cmd("net_start")
            evt, _ = transact(ser, line)
        elif args.action == "permit-join":
            line = encode_cmd("permit_join", timeout_s=args.timeout)
            evt, _ = transact(ser, line, expect_evt="permit_join")
        elif args.action == "permit-join-close":
            line = encode_cmd("permit_join_close")
            evt, _ = transact(ser, line, expect_evt="permit_join")
        elif args.action == "onoff":
            line = encode_cmd(
                "zcl_onoff",
                short=args.short,
                endpoint=args.endpoint,
                action=args.action,
            )
            evt, _ = transact(ser, line, expect_evt="zcl_sent")
        elif args.action == "read-onoff":
            line = encode_cmd(
                "zcl_onoff_read",
                short=args.short,
                endpoint=args.endpoint,
            )
            evt, _ = transact(ser, line, expect_evt="zcl_read_sent")
        else:
            raise SystemExit(f"unknown action {args.action}")

        print(json.dumps({"ok": evt is not None, "event": evt, "protocolVersion": PROTOCOL_VERSION}))
        return 0 if evt is not None else 1
    finally:
        ser.close()


if __name__ == "__main__":
    sys.exit(main())
