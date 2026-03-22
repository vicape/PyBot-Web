import { useState, useCallback, useEffect, useRef } from "react";
import "./App.css";
import {
  openFirmata,
  writeServoSpeed,
  speedToServoAngle,
} from "./firmataWeb.js";

const MOTOR_PIN = 10;
const BUTTON_PIN = 12;
const STEP = 50;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [phase, setPhase] = useState(0);
  const [direction, setDirection] = useState(-1);
  const [log, setLog] = useState(["Listo. Conectá el Arduino y tocá el pulsador."]);
  const [connecting, setConnecting] = useState(false);

  /** @type {React.MutableRefObject<{ writer: WritableStreamDefaultWriter, close: () => Promise<void> } | null>} */
  const connRef = useRef(null);

  const pushLog = useCallback((msg) => {
    setLog((prev) => [...prev.slice(-12), msg]);
  }, []);

  const disconnectSerial = useCallback(async () => {
    const c = connRef.current;
    connRef.current = null;
    setConnected(false);
    if (c) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
      pushLog("Desconectado.");
    }
  }, [pushLog]);

  const connectSerial = useCallback(async () => {
    if (!("serial" in navigator)) {
      pushLog("Este navegador no tiene Web Serial. Usá Chrome.");
      return;
    }
    if (connRef.current) {
      await disconnectSerial();
    }
    setConnecting(true);
    try {
      const port = await navigator.serial.requestPort();
      const { writer, close, baudRate } = await openFirmata(port, MOTOR_PIN);
      connRef.current = { writer, close };
      setConnected(true);
      pushLog(
        `Firmata listo @ ${baudRate} baud — servo pin ${MOTOR_PIN}`,
      );
    } catch (e) {
      pushLog(`Error: ${e.message || e}`);
      connRef.current = null;
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }, [pushLog, disconnectSerial]);

  useEffect(() => {
    const w = connRef.current?.writer;
    if (!w) return;
    writeServoSpeed(w, MOTOR_PIN, speed).catch((e) =>
      pushLog(`Escritura servo: ${e.message}`),
    );
  }, [speed, connected, pushLog]);

  const onButtonPress = useCallback(() => {
    let nextSpeed = speed;
    let nextPhase = phase;
    let nextDir = direction;

    if (phase === 0) {
      nextSpeed = 60;
      nextPhase = 1;
      pushLog("→ 60 %");
    } else if (phase === 1) {
      nextSpeed = 100;
      nextPhase = 2;
      pushLog("→ 100 %");
    } else if (phase === 2) {
      nextPhase = 3;
      nextDir = -1;
      nextSpeed = 100 - STEP;
      pushLog(`→ modo rebote, bajando: ${nextSpeed}`);
    } else {
      nextSpeed = speed + direction * STEP;
      if (nextSpeed > 100) nextSpeed = 100;
      if (nextSpeed < -100) nextSpeed = -100;
      if (nextSpeed >= 100) nextDir = -1;
      else if (nextSpeed <= -100) nextDir = 1;
      pushLog(`→ ${nextSpeed}`);
    }

    setSpeed(nextSpeed);
    setPhase(nextPhase);
    setDirection(nextDir);
  }, [speed, phase, direction, pushLog]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        onButtonPress();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onButtonPress]);

  useEffect(() => {
    return () => {
      const c = connRef.current;
      if (c) {
        c.close().catch(() => {});
        connRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>PyBot Web</h1>
        <p className="subtitle">
          Pulsador pin {BUTTON_PIN} · Motor pin {MOTOR_PIN} · StandardFirmata
        </p>
      </header>

      <main className="main">
        <section className="card">
          <h2>Conexión</h2>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={connectSerial}
              disabled={connecting}
            >
              {connecting ? "Conectando…" : "Conectar USB (Chrome)"}
            </button>
            {connected ? (
              <button type="button" className="btn secondary" onClick={disconnectSerial}>
                Desconectar
              </button>
            ) : null}
          </div>
          <p className={`status ${connected ? "ok" : ""}`}>
            {connected
              ? `Firmata activo — enviando servo al pin ${MOTOR_PIN}`
              : "Sin conexión serie"}
          </p>
        </section>

        <section className="card">
          <h2>Estado</h2>
          <div className="metrics">
            <div>
              <span className="label">Velocidad</span>
              <span className="value">{speed}</span>
            </div>
            <div>
              <span className="label">Fase</span>
              <span className="value">{phase}</span>
            </div>
            <div>
              <span className="label">Ángulo (aprox.)</span>
              <span className="value">{speedToServoAngle(speed)}°</span>
            </div>
          </div>
          <p className="hint">
            Cable de señal del servo continuo en <strong>D{MOTOR_PIN}</strong>. Conectá,
            elegí el puerto COM y usá Espacio o el botón (pulsador real: próximo paso).
          </p>
          <button type="button" className="btn secondary" onClick={onButtonPress}>
            Simular toque (o Espacio)
          </button>
        </section>

        <section className="card log-card">
          <h2>Registro</h2>
          <ul className="log">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="footer">
        PyBot-Web · React + Vercel · StandardFirmata (mismo enfoque que PyBot)
      </footer>
    </div>
  );
}
