/**
 * Rosetta — Generador AST -> Diagrama de flujo (SVG).
 *
 * Construye un flowchart ESTRUCTURADO: cada construccion produce un "fragmento"
 * con un puerto de entrada (arriba) y uno de salida (abajo), sobre un eje
 * vertical. Asi el armado es predecible y siempre queda bien formado:
 *   - Secuencia: cajas apiladas con flechas hacia abajo.
 *   - Decision (if): rombo con ramas Si/No que se reunen abajo.
 *   - Bucles: rombo + cuerpo + flecha de retorno.
 *
 * Formas (ANSI/ISO): ovalo=inicio/fin, rectangulo=proceso,
 * paralelogramo=entrada/salida, rombo=decision.
 *
 * Devuelve un string SVG listo para inyectar. Los colores salen por CSS.
 */

import { exprToPseudo } from "./pseudocodeGen.js";

const CHAR_W = 7.4;
const PAD_X = 22;
const H_SIMPLE = 44;
const H_DIAMOND = 58;
const VGAP = 34;
const BRANCH_GAP = 54;
const LANE = 26;

function measure(text, extra = 0) {
  return Math.max(70, String(text).length * CHAR_W + PAD_X * 2 + extra);
}

let _id = 0;
function nid() {
  return "n" + _id++;
}

function node(shape, text, w, h) {
  return { id: nid(), shape, text, x: 0, y: 0, w, h };
}

function simpleFrag(shape, text) {
  const w = measure(text, shape === "diamond" ? 30 : 0);
  const h = shape === "diamond" ? H_DIAMOND : H_SIMPLE;
  const nd = node(shape, text, w, h);
  return { nodes: [nd], edges: [], width: w, height: h, portX: w / 2, node: nd };
}

function translate(frag, dx, dy) {
  for (const n of frag.nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const e of frag.edges) {
    e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (e.labelPos) e.labelPos = { x: e.labelPos.x + dx, y: e.labelPos.y + dy };
  }
  return frag;
}

function merge(into, frag) {
  into.nodes.push(...frag.nodes);
  into.edges.push(...frag.edges);
}

function edge(points, label) {
  const e = { points };
  if (label) {
    e.label = label;
    e.labelPos = { x: points[0].x + 8, y: (points[0].y + points[1].y) / 2 };
  }
  return e;
}

// Secuencia de sentencias -> fragmento apilado en el eje de entrada.
function layoutList(stmts, labels) {
  const frags = (stmts || []).map((s) => layoutStmt(s, labels)).filter(Boolean);
  if (frags.length === 0) return null;
  if (frags.length === 1) return frags[0];

  const axis = Math.max(...frags.map((f) => f.portX));
  let rightExtent = 0;
  for (const f of frags) rightExtent = Math.max(rightExtent, f.width - f.portX);
  const width = axis + rightExtent;

  const out = { nodes: [], edges: [], width, height: 0, portX: axis };
  let y = 0;
  let prevExit = null;
  for (const f of frags) {
    translate(f, axis - f.portX, y);
    merge(out, f);
    const entry = { x: axis, y };
    if (prevExit) out.edges.push(edge([prevExit, entry]));
    y += f.height;
    prevExit = { x: axis, y };
    y += VGAP;
  }
  out.height = y - VGAP;
  return out;
}

function layoutStmt(stmt, labels) {
  switch (stmt.type) {
    case "Assign":
      if (stmt.value.type === "Input") {
        const label =
          (stmt.value.prompt ? exprToPseudo(stmt.value.prompt) + " -> " : "") +
          "input " + exprToPseudo(stmt.target);
        return simpleFrag("io", label);
      }
      return simpleFrag("rect", `${exprToPseudo(stmt.target)} = ${exprToPseudo(stmt.value)}`);
    case "AugAssign":
      return simpleFrag(
        "rect",
        `${exprToPseudo(stmt.target)} = ${exprToPseudo(stmt.target)} ${stmt.op} ${exprToPseudo(stmt.value)}`,
      );
    case "Output":
      return simpleFrag("io", "output " + stmt.args.map(exprToPseudo).join(", "));
    case "ExprStmt":
      return simpleFrag("rect", exprToPseudo(stmt.expr));
    case "Return":
      return simpleFrag("terminal", "return" + (stmt.value ? " " + exprToPseudo(stmt.value) : ""));
    case "Break":
      return simpleFrag("rect", labels.brk);
    case "Continue":
      return simpleFrag("rect", labels.cont);
    case "If":
      return layoutIf(stmt, labels);
    case "While":
      return layoutLoop(exprToPseudo(stmt.test), stmt.body, labels, false);
    case "Until":
      return layoutUntil(stmt, labels);
    case "ForRange":
      return layoutForRange(stmt, labels);
    case "ForEach":
      return layoutLoop(
        `${labels.forEach} ${stmt.varName} : ${exprToPseudo(stmt.iter)}`,
        stmt.body,
        labels,
        false,
      );
    case "FuncDef":
      return layoutFunc(stmt, labels);
    case "Raw":
      return simpleFrag("rect", stmt.text);
    default:
      return null;
  }
}

