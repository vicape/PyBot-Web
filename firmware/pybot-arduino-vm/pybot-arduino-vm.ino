/*
 * PyBot Arduino VM  (firmware intérprete para "Bajar a Arduino")
 * ----------------------------------------------------------------
 * Permite que un programa hecho en PyBot Web corra SOLO en la placa,
 * desconectada de la computadora.
 *
 * Cómo funciona:
 *   - PyBot Web traduce el Python del alumno a bytecode (ver
 *     src/arduino/pybotArduinoCompiler.js) y graba la "imagen" en la EEPROM.
 *   - Al encender, este firmware lee la imagen de la EEPROM y la ejecuta.
 *   - Tras un reset (DTR), abre una ventana corta para recibir un programa
 *     nuevo por el puerto serie y grabarlo en EEPROM.
 *
 * Placa objetivo: Arduino Uno / Nano (ATmega328P).
 *
 * Protocolo de carga (115200 baud):
 *   Al boot el firmware imprime "PYBOTVM\n".
 *   El host envía: 0x7E <cmd>
 *     'I' (identify) -> el firmware responde "PYBOTVM\n" y sigue escuchando.
 *     'U' (upload)   -> luego: len(2 bytes LE) + <len bytes de imagen> + checksum(1)
 *                       checksum = (suma de los bytes) & 0xFF
 *                       responde 'K' si ok, 'E' si error, luego ejecuta.
 *   Si no llega nada en la ventana, ejecuta el programa guardado.
 *
 * Formato de imagen (idéntico al compilador JS):
 *   [0..1]  'P','B'
 *   [2]     version (1)
 *   [3]     varCount
 *   [4..5]  constSectionLen (LE)
 *   [6..7]  codeLen (LE)
 *   [8..]   const section: por cada texto (len:1, bytes...)
 *   [...]   code bytes (codeLen)
 */

#include <EEPROM.h>
#include <Servo.h>

// ---- Opcodes (deben coincidir con pybotArduinoCompiler.js) ----
enum {
  OP_PUSH_I16 = 0x01,
  OP_LOAD = 0x02,
  OP_STORE = 0x03,
  OP_ADD = 0x10,
  OP_SUB = 0x11,
  OP_MUL = 0x12,
  OP_DIV = 0x13,
  OP_MOD = 0x14,
  OP_NEG = 0x15,
  OP_EQ = 0x20,
  OP_NE = 0x21,
  OP_LT = 0x22,
  OP_LE = 0x23,
  OP_GT = 0x24,
  OP_GE = 0x25,
  OP_AND = 0x30,
  OP_OR = 0x31,
  OP_NOT = 0x32,
  OP_JMP = 0x40,
  OP_JMP_IF_FALSE = 0x41,
  OP_DIGITAL_WRITE = 0x50,
  OP_PWM_WRITE = 0x51,
  OP_DIGITAL_READ = 0x52,
  OP_ANALOG_READ = 0x53,
  OP_SERVO_WRITE = 0x54,
  OP_MOTOR_WRITE = 0x55,
  OP_WAIT_MS = 0x56,
  OP_PRINT_STR = 0x60,
  OP_PRINT_INT = 0x61,
  OP_PRINT_NL = 0x62,
  OP_PRINT_SP = 0x63,
  OP_HALT = 0xFF
};

#define MAX_VARS 32
#define MAX_CONSTS 24
#define STACK_SIZE 24
#define MAX_SERVOS 4
#define EEPROM_CAP 1024
#define MAX_IMAGE 768
#define BOOT_WINDOW_MS 900

int16_t vars[MAX_VARS];
int16_t stk[STACK_SIZE];
uint8_t sp = 0;

uint16_t constOffset[MAX_CONSTS];
uint8_t constCount = 0;
uint16_t codeBase = 0;
uint16_t codeLen = 0;

Servo servos[MAX_SERVOS];
uint8_t servoPin[MAX_SERVOS];
uint8_t servoUsed = 0;

// ---------------- pila ----------------
static inline void push(int16_t v) {
  if (sp < STACK_SIZE) stk[sp++] = v;
}
static inline int16_t pop() {
  if (sp == 0) return 0;
  return stk[--sp];
}

// ---------------- servos ----------------
Servo *getServo(uint8_t pin) {
  for (uint8_t i = 0; i < servoUsed; i++) {
    if (servoPin[i] == pin) return &servos[i];
  }
  if (servoUsed < MAX_SERVOS) {
    servoPin[servoUsed] = pin;
    servos[servoUsed].attach(pin);
    return &servos[servoUsed++];
  }
  // reusar el último si nos quedamos sin slots
  return &servos[MAX_SERVOS - 1];
}

