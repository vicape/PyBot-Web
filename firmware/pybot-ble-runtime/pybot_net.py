# pybot_net — Wi-Fi + HTTP nativos en la ESP32 (no proxy del navegador).
# API educativa: wifi_* / web_get / web_post. Compatible USB, BLE y main.py autónomo.

import usocket as socket
import ujson as json
import time

try:
    import network
except ImportError:
    network = None

try:
    import ssl
except ImportError:
    try:
        import ussl as ssl
    except ImportError:
        ssl = None

WIFI_TIMEOUT_DEFAULT = 15
HTTP_TIMEOUT_DEFAULT = 10
HTTP_MAX_REDIRECTS = 5
HTTP_MAX_BODY = 8192

_wlan = None


class WifiError(OSError):
    pass


class HttpError(OSError):
    pass


class HttpResponse:
    def __init__(self, status, headers, body):
        self.status = int(status)
        self.headers = headers if isinstance(headers, dict) else {}
        self.text = body if isinstance(body, str) else str(body)

    def json(self):
        return json.loads(self.text)


def _sta():
    global _wlan
    if network is None:
        raise WifiError("WIFI_UNSUPPORTED")
    if _wlan is None:
        _wlan = network.WLAN(network.STA_IF)
    return _wlan


def wifi_conectar(ssid, clave="", timeout=WIFI_TIMEOUT_DEFAULT):
    wlan = _sta()
    try:
        wlan.active(True)
    except Exception as e:
        raise WifiError("WIFI_ACTIVE") from e
    if wlan.isconnected():
        try:
            cur = wlan.config("essid")
        except Exception:
            cur = None
        if cur is None or cur == ssid:
            return wifi_ip()
        try:
            wlan.disconnect()
        except Exception:
            pass
    try:
        wlan.config(reconnects=3)
    except Exception:
        pass
    try:
        wlan.connect(ssid, clave)
    except Exception as e:
        raise WifiError("WIFI_CONNECT") from e
    try:
        limit_ms = int(float(timeout) * 1000)
    except Exception:
        limit_ms = WIFI_TIMEOUT_DEFAULT * 1000
    if limit_ms < 1:
        limit_ms = 1
    t0 = time.ticks_ms()
    while not wlan.isconnected():
        if time.ticks_diff(time.ticks_ms(), t0) >= limit_ms:
            try:
                st = wlan.status()
            except Exception:
                st = None
            if st == network.STAT_WRONG_PASSWORD:
                raise WifiError("WIFI_BAD_PASSWORD")
            if st == network.STAT_NO_AP_FOUND:
                raise WifiError("WIFI_NO_AP")
            raise WifiError("WIFI_TIMEOUT")
        time.sleep_ms(200)
    return wifi_ip()


def wifi_desconectar():
    wlan = _sta()
    try:
        wlan.disconnect()
    except Exception:
        pass
    try:
        wlan.active(False)
    except Exception:
        pass
    return True


def wifi_conectado():
    try:
        return bool(_sta().isconnected())
    except Exception:
        return False


def wifi_ip():
    try:
        ifcfg = _sta().ifconfig()
        return ifcfg[0] if ifcfg else None
    except Exception:
        return None


def wifi_estado():
    if network is None:
        return "unsupported"
    try:
        wlan = _sta()
    except Exception:
        return "error"
    try:
        if wlan.isconnected():
            return "conectado"
        st = wlan.status()
    except Exception:
        return "error"
    try:
        if st == network.STAT_CONNECTING:
            return "conectando"
        if st == network.STAT_WRONG_PASSWORD:
            return "clave_incorrecta"
        if st == network.STAT_NO_AP_FOUND:
            return "red_inexistente"
        if st == network.STAT_CONNECT_FAIL:
            return "fallo"
    except Exception:
        pass
    return "desconectado"


def wifi_signal():
    try:
        wlan = _sta()
        if not wlan.isconnected():
            return None
        try:
            return int(wlan.status("rssi"))
        except Exception:
            pass
        try:
            return int(wlan.config("rssi"))
        except Exception:
            return None
    except Exception:
        return None


def _parse_url(url):
    u = str(url)
    proto = "http"
    if u.startswith("https://"):
        proto = "https"
        rest = u[8:]
    elif u.startswith("http://"):
        rest = u[7:]
    else:
        rest = u
    if "/" in rest:
        hostport, path = rest.split("/", 1)
        path = "/" + path
    else:
        hostport = rest
        path = "/"
    if ":" in hostport:
        host, port_s = hostport.rsplit(":", 1)
        try:
            port = int(port_s)
        except Exception:
            host = hostport
            port = 443 if proto == "https" else 80
    else:
        host = hostport
        port = 443 if proto == "https" else 80
    return proto, host, port, path


