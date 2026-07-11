/**
 * Rosetta — Facade de conversiones entre representaciones.
 *
 * Todas pasan por el AST comun (el "centro"):
 *
 *        Flowchart
 *            |
 *   Pseudo -- [ AST ] -- Python
 *            |
 *         PyBlock (via su Python generado)
 *
 * Estas funciones nunca lanzan: ante algo no soportado degradan a Raw.
 */

import { pythonToAst } from "./pythonParser.js";
import { pseudocodeToAst } from "./pseudocodeParser.js";
import { astToPython } from "./pythonGen.js";
import { astToPseudocode } from "./pseudocodeGen.js";
import { astToFlowchart } from "./flowchart.js";
import { astToBlockly } from "./astToBlocks.js";

export {
  pythonToAst,
  pseudocodeToAst,
  astToPython,
  astToPseudocode,
  astToFlowchart,
  astToBlockly,
};

export function pythonToBlockly(python) {
  return astToBlockly(pythonToAst(python));
}

export function pythonToPseudocode(python) {
  return astToPseudocode(pythonToAst(python));
}

export function pseudocodeToPython(pseudo) {
  return astToPython(pseudocodeToAst(pseudo));
}

export function pythonToFlowchart(python, lang) {
  return astToFlowchart(pythonToAst(python), { lang });
}

export function pseudocodeToFlowchart(pseudo, lang) {
  return astToFlowchart(pseudocodeToAst(pseudo), { lang });
}
