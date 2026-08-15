# Red MicroPython (Wi-Fi + HTTP)

Estado: **SOFTWARE VERIFIED** (fuente, API, ejemplos, tests estáticos). **PENDIENTE FÍSICO:** asociación Wi-Fi, GET/POST, HTTPS/TLS del port, BLE+Wi-Fi simultáneos, memoria.

La red es de la **ESP32**, no del navegador. El mismo código corre por USB, BLE y `main.py` autónomo.

## Módulo `pybot_net.py`

Instalado en la placa (USB / pack OTA). EDA6 y `pybot_mpy` **reexportan** las mismas funciones (no hay una segunda implementación).

### Wi-Fi

```python
wifi_conectar("MiRed", "clave", timeout=15)
wifi_desconectado = not wifi_conectado()
print(wifi_ip(), wifi_estado(), wifi_signal())
wifi_desconectar()
```

- Station mode (`network.WLAN(STA_IF)`).
- Timeout obligatorio (nunca `while not isconnected(): pass`).
- Errores: `WIFI_TIMEOUT`, `WIFI_BAD_PASSWORD`, `WIFI_NO_AP`, `WIFI_UNSUPPORTED`.
- `reconnects=3` si el port lo soporta.

Estados de `wifi_estado()`: `conectado`, `desconectado`, `conectando`, `clave_incorrecta`, `red_inexistente`, `fallo`, `unsupported`, `error`.

### HTTP

```python
r = web_get("https://ejemplo.com/api", headers={"Accept": "application/json"}, timeout=10)
print(r.status, r.text)
print(r.json())  # si el cuerpo es JSON

r = web_post(URL, {"temperatura": 24.5})  # dict → JSON
```

- `HttpResponse`: `status`, `headers`, `text`, `json()`.
- HTTPS: `ssl.wrap_socket` (depende del firmware; si no hay SSL → `HTTPS_UNSUPPORTED`).
- Redirects 301/302/303/307/308 (máx. 5).
- PUT/DELETE se pueden agregar sobre `_request` sin rediseñar.

No hay credenciales reales en el repo.

## Ejemplo Google Sheets

1. En Google Sheets: Extensiones → Apps Script.
2. Pegar el script de ejemplo (abajo). Desplegar como aplicación web (ejecutar como yo, acceso: cualquiera con el enlace).
3. Copiar la URL `/macros/s/…/exec` al programa del alumno.

```javascript
// EJEMPLO — no contiene IDs reales ni correos.
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput("bad json").setMimeType(ContentService.MimeType.TEXT);
  }
  sheet.appendRow([
    new Date(),
    body.temperatura,
    body.humedad,
    body.presion
  ]);
  return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
}
```

Payload esperado: JSON `{"temperatura": number, "humedad": number, "presion": number}`.

Programa en la placa: ejemplo IDE **ESP32: Google Sheets** (`esp32_google_sheets`). Sustituí `URL` y `wifi_conectar("MiRed", "clave")`.

## Autónomo

`main.py` del alumno puede llamar `wifi_conectar` / `web_post` sin PC. Tras “Bajar a ESP32”, desconectar USB y alimentar la placa.
