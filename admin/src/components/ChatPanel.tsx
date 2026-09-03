import { useEffect, useRef, useState } from 'react';
import * as tanstackAiReact from '@tanstack/ai-react';
import { Badge, Box, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from '../utils/auth';
import type { Message } from '../hooks/chat-messages';
import { useConversations } from '../hooks/useConversations';
import { useMemories } from '../hooks/useMemories';
import { useNotes } from '../hooks/useNotes';
import { useToolSources } from '../hooks/useToolSources';
import { ConversationSidebar } from './ConversationSidebar';
import { MemoryPanel } from './MemoryPanel';
import { NotePanel } from './NotePanel';
import { ToolSourcePicker } from './ToolSourcePicker';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

/**
 * A NAMESPACE import, not `import { useChat } from …`, and that is load-bearing.
 *
 * `@tanstack/ai-react` is an OPTIONAL peer dependency, so a host that installed
 * this plugin for the MCP tools alone does not have it. Strapi's admin build
 * substitutes Vite's optional-peer stub for the missing package — `export
 * default {}` in production, a module that throws in dev — and NEITHER exports
 * anything named. A named import therefore fails at ROLLUP time with
 * `"useChat" is not exported by __vite-optional-peer-dep:@tanstack/ai-react`,
 * which breaks the HOST's admin build, not ours. A tools-only install could not
 * build its admin panel at all.
 *
 * A namespace import binds nothing statically, so it resolves against either
 * stub, and resolves to the real module when the package is installed. The
 * chunk is lazy, so this file is only evaluated when someone opens the chat —
 * which requires chat to be enabled, which requires the package to be there.
 */
const { useChat, fetchServerSentEvents } = tanstackAiReact;

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
  flex-direction: row;
  height: calc(100vh - 320px);
  min-height: 400px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadows.tableShadow};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const ChatColumn = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const ChatTopBar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
  gap: 8px;
`;

/**
 * The hint gives up its space before the controls do.
 *
 * With the sidebar and both panels open, the chat column is narrow enough that
 * flex would otherwise wrap this sentence into a four-line column and shove
 * the buttons around. It truncates instead — the controls are what the bar is
 * for.
 */
const TopBarHint = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  // Reported by the stream itself rather than fetched separately: the answer
  // knows which model produced it, so there is no second source to fall out of
  // step with the first.
  const [model, setModel] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Tracks the streaming edge so the transcript is saved once, when a turn
  // ENDS — not on every token, which would be a write per frame.
  const wasLoadingRef = useRef(false);

  const {
    conversations,
    activeId,
    initialMessages,
    error: historyError,
    selectConversation,
    startNewConversation,
    saveMessages,
    removeConversation,
  } = useConversations();

  const {
    memories,
    error: memoryError,
    addMemory,
    removeMemory,
    refresh: refreshMemories,
  } = useMemories();

  const { notes, error: noteError, editNote, removeNote, refresh: refreshNotes } = useNotes();

  const {
    sources,
    enabled: enabledSources,
    enabledToolSources,
    toggle: toggleSource,
    error: sourceError,
  } = useToolSources();

  const { messages, setMessages, sendMessage, isLoading, error, stop, clear } = useChat({
    // Sent with every request so the server can filter contributed tools to
    // the sources this admin has switched on. Undefined until the sources have
    // loaded — which the server reads as "not stated" and answers with all of
    // them, rather than as "none".
    ...(enabledToolSources ? { forwardedProps: { enabledToolSources } } : {}),
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

  /**
   * Seed the transcript when a conversation is opened.
   *
   * Done through `setMessages` in an effect rather than an initial-value
   * option, because history arrives ASYNCHRONOUSLY: the first render has none
   * and the fetch resolves later. An option read once at construction would
   * never adopt it — the reference plugin hit exactly this, and the symptom is
   * a panel that renders the right NUMBER of bubbles with nothing in them.
   *
   * Keyed on `activeId` so switching conversations replaces the transcript,
   * and starting a new one clears it.
   */
  useEffect(() => {
    setMessages(initialMessages as never);
  }, [activeId, initialMessages, setMessages]);

  // Save when a turn finishes: isLoading true -> false.
  //
  // Memories are refreshed on the same edge, because the MODEL writes them
  // mid-turn via `save_memory`. Nothing on the client can know a new one
  // exists until it asks, so without this the panel only catches up on a
  // reload — and a user watching it would conclude the tool had not run.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && messages.length > 0) {
      void saveMessages(messages as unknown as Message[]);
      void refreshMemories();
      void refreshNotes();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, messages, saveMessages, refreshMemories, refreshNotes]);

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
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={selectConversation}
        onNew={() => {
          startNewConversation();
          clear();
        }}
        onDelete={removeConversation}
      />
      <ChatColumn>
        <ChatTopBar>
          <TopBarButton
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? 'Hide history' : 'History'}
          </TopBarButton>
          {model ? (
            <Badge>{model}</Badge>
          ) : null}
          <ToolSourcePicker sources={sources} enabled={enabledSources} onToggle={toggleSource} />
          <TopBarHint>
            {!model && (
              <Typography variant="pi" textColor="neutral600">
                Ask about your content types or search across all of them.
              </Typography>
            )}
          </TopBarHint>
          <TopBarButton
            type="button"
            onClick={() => setMemoryPanelOpen((open) => !open)}
            aria-expanded={memoryPanelOpen}
          >
            Memories ({memories.length})
          </TopBarButton>
          <TopBarButton
            type="button"
            onClick={() => setNotePanelOpen((open) => !open)}
            aria-expanded={notePanelOpen}
          >
            Notes ({notes.length})
          </TopBarButton>
          {/*
          "New chat" rather than "Clear": the transcript is persisted now, so
          emptying the panel starts a new conversation instead of destroying
          the current one. Clearing only the view would silently detach it from
          the row it had been saving to, and the next reply would append to a
          conversation the user believed they had discarded.
        */}
          <TopBarButton
            type="button"
            onClick={() => {
              startNewConversation();
              clear();
            }}
            disabled={messages.length === 0 || isLoading}
          >
            New chat
          </TopBarButton>
        </ChatTopBar>

        <MessageList
          ref={messagesEndRef}
          messages={messages as unknown as Message[]}
          isLoading={isLoading}
        />

        {(error || historyError || memoryError || noteError || sourceError) && (
          <Box padding={3} background="danger100" marginLeft={4} marginRight={4}>
            <Typography textColor="danger600">
              {error
                ? `Error: ${error instanceof Error ? error.message : String(error)}`
                : (historyError ?? memoryError ?? noteError ?? sourceError)}
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
      </ChatColumn>
      <MemoryPanel
        memories={memories}
        open={memoryPanelOpen}
        onAdd={addMemory}
        onDelete={removeMemory}
      />
      <NotePanel notes={notes} open={notePanelOpen} onEdit={editNote} onDelete={removeNote} />
    </ChatLayout>
  );
}

export default ChatPanel;
