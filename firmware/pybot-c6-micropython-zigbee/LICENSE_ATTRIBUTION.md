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

## Zigbee SDK precompiled / proprietary terms (NOT redistributed here)

Upstream uZigbee `docs/LICENSE_NOTES.md` states:

- `esp-zigbee-lib` — obtained at **build time** from Espressif Component Registry
- `esp-zboss-lib` — **proprietary** Espressif/DSR distribution terms

**PyBot policy for this path:**

- Do **not** vendor or commit Zigbee SDK binaries, `.a` libs, or merged firmware
  images into the repository until redistribution terms are verified for the
  intended distribution model.
- Build scripts clone toolchains into ignored `third_party/` / write artifacts
  under ignored `build-artifact/*.bin`.
- Publishing a READY firmware artifact to end users requires a separate license
  compliance check for bundled ZBOSS components.

## Other toolchain licenses (fetched at build time, not vendored)

| Component | Typical license |
| --- | --- |
| MicroPython v1.27.0 | MIT |
| ESP-IDF v5.3.2 | Apache-2.0 (+ component notices) |
