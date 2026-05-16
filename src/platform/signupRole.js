/** Rol elegido en /login antes de OAuth (teacher | student). */

export const SIGNUP_ROLE_KEY = "pybot_signup_role";

export const SIGNUP_ROLES = {
  teacher: "teacher",
  student: "student",
};

export function isValidSignupRole(role) {
  return role === SIGNUP_ROLES.teacher || role === SIGNUP_ROLES.student;
}

export function setSignupRole(role) {
  if (!isValidSignupRole(role)) return;
  try {
    sessionStorage.setItem(SIGNUP_ROLE_KEY, role);
  } catch {
    //
  }
}

export function getSignupRole() {
  try {
    const v = sessionStorage.getItem(SIGNUP_ROLE_KEY);
    return isValidSignupRole(v) ? v : null;
  } catch {
    return null;
  }
}

export function consumeSignupRole() {
  const v = getSignupRole();
  try {
    sessionStorage.removeItem(SIGNUP_ROLE_KEY);
  } catch {
    //
  }
  return v;
}

export function signupRoleLabelEs(role) {
  if (role === SIGNUP_ROLES.teacher) return "Docente";
  if (role === SIGNUP_ROLES.student) return "Alumno";
  return "—";
}
