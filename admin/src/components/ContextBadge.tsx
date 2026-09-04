import { useEffect, useState } from 'react';
import { Badge, Flex, Tooltip, Typography } from '@strapi/design-system';
import {
  fetchContextInfo,
  fetchModelInfo,
  type ContextInfo,
  type ModelInfo,
} from '../utils/context-api';

/**
 * How much of the model's context window this conversation is using.
 *
 * Ported from the reference plugin's `ContextBadge`, whose header explains why
 * it earns its space: the plugin sends a system prompt and every tool's schema
 * before the user's question, which on a real install measured close to 7,000
 * tokens. When the served window is smaller than that, the model does not
 * error — it hangs, or answers while ignoring its tools, and the obvious
 * conclusion is that tool calling is broken. Showing the number turns an
 * afternoon of guessing into a glance.
 *
 * `used` is the running estimate for the conversation so far. Before the first
 * message there is nothing to add, so the badge shows the preamble — the floor
 * every request starts from.
 */

interface ContextBadgeProps {
  /** Estimated tokens in the transcript so far, on top of the preamble. */
  conversationTokens: number;
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  // Whole thousands past 10k: "12k" reads faster than "12.3k" at a glance.
  const decimals = n >= 10_000 ? 0 : 1;
  return `${(n / 1000).toFixed(decimals)}k`;
}

function toneFor(share: number): { bg: string; fg: string } {
  if (share >= 0.9) return { bg: 'danger100', fg: 'danger700' };
  if (share >= 0.6) return { bg: 'warning100', fg: 'warning700' };
  return { bg: 'neutral150', fg: 'neutral700' };
}

export function ContextBadge({ conversationTokens }: ContextBadgeProps) {
  const [info, setInfo] = useState<ContextInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const value = await fetchContextInfo();
      if (!cancelled) setInfo(value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const used = info.preambleTokens + conversationTokens;
  const window = info.contextWindow;
  const share = window ? used / window : null;
  const tone = share === null ? { bg: 'neutral150', fg: 'neutral700' } : toneFor(share);
  const label = window ? `${compact(used)} / ${compact(window)}` : `${compact(used)} tokens`;

  const source = info.windowSource === 'known-model' ? 'a published figure' : info.windowSource;
  const lines = [
    `Instructions and ${info.toolCount} tool definitions cost about ${info.preambleTokens} tokens before your message.`,
    conversationTokens > 0
      ? `This conversation adds roughly ${conversationTokens}.`
      : 'Nothing sent yet this conversation.',
    window
      ? `The model is serving a ${window}-token window (${source}).`
      : 'The context window could not be detected for this provider.',
    window && info.trainedContext && info.trainedContext > window
      ? `The weights support ${info.trainedContext}.`
      : '',
    'All counts are estimates.',
  ].filter(Boolean);

  return (
    <Flex gap={2} alignItems="center" tag="span">
      {/*
        The <span> is not decoration. Strapi's Tooltip clones its child and
        hands it a ref; Badge and Typography are function components that do
        not forward one, so React logs "Function components cannot be given
        refs" and the tooltip silently loses its anchor. A DOM element takes
        the ref.
      */}
      <Tooltip label={lines.join(' ')}>
        <span>
          <Badge backgroundColor={tone.bg} textColor={tone.fg}>
            {label}
          </Badge>
        </span>
      </Tooltip>

      {info.warning && (
        <Tooltip label={info.warning}>
          <span>
            <Badge backgroundColor="danger100" textColor="danger700">
              Context tight
            </Badge>
          </span>
        </Tooltip>
      )}
    </Flex>
  );
}

/**
 * What the server says it is configured to use.
 *
 * Fetched once by the panel and passed down, rather than fetched inside each
 * badge: two components asking the same endpoint on mount is two requests for
 * one answer.
 */
export function useModelInfo(): ModelInfo | null {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const value = await fetchModelInfo();
      if (!cancelled) setInfo(value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return info;
}

/** Which model answered. */
export function ModelBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return <Badge>{name}</Badge>;
}

/**
 * Whether inference stayed on your infrastructure.
 *
 * Computed from the host, never claimed: "local" means the baseURL resolves to
 * a loopback or private address, which is the only form of that claim that can
 * be checked.
 */
export function LocalMarker({ isLocal }: { isLocal: boolean }) {
  if (!isLocal) return null;
  return (
    <Tooltip label="This model is served from a loopback or private address, so inference stays on your infrastructure.">
      <span>
        <Typography variant="pi" textColor="success600">
          local
        </Typography>
      </span>
    </Tooltip>
  );
}
