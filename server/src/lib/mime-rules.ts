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
  // The XML family: XML and XSLT render as active content in a browser, and
  // the MIME-wrapper types (MHTML, RFC 822 mail) and HTML Components carry
  // script. Strapi derives a file's extension from its type when the name has
  // none, so the types need listing as well as the extensions below.
  'application/xml',
  'text/xml',
  'application/xslt+xml',
  'text/xsl',
  'multipart/related',
  'message/rfc822',
  'text/x-component',
]);

/**
 * Strapi stores the file under the extension of the name it is given, and the
 * media library serves it by that extension. So the Content-Type the remote
 * server claims is not enough: `x.html` sent as image/png would be stored and
 * served as HTML. These extensions are refused whatever the config says...
 */
const ALWAYS_DENIED_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'xht', 'shtml', 'svg', 'svgz', 'js', 'mjs', 'cjs', 'sh', 'php', 'xml', 'xsl', 'xslt', 'mht', 'mhtml', 'htc']);

/** ...and a known extension is also checked, as the type it will be served as, against the operator's rules. */
const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', svgz: 'image/svg+xml',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv',
  json: 'application/json', html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  xht: 'application/xhtml+xml', shtml: 'text/html', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  sh: 'application/x-sh', php: 'application/x-httpd-php',
};

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

/** The extension of a filename, lowercased, without the dot; '' when there is none. */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).trim().toLowerCase();
};

/** Why this FILENAME is refused (by its extension), or undefined. */
export function nameRefusal(name: string, security?: UploadSecurity): string | undefined {
  const extension = extensionOf(name);
  if (ALWAYS_DENIED_EXTENSIONS.has(extension)) {
    return `Files named .${extension} are not accepted by upload_media.`;
  }
  const mime = Object.hasOwn(EXTENSION_MIME, extension) ? EXTENSION_MIME[extension] : undefined;
  return mime ? mimeRefusal(mime, security) : undefined;
}
