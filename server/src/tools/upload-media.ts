import { ai } from '@strapi/strapi';
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { Modules } from '@strapi/types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { actionForTool } from '../lib/tool-permissions';
import { abilityFrom } from '../lib/read-permissions';
import { assertPublicUrl } from '../lib/public-url';
import { errorResult, okResult } from './results';

/**
 * `upload_media`: fetch a public URL into the media library.
 *
 * Ported from strapi-plugin-ai-chat with two changes: the SSRF guard resolves
 * DNS (lib/public-url.ts), and the caller must hold the media library's own
 * upload permission as well as this tool's action. A token allowed to call
 * the tool but not to upload in the admin should not get a back door.
 */
const UPLOAD_ACTION = 'plugin::upload.assets.create';
const MAX_BYTES = 50 * 1024 * 1024;

let deps: { fetch?: typeof fetch; lookup?: (host: string) => Promise<Array<{ address: string }>> } = {};
/** Test seam only. */
export const __setUploadDeps = (next: typeof deps) => {
  // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- test seam: the one hook that swaps fetch/lookup
  deps = next;
};

const outputSchema = () =>
  z.object({
    file: z.object({ id: z.number(), name: z.string(), url: z.string(), mime: z.string(), size: z.number() }),
    usage: z.string(),
  });

type ToolResult = Modules.MCP.McpToolHandlerReturn<ReturnType<typeof outputSchema>>;

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

    const doFetch = deps.fetch ?? fetch;
    const response = await doFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      return errorResult('That URL redirects, and redirects are refused. Pass the final URL instead.');
    }
    if (!response.ok) {
      return errorResult(`Fetching the file failed: ${response.status} ${response.statusText}`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return errorResult(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) return errorResult(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);

    // basename() so a crafted name cannot write outside the temp dir.
    const filename = nodePath.basename(args.name || url.pathname.split('/').pop() || 'upload');
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'tanstack-ai-upload-'));
    const filePath = nodePath.join(dir, filename);
    writeFileSync(filePath, buffer);

    const fileInfo: Record<string, string> = {};
    if (args.caption) fileInfo.caption = args.caption;
    if (args.alternativeText) fileInfo.alternativeText = args.alternativeText;

    let uploaded: { id: number; name: string; url: string; mime: string; size: number } | undefined;
    try {
      [uploaded] = await strapi.plugin('upload').service('upload').upload({
        data: { fileInfo },
        files: {
          filepath: filePath,
          originalFilename: filename,
          mimetype: response.headers.get('content-type') || 'application/octet-stream',
          size: buffer.length,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!uploaded) return errorResult('The upload service returned no file.');

    const file = { id: uploaded.id, name: uploaded.name, url: uploaded.url, mime: uploaded.mime, size: uploaded.size };
    return okResult({
      file,
      usage: `Attach it with create_content or update_content: { "<mediaField>": ${file.id} }`,
    });
  },
});