function layoutIf(stmt, labels) {
  const dia = simpleFrag("diamond", exprToPseudo(stmt.test));
  const thenFrag = layoutList(stmt.body, labels);
  const elseFrag = layoutList(stmt.orelse, labels);
  const out = { nodes: [], edges: [], width: 0, height: 0, portX: 0 };

  const dW = dia.width;
  const dH = dia.height;

  if (elseFrag) {
    // Ramas lado a lado, reunion abajo.
    const leftW = thenFrag ? thenFrag.width : 40;
    const rightW = elseFrag.width;
    const total = leftW + BRANCH_GAP + rightW;
    const axis = total / 2;
    const leftCenter = leftW / 2;
    const rightCenter = leftW + BRANCH_GAP + rightW / 2;

    translate(dia, axis - dW / 2, 0);
    merge(out, dia);
    // Conectores SIEMPRE ortogonales (codos en angulo recto): salen por los
    // vertices laterales del rombo, tramo horizontal + tramo vertical.
    const dLeft = axis - dW / 2;
    const dRight = axis + dW / 2;
    const dMidY = dH / 2;
    const branchTop = dH + VGAP;

    // Rama verdadera (izquierda): vertice izquierdo -> horizontal -> baja.
    let leftBottom = branchTop;
    if (thenFrag) {
      translate(thenFrag, leftCenter - thenFrag.portX, branchTop);
      merge(out, thenFrag);
      out.edges.push(
        edge(
          [
            { x: dLeft, y: dMidY },
            { x: leftCenter, y: dMidY },
            { x: leftCenter, y: branchTop },
          ],
          labels.yes,
        ),
      );
      leftBottom = branchTop + thenFrag.height;
    }
    // Rama falsa (derecha): vertice derecho -> horizontal -> baja.
    translate(elseFrag, rightCenter - elseFrag.portX, branchTop);
    merge(out, elseFrag);
    out.edges.push(
      edge(
        [
          { x: dRight, y: dMidY },
          { x: rightCenter, y: dMidY },
          { x: rightCenter, y: branchTop },
        ],
        labels.no,
      ),
    );
    const rightBottom = branchTop + elseFrag.height;

    const mergeY = Math.max(leftBottom, rightBottom) + VGAP;
    const conn = node("conn", "", 10, 10);
    conn.x = axis - 5;
    conn.y = mergeY - 5;
    out.nodes.push(conn);
    // Reunion: cada rama baja recta y luego entra horizontal al conector.
    if (thenFrag) {
      out.edges.push(
        edge([
          { x: leftCenter, y: leftBottom },
          { x: leftCenter, y: mergeY },
          { x: axis, y: mergeY },
        ]),
      );
    } else {
      // Sin cuerpo "then": baja recto por el eje.
      out.edges.push(edge([{ x: axis, y: dH }, { x: axis, y: mergeY }], labels.yes));
    }
    out.edges.push(
      edge([
        { x: rightCenter, y: rightBottom },
        { x: rightCenter, y: mergeY },
        { x: axis, y: mergeY },
      ]),
    );

    out.width = total;
    out.height = mergeY;
    out.portX = axis;
    return out;
  }

  // Sin else: Si va a la derecha y vuelve; No sigue derecho.
  const dCenter = dW / 2;
  translate(dia, 0, 0);
  merge(out, dia);
  const dBottom = dH;
  const branchTop = dH + VGAP;

  if (thenFrag) {
    const colCenter = dW + BRANCH_GAP + thenFrag.width / 2;
    translate(thenFrag, colCenter - thenFrag.portX, branchTop);
    merge(out, thenFrag);
    const thenBottom = branchTop + thenFrag.height;
    const mergeY = thenBottom + VGAP;
    // Si: rombo derecha -> columna
    out.edges.push(
      edge([{ x: dW, y: dH / 2 }, { x: colCenter, y: dH / 2 }, { x: colCenter, y: branchTop }], labels.yes),
    );
    // vuelta de la columna al eje
    out.edges.push(edge([{ x: colCenter, y: thenBottom }, { x: colCenter, y: mergeY }, { x: dCenter, y: mergeY }]));
    // No: recto hacia abajo
    out.edges.push(edge([{ x: dCenter, y: dBottom }, { x: dCenter, y: mergeY }], labels.no));
    out.width = colCenter + thenFrag.width / 2;
    out.height = mergeY;
    out.portX = dCenter;
    return out;
  }

  // if vacio: solo el rombo, salida por abajo
  out.width = dW;
  out.height = dH;
  out.portX = dCenter;
  return out;
}

