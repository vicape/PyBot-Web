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
              <span className="entry-visual__tab entry-visual__tab--hw">{hardware}</span>
            </span>
          </div>

          <div className="entry-visual__workspace">
            <div className="entry-visual__files">
              <span className="entry-visual__files-item entry-visual__files-item--active">
                {codeLabel}
              </span>
              <span className="entry-visual__files-item entry-visual__files-item--muted">
                {blocks}
              </span>
              <span className="entry-visual__files-item entry-visual__files-item--muted entry-visual__files-item--hw">
                {hardware}
              </span>
            </div>

            <div className="entry-visual__body">
              <div className="entry-visual__editor">
                <div className="entry-visual__editor-head">
                  <span className="entry-visual__file-dot" />
                  <span className="entry-visual__file">{codeLabel}</span>
                </div>
                <div className="entry-visual__code-row">
                  <div className="entry-visual__gutter">
                    <span className="entry-visual__ln entry-visual__ln--active">1</span>
                    <span className="entry-visual__ln">2</span>
                    <span className="entry-visual__ln">3</span>
                    <span className="entry-visual__ln">4</span>
                    <span className="entry-visual__ln entry-visual__ln--extra">5</span>
                    <span className="entry-visual__ln entry-visual__ln--extra">6</span>
                  </div>
                  <pre className="entry-visual__code">
                    <code>
                      <span className="entry-visual__cline entry-visual__cline--active">
                        <span className="tok-kw">pin</span>
                        <span className="tok-p">(</span>
                        <span className="tok-str">&quot;out&quot;</span>
                        <span className="tok-p">,</span> <span className="tok-num">2</span>
                        <span className="tok-p">,</span> <span className="tok-num">1</span>
                        <span className="tok-p">);</span>
                      </span>
                      <span className="entry-visual__cline">
                        <span className="tok-kw">wait</span>
                        <span className="tok-p">(</span>
                        <span className="tok-num">0.5</span>
                        <span className="tok-p">);</span>
                      </span>
                      <span className="entry-visual__cline">
                        <span className="tok-kw">pin</span>
                        <span className="tok-p">(</span>
                        <span className="tok-str">&quot;out&quot;</span>
                        <span className="tok-p">,</span> <span className="tok-num">2</span>
                        <span className="tok-p">,</span> <span className="tok-num">0</span>
                        <span className="tok-p">);</span>
                      </span>
                      <span className="entry-visual__cline">
                        <span className="tok-kw">servo</span>
                        <span className="tok-p">(</span>
                        <span className="tok-num">10</span>
                        <span className="tok-p">,</span> <span className="tok-num">90</span>
                        <span className="tok-p">);</span>
                      </span>
                      <span className="entry-visual__cline entry-visual__cline--extra">
                        <span className="tok-kw">wait</span>
                        <span className="tok-p">(</span>
                        <span className="tok-num">1</span>
                        <span className="tok-p">)</span>
                      </span>
                      <span className="entry-visual__cline entry-visual__cline--extra">
                        <span className="tok-fn">print</span>
                        <span className="tok-p">(</span>
                        <span className="tok-str">&quot;Hola PyBot&quot;</span>
                        <span className="tok-p">);</span>
                      </span>
                    </code>
                  </pre>
                </div>
              </div>

              <div className="entry-visual__side">
                <div className="entry-visual__panel entry-visual__panel--blocks">
                  <div className="entry-visual__panel-head">{blocks}</div>
                  <div className="entry-visual__blocks">
                    <div className="entry-block entry-block--hat">
                      <span className="entry-block__label">start</span>
                    </div>
                    <div className="entry-block entry-block--pin">
                      <span className="entry-block__label">
                        pin <em>out</em> <strong>2</strong> <strong>1</strong>
                      </span>
                    </div>
                    <div className="entry-block entry-block--wait">
                      <span className="entry-block__label">
                        wait <strong>0.5</strong>
                      </span>
                    </div>
                    <div className="entry-block entry-block--pin entry-block--pin-alt">
                      <span className="entry-block__label">
                        pin <em>out</em> <strong>2</strong> <strong>0</strong>
                      </span>
                    </div>
                    <div className="entry-block entry-block--servo">
                      <span className="entry-block__label">
                        servo <strong>10</strong> <strong>90</strong>
                      </span>
                    </div>
                    <div className="entry-block entry-block--print entry-block--extra">
                      <span className="entry-block__label">
                        print <em>Hola</em>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="entry-visual__panel entry-visual__panel--hw">
                  <div className="entry-visual__panel-head">{hardware}</div>
                  <div className="entry-visual__board">
                    <svg className="entry-board-svg" viewBox="0 0 176 104" fill="none">
                      <rect
                        x="20"
                        y="18"
                        width="128"
                        height="70"
                        rx="6"
                        className="entry-board-svg__body"
                      />
                      <rect x="20" y="18" width="128" height="7" className="entry-board-svg__edge" />
                      <rect x="6" y="42" width="16" height="16" rx="2" className="entry-board-svg__usb" />
                      <rect x="46" y="34" width="40" height="34" rx="3" className="entry-board-svg__chip" />
                      <rect x="54" y="42" width="24" height="18" rx="1.4" className="entry-board-svg__die" />
                      <circle cx="96" cy="30" r="2.5" className="entry-board-svg__led" />
                      <circle cx="104" cy="30" r="2.5" className="entry-board-svg__led entry-board-svg__led--alt" />
                      <path
                        d="M86 50h14M86 60h10"
                        className="entry-board-svg__traces"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                      <g className="entry-board-svg__pins">
                        <circle cx="118" cy="32" r="1.7" className="entry-board-svg__pin entry-board-svg__pin--active" />
                        <circle cx="128" cy="32" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="118" cy="42" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="128" cy="42" r="1.7" className="entry-board-svg__pin entry-board-svg__pin--servo" />
                        <circle cx="118" cy="52" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="128" cy="52" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="118" cy="62" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="128" cy="62" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="118" cy="72" r="1.7" className="entry-board-svg__pin" />
                        <circle cx="128" cy="72" r="1.7" className="entry-board-svg__pin" />
                      </g>
                      <path
                        d="M128 32H158V12"
                        className="entry-board-svg__traces entry-board-svg__traces--active"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="158" cy="12" r="2.2" className="entry-board-svg__pin entry-board-svg__pin--active" />
                      <path
                        d="M128 42H150V86H138"
                        className="entry-board-svg__traces entry-board-svg__wire-servo"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <rect x="126" y="82" width="22" height="10" rx="2" className="entry-board-svg__plug" />
                      <circle cx="132" cy="87" r="1.2" className="entry-board-svg__pin entry-board-svg__pin--servo" />
                      <circle cx="137" cy="87" r="1.2" className="entry-board-svg__pin" />
                      <circle cx="142" cy="87" r="1.2" className="entry-board-svg__pin" />
                      <text x="28" y="78" className="entry-board-svg__label">
                        ESP32
                      </text>
                      <text x="64" y="78" className="entry-board-svg__label entry-board-svg__label--muted">
                        Arduino
                      </text>
                      <text x="112" y="26" className="entry-board-svg__pin-label">
                        GPIO2
                      </text>
                    </svg>
                  </div>
                  <div className="entry-visual__hw-meta">
                    <span className="entry-visual__hw-chip">GPIO2</span>
                    <span className="entry-visual__hw-chip entry-visual__hw-chip--servo">
                      servo · 10
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
