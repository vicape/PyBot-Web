import { googleLogout } from "@react-oauth/google";
import { clearGoogleProfile } from "./authSession.js";

/** Cierra sesión Google (GIS) y borra el perfil guardado en localStorage. */
export function signOutGoogleClient() {
  try {
    googleLogout();
  } catch {
    /* sin GoogleOAuthProvider o entorno de prueba */
  }
  clearGoogleProfile();
}
