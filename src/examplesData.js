/** Ejemplos estilo PyBot escritorio (sin bloque main()). */

export const DEFAULT_CODE = [
  'print("PyBot Web listo.")',
  "# Si activás Solo Python, podés usar Python puro sin Arduino.",
  "",
  "for i in range(5):",
  '    print("Linea", i)',
  "    wait(0.2)",
  "",
].join("\n");

export const EXAMPLES = [
  {
    id: "blink",
    keyEs: "Blink",
    keyEn: "Blink",
    file: "blink.py",
    code: [
      "while True:",
      '    pin("out", 2, 1)',
      "    wait(0.5)",
      '    pin("out", 2, 0)',
      "    wait(0.5)",
    ].join("\n"),
  },
  {
    id: "motor",
    keyEs: "Motor",
    keyEn: "Motor",
    file: "motor.py",
    code: [
      "motor(10, 80)",
      "wait(2)",
      "motor(10, -60)",
      "wait(2)",
      "motor(10, 0)",
    ].join("\n"),
  },
  {
    id: "servo",
    keyEs: "Servo",
    keyEn: "Servo",
    file: "servo.py",
    code: [
      "servo(10, 0)",
      "wait(1)",
      "servo(10, 90)",
      "wait(1)",
      "servo(10, 180)",
    ].join("\n"),
  },
  {
    id: "light_sensor",
    keyEs: "Sensor de luz",
    keyEn: "Light sensor",
    file: "light_sensor.py",
    code: [
      "for _ in range(20):",
      '    luz = pin("in", "A0")',
      "    pct = int(luz / 1023 * 100)",
      '    print(f"Luz: {pct}%")',
      "    wait(0.3)",
    ].join("\n"),
  },
  {
    id: "button",
    keyEs: "Pulsador",
    keyEn: "Button",
    file: "button.py",
    code: [
      "while True:",
      '    if pin("in", 7):',
      '        pin("out", 2, 1)',
      "    else:",
      '        pin("out", 2, 0)',
      "    wait(0.05)",
    ].join("\n"),
  },
];
