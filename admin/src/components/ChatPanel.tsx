import { useEffect, useRef, useState } from 'react';
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react';
import { Badge, Box, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from '../utils/auth';
import type { Message } from '../hooks/chat-messages';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

/**
 * The chat shell — layout, transport, and the three pieces below it.
 *
 * Ported from the reference plugin's `Chat.tsx`, minus the surfaces this plugin
 * does not have (conversation sidebar, memories, notes, tool-source picker).
 * What carries over is the structure: this component owns the SDK state and
 * nothing else, `MessageList` renders the transcript, `ChatInput` composes.
 *
 * THIS MODULE IS LAZY-LOADED, and that is the client half of the plugin's ESM
 * seam. `@tanstack/ai-react`, react-markdown and remark-gfm are all optional
 * peers, so an install with chat off must never evaluate this file — the page
 * reaches it through React.lazy(), and the menu link that leads there is only
 * registered when the server says chat is on.
 */

const ChatLayout = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 320px);
  min-height: 400px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadows.tableShadow};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const ChatTopBar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
  gap: 8px;
`;

const TopBarButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  color: ${({ theme }) => theme.colors.neutral600};
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.neutral100};
    color: ${({ theme }) => theme.colors.primary600};
    border-color: ${({ theme }) => theme.colors.primary600};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export function ChatPanel() {
  const [input, setInput] = useState('');
  // Reported by the stream itself rather than fetched separately: the answer
  // knows which model produced it, so there is no second source to fall out of
  // step with the first.
  const [model, setModel] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({
    connection: fetchServerSentEvents(`${backendURL()}/${PLUGIN_ID}/chat`, () => ({
      // Resolved per request, not captured once: a token refreshed mid-session
      // would otherwise leave this panel authenticating with a stale one.
      headers: authHeaders(),
    })),
    onFinish: (message) => {
      const reported = (message as { metadata?: { tanstack?: { model?: string } } }).metadata
        ?.tanstack?.model;
      if (reported) setModel(reported);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage(text);
  };

  return (
    <ChatLayout>
      <ChatTopBar>
        {model ? (
          <Badge>{model}</Badge>
        ) : (
          <Typography variant="pi" textColor="neutral600">
            Ask about your content types or search across all of them.
          </Typography>
        )}
        <div style={{ flex: 1 }} />
        <TopBarButton
          type="button"
          onClick={() => clear()}
          disabled={messages.length === 0 || isLoading}
        >
          Clear
        </TopBarButton>
      </ChatTopBar>

      <MessageList
        ref={messagesEndRef}
        messages={messages as unknown as Message[]}
        isLoading={isLoading}
      />

      {error && (
        <Box padding={3} background="danger100" marginLeft={4} marginRight={4}>
          <Typography textColor="danger600">
            Error: {error instanceof Error ? error.message : String(error)}
          </Typography>
        </Box>
      )}

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSend={handleSend}
        onStop={() => stop()}
      />
    </ChatLayout>
  );
}

export default ChatPanel;