// ---------------- EEPROM helpers ----------------
uint8_t eeRead(uint16_t addr) {
  if (addr >= EEPROM_CAP) return 0;
  return EEPROM.read(addr);
}

bool loadProgramMeta() {
  if (eeRead(0) != 'P' || eeRead(1) != 'B') return false;
  uint8_t version = eeRead(2);
  if (version != 1) return false;
  uint16_t constLen = eeRead(4) | (((uint16_t)eeRead(5)) << 8);
  codeLen = eeRead(6) | (((uint16_t)eeRead(7)) << 8);

  // mapear offsets de los textos del const pool
  constCount = 0;
  uint16_t p = 8;
  uint16_t end = 8 + constLen;
  while (p < end && constCount < MAX_CONSTS) {
    constOffset[constCount++] = p;
    uint8_t l = eeRead(p);
    p += 1 + l;
  }
  codeBase = 8 + constLen;
  return true;
}

void printConst(uint16_t idx) {
  if (idx >= constCount) return;
  uint16_t p = constOffset[idx];
  uint8_t l = eeRead(p);
  for (uint8_t i = 0; i < l; i++) {
    Serial.write(eeRead(p + 1 + i));
  }
}

// ---------------- ejecución ----------------
void runProgram() {
  if (!loadProgramMeta()) return;  // sin programa válido -> nada

  for (uint8_t i = 0; i < MAX_VARS; i++) vars[i] = 0;
  sp = 0;
  uint16_t pc = 0;

  for (;;) {
    if (pc >= codeLen) return;
    uint8_t op = eeRead(codeBase + pc++);

    switch (op) {
      case OP_PUSH_I16: {
        int16_t lo = eeRead(codeBase + pc++);
        int16_t hi = eeRead(codeBase + pc++);
        push((int16_t)(lo | (hi << 8)));
        break;
      }
      case OP_LOAD: {
        uint8_t slot = eeRead(codeBase + pc++);
        push(slot < MAX_VARS ? vars[slot] : 0);
        break;
      }
      case OP_STORE: {
        uint8_t slot = eeRead(codeBase + pc++);
        int16_t v = pop();
        if (slot < MAX_VARS) vars[slot] = v;
        break;
      }
      case OP_ADD: { int16_t b = pop(), a = pop(); push(a + b); break; }
      case OP_SUB: { int16_t b = pop(), a = pop(); push(a - b); break; }
      case OP_MUL: { int16_t b = pop(), a = pop(); push(a * b); break; }
      case OP_DIV: { int16_t b = pop(), a = pop(); push(b == 0 ? 0 : a / b); break; }
      case OP_MOD: { int16_t b = pop(), a = pop(); push(b == 0 ? 0 : a % b); break; }
      case OP_NEG: { push(-pop()); break; }
      case OP_EQ: { int16_t b = pop(), a = pop(); push(a == b); break; }
      case OP_NE: { int16_t b = pop(), a = pop(); push(a != b); break; }
      case OP_LT: { int16_t b = pop(), a = pop(); push(a < b); break; }
      case OP_LE: { int16_t b = pop(), a = pop(); push(a <= b); break; }
      case OP_GT: { int16_t b = pop(), a = pop(); push(a > b); break; }
      case OP_GE: { int16_t b = pop(), a = pop(); push(a >= b); break; }
      case OP_AND: { int16_t b = pop(), a = pop(); push((a != 0) && (b != 0)); break; }
      case OP_OR: { int16_t b = pop(), a = pop(); push((a != 0) || (b != 0)); break; }
      case OP_NOT: { push(pop() == 0 ? 1 : 0); break; }
      case OP_JMP: {
        uint16_t addr = eeRead(codeBase + pc) | (((uint16_t)eeRead(codeBase + pc + 1)) << 8);
        pc = addr;
        break;
      }
      case OP_JMP_IF_FALSE: {
        uint16_t addr = eeRead(codeBase + pc) | (((uint16_t)eeRead(codeBase + pc + 1)) << 8);
        pc += 2;
        if (pop() == 0) pc = addr;
        break;
      }
      case OP_DIGITAL_WRITE: {
        int16_t val = pop(); uint8_t pin = (uint8_t)pop();
        pinMode(pin, OUTPUT);
        digitalWrite(pin, val ? HIGH : LOW);
        break;
      }
      case OP_PWM_WRITE: {
        int16_t val = pop(); uint8_t pin = (uint8_t)pop();
        if (val < 0) val = 0; if (val > 255) val = 255;
        pinMode(pin, OUTPUT);
        analogWrite(pin, val);
        break;
      }
      case OP_DIGITAL_READ: {
        uint8_t pin = (uint8_t)pop();
        pinMode(pin, INPUT);
        push(digitalRead(pin) ? 1 : 0);
        break;
      }
      case OP_ANALOG_READ: {
        uint8_t ch = (uint8_t)pop();
        if (ch > 5) ch = 5;
        push((int16_t)analogRead(A0 + ch));
        break;
      }
      case OP_SERVO_WRITE: {
        int16_t ang = pop(); uint8_t pin = (uint8_t)pop();
        if (ang < 0) ang = 0; if (ang > 180) ang = 180;
        getServo(pin)->write(ang);
        break;
      }
      case OP_MOTOR_WRITE: {
        int16_t speed = pop(); uint8_t pin = (uint8_t)pop();
        if (speed < -100) speed = -100; if (speed > 100) speed = 100;
        int16_t ang = 90 + (int16_t)((long)speed * 90 / 100);
        if (ang < 0) ang = 0; if (ang > 180) ang = 180;
        getServo(pin)->write(ang);
        break;
      }
      case OP_WAIT_MS: {
        int16_t ms = pop();
        if (ms > 0) delay((uint16_t)ms);
        break;
      }
      case OP_PRINT_STR: {
        uint16_t idx = eeRead(codeBase + pc) | (((uint16_t)eeRead(codeBase + pc + 1)) << 8);
        pc += 2;
        printConst(idx);
        break;
      }
      case OP_PRINT_INT: { Serial.print(pop()); break; }
      case OP_PRINT_SP: { Serial.print(' '); break; }
      case OP_PRINT_NL: { Serial.println(); break; }
      case OP_HALT:
        return;
      default:
        return;  // opcode desconocido -> detener por seguridad
    }
  }
}

