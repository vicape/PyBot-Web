/**
 * Fachada estable: USB y BLE usan src/micropython/micropythonSession.js.
 */

export {
  MicroPythonSession,
  connectMicroPythonEsp32Session,
  connectMicroPythonFromTransport,
  MPY_PRELUDE,
} from "./micropython/micropythonSession.js";

export { BLE_NATIVE_PRELUDE, BLE_LINK_STATE } from "./micropython/constants.js";
export { MicroPythonReplProtocol } from "./micropython/replProtocol.js";
export { ByteQueue } from "./micropython/byteQueue.js";
export { PROTOCOL_ERROR, protocolError } from "./micropython/errors.js";