// Bucle pre-test (while / for-each).
//
// Patron T-junction: la flecha de retorno NO entra al rombo sino que se une
// a la linea de entrada SOBRE el rombo (punto de union). Asi la cabeza del
// rombo solo recibe UNA linea (limpia) y el retorno se conecta a la misma
// "wire" que llega de arriba.
//
//   ─── [prev box] ───
//          │
//          ●   <- PUNTO DE UNION (y=0 del fragmento)
//          │        ^
//       ◇ cond ◇    │ retorno sube por la izquierda y entra aqui
//          │ Si      │
//         ...        │
//          │ ────────┘  (baja por el fondo y va a la izquierda)
//          │
//      No salida
//
const MERGE_ABOVE = 20; // espacio entre el punto de union y el vertice superior del rombo
const LOOP_DROP   = 14; // descenso minimo desde el fondo del ultimo bloque antes de girar

function layoutLoop(condText, body, labels, _post) {
  const dia = simpleFrag("diamond", condText);
  const bodyFrag = layoutList(body, labels);
  const out = { nodes: [], edges: [], width: 0, height: 0, portX: 0 };

  const dW = dia.width;
  const dH = dia.height;
  const dCenter = dW / 2;

  // El rombo se coloca con MERGE_ABOVE de margen en la parte superior,
  // dejando espacio para el punto de union con la flecha de retorno.
  translate(dia, 0, MERGE_ABOVE);
  merge(out, dia);

  const branchTop = MERGE_ABOVE + dH + VGAP;
  const bodyW = bodyFrag ? bodyFrag.width : 40;
  if (bodyFrag) {
    translate(bodyFrag, dCenter - bodyFrag.portX, branchTop);
    merge(out, bodyFrag);
  }
  const bodyBottom = branchTop + (bodyFrag ? bodyFrag.height : 0);

  // Segmento interno: punto de union (y=0) -> vertice superior del rombo.
  // Sin punta de flecha: es solo la continuacion de la linea de entrada.
  out.edges.push({ points: [{ x: dCenter, y: 0 }, { x: dCenter, y: MERGE_ABOVE }], noArrow: true });

  // Si: vertice inferior del rombo -> cuerpo.
  out.edges.push(edge([
    { x: dCenter, y: MERGE_ABOVE + dH },
    { x: dCenter, y: branchTop },
  ], labels.yes));

  // Retorno: baja del fondo del cuerpo (LOOP_DROP para salir por abajo del rectangulo,
  // NO por el costado), va por el carril izquierdo, sube hasta el punto de union.
  const leftLane = -LANE;
  out.edges.push(
    edge([
      { x: dCenter, y: bodyBottom },             // puerto de salida del cuerpo (fondo)
      { x: dCenter, y: bodyBottom + LOOP_DROP },  // baja un poco (sale por el FONDO del bloque)
      { x: leftLane, y: bodyBottom + LOOP_DROP }, // va al carril izquierdo
      { x: leftLane, y: 0 },                     // sube hasta el punto de union
      { x: dCenter, y: 0 },                      // llega al punto de union (T-junction)
    ]),
  );

  // No: vertice derecho del rombo -> carril derecho -> punto de salida del fragmento.
  const rightLane = Math.max(dW, dCenter + bodyW / 2) + LANE;
  const exitY = bodyBottom + VGAP;
  out.edges.push(
    edge([
      { x: dW, y: MERGE_ABOVE + dH / 2 },          // vertice derecho del rombo
      { x: rightLane, y: MERGE_ABOVE + dH / 2 },    // horizontal al carril derecho
      { x: rightLane, y: exitY },                   // baja hasta el punto de salida
      { x: dCenter, y: exitY },                     // vuelve al eje central
    ], labels.no),
  );

  // Desplazar todo LANE pixels a la derecha para que el carril izquierdo quede en x=0.
  translate(out, LANE, 0);
  out.width = rightLane + LANE;
  out.height = exitY;
  out.portX = dCenter + LANE;
  return out;
}

