/*
 * PyBot ESP32 - Firmware mínimo para PyBot Web.
 *
 * Habla el mismo protocolo que espera src/esp32Session.js:
 * comandos JSON por línea (terminados en '\n') y respuestas JSON por línea.
 *
 * Comandos:
 *   {"cmd":"hello"}                          -> {"ok":true,"board":"esp32","firmware":"pybot-esp32","version":"0.1.0"}
 *   {"cmd":"pin_write","pin":2,"value":1}    -> {"ok":true}
 *   {"cmd":"pin_read","pin":4}               -> {"ok":true,"value":0|1}
 *   {"cmd":"pwm_write","pin":18,"value":128} -> {"ok":true}
 *   {"cmd":"servo_write","pin":19,"angle":90}-> {"ok":true}
 *   {"cmd":"motor_write","pin":19,"speed":50}-> {"ok":true}
 *   {"cmd":"analog_read","pin":34}           -> {"ok":true,"value":0..1023}
 * Errores:
 *   {"ok":false,"error":"bad_pin"} | {"ok":false,"error":"bad_cmd"}
 *
 * Notas:
 * - El ESP32 trabaja a 3.3V (NO conectar señales de 5V a sus pines).
 * - La lectura analógica se escala a 0..1023 para que el código del alumno
 *   sea igual que en Arduino.
 * - No usa librerías externas: parser JSON propio y servo por LEDC.
 * - Compila en core Arduino-ESP32 2.x y 3.x.
 */

#include <Arduino.h>

#if defined(ESP_ARDUINO_VERSION) && defined(ESP_ARDUINO_VERSION_VAL)
  #if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    #define PYBOT_LEDC_V3 1
  #else
    #define PYBOT_LEDC_V3 0
  #endif
#else
  #define PYBOT_LEDC_V3 0
#endif

static const int   MAX_GPIO   = 40;     // GPIO 0..39
static const int   PWM_FREQ   = 5000;   // Hz para PWM general
static const int   PWM_RES    = 8;      // bits -> 0..255
static const int   SERVO_FREQ = 50;     // Hz para servo / motor de rotación continua
static const int   SERVO_RES  = 16;     // bits -> 0..65535
static const long  SERVO_PERIOD_US = 20000; // 50 Hz

enum PinKind { K_NONE = 0, K_OUT, K_IN, K_PWM, K_SERVO };
static uint8_t g_kind[MAX_GPIO];

#if !PYBOT_LEDC_V3
static int  g_channel[MAX_GPIO];
static int  g_nextChannel = 0;
#endif

// ---------- Capa LEDC compatible 2.x / 3.x ----------
static void ledcSetupPin(int pin, int freq, int res) {
#if PYBOT_LEDC_V3
  ledcAttach(pin, freq, res);
#else
  int ch = g_channel[pin];
  if (ch < 0) {
    ch = g_nextChannel++;
    if (ch > 15) ch = 15; // límite de canales LEDC
    g_channel[pin] = ch;
  }
  ledcSetup(ch, freq, res);
  ledcAttachPin(pin, ch);
#endif
}

static void ledcWritePin(int pin, uint32_t duty) {
#if PYBOT_LEDC_V3
  ledcWrite(pin, duty);
#else
  ledcWrite(g_channel[pin], duty);
#endif
}

static void ledcDetachPinCompat(int pin) {
#if PYBOT_LEDC_V3
  ledcDetach(pin);
#else
  ledcDetachPin(pin);
#endif
}

// ---------- Validación de pines ----------
static bool validGpio(int pin) {
  return pin >= 0 && pin < MAX_GPIO;
}

// GPIO 34..39 son solo entrada en el ESP32 clásico.
static bool canOutput(int pin) {
  return validGpio(pin) && (pin < 34 || pin > 39);
}

// ---------- Configuración de modo por pin ----------
static void ensureKind(int pin, PinKind want) {
  if (g_kind[pin] == want) return;
  // Si estaba en LEDC y cambiamos a algo no-LEDC, soltamos el canal.
  if ((g_kind[pin] == K_PWM || g_kind[pin] == K_SERVO) &&
      (want != K_PWM && want != K_SERVO)) {
    ledcDetachPinCompat(pin);
  }
  switch (want) {
    case K_OUT:
      pinMode(pin, OUTPUT);
      break;
    case K_IN:
      pinMode(pin, INPUT);
      break;
    case K_PWM:
      ledcSetupPin(pin, PWM_FREQ, PWM_RES);
      break;
    case K_SERVO:
      ledcSetupPin(pin, SERVO_FREQ, SERVO_RES);
      break;
    default:
      break;
  }
  g_kind[pin] = want;
}

// ---------- Acciones ----------
static void doDigitalWrite(int pin, int value) {
  ensureKind(pin, K_OUT);
  digitalWrite(pin, value ? HIGH : LOW);
}

static int doDigitalRead(int pin) {
  ensureKind(pin, K_IN);
  return digitalRead(pin) ? 1 : 0;
}

static void doPwmWrite(int pin, int value) {
  if (value < 0) value = 0;
  if (value > 255) value = 255;
  ensureKind(pin, K_PWM);
  ledcWritePin(pin, (uint32_t)value); // 8 bits -> 0..255
}

