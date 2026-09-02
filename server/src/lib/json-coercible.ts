import { z } from '@strapi/utils';

/**
 * Wrap a schema so a JSON-encoded string is parsed before validation.
 *
 * MCP clients — notably through `mcp-remote` — sometimes send complex
 * arguments as JSON text: `fields: '["title","slug"]'` rather than
 * `fields: ["title"]`. Strapi's MCP server validates arguments BEFORE the
 * handler runs, so coercing inside the handler is too late; it has to live in
 * the schema itself.
 *
 * `z.preprocess` rather than a union: it coerces at parse time while still
 * emitting the wrapped schema's own JSON Schema, so the client keeps seeing a
 * typed parameter. A union would emit `anyOf` and would not coerce.
 *
 * Only strings that look like a JSON object or array are touched, so a
 * genuine string value — `populate: "*"` — passes through untouched.
 */
export function jsonCoercible<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Leave it; the wrapped schema produces the validation error, which is
      // more useful than one about malformed JSON.
      return value;
    }
  }, schema) as z.ZodType<z.infer<T>>;
}
