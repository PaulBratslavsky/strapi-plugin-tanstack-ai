import { useState } from 'react';
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react';
import { Box, Button, Flex, TextInput, Typography, Loader } from '@strapi/design-system';
import { PLUGIN_ID } from '../pluginId';

/**
 * The in-admin chat.
 *
 * THIS MODULE IS LAZY-LOADED, and that is the client half of the plugin's ESM
 * seam. `@tanstack/ai-react` is an optional peer dependency, so an install
 * with chat off must never evaluate this file — importing it eagerly from the
 * page would pull the SDK into the admin bundle for everyone, including hosts
 * that were told they did not need it. The page imports it through
 * React.lazy(), behind the config check.
 */

type Msg = { id?: string; role: string; parts?: Array<{ type: string; content?: string }> };

/** The visible prose of a message. `parts` is ordered and mixed. */
function textOf(m: Msg): string {
  return (m.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.content ?? '')
    .join('');
}

/** Tool calls, so the panel can show that the model reached for the content. */
function toolsOf(m: Msg): string[] {
  return (m.parts ?? [])
    .filter((p) => p.type === 'tool-call')
    .map((p) => (p as { name?: string }).name ?? 'tool');
}

export function ChatPanel({ model }: Readonly<{ model: string }>) {
  const [input, setInput] = useState('');

  const { messages, sendMessage, isLoading, error } = useChat({
    // Strapi's admin fetch client is not reachable from here, so the session
    // JWT is read the way the admin stores it. Without the header this posts
    // as anonymous and the route rejects it — which looks like the chat being
    // broken rather than unauthenticated.
    connection: fetchServerSentEvents(`/${PLUGIN_ID}/chat`, () => ({
      headers: {
        Authorization: `Bearer ${
          JSON.parse(sessionStorage.getItem('jwtToken') ?? localStorage.getItem('jwtToken') ?? '""')
        }`,
      },
    })),
  });

  const send = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage(text);
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Typography variant="pi" textColor="neutral600">
        Answering with <b>{model}</b>. The model can read this instance's content types and
        search across them.
      </Typography>

      <Box
        background="neutral0"
        padding={4}
        hasRadius
        borderColor="neutral200"
        style={{ minHeight: 240, maxHeight: 480, overflowY: 'auto' }}
      >
        {messages.length === 0 && (
          <Typography textColor="neutral500">
            Ask something about your content — try “what content types exist?” or “search
            everything for Strapi”.
          </Typography>
        )}

        <Flex direction="column" alignItems="stretch" gap={3}>
          {messages.map((m, i) => {
            const tools = toolsOf(m as Msg);
            return (
              <Box key={(m as Msg).id ?? i}>
                <Typography variant="sigma" textColor="neutral600">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </Typography>
                {tools.length > 0 && (
                  <Box paddingTop={1} paddingBottom={1}>
                    <Typography variant="pi" textColor="primary600">
                      called {tools.join(', ')}
                    </Typography>
                  </Box>
                )}
                <Typography style={{ whiteSpace: 'pre-wrap' }}>{textOf(m as Msg)}</Typography>
              </Box>
            );
          })}
          {isLoading && <Loader small>Thinking…</Loader>}
        </Flex>
      </Box>

      {error && (
        <Typography textColor="danger600">
          {error instanceof Error ? error.message : String(error)}
        </Typography>
      )}

      <Flex gap={2}>
        <Box grow={1}>
          <TextInput
            aria-label="Message"
            placeholder="Ask about your content…"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') send();
            }}
            disabled={isLoading}
          />
        </Box>
        <Button onClick={send} disabled={isLoading || input.trim().length === 0}>
          Send
        </Button>
      </Flex>
    </Flex>
  );
}

export default ChatPanel;
