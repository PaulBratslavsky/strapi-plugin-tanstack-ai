import { useEffect, useMemo, useRef, useState } from 'react';
import * as tanstackAiReact from '@tanstack/ai-react';
import { Box, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { PLUGIN_ID } from '../pluginId';
import { authHeaders, backendURL } from '../utils/auth';
import { messageReasoningText, messageText, type Message } from '../hooks/chat-messages';
import { useConversations } from '../hooks/useConversations';
import { useMemories } from '../hooks/useMemories';
import { useNotes } from '../hooks/useNotes';
import { useToolSources } from '../hooks/useToolSources';
import { ConversationSidebar } from './ConversationSidebar';
import { MemoryPanel } from './MemoryPanel';
import { NotePanel } from './NotePanel';
import { ToolSourcePicker } from './ToolSourcePicker';
import { ContextBadge, LocalMarker, ModelBadge, useModelInfo } from './ContextBadge';
import {
  HistoryIcon,
  MemoryIcon,
  NewChatIcon,
  NoteIcon,
  TopBarIcon,
} from './TopBarIcon';
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
  /*
   * Fills whatever the page has left, rather than a calc() against 100vh.
   *
   * The old value subtracted a hardcoded 320px — a guess at the height of the
   * heading above it, and a wrong one, hence the dead strip under the
   * composer. It would have been wrong again at any other zoom level, font
   * size or heading length. The page is a flex column now, so this just takes
   * the remainder.
   *
   * min-height: 0 is the part that is easy to omit and breaks it: a flex child
   * defaults to min-height auto, which refuses to shrink below its content, so
   * the transcript would push the composer off the bottom instead of
   * scrolling.
   */
  flex: 1;
  min-height: 0;
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
 * Pushes what follows to the right-hand end of the bar.
 *
 * This used to hold a sentence explaining what to ask. The transcript's empty
 * state says the same thing with more room, and in the bar it crowded the
 * controls — so the space it was taking is all that remains of it.
 */
const TopBarSpacer = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;


export function ChatPanel() {
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const modelInfo = useModelInfo();
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
    editMemory,
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
    if (!isLoading && wasLoadingRef.current && messages.length > 0) {
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

  /*
   * One line for whatever went wrong. A streaming error wins: it is about the
   * turn the user is watching, where the others are about a side panel.
   */
  /*
   * What the transcript adds on top of the preamble.
   *
   * Estimated the same way the server estimates the preamble — four characters
   * per token — so the two halves of the badge are at least consistent with
   * each other. Reasoning text counts: it was generated, and on a local model
   * it is often most of the turn.
   */
  const conversationTokens = useMemo(() => {
    const text = (messages as unknown as Message[])
      .map((message) => messageText(message) + messageReasoningText(message))
      .join('');
    return Math.ceil(text.length / 4);
  }, [messages]);

  const streamDetail = error instanceof Error ? error.message : String(error);
  const streamError = error ? `Error: ${streamDetail}` : null;
  const problem = streamError ?? historyError ?? memoryError ?? noteError ?? sourceError;

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
          <TopBarIcon
            label={sidebarOpen ? 'Hide history' : 'History'}
            active={sidebarOpen}
            expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <HistoryIcon />
          </TopBarIcon>
          <ToolSourcePicker sources={sources} enabled={enabledSources} onToggle={toggleSource} />
          {/* Model, then what it is costing, then where it runs. */}
          <ModelBadge name={model ?? modelInfo?.model ?? null} />
          <ContextBadge conversationTokens={conversationTokens} />
          <LocalMarker isLocal={modelInfo?.isLocal ?? false} />
          <TopBarSpacer />
          <TopBarIcon
            label={`Memories (${memories.length})`}
            active={memoryPanelOpen}
            expanded={memoryPanelOpen}
            onClick={() => setMemoryPanelOpen((open) => !open)}
          >
            <MemoryIcon />
          </TopBarIcon>
          <TopBarIcon
            label={`Notes (${notes.length})`}
            active={notePanelOpen}
            expanded={notePanelOpen}
            onClick={() => setNotePanelOpen((open) => !open)}
          >
            <NoteIcon />
          </TopBarIcon>
          {/*
          "New chat" rather than "Clear": the transcript is persisted now, so
          emptying the panel starts a new conversation instead of destroying
          the current one. Clearing only the view would silently detach it from
          the row it had been saving to, and the next reply would append to a
          conversation the user believed they had discarded.
        */}
          <TopBarIcon
            label="New chat"
            disabled={messages.length === 0 || isLoading}
            onClick={() => {
              startNewConversation();
              clear();
            }}
          >
            <NewChatIcon />
          </TopBarIcon>
        </ChatTopBar>

        <MessageList
          ref={messagesEndRef}
          messages={messages as unknown as Message[]}
          isLoading={isLoading}
        />

        {problem && (
          <Box padding={3} background="danger100" marginLeft={4} marginRight={4}>
            <Typography textColor="danger600">{problem}</Typography>
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
        onEdit={editMemory}
        onDelete={removeMemory}
      />
      <NotePanel notes={notes} open={notePanelOpen} onEdit={editNote} onDelete={removeNote} />
    </ChatLayout>
  );
}

export default ChatPanel;
