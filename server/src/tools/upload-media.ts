import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { actionForTool } from '../lib/tool-permissions';
import { abilityFrom } from '../lib/read-permissions';
import { guardedFetch, type Fetcher } from '../lib/guarded-fetch';
import { mimeRefusal, normalizeMime, type UploadSecurity } from '../lib/mime-rules';
import { assertPublicUrl } from '../lib/public-url';
import { callerId } from './create-content';
import { errorResult, okResult } from './results';

/**
 * `upload_media`: fetch a public URL into the media library.
 *
 * Ported from strapi-plugin-ai-chat with these changes:
 *   - the SSRF guard resolves DNS (lib/public-url.ts) and the connection itself
 *     refuses private addresses (lib/guarded-fetch.ts), so DNS rebinding fails;
 *   - the caller must hold the media library's own upload permission as well as
 *     this tool's action, so a token allowed to call the tool but not to upload
 *     in the admin gets no back door;
 *   - the operator's allowed/denied upload types apply (lib/mime-rules.ts);
 *   - the body is streamed to disk under a byte cap, never buffered.
 */
const UPLOAD_ACTION = 'plugin::upload.assets.create';
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

interface Deps {
  fetch?: Fetcher;
  lookup?: (host: string) => Promise<Array<{ address: string }>>;
  maxBytes?: number;
}
let deps: Deps = {};
/** @internal Test seam only; not part of the tool's public surface. */
export const __setUploadDeps = (next: Deps) => {
  // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- test seam: the one hook that swaps fetch/lookup/cap
  deps = next;
};

const outputSchema = () =>
  z.object({
    file: z.object({ id: z.number(), name: z.string(), url: z.string(), mime: z.string(), size: z.number() }),
    usage: z.string(),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

/**
 * The name the media library shows. Only ever a label: the file on disk has a
 * fixed name, so nothing here can steer a path. Falls back to "upload" for
 * anything that is not a plain filename.
 */
const lastSegment = (value: string) => value.split(/[/\\]/).pop() ?? '';
const displayName = (requested: string | undefined, url: URL): string => {
  const candidate = lastSegment(requested || lastSegment(url.pathname));
  const unusable =
    !candidate || candidate === '.' || candidate === '..' || candidate.includes('\0') || Buffer.byteLength(candidate) > 255;
  return unusable ? 'upload' : candidate;
};

/**
 * Stream a response body to `filepath`, counting as it goes. Returns the byte
 * count, or undefined once it passes `maxBytes`; at that point the request is
 * aborted and the rest of the body is never read.
 */
async function streamToFile(
  response: Response,
  filepath: string,
  maxBytes: number,
  controller: AbortController,
): Promise<number | undefined> {
  const reader = response.body?.getReader();
  const file = await open(filepath, 'w');
  let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        controller.abort();
        await cancelQuietly(reader);
        return undefined;
      }
      await file.write(value);
    }
  } finally {
    await file.close();
  }
  return size;
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // The abort already tore the connection down; nothing left to cancel.
  }
}

const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;

export const uploadMedia = ai.mcp.defineTool({
  name: 'upload_media',
  title: 'TanStack AI: Upload Media',
  description:
    'Upload a file from a public http(s) URL to the media library. Step 1 of 2: this returns a file ' +
    'id; step 2 is create_content or update_content with { "<mediaField>": <id> }. One call ' +
    'uploads one file. Private or local addresses and redirects are refused.',

  auth: { policies: [{ action: actionForTool('upload_media') }] },

  resolveInputSchema: () =>
    z.object({
      url: z.string().describe('Public http(s) URL of the file.'),
      name: z.string().optional().describe('Filename to store. Defaults to the last part of the URL path.'),
      caption: z.string().optional(),
      alternativeText: z.string().optional().describe('Alt text for accessibility.'),
    }),

  resolveOutputSchema: outputSchema,

  createHandler: (strapi: Core.Strapi, context) => async ({ args }): Promise<ToolResult> => {
    const ability = abilityFrom(context) as { can?: (action: string) => boolean } | undefined;
    if (!ability?.can?.(UPLOAD_ACTION)) {
      return errorResult('You do not have permission to upload to the media library.');
    }

    let url: URL;
    try {
      url = await assertPublicUrl(args.url, deps.lookup);
    } catch (error) {
      return errorResult((error as Error).message);
    }

    const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    const tooLarge = () => errorResult(`The file is larger than ${mb(maxBytes)}.`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let dir: string | undefined;
    try {
      const response = await (deps.fetch ?? guardedFetch)(url, { signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        return errorResult('That URL redirects, and redirects are refused. Pass the final URL instead.');
      }
      if (!response.ok) {
        return errorResult(`Fetching the file failed: ${response.status} ${response.statusText}`);
      }

      const mime = normalizeMime(response.headers.get('content-type'));
      const security = strapi.config.get('plugin::upload.security') as UploadSecurity | undefined;
      const refusal = mimeRefusal(mime, security);
      if (refusal) return errorResult(refusal);

      // The declared length is only an early exit: it can be absent, wrong, or
      // the COMPRESSED size. The running count below is what enforces the cap.
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return tooLarge();

      dir = await mkdtemp(nodePath.join(tmpdir(), 'tanstack-ai-upload-'));
      const filepath = nodePath.join(dir, 'upload');
      const size = await streamToFile(response, filepath, maxBytes, controller);
      if (size === undefined) return tooLarge();
      if (size === 0) return errorResult('That URL returned an empty file.');

      const fileInfo: Record<string, string> = {};
      if (args.caption) fileInfo.caption = args.caption;
      if (args.alternativeText) fileInfo.alternativeText = args.alternativeText;

      const id = callerId(context);
      const [uploaded] = (await strapi
        .plugin('upload')
        .service('upload')
        .upload(
          {
            data: { fileInfo },
            files: { filepath, originalFilename: displayName(args.name, url), mimetype: mime, size },
          },
          id ? { user: { id } } : undefined,
        )) as Array<{ id: number; name: string; url: string; mime: string; size: number }>;
      if (!uploaded) return errorResult('The upload service returned no file.');

      const stored = { id: uploaded.id, name: uploaded.name, url: uploaded.url, mime: uploaded.mime, size: uploaded.size };
      return okResult({
        file: stored,
        usage: `Attach it with create_content or update_content: { "<mediaField>": ${stored.id} }`,
      });
    } catch (error) {
      // A refusal is a result, never a throw: the model gets the reason, not a stack.
      return errorResult(`Uploading from that URL failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  },
});