// ---------------- carga por serial ----------------
int readByteTimeout(uint16_t ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    if (Serial.available()) return Serial.read();
  }
  return -1;
}

// Buffer en RAM para recibir la imagen ANTES de grabar la EEPROM.
// La escritura de EEPROM bloquea ~3.3 ms/byte; si grabáramos mientras llegan
// datos a 115200 baud, el buffer serie de 64 bytes se desbordaría y se perderían
// bytes. Por eso primero recibimos todo a RAM (rápido) y luego grabamos.
uint8_t imageBuf[MAX_IMAGE];

bool handleUpload() {
  int lo = readByteTimeout(500);
  int hi = readByteTimeout(500);
  if (lo < 0 || hi < 0) return false;
  uint16_t len = (uint16_t)lo | (((uint16_t)hi) << 8);
  if (len == 0 || len > MAX_IMAGE || (uint16_t)(len + 8) > EEPROM_CAP) {
    Serial.write('E');
    return false;
  }
  uint16_t sum = 0;
  for (uint16_t i = 0; i < len; i++) {
    int b = readByteTimeout(1000);
    if (b < 0) {
      Serial.write('E');
      return false;
    }
    imageBuf[i] = (uint8_t)b;
    sum += (uint8_t)b;
  }
  int chk = readByteTimeout(1000);
  if (chk < 0 || (uint8_t)chk != (uint8_t)(sum & 0xFF)) {
    Serial.write('E');
    return false;
  }
  // checksum OK -> grabar EEPROM (ahora sí, sin datos entrantes que perder)
  for (uint16_t i = 0; i < len; i++) {
    EEPROM.update(i, imageBuf[i]);
  }
  Serial.write('K');
  Serial.flush();
  return true;
}

// Escucha la ventana de boot. Devuelve true si se cargó un programa nuevo.
bool bootListen() {
  unsigned long start = millis();
  while (millis() - start < BOOT_WINDOW_MS) {
    if (Serial.available()) {
      int b = Serial.read();
      if (b == 0x7E) {
        int cmd = readByteTimeout(300);
        if (cmd == 'I') {
          Serial.print(F("PYBOTVM\n"));
          start = millis();  // reiniciar ventana
        } else if (cmd == 'U') {
          if (handleUpload()) return true;
        }
      }
    }
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(40);
  Serial.print(F("PYBOTVM\n"));
  bootListen();
  runProgram();
}

void loop() {
  // El programa corre dentro de runProgram(). Si terminó (HALT / sin while),
  // quedamos en reposo hasta el próximo reset.
}
