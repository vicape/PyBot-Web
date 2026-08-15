import { test } from "node:test";
import assert from "node:assert/strict";
import { compileToBytecode, OP } from "../src/arduino/pybotArduinoCompiler.js";

test("Arduino compiler: blink program produces a valid image", () => {
  const src = [
    'pin("out", 13, 1)',
    "wait(0.2)",
    'pin("out", 13, 0)',
  ].join("\n");
  const compiled = compileToBytecode(src);
  assert.equal(compiled.ok, true, compiled.error && JSON.stringify(compiled.error));
  assert.ok(compiled.image.length > 8);
  assert.equal(compiled.image[0], 80); // 'P'
  assert.equal(compiled.image[1], 66); // 'B'
});

test("Arduino compiler: while True + servo/motor stay in the VM subset", () => {
  const src = [
    "while True:",
    "    servo(9, 90)",
    "    motor(10, 0)",
    "    wait(1)",
  ].join("\n");
  const compiled = compileToBytecode(src);
  assert.equal(compiled.ok, true, compiled.error && JSON.stringify(compiled.error));
  assert.ok(compiled.image.includes(OP.SERVO_WRITE));
  assert.ok(compiled.image.includes(OP.MOTOR_WRITE));
});

test("Arduino compiler: unsupported Python is a compile error, not a crash", () => {
  const compiled = compileToBytecode("import os\nprint(os.listdir())\n");
  assert.equal(compiled.ok, false);
  assert.ok(compiled.error);
  assert.ok(compiled.error.es || compiled.error.en);
});
