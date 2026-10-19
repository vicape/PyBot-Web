# License attribution — pybot-c6-micropython-zigbee

## uZigbee project source (MIT)

This integration pins and builds against upstream
[mateuszsury/uZigbee](https://github.com/mateuszsury/uZigbee) (commit in `PINS.json`).

```
MIT License

Copyright (c) 2026 mateuszsury

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

PyBot-authored wrappers under `onboard/` and build scripts in this directory are
part of the PyBot repository license unless otherwise noted.

## Zigbee SDK precompiled terms (resolved LICENSE inspected)

Exact LICENSE files from the resolved Maxwell private-bench package are stored under
`licenses/` and summarized in `THIRD_PARTY_NOTICES.md`.

- `esp-zigbee-lib` ~1.6.0 — Apache-2.0 (see `licenses/espressif__esp-zigbee-lib.LICENSE.txt`)
- `esp-zboss-lib` ~1.6.0 — Espressif/DSR binary license that **permits** redistribution
  in binary form provided copyright notice, conditions, and disclaimer are retained;
  binaries must not be reverse engineered / decompiled / modified / disassembled
  (see `licenses/espressif__esp-zboss-lib.LICENSE.txt`)

**PyBot policy for this path (product-owner updated):**

- Do not publish proprietary Zigbee `.a` libs or storage credentials into git or logs.
- Do not expose an open/generic unauthenticated CDN of arbitrary binaries.
- Anonymous guest delivery of the **pinned** ESP32-C6 firmware image via
  `/api/c6-zigbee-bench-firmware` is authorized when notices/restrictions are bundled
  and short-lived signed tickets gate the three SHA256-verified segments.
- Copyright of third-party components does **not** forbid all guest delivery; it
  requires retaining notices/disclaimers (esp-zboss-lib) and license texts
  (Apache-2.0 / MIT) — complied with by bundled `THIRD_PARTY_NOTICES` + licenses.

## Other toolchain licenses (fetched at build time, not vendored)

| Component | Typical license |
| --- | --- |
| MicroPython v1.27.0 | MIT |
| ESP-IDF v5.3.2 | Apache-2.0 (+ component notices) |
