import { useState } from "react";

export function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("es-AR");
  } catch {
    return String(v);
  }
}

export function AdminTable({ columns, rows, rowKey }) {
  if (!rows.length) return <p className="dash-muted">Sin registros.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row) : row[c.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminFormRow({ children, onSubmit, onCancel, submitLabel = "Guardar" }) {
  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="admin-form__grid">{children}</div>
      <div className="admin-form__actions">
        <button type="submit" className="auth-btn auth-btn--primary auth-btn--sm">
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="auth-btn auth-btn--ghost auth-btn--sm" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function Field({ label, children }) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props) {
  return <input className="auth-input admin-input" {...props} />;
}

export function SelectInput({ options, ...props }) {
  return (
    <select className="auth-input admin-input" {...props}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea(props) {
  return <textarea className="auth-input admin-input admin-textarea" rows={4} {...props} />;
}

export function ActionBtn({ onClick, children, danger }) {
  return (
    <button
      type="button"
      className={`auth-btn auth-btn--sm ${danger ? "admin-btn--danger" : "auth-btn--ghost"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function useCrudMessage() {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const wrap = async (fn) => {
    setMsg("");
    setErr("");
    const r = await fn();
    if (r?.error) setErr(r.error);
    else if (r?.ok === false && r?.error) setErr(r.error);
    else setMsg("Guardado.");
    return r;
  };
  return { msg, err, setErr, wrap };
}