def _header_lines(headers):
    out = []
    if not headers:
        return out
    if isinstance(headers, dict):
        items = headers.items()
    else:
        items = headers
    for k, v in items:
        out.append("%s: %s" % (k, v))
    return out


def _read_response(sock, max_body=HTTP_MAX_BODY):
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.read(256)
        if not chunk:
            break
        buf += chunk
        if len(buf) > 16384:
            break
    sep = buf.find(b"\r\n\r\n")
    if sep < 0:
        head = buf
        body = b""
    else:
        head = buf[:sep]
        body = buf[sep + 4:]
    try:
        head_s = head.decode("iso-8859-1")
    except Exception:
        head_s = str(head)
    lines = head_s.split("\r\n")
    status = 0
    if lines:
        parts = lines[0].split(" ")
        if len(parts) >= 2:
            try:
                status = int(parts[1])
            except Exception:
                status = 0
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    clen = headers.get("content-length")
    if clen is not None:
        try:
            need = int(clen)
        except Exception:
            need = max_body
        while len(body) < need and len(body) < max_body:
            chunk = sock.read(min(256, need - len(body)))
            if not chunk:
                break
            body += chunk
    else:
        while len(body) < max_body:
            chunk = sock.read(256)
            if not chunk:
                break
            body += chunk
    if len(body) > max_body:
        body = body[:max_body]
    try:
        text = body.decode("utf-8")
    except Exception:
        try:
            text = body.decode("iso-8859-1")
        except Exception:
            text = str(body)
    return status, headers, text


def _request(method, url, data=None, headers=None, timeout=HTTP_TIMEOUT_DEFAULT, _redirects=0):
    proto, host, port, path = _parse_url(url)
    hdrs = {}
    if headers:
        if isinstance(headers, dict):
            for k, v in headers.items():
                hdrs[str(k)] = str(v)
        else:
            for k, v in headers:
                hdrs[str(k)] = str(v)
    body = None
    if data is not None:
        if isinstance(data, dict):
            body = json.dumps(data)
            hdrs.setdefault("Content-Type", "application/json")
        elif isinstance(data, bytes):
            body = data.decode("utf-8")
        else:
            body = str(data)
        hdrs.setdefault("Content-Length", str(len(body)))
    hdrs.setdefault("Host", host)
    hdrs.setdefault("Connection", "close")
    hdrs.setdefault("User-Agent", "PyBot-ESP32")
    lines = ["%s %s HTTP/1.0" % (method, path)]
    lines.extend(_header_lines(hdrs))
    req = "\r\n".join(lines) + "\r\n\r\n"
    if body is not None:
        req += body
    try:
        ai = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
        addr = ai[0][-1]
    except Exception as e:
        raise HttpError("HTTP_DNS") from e
    sock = None
    try:
        sock = socket.socket()
        try:
            sock.settimeout(float(timeout))
        except Exception:
            pass
        sock.connect(addr)
        if proto == "https":
            if ssl is None:
                raise HttpError("HTTPS_UNSUPPORTED")
            try:
                sock = ssl.wrap_socket(sock, server_hostname=host)
            except TypeError:
                sock = ssl.wrap_socket(sock)
        sock.write(req.encode())
        status, resp_headers, text = _read_response(sock)
    except HttpError:
        raise
    except Exception as e:
        raise HttpError("HTTP_FAIL") from e
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
    if status in (301, 302, 303, 307, 308) and _redirects < HTTP_MAX_REDIRECTS:
        loc = resp_headers.get("location")
        if loc:
            if loc.startswith("/"):
                loc = "%s://%s%s" % (proto, host, loc)
            nxt = "GET" if status in (301, 302, 303) else method
            return _request(nxt, loc, data if nxt != "GET" else None, headers, timeout, _redirects + 1)
    return HttpResponse(status, resp_headers, text)


def web_get(url, headers=None, timeout=HTTP_TIMEOUT_DEFAULT):
    return _request("GET", url, None, headers, timeout)


def web_post(url, data=None, headers=None, timeout=HTTP_TIMEOUT_DEFAULT):
    return _request("POST", url, data, headers, timeout)
