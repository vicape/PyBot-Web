import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BluetoothTransport,
  isWebBluetoothSupported,
  BLE_STATE,
} from "../src/bluetoothTransport.js";
import { RX_UUID, TX_UUID, simulateDeviceResponse } from "../src/bleProtocol.js";

/** Crea un mock de navigator.bluetooth que simula un dispositivo PyBot BLE. */
function makeMockBluetooth({ autoRespond = true, deviceName = "PYBOT-A34F21" } = {}) {
  const dec = new TextDecoder();
  const listeners = { tx: [], device: [] };

  const txChar = {
    async startNotifications() {},
    async stopNotifications() {},
    addEventListener(type, cb) {
      if (type === "characteristicvaluechanged") listeners.tx.push(cb);
    },
    removeEventListener(type, cb) {
      listeners.tx = listeners.tx.filter((c) => c !== cb);
    },
    emit(text) {
      const value = new TextEncoder().encode(text);
      listeners.tx.forEach((cb) => cb({ target: { value } }));
    },
  };

  const rxChar = {
    lastWrite: null,
    async writeValueWithoutResponse(bytes) {
      rxChar.lastWrite = dec.decode(bytes);
      if (autoRespond) {
        const command = rxChar.lastWrite.replace(/\n+$/, "");
        const resp = simulateDeviceResponse(command, { deviceName, deviceId: "A34F21" });
        if (resp != null) {
          queueMicrotask(() => txChar.emit(resp + "\n"));
        }
      }
    },
  };

  const service = {
    async getCharacteristic(uuid) {
      if (uuid === RX_UUID) return rxChar;
      if (uuid === TX_UUID) return txChar;
      throw new Error("unknown characteristic");
    },
  };

  const server = {
    connected: false,
    async connect() {
      server.connected = true;
      return server;
    },
    async getPrimaryService() {
      return service;
    },
    disconnect() {
      server.connected = false;
      listeners.device.forEach((cb) => cb());
    },
  };

  const device = {
    name: deviceName,
    gatt: server,
    addEventListener(type, cb) {
      if (type === "gattserverdisconnected") listeners.device.push(cb);
    },
    removeEventListener(type, cb) {
      listeners.device = listeners.device.filter((c) => c !== cb);
    },
  };

  const bluetooth = {
    requestDeviceCalledWith: null,
    async requestDevice(options) {
      bluetooth.requestDeviceCalledWith = options;
      return device;
    },
  };

  return { bluetooth, device, server, rxChar, txChar };
}

test("isWebBluetoothSupported is false in Node (no navigator.bluetooth)", () => {
  assert.equal(isWebBluetoothSupported(), false);
});

test("connect() filters by SERVICE UUID and reaches CONNECTED", async () => {
  const mock = makeMockBluetooth();
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });

  assert.equal(tr.isConnected(), false);
  const { deviceName } = await tr.connect();

  assert.equal(deviceName, "PYBOT-A34F21");
  assert.equal(tr.state, BLE_STATE.CONNECTED);
  assert.equal(tr.isConnected(), true);

  const filters = mock.bluetooth.requestDeviceCalledWith.filters;
  assert.ok(filters.some((f) => f.services?.includes("8fbc0001-4d5a-4b8c-9a1f-123456789001")));
});

test("send() appends delimiter and writes to RX characteristic", async () => {
  const mock = makeMockBluetooth({ autoRespond: false });
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  await tr.send("PING");
  assert.equal(mock.rxChar.lastWrite, "PING\n");
});

test("onData receives complete messages split on newline", async () => {
  const mock = makeMockBluetooth({ autoRespond: false });
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  const received = [];
  tr.onData((m) => received.push(m));

  // Fragmented notifications (as BLE would chunk them).
  mock.txChar.emit("PO");
  mock.txChar.emit("NG\nO");
  mock.txChar.emit("K\n");

  assert.deepEqual(received, ["PONG", "OK"]);
});

test("sendAndWait resolves with the device response (PING -> PONG)", async () => {
  const mock = makeMockBluetooth();
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  const pong = await tr.sendAndWait("PING", 1000);
  assert.equal(pong, "PONG");
});

test("sendAndWait INFO returns parseable JSON", async () => {
  const mock = makeMockBluetooth();
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  const info = await tr.sendAndWait("INFO", 1000);
  const obj = JSON.parse(info);
  assert.equal(obj.device, "PYBOT-A34F21");
  assert.equal(obj.board, "ESP32");
});

test("sendAndWait rejects on timeout when no response", async () => {
  const mock = makeMockBluetooth({ autoRespond: false });
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  await assert.rejects(() => tr.sendAndWait("PING", 60), /BLE_TIMEOUT/);
});

test("gattserverdisconnected transitions to DISCONNECTED", async () => {
  const mock = makeMockBluetooth();
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();
  assert.equal(tr.isConnected(), true);

  mock.server.disconnect();
  assert.equal(tr.state, BLE_STATE.DISCONNECTED);
  assert.equal(tr.isConnected(), false);
});

test("disconnect() returns to IDLE and send() then fails", async () => {
  const mock = makeMockBluetooth();
  const tr = new BluetoothTransport({ bluetooth: mock.bluetooth });
  await tr.connect();

  await tr.disconnect();
  assert.equal(tr.state, BLE_STATE.IDLE);
  await assert.rejects(() => tr.send("PING"), /BLE_NOT_CONNECTED/);
});

test("connect() rejects with BLE_UNSUPPORTED when no bluetooth backend", async () => {
  const tr = new BluetoothTransport({ bluetooth: undefined });
  await assert.rejects(() => tr.connect(), /BLE_UNSUPPORTED/);
});

test("connect() maps user cancellation (NotFoundError) to BLE_CANCELLED", async () => {
  const bluetooth = {
    async requestDevice() {
      const e = new Error("cancelled");
      e.name = "NotFoundError";
      throw e;
    },
  };
  const tr = new BluetoothTransport({ bluetooth });
  await assert.rejects(() => tr.connect(), /BLE_CANCELLED/);
  assert.equal(tr.state, BLE_STATE.IDLE);
});
