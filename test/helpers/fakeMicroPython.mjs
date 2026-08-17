/**
 * Simulador byte-oriented del raw REPL / raw-paste de MicroPython 1.27.
 * Emite OK como 0x4F 0x4B, nunca "OK\n".
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toU8(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return ENC.encode(data);
  return new Uint8Array(data);
}

function includesByte(u8, b) {
  for (let i = 0; i < u8.length; i++) if (u8[i] === b) return true;
  return false;
}

export class FakeMicroPythonTransport {
  /**
   * @param {{
   *   paste?: boolean,
   *   windowSize?: number,
   *   grantWindow?: boolean,
   *   sendPasteAck?: boolean,
   *   abortPaste?: boolean,
   *   fragment?: (u8: Uint8Array) => Uint8Array[],
   *   sameChunk?: boolean,
   *   txFail?: boolean,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.writes = [];
    this._cbs = new Set();
    this._raw = false;
    this._busy = false;
    this._program = new Uint8Array(0);
    this._paste = false;
    this._windowRemain = 0;
    this._windowSize = opts.windowSize ?? 32;
    this.execStarted = false;
    this.ctrlCDuringExec = 0;
    this.open = true;
    this.forceStopSeen = false;
    this.overflowSimulated = false;
  }

  isOpen() {
    return this.open;
  }

  onData(cb) {
    this._cbs.add(cb);
    return () => this._cbs.delete(cb);
  }

  emitBytes(u8) {
    const bytes = toU8(u8);
    if (!bytes.length) return;
    const parts = this.opts.fragment ? this.opts.fragment(bytes) : [bytes];
    for (const p of parts) {
      this._cbs.forEach((cb) => cb(p));
    }
  }

  emitText(s) {
    this.emitBytes(ENC.encode(s));
  }

  _appendProgram(u8) {
    const next = new Uint8Array(this._program.length + u8.length);
    next.set(this._program, 0);
    next.set(u8, this._program.length);
    this._program = next;
  }

  _programText() {
    return DEC.decode(this._program);
  }

  _isInfinite(text) {
    return /while\s+True\s*:/.test(text) || /for\s+\w+\s+in\s+range\s*\(\s*10\s*\*\*\s*9/.test(text);
  }

  _stdoutFor(text) {
    const m = text.match(/print\((['"])(.*?)\1\)/);
    if (m) return m[2] + "\n";
    if (text.includes("PYBOT_FILE_EXISTS") || /os\.stat\(/.test(text)) return "PYBOT_FILE_EXISTS\n";
    if (text.includes("PYBOT_INSTALL_OK")) return "PYBOT_INSTALL_OK\n";
    if (text.includes("PYBOT_SYNC_OK")) return "PYBOT_SYNC_OK\n";
    if (text.includes("PYBOT_REMOVE_OK")) return "PYBOT_REMOVE_OK\n";
    if (text.includes("PYBOT_VERIFY")) return "PYBOT_VERIFY True 12 \n";
    if (/print\(os\.stat/.test(text)) return "12\n";
    return "ok\n";
  }

  _finishClassic(text) {
    this.execStarted = true;
    if (this._isInfinite(text)) {
      this._busy = true;
      this.emitBytes(new Uint8Array([0x4f, 0x4b]));
      if (/print\s*\(/.test(text) && !/print\((['"])/.test(text)) {
        this.emitText("1\n");
      }
      return;
    }
    const out = this._stdoutFor(text);
    if (this.opts.sameChunk) {
      this.emitBytes(ENC.encode("OK" + out.replace(/\n$/, "") + "\r\n\x04\x04>"));
      return;
    }
    this.emitBytes(new Uint8Array([0x4f, 0x4b]));
    this.emitText(out);
    this.emitBytes(new Uint8Array([0x04, 0x04]));
  }

  _finishPaste(text) {
    this.execStarted = true;
    if (this.opts.sendPasteAck !== false) {
      this.emitBytes(new Uint8Array([0x04]));
    }
    if (this._isInfinite(text)) {
      this._busy = true;
      return;
    }
    this.emitText(this._stdoutFor(text));
    this.emitBytes(new Uint8Array([0x04, 0x04]));
  }

  async write(data) {
    if (this.opts.txFail) throw new Error("BLE_REPL_TX_FAIL");
    const u8 = toU8(data);
    this.writes.push(u8);
    const text = DEC.decode(u8);
    if (text.includes("STOP:FORCE")) this.forceStopSeen = true;

    if (this._busy && includesByte(u8, 0x03)) {
      this.ctrlCDuringExec += 1;
      this._busy = false;
      this.emitBytes(new Uint8Array([0x04]));
      this.emitText("Traceback (most recent call last):\nKeyboardInterrupt\n");
      this.emitBytes(new Uint8Array([0x04]));
      return;
    }

    if (this.execStarted && includesByte(u8, 0x03) && !this._busy) {
      this.ctrlCDuringExec += 1;
    }

    if (includesByte(u8, 0x01) && !this._paste && text.includes("\x01") && !text.includes("\x05A\x01")) {
      // Ctrl+A enter raw (not the paste hello which also contains 0x01)
      if (u8.length === 1 && u8[0] === 0x01) {
        this._raw = true;
        this.emitText("raw REPL; CTRL-B to exit\r\n>");
        return;
      }
    }

    if (u8.length === 1 && u8[0] === 0x01) {
      this._raw = true;
      this.emitText("raw REPL; CTRL-B to exit\r\n>");
      return;
    }

    if (u8.length === 1 && u8[0] === 0x02) {
      this._raw = false;
      this._paste = false;
      this.emitText("\r\n>>> ");
      return;
    }

    if (this._raw && u8.length === 3 && u8[0] === 0x05 && u8[1] === 0x41 && u8[2] === 0x01) {
      if (this.opts.paste) {
        this._paste = true;
        this._program = new Uint8Array(0);
        const win = this._windowSize;
        this._windowRemain = win;
        const header = new Uint8Array([0x52, 0x01, win & 0xff, (win >> 8) & 0xff]);
        this.emitBytes(header);
        if (this.opts.abortPaste) {
          this.emitBytes(new Uint8Array([0x04]));
        }
      } else {
        this.emitBytes(new Uint8Array([0x52, 0x00]));
      }
      return;
    }

    if (this._paste) {
      if (u8.length === 1 && u8[0] === 0x04) {
        this._paste = false;
        this._finishPaste(this._programText());
        this._program = new Uint8Array(0);
        return;
      }
      this._appendProgram(u8);
      this._windowRemain -= u8.length;
      if (this._windowRemain <= 0 && this.opts.grantWindow !== false && this.opts.abortPaste !== true) {
        this._windowRemain += this._windowSize;
        this.emitBytes(new Uint8Array([0x01]));
      }
      return;
    }

    if (this._raw && includesByte(u8, 0x04)) {
      const idx = [...u8].indexOf(0x04);
      if (idx > 0) this._appendProgram(u8.subarray(0, idx));
      const body = this._programText();
      this._program = new Uint8Array(0);
      this._finishClassic(body);
      return;
    }

    if (this._raw && u8.length && u8[0] !== 0x03 && u8[0] !== 0x01 && u8[0] !== 0x02) {
      this._appendProgram(u8);
    }
  }

  async close() {
    this.open = false;
  }
}

export function bluetoothFromTransport(board) {
  const replCbs = new Set();
  const orig = board.emitBytes.bind(board);
  board.emitBytes = (u8) => {
    orig(u8);
    const bytes = toU8(u8);
    replCbs.forEach((cb) => cb(bytes));
  };
  return {
    isConnected: () => board.isOpen(),
    hasRepl: () => true,
    onReplData(cb) {
      if (typeof cb === "function") replCbs.add(cb);
      return () => replCbs.delete(cb);
    },
    async writeRepl(data) {
      await board.write(data);
    },
  };
}
