/**
 * Representación visual del ecosistema real PyBot (IDE + Python + bloques + hardware).
 * Solo presentación; sin funcionalidades inventadas.
 */
export default function EntryProductVisual({ labels }) {
  const ide = labels?.ide ?? "IDE PyBot";
  const python = labels?.python ?? "Python";
  const blocks = labels?.blocks ?? "Bloques";
  const hardware = labels?.hardware ?? "ESP32 / Arduino";
  const codeLabel = labels?.codeLabel ?? "main.py";

  return (
    <div className="entry-visual" aria-hidden="true">
      <div className="entry-visual__glow" />
      <div className="entry-visual__stage">
        <div className="entry-visual__window">
          <div className="entry-visual__titlebar">
            <span className="entry-visual__dots" />
            <span className="entry-visual__win-title">{ide}</span>
            <span className="entry-visual__tabs">
              <span className="entry-visual__tab entry-visual__tab--active">{python}</span>
              <span className="entry-visual__tab">{blocks}</span>
            </span>
          </div>
          <div className="entry-visual__body">
            <div className="entry-visual__editor">
              <div className="entry-visual__file">{codeLabel}</div>
              <pre className="entry-visual__code">
                <code>
                  <span className="tok-kw">pin</span>
                  <span className="tok-p">(</span>
                  <span className="tok-str">&quot;out&quot;</span>
                  <span className="tok-p">,</span> <span className="tok-num">2</span>
                  <span className="tok-p">,</span> <span className="tok-num">1</span>
                  <span className="tok-p">)</span>
                  {"\n"}
                  <span className="tok-kw">wait</span>
                  <span className="tok-p">(</span>
                  <span className="tok-num">1</span>
                  <span className="tok-p">)</span>
                  {"\n"}
                  <span className="tok-kw">servo</span>
                  <span className="tok-p">(</span>
                  <span className="tok-num">10</span>
                  <span className="tok-p">,</span> <span className="tok-num">90</span>
                  <span className="tok-p">)</span>
                  {"\n"}
                  <span className="tok-fn">print</span>
                  <span className="tok-p">(</span>
                  <span className="tok-str">&quot;Hola PyBot&quot;</span>
                  <span className="tok-p">)</span>
                </code>
              </pre>
            </div>
            <div className="entry-visual__side">
              <div className="entry-visual__blocks" aria-label={blocks}>
                <span className="entry-block entry-block--start">start</span>
                <span className="entry-block entry-block--pin">pin out 2</span>
                <span className="entry-block entry-block--wait">wait 1</span>
                <span className="entry-block entry-block--servo">servo 90°</span>
              </div>
              <div className="entry-visual__board" aria-label={hardware}>
                <svg className="entry-board-svg" viewBox="0 0 160 88" fill="none">
                  <rect x="8" y="10" width="144" height="68" rx="8" className="entry-board-svg__body" />
                  <rect x="18" y="20" width="52" height="36" rx="4" className="entry-board-svg__chip" />
                  <circle cx="34" cy="38" r="3" className="entry-board-svg__led" />
                  <circle cx="48" cy="38" r="3" className="entry-board-svg__led entry-board-svg__led--alt" />
                  <path
                    d="M78 28h58M78 40h46M78 52h52"
                    className="entry-board-svg__traces"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <text x="22" y="68" className="entry-board-svg__label">
                    ESP32
                  </text>
                  <text x="78" y="68" className="entry-board-svg__label entry-board-svg__label--muted">
                    Arduino
                  </text>
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="entry-visual__orbit entry-visual__orbit--python">{python}</div>
        <div className="entry-visual__orbit entry-visual__orbit--blocks">{blocks}</div>
        <div className="entry-visual__orbit entry-visual__orbit--hw">{hardware}</div>
      </div>
    </div>
  );
}
