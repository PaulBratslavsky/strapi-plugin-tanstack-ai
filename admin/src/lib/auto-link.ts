/**
 * Turn content-type UIDs in an answer into Content Manager links.
 *
 * The model names types as `api::product.product` because that is what the
 * tools return. Left as text it is a string the operator has to go and look up.
 *
 * FIXES A BUG INHERITED FROM THE REFERENCE, which runs its regex over the whole
 * answer. Models routinely write the UID in backticks, and rewriting it there
 * produces `[api::product.product](/content-manager/...)` INSIDE a code span —
 * where markdown is not parsed, so the reader sees raw link syntax. That is
 * exactly how it rendered here.
 *
 * So: fenced blocks and existing links are left alone, a code span holding just
 * a UID becomes a link AROUND the code (markdown allows code as link text, so
 * the monospace styling survives), and bare UIDs link as before.
 */

const CONTENT_TYPE_UID_RE = /\b(api::\w[\w-]*\.\w[\w-]*)\b/g;

/** An inline code span containing nothing but a UID. */
const CODE_SPAN_UID_RE = /^`(api::\w[\w-]*\.\w[\w-]*)`$/;

const uidLink = (uid: string, label: string) =>
  `[${label}](/content-manager/collection-types/${uid})`;

/**
 * The protected region starting at `index`, or null if none starts there.
 *
 * SCANNED RATHER THAN MATCHED WITH A REGEX, and that is the point. The obvious
 * pattern for a fence — ```` ```[\s\S]*?``` ```` — backtracks super-linearly on
 * text containing many backticks and no closing fence. This runs on MODEL
 * OUTPUT on every render of a streaming answer, where a half-written fence is
 * the normal state, so that input is the common case rather than an attack.
 * Scanning is one pass, and it is easier to read than the regex that would
 * avoid the same problem.
 *
 * An UNTERMINATED region is deliberately not protected: mid-stream, the closing
 * fence has not arrived yet, and treating the rest of the answer as code would
 * make links flicker in and out as the text lands.
 */
function protectedRegionAt(text: string, index: number): string | null {
  if (text.startsWith('```', index)) {
    const close = text.indexOf('```', index + 3);
    return close === -1 ? null : text.slice(index, close + 3);
  }

  if (text[index] === '`') {
    // Inline code does not span lines; a lone backtick before a newline is
    // just a backtick.
    const newline = text.indexOf('\n', index + 1);
    const close = text.indexOf('`', index + 1);
    if (close === -1) return null;
    if (newline !== -1 && newline < close) return null;
    return text.slice(index, close + 1);
  }

  if (text[index] === '[') {
    const label = text.indexOf(']', index + 1);
    if (label === -1 || text[label + 1] !== '(') return null;
    const target = text.indexOf(')', label + 2);
    return target === -1 ? null : text.slice(index, target + 1);
  }

  return null;
}

interface Segment {
  text: string;
  /** Fenced code, inline code, or an existing link — never rewritten in place. */
  isProtected: boolean;
}

/** Split an answer into plain prose and the regions the linker must not touch. */
export function splitProtected(text: string): Segment[] {
  const segments: Segment[] = [];
  let plainFrom = 0;
  let index = 0;

  while (index < text.length) {
    const region = protectedRegionAt(text, index);
    if (!region) {
      index += 1;
      continue;
    }

    if (index > plainFrom) {
      segments.push({ text: text.slice(plainFrom, index), isProtected: false });
    }
    segments.push({ text: region, isProtected: true });
    index += region.length;
    plainFrom = index;
  }

  if (plainFrom < text.length) {
    segments.push({ text: text.slice(plainFrom), isProtected: false });
  }

  return segments;
}

export function autoLinkContentTypeUids(text: string): string {
  return splitProtected(text)
    .map(({ text: segment, isProtected }) => {
      if (!isProtected) {
        return segment.replaceAll(CONTENT_TYPE_UID_RE, (uid) => uidLink(uid, uid));
      }
      // The one protected region worth touching: a code span that is precisely
      // a UID becomes linked code rather than a dead string.
      const codeSpan = CODE_SPAN_UID_RE.exec(segment);
      return codeSpan ? uidLink(codeSpan[1], segment) : segment;
    })
    .join('');
}
