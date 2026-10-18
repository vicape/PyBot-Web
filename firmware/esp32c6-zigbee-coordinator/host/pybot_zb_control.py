#!/usr/bin/env python3
"""
Executable PyBot HOST-SIDE control flow for the native Zigbee coordinator firmware.

This is NOT an on-device MicroPython module and must NOT be labeled pybot.zigbee.
Requires the board to be flashed with the opt-in Zigbee coordinator image
(NOT stock MicroPython). Uses USB CDC / Serial-JTAG.

English Python-programmable commands (host CLI):
  create network  -> net-start
  allow joining   -> permit-join
  status          -> status
  command on/off  -> onoff --action on|off
  read            -> read-onoff
  monitor         -> monitor --seconds N  (live device_annce / device_joined)

Usage:
  python3 pybot_zb_control.py --port /dev/ttyACM0 ping
  python3 pybot_zb_control.py --port /dev/ttyACM0 status
  python3 pybot_zb_control.py --port /dev/ttyACM0 "create network"
  python3 pybot_zb_control.py --port /dev/ttyACM0 "allow joining" --timeout 60
  python3 pybot_zb_control.py --port /dev/ttyACM0 monitor --seconds 30
  python3 pybot_zb_control.py --port /dev/ttyACM0 onoff --short 0x1234 --endpoint 1 --action on
  python3 pybot_zb_control.py --port /dev/ttyACM0 read-onoff --short 0x1234 --endpoint 1

Physical Zigbee pairing is UNVERIFIED until run against real hardware.
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from typing import Any


PROTOCOL_VERSION = 1

# Live discoveries collected during this process (never fabricated).
_discovered: dict[int, dict[str, Any]] = {}


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


def _record_discovery(evt: dict) -> None:
    """Persist real join/annce events only (no fabricated device IDs)."""
    name = evt.get("evt")
    if name not in ("device_annce", "device_joined"):
        return
    short = evt.get("short")
    ieee = evt.get("ieee")
    if not isinstance(short, int) or not isinstance(ieee, str):
        return
    entry = _discovered.get(short, {"short": short, "ieee": ieee, "endpoints": []})
    entry["ieee"] = ieee
    entry["last_evt"] = name
    if name == "device_joined" and isinstance(evt.get("endpoints"), list):
        eps = [e for e in evt["endpoints"] if isinstance(e, int)]
        if eps:
            entry["endpoints"] = eps
    _discovered[short] = entry


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
        _record_discovery(evt)
        events.append(evt)
        if expect_evt is None or evt.get("evt") == expect_evt:
            return evt, events
    return None, events


def monitor_events(ser, seconds: float) -> list[dict]:
    """
    Live async event monitor for device_annce / device_joined (and any other JSON evt).
    Cancels cleanly on timeout or SIGINT; always closes via caller finally.
    """
    collected: list[dict] = []
    stop = {"flag": False}

    def _on_sigint(signum, frame):  # noqa: ARG001
        stop["flag"] = True

    prev = signal.signal(signal.SIGINT, _on_sigint)
    deadline = time.time() + max(0.0, float(seconds))
    try:
        while time.time() < deadline and not stop["flag"]:
            raw = ser.readline().decode("utf-8", errors="replace")
            if not raw:
                continue
            try:
                evt = decode_event(raw)
            except (ValueError, json.JSONDecodeError):
                continue
            _record_discovery(evt)
            collected.append(evt)
            print(json.dumps(evt, separators=(",", ":")), flush=True)
    finally:
        signal.signal(signal.SIGINT, prev)
    return collected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "PyBot Zigbee coordinator HOST control (USB). "
            "Not on-device pybot.zigbee."
        )
    )
    parser.add_argument("--port", required=True, help="USB serial port, e.g. /dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=115200)
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("ping")
    sub.add_parser("status")
    # English aliases (user-facing Python/CLI vocabulary)
    sub.add_parser("create network", aliases=["net-start", "create-network"])
    p_join = sub.add_parser(
        "allow joining",
        aliases=["permit-join", "allow-joining"],
    )
    p_join.add_argument("--timeout", type=int, default=60)
    sub.add_parser("permit-join-close", aliases=["close-joining"])
    p_on = sub.add_parser("onoff", aliases=["command"])
    p_on.add_argument("--short", required=True, type=lambda s: int(s, 0))
    p_on.add_argument("--endpoint", type=int, default=1)
    p_on.add_argument("--action", choices=("on", "off", "toggle"), required=True)
    p_rd = sub.add_parser("read-onoff", aliases=["read"])
    p_rd.add_argument("--short", required=True, type=lambda s: int(s, 0))
    p_rd.add_argument("--endpoint", type=int, default=1)
    p_mon = sub.add_parser("monitor")
    p_mon.add_argument(
        "--seconds",
        type=float,
        required=True,
        help="Live-monitor window for async device_annce / device_joined",
    )
    # list/status of discovered devices only when this process collected real events
    sub.add_parser("list")

    args = parser.parse_args(argv)
    ser = open_serial(args.port, args.baud)
    try:
        if args.action == "ping":
            line = encode_cmd("ping")
            evt, _ = transact(ser, line, expect_evt="pong")
        elif args.action == "status":
            line = encode_cmd("status")
            evt, _ = transact(ser, line, expect_evt="status")
        elif args.action in ("create network", "net-start", "create-network"):
            line = encode_cmd("net_start")
            evt, _ = transact(ser, line)
        elif args.action in ("allow joining", "permit-join", "allow-joining"):
            line = encode_cmd("permit_join", timeout_s=args.timeout)
            evt, _ = transact(ser, line, expect_evt="permit_join")
        elif args.action in ("permit-join-close", "close-joining"):
            line = encode_cmd("permit_join_close")
            evt, _ = transact(ser, line, expect_evt="permit_join")
        elif args.action in ("onoff", "command"):
            line = encode_cmd(
                "zcl_onoff",
                short=args.short,
                endpoint=args.endpoint,
                action=args.action,
            )
            evt, _ = transact(ser, line, expect_evt="zcl_sent")
        elif args.action in ("read-onoff", "read"):
            line = encode_cmd(
                "zcl_onoff_read",
                short=args.short,
                endpoint=args.endpoint,
            )
            evt, _ = transact(ser, line, expect_evt="zcl_read_sent")
        elif args.action == "monitor":
            events = monitor_events(ser, args.seconds)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "action": "monitor",
                        "seconds": args.seconds,
                        "events": events,
                        "discovered": list(_discovered.values()),
                        "protocolVersion": PROTOCOL_VERSION,
                        "hostSide": True,
                        "onDeviceModule": None,
                    }
                )
            )
            return 0
        elif args.action == "list":
            # Only report devices actually observed in this process — never fabricate.
            devices = list(_discovered.values())
            print(
                json.dumps(
                    {
                        "ok": True,
                        "action": "list",
                        "devices": devices,
                        "note": (
                            "Empty unless prior monitor/transact in this process saw "
                            "device_annce/device_joined. No persistent store in M2A."
                        ),
                        "protocolVersion": PROTOCOL_VERSION,
                        "hostSide": True,
                        "onDeviceModule": None,
                    }
                )
            )
            return 0
        else:
            raise SystemExit(f"unknown action {args.action}")

        print(
            json.dumps(
                {
                    "ok": evt is not None,
                    "event": evt,
                    "discovered": list(_discovered.values()),
                    "protocolVersion": PROTOCOL_VERSION,
                    "hostSide": True,
                    "onDeviceModule": None,
                }
            )
        )
        return 0 if evt is not None else 1
    finally:
        try:
            ser.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