function layoutUntil(stmt, labels) {
  // Post-test: cuerpo primero, luego rombo; si NO se cumple, vuelve arriba.
  const bodyFrag = layoutList(stmt.body, labels);
  const dia = simpleFrag("diamond", exprToPseudo(stmt.test));
  const out = { nodes: [], edges: [], width: 0, height: 0, portX: 0 };

  const bodyW = bodyFrag ? bodyFrag.width : 40;
  const bodyH = bodyFrag ? bodyFrag.height : 0;
  const axis = Math.max(bodyW, dia.width) / 2;

  if (bodyFrag) {
    translate(bodyFrag, axis - bodyFrag.portX, 0);
    merge(out, bodyFrag);
  }
  const diaTop = bodyH + VGAP;
  translate(dia, axis - dia.width / 2, diaTop);
  merge(out, dia);
  if (bodyFrag) out.edges.push(edge([{ x: axis, y: bodyH }, { x: axis, y: diaTop }]));

  // No -> vuelve arriba (por la izquierda)
  const leftLane = -LANE;
  out.edges.push(
    edge([
      { x: axis - dia.width / 2, y: diaTop + dia.height / 2 },
      { x: leftLane, y: diaTop + dia.height / 2 },
      { x: leftLane, y: -14 },
      { x: axis, y: -14 },
      { x: axis, y: 0 },
    ], labels.no),
  );
  // Si -> salida abajo
  const exitY = diaTop + dia.height + VGAP;
  out.edges.push(edge([{ x: axis, y: diaTop + dia.height }, { x: axis, y: exitY }], labels.yes));

  translate(out, LANE, 14);
  out.width = axis + Math.max(bodyW, dia.width) / 2 + LANE;
  out.height = exitY + 14;
  out.portX = axis + LANE;
  return out;
}

function minusOne(node2) {
  if (node2.type === "Num" && typeof node2.value === "number")
    return { type: "Num", value: node2.value - 1 };
  return { type: "BinOp", op: "-", left: node2, right: { type: "Num", value: 1 } };
}

function layoutForRange(stmt, labels) {
  const args = stmt.rangeArgs;
  let start;
  let stopEx;
  let step = null;
  if (args.length === 1) {
    start = { type: "Num", value: 0 };
    stopEx = args[0];
  } else {
    start = args[0];
    stopEx = args[1];
    step = args[2] ?? null;
  }
  const endIncl = minusOne(stopEx);
  const init = { type: "Assign", target: { type: "Name", id: stmt.varName }, value: start };
  const cond = `${stmt.varName} ≤ ${exprToPseudo(endIncl)}`;
  const incVal = step
    ? `${stmt.varName} + ${exprToPseudo(step)}`
    : `${stmt.varName} + 1`;
  const incNode = {
    type: "Raw",
    text: `${stmt.varName} = ${incVal}`,
  };
  const bodyPlus = [...stmt.body, incNode];
  const loop = layoutLoop(cond, bodyPlus, labels, false);
  const initFrag = layoutStmt(init, labels);
  return stackFrags([initFrag, loop]);
}

