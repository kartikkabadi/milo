/**
 * The admin token the Worker expects on /api/auth/* and /agents/* once
 * MILO_ADMIN_TOKEN is set as a secret.
 *
 * Lives in sessionStorage (tab-scoped, gone on close) with an in-memory
 * fallback for private-mode browsers where storage writes throw. It is
 * still readable by any script on the origin — that is inherent to a
 * bearer the browser has to send — so the token is scoped to a single
 * deployment and never leaves it.
 */

const KEY = "milo.adminToken";

let memory = "";

export function adminToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setAdminToken(value: string): void {
  memory = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private mode: the in-memory copy still covers this page load.
  }
}
