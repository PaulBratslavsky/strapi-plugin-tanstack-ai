/**
 * Where the admin session token actually lives.
 *
 * Three things here are each a bug I shipped by assuming:
 *
 *   1. localStorage is not the only home. Strapi also keeps the token in a
 *      `jwtToken` cookie, and reading only localStorage yields null for a
 *      perfectly valid session — which surfaces as a 401 that looks like the
 *      plugin being broken.
 *   2. The stored value is usually JSON-encoded, but not always. JSON.parse
 *      without a fallback turns a raw token into a thrown error.
 *   3. The admin is not always served from the API's origin, so a relative
 *      fetch can miss. `strapi.backendURL` is what the admin itself uses.
 */

const COOKIE = /(?:^|;\s*)jwtToken=([^;]*)/;

export function getToken(): string | null {
  const stored = localStorage.getItem('jwtToken') ?? sessionStorage.getItem('jwtToken');
  if (stored) {
    try {
      return JSON.parse(stored) as string;
    } catch {
      return stored;
    }
  }
  const match = COOKIE.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Prefix for plugin routes. Empty when the admin shares the API's origin. */
export function backendURL(): string {
  return (globalThis as { strapi?: { backendURL?: string } }).strapi?.backendURL ?? '';
}

/** Authorization header, or nothing — never a `Bearer null`. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