function layoutFunc(stmt, labels) {
  const head = simpleFrag("terminal", `${labels.func} ${stmt.name}(${stmt.params.join(", ")})`);
  const bodyFrag = layoutList(stmt.body, labels);
  const tail = simpleFrag("terminal", labels.endFunc);
  const parts = [head, bodyFrag, tail].filter(Boolean);
  return stackFrags(parts);
}

// Apila fragmentos ya construidos (para casos donde ya tenemos fragments).
function stackFrags(frags) {
  const list = frags.filter(Boolean);
  if (list.length === 1) return list[0];
  const axis = Math.max(...list.map((f) => f.portX));
  const rightExtent = Math.max(...list.map((f) => f.width - f.portX));
  const out = { nodes: [], edges: [], width: axis + rightExtent, height: 0, portX: axis };
  let y = 0;
  let prevExit = null;
  for (const f of list) {
    translate(f, axis - f.portX, y);
    merge(out, f);
    const entry = { x: axis, y };
    if (prevExit) out.edges.push(edge([prevExit, entry]));
    y += f.height;
    prevExit = { x: axis, y };
    y += VGAP;
  }
  out.height = y - VGAP;
  return out;
}

// -------------------------- Render SVG --------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderNode(n) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const textEl = `<text x="${cx}" y="${cy}" class="fc-text" dominant-baseline="middle" text-anchor="middle">${esc(n.text)}</text>`;
  switch (n.shape) {
    case "rect":
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" class="fc-rect"/>${textEl}`;
    case "io": {
      const s = 14;
      const pts = `${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}`;
      return `<polygon points="${pts}" class="fc-io"/>${textEl}`;
    }
    case "diamond": {
      const pts = `${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`;
      return `<polygon points="${pts}" class="fc-diamond"/>${textEl}`;
    }
    case "terminal":
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" class="fc-terminal"/>${textEl}`;
    case "conn":
      return `<circle cx="${cx}" cy="${cy}" r="4" class="fc-conn"/>`;
    default:
      return "";
  }
}

function renderEdge(e) {
  const pts = e.points.map((p) => `${p.x},${p.y}`).join(" ");
  const arrowAttr = e.noArrow ? "" : ` marker-end="url(#fc-arrow)"`;
  const line = `<polyline points="${pts}" class="fc-edge"${arrowAttr}/>`;
  let label = "";
  if (e.label && e.labelPos) {
    label = `<text x="${e.labelPos.x}" y="${e.labelPos.y}" class="fc-elabel">${esc(e.label)}</text>`;
  }
  return line + label;
}

/**
 * Convierte el AST en un SVG de diagrama de flujo.
 * @param {{type:'Program', body:Array}} ast
 * @param {{lang?:string}} [opts]
 * @returns {string} SVG
 */
export function astToFlowchart(ast, opts = {}) {
  _id = 0;
  const es = opts.lang !== "en";
  const labels = es
    ? {
        yes: "Sí",
        no: "No",
        start: "Inicio",
        end: "Fin",
        brk: "salir del bucle",
        cont: "continuar",
        forEach: "para cada",
        func: "función",
        endFunc: "fin función",
      }
    : {
        yes: "Yes",
        no: "No",
        start: "Start",
        end: "End",
        brk: "break",
        cont: "continue",
        forEach: "for each",
        func: "function",
        endFunc: "end function",
      };

  const body = ast && ast.body ? ast.body : [];
  const startFrag = simpleFrag("terminal", labels.start);
  const bodyFrag = layoutList(body, labels);
  const endFrag = simpleFrag("terminal", labels.end);
  const program = stackFrags([startFrag, bodyFrag, endFrag].filter(Boolean));

  // Normalizar bounding box (por posibles coords negativas de bucles).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of program.nodes) {
    consider(n.x, n.y);
    consider(n.x + n.w, n.y + n.h);
  }
  for (const e of program.edges) for (const p of e.points) consider(p.x, p.y);
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  const PAD = 24;
  translate(program, -minX + PAD, -minY + PAD);
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2);

  const nodesSvg = program.nodes.map(renderNode).join("");
  const edgesSvg = program.edges.map(renderEdge).join("");

  return (
    `<svg class="fc-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="fc-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">` +
    `<path d="M0,0 L8,3 L0,6 Z" class="fc-arrowhead"/></marker></defs>` +
    edgesSvg +
    nodesSvg +
    `</svg>`
  );
}