static void doServoAngle(int pin, int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  ensureKind(pin, K_SERVO);
  // Ángulo 0..180 -> pulso 500..2500 us.
  long pulseUs = 500 + ((long)angle * 2000L) / 180L;
  long maxDuty = (1L << SERVO_RES) - 1;
  long duty = (pulseUs * maxDuty) / SERVO_PERIOD_US;
  ledcWritePin(pin, (uint32_t)duty);
}

static void doMotor(int pin, int speed) {
  if (speed < -100) speed = -100;
  if (speed > 100) speed = 100;
  // Servo de rotación continua: speed 0 -> 90 (parada).
  int angle = 90 + (speed * 90) / 100;
  doServoAngle(pin, angle);
}

static int doAnalogRead(int pin) {
  // analogRead devuelve 0..4095 (12 bits). Escalamos a 0..1023.
  long raw = analogRead(pin);
  long scaled = (raw * 1023L) / 4095L;
  if (scaled < 0) scaled = 0;
  if (scaled > 1023) scaled = 1023;
  return (int)scaled;
}

// ---------- Parser JSON mínimo ----------
static String jsonGetString(const String &s, const char *key) {
  String pat = String("\"") + key + "\"";
  int k = s.indexOf(pat);
  if (k < 0) return String("");
  int c = s.indexOf(':', k + pat.length());
  if (c < 0) return String("");
  int q1 = s.indexOf('"', c + 1);
  if (q1 < 0) return String("");
  int q2 = s.indexOf('"', q1 + 1);
  if (q2 < 0) return String("");
  return s.substring(q1 + 1, q2);
}

static bool jsonGetInt(const String &s, const char *key, long &out) {
  String pat = String("\"") + key + "\"";
  int k = s.indexOf(pat);
  if (k < 0) return false;
  int c = s.indexOf(':', k + pat.length());
  if (c < 0) return false;
  int i = c + 1;
  while (i < (int)s.length() && s[i] == ' ') i++;
  bool neg = false;
  if (i < (int)s.length() && s[i] == '-') { neg = true; i++; }
  long v = 0;
  bool any = false;
  while (i < (int)s.length() && isdigit((unsigned char)s[i])) {
    v = v * 10 + (s[i] - '0');
    i++;
    any = true;
  }
  if (!any) return false;
  out = neg ? -v : v;
  return true;
}

// ---------- Respuestas ----------
static void ok() { Serial.println("{\"ok\":true}"); }
static void okValue(int v) { Serial.print("{\"ok\":true,\"value\":"); Serial.print(v); Serial.println("}"); }
static void fail(const char *err) { Serial.print("{\"ok\":false,\"error\":\""); Serial.print(err); Serial.println("\"}"); }

static void handleLine(const String &line) {
  if (line.length() == 0) return;
  String cmd = jsonGetString(line, "cmd");
  if (cmd.length() == 0) { fail("bad_cmd"); return; }

  if (cmd == "hello") {
    Serial.println("{\"ok\":true,\"board\":\"esp32\",\"firmware\":\"pybot-esp32\",\"version\":\"0.1.0\"}");
    return;
  }

  long pin = -1;
  if (!jsonGetInt(line, "pin", pin) || !validGpio((int)pin)) {
    fail("bad_pin");
    return;
  }

  if (cmd == "pin_write") {
    long value = 0;
    jsonGetInt(line, "value", value);
    if (!canOutput((int)pin)) { fail("bad_pin"); return; }
    doDigitalWrite((int)pin, (int)value);
    ok();
    return;
  }
  if (cmd == "pin_read") {
    okValue(doDigitalRead((int)pin));
    return;
  }
  if (cmd == "pwm_write") {
    long value = 0;
    jsonGetInt(line, "value", value);
    if (!canOutput((int)pin)) { fail("bad_pin"); return; }
    doPwmWrite((int)pin, (int)value);
    ok();
    return;
  }
  if (cmd == "servo_write") {
    long angle = 90;
    jsonGetInt(line, "angle", angle);
    if (!canOutput((int)pin)) { fail("bad_pin"); return; }
    doServoAngle((int)pin, (int)angle);
    ok();
    return;
  }
  if (cmd == "motor_write") {
    long speed = 0;
    jsonGetInt(line, "speed", speed);
    if (!canOutput((int)pin)) { fail("bad_pin"); return; }
    doMotor((int)pin, (int)speed);
    ok();
    return;
  }
  if (cmd == "analog_read") {
    okValue(doAnalogRead((int)pin));
    return;
  }

  fail("bad_cmd");
}

// ---------- Bucle serial ----------
static String g_buf;

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < MAX_GPIO; i++) {
    g_kind[i] = K_NONE;
#if !PYBOT_LEDC_V3
    g_channel[i] = -1;
#endif
  }
  g_buf.reserve(96);
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      handleLine(g_buf);
      g_buf = "";
    } else if (c != '\r') {
      g_buf += c;
      if (g_buf.length() > 200) g_buf = ""; // protección anti-desborde
    }
  }
}
