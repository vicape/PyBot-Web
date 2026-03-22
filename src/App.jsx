import { useState, useCallback, useEffect } from "react";
import "./App.css";

const MOTOR_PIN = 10;
const BUTTON_PIN = 12;
const STEP = 50;

/** Firmata + Web Serial: implementación próxima; por ahora UI y lógica de estados lista */
export default function App() {
  const [connected, setConnected] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [phase, setPhase] = useState(0);
  const [direction, setDirection] = useState(-1);
  const [log, setLog] = useState(["Listo. Conectá el Arduino y tocá el pulsador."]);

  const pushLog = useCallback((msg) => {
    setLog((prev) => [...prev.slice(-12), msg]);
  }, []);

  const connectSerial = useCallback(async () => {
    if (!("serial" in navigator)) {
      pushLog("Este navegador no tiene Web Serial. Usá Chrome.");
      return;
    }
    try {
      await navigator.serial.requestPort();
      setConnected(true);
      pushLog("Puerto elegido. (Firmata: abrir puerto y handshake — próximo paso)");
    } catch (e) {
      if (e.name !== "NotFoundError") pushLog(`Conexión: ${e.message}`);
    }
  }, [pushLog]);

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
    // TODO: firmataServoWrite(MOTOR_PIN, angleFromSpeed(nextSpeed))
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

  return (
    <div className="app">
      <header className="header">
        <h1>PyBot Web</h1>
        <p className="subtitle">
          Pulsador pin {BUTTON_PIN} · Motor pin {MOTOR_PIN} · Firmata
        </p>
      </header>

      <main className="main">
        <section className="card">
          <h2>Conexión</h2>
          <button type="button" className="btn primary" onClick={connectSerial}>
            Conectar USB (Chrome)
          </button>
          <p className={`status ${connected ? "ok" : ""}`}>
            {connected ? "Puerto seleccionado" : "Sin puerto"}
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
          </div>
          <p className="hint">
            Simulá el pulsador con la barra espaciadora hasta que Firmata lea el pin
            real.
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
        PyBot-Web · React + Vercel · no modifica el proyecto PyBot de escritorio
      </footer>
    </div>
  );
}
