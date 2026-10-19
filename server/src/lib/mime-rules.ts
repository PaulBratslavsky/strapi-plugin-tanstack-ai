/**
 * Which downloaded content types `upload_media` will store.
 *
 * Strapi enforces the operator's `plugin::upload.security` allowedTypes and
 * deniedTypes in its upload CONTROLLERS (utils/mime-validation), not in the
 * upload service, and that helper is not importable from @strapi/upload. A tool
 * that calls the service directly would skip them, so the same rules are applied
 * here, to the Content-Type the remote server claims.
 */

/**
 * Refused whatever the config says. The type comes from an untrusted server,
 * and each of these runs as active content when the media library serves it
 * from the site's own origin.
 */
const ALWAYS_DENIED = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/x-sh',
]);

export interface UploadSecurity {
  allowedTypes?: string[];
  deniedTypes?: string[];
}

/** `Image/PNG; charset=x` becomes `image/png`. */
export const normalizeMime = (contentType: string | null | undefined): string =>
  (contentType ?? '').split(';', 1)[0].trim().toLowerCase() || 'application/octet-stream';

/** An exact entry (`image/png`) or a `type/*` wildcard. */
const matches = (mime: string, entry: string): boolean => {
  const pattern = entry.trim().toLowerCase();
  return pattern.endsWith('/*') ? mime.startsWith(pattern.slice(0, -1)) : mime === pattern;
};

/** Why this content type is refused, or undefined when it may be stored. Deny wins over allow. */
export function mimeRefusal(contentType: string | null | undefined, security?: UploadSecurity): string | undefined {
  const mime = normalizeMime(contentType);
  if (ALWAYS_DENIED.has(mime)) {
    return `Files of type ${mime} are not accepted by upload_media.`;
  }
  if (security?.deniedTypes?.some((entry) => matches(mime, entry))) {
    return `Files of type ${mime} are blocked by this site's media library settings.`;
  }
  const allowed = security?.allowedTypes;
  if (allowed && allowed.length > 0 && allowed.every((entry) => !matches(mime, entry))) {
    return `Files of type ${mime} are not allowed by this site's media library settings.`;
  }
  return undefined;
}
