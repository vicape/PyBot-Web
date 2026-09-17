/**
 * Representación visual del ecosistema real PyBot (IDE + Python + bloques + hardware).
 * Solo presentación; APIs reales: pin / wait / servo / print.
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
              <div className="entry-visual__editor-head">
                <span className="entry-visual__file">{codeLabel}</span>
              </div>
              <div className="entry-visual__code-row">
                <div className="entry-visual__gutter" aria-hidden="true">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                </div>
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
            </div>

            <div className="entry-visual__side">
              <div className="entry-visual__panel">
                <div className="entry-visual__panel-head">{blocks}</div>
                <div className="entry-visual__blocks">
                  <span className="entry-block entry-block--start">start</span>
                  <span className="entry-block entry-block--pin">pin out · 2</span>
                  <span className="entry-block entry-block--wait">wait · 1</span>
                  <span className="entry-block entry-block--servo">servo · 90°</span>
                </div>
              </div>

              <div className="entry-visual__panel entry-visual__panel--hw">
                <div className="entry-visual__panel-head">{hardware}</div>
                <div className="entry-visual__board">
                  <svg className="entry-board-svg" viewBox="0 0 168 96" fill="none">
                    <rect
                      x="10"
                      y="14"
                      width="148"
                      height="68"
                      rx="6"
                      className="entry-board-svg__body"
                    />
                    {/* USB / edge connector */}
                    <rect
                      x="4"
                      y="36"
                      width="8"
                      height="24"
                      rx="1.5"
                      className="entry-board-svg__usb"
                    />
                    {/* MCU */}
                    <rect
                      x="28"
                      y="28"
                      width="44"
                      height="40"
                      rx="3"
                      className="entry-board-svg__chip"
                    />
                    <rect
                      x="36"
                      y="36"
                      width="28"
                      height="24"
                      rx="1.5"
                      className="entry-board-svg__die"
                    />
                    {/* Status LEDs */}
                    <circle cx="86" cy="34" r="3.2" className="entry-board-svg__led" />
                    <circle
                      cx="98"
                      cy="34"
                      r="3.2"
                      className="entry-board-svg__led entry-board-svg__led--alt"
                    />
                    {/* Pin header suggestion */}
                    <g className="entry-board-svg__pins">
                      <circle cx="130" cy="28" r="1.6" />
                      <circle cx="138" cy="28" r="1.6" />
                      <circle cx="146" cy="28" r="1.6" />
                      <circle cx="130" cy="36" r="1.6" />
                      <circle cx="138" cy="36" r="1.6" />
                      <circle cx="146" cy="36" r="1.6" />
                      <circle cx="130" cy="44" r="1.6" />
                      <circle cx="138" cy="44" r="1.6" />
                      <circle cx="146" cy="44" r="1.6" />
                      <circle cx="130" cy="52" r="1.6" />
                      <circle cx="138" cy="52" r="1.6" />
                      <circle cx="146" cy="52" r="1.6" />
                      <circle cx="130" cy="60" r="1.6" />
                      <circle cx="138" cy="60" r="1.6" />
                      <circle cx="146" cy="60" r="1.6" />
                      <circle cx="130" cy="68" r="1.6" />
                      <circle cx="138" cy="68" r="1.6" />
                      <circle cx="146" cy="68" r="1.6" />
                    </g>
                    <path
                      d="M86 48h28M86 58h22"
                      className="entry-board-svg__traces"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <text x="28" y="78" className="entry-board-svg__label">
                      ESP32
                    </text>
                    <text
                      x="86"
                      y="78"
                      className="entry-board-svg__label entry-board-svg__label--muted"
                    >
                      Arduino
                    </text>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
