import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { ToolCall } from '../hooks/chat-messages';

/**
 * One tool invocation: a collapsible header, and chips linking to whatever the
 * tool touched.
 *
 * Ported from the reference plugin's `ToolCallDisplay`. The chips are the part
 * worth keeping: a search that says "found 3 products" is a dead end, while one
 * that links each row into the Content Manager makes the answer checkable — and
 * checking the model's work is most of what this panel is for.
 */

const CONTENT_MANAGER = '/content-manager/collection-types';

function contentManagerUrl(contentType: string, documentId?: string): string {
  const base = `${CONTENT_MANAGER}/${contentType}`;
  return documentId ? `${base}/${documentId}` : base;
}

interface ContentLink {
  label: string;
  to: string;
}

/** How many rows get a chip before the row would stop being scannable. */
const MAX_CHIPS = 5;

/**
 * Links into the Content Manager for whatever this call returned.
 *
 * Diverges from the reference in one place, because the tools differ: the
 * reference reads `contentType` off the tool INPUT, which works when a search
 * is scoped to one type. `search_content` here can fan out across types, so
 * every result row carries its own `contentType` and the link is built per row.
 */
function extractContentLinks(toolCall: ToolCall): ContentLink[] {
  if (toolCall.output === undefined) return [];
  const output = toolCall.output as Record<string, unknown> | undefined;
  if (!output || typeof output !== 'object') return [];

  if (toolCall.toolName === 'search_content') {
    const results = output.results as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(results)) return [];

    const links: ContentLink[] = [];
    const seen = new Set<string>();
    for (const row of results.slice(0, MAX_CHIPS)) {
      const contentType = row.contentType as string | undefined;
      if (!contentType) continue;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const title =
        (data.title as string) ||
        (data.name as string) ||
        (data.slug as string) ||
        (row.documentId as string) ||
        contentType;
      const to = contentManagerUrl(contentType, row.documentId as string | undefined);
      if (seen.has(to)) continue;
      seen.add(to);
      links.push({ label: String(title), to });
    }
    return links;
  }

  if (toolCall.toolName === 'list_content_types') {
    const types = output.contentTypes as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(types)) return [];
    return types
      .slice(0, MAX_CHIPS)
      .map((type) => type.uid as string | undefined)
      .filter((uid): uid is string => typeof uid === 'string')
      // Only collection types have a Content Manager list view; a single type
      // 404s on this route, so linking one would be a broken chip.
      .filter((uid) => uid.startsWith('api::'))
      .map((uid) => ({ label: uid, to: contentManagerUrl(uid) }));
  }

  return [];
}

const ToolCallBox = styled.div`
  margin-top: 8px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;
`;

const ToolCallHeader = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.neutral150};
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.neutral800};
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
  }
`;

const Spinner = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid ${({ theme }) => theme.colors.neutral300};
  border-top-color: ${({ theme }) => theme.colors.primary600};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: auto;
  flex-shrink: 0;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const ToolCallContent = styled.pre`
  margin: 0;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: 11px;
  line-height: 1.4;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ContentLinksRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px;
  background: ${({ theme }) => theme.colors.neutral100};
  border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

const ContentLinkChip = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral150};
  color: ${({ theme }) => theme.colors.primary600};
  font-size: 11px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
  }
`;

/** Tools whose calls are noise in the transcript. None yet; the hook is the reference's. */
export const HIDDEN_TOOLS = new Set<string>();

export function ToolCallDisplay({ toolCall }: Readonly<{ toolCall: ToolCall }>) {
  const [expanded, setExpanded] = useState(false);
  const links = extractContentLinks(toolCall);
  const running = toolCall.output === undefined && !toolCall.error;

  return (
    <ToolCallBox>
      <ToolCallHeader
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
        <span>Tool: {toolCall.toolName}</span>
        {running ? (
          <Spinner aria-label="running" />
        ) : (
          <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.6 }}>
            {toolCall.error ? 'failed' : 'completed'}
          </span>
        )}
      </ToolCallHeader>
      {links.length > 0 && (
        <ContentLinksRow>
          {links.map((link) => (
            <ContentLinkChip key={link.to} to={link.to}>
              {link.label}
            </ContentLinkChip>
          ))}
        </ContentLinksRow>
      )}
      {expanded && (
        <ToolCallContent>
          {toolCall.error
            ? toolCall.error
            : running
              ? 'Waiting for result...'
              : JSON.stringify(toolCall.output, null, 2)}
        </ToolCallContent>
      )}
    </ToolCallBox>
  );
}
