import { forwardRef, useState, useRef, useEffect, type ComponentProps } from 'react';
import { Box, Typography } from '@strapi/design-system';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkle } from '@strapi/icons';
import {
  messageText,
  messageReasoningText,
  messageToolCalls,
  type Message,
} from '../hooks/chat-messages';
import { ToolCallDisplay, HIDDEN_TOOLS } from './ToolCallDisplay';
import { autoLinkContentTypeUids } from '../lib/auto-link';

/**
 * The transcript.
 *
 * Ported from the reference plugin's `MessageList`, which is where the answers
 * to the fiddly questions already live: markdown has to be RENDERED (models
 * answer in it whether or not you ask), a turn that is thinking needs to say so
 * or the panel reads as hung, and a tool-only turn with no text needs an
 * explanation rather than an empty bubble.
 *
 * Colours come from the Strapi theme rather than the reference's literal hexes.
 * Same look in light mode, and the panel stays readable in dark mode, where
 * `#ffffff` bubbles would not.
 */

const MessagesArea = styled.div`
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const MessageRow = styled.div<{ $isUser: boolean }>`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  align-self: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
  max-width: 80%;
`;

const SparkleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary600};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  svg {
    width: 16px;
    height: 16px;
    fill: ${({ theme }) => theme.colors.neutral0};
  }
`;

const EmptyReplyNote = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.neutral600};
  font-style: italic;
  line-height: 1.5;

  code {
    font-style: normal;
    background: ${({ theme }) => theme.colors.neutral150};
    padding: 1px 4px;
    border-radius: 3px;
  }
`;

const MessageBubble = styled.div<{ $isUser: boolean }>`
  min-width: 0;
  background-color: ${({ $isUser, theme }) =>
    $isUser ? theme.colors.primary600 : theme.colors.neutral100};
  color: ${({ $isUser, theme }) => ($isUser ? theme.colors.neutral0 : theme.colors.neutral800)};
  border-radius: ${({ $isUser }) => ($isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px')};
  padding: 12px 16px;
  font-size: 15px;
  word-break: break-word;
  line-height: 1.6;
`;

const MarkdownBody = styled.div`
  p { margin: 0 0 8px; &:last-child { margin-bottom: 0; } }
  ul, ol { margin: 4px 0; padding-left: 20px; }
  li { margin: 2px 0; }
  code {
    font-size: 0.85em;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.06);
  }
  pre {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.85em;
    background: rgba(0, 0, 0, 0.04);
    code { padding: 0; background: none; }
  }
  h1, h2, h3, h4 { margin: 12px 0 4px; &:first-child { margin-top: 0; } }
  h1 { font-size: 1.3em; } h2 { font-size: 1.15em; } h3 { font-size: 1.05em; }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid ${({ theme }) => theme.colors.neutral300};
    opacity: 0.85;
  }
  a { color: ${({ theme }) => theme.colors.primary600}; }
  table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 0.9em;
    width: 100%;
    overflow-x: auto;
    display: block;
  }
  th, td {
    border: 1px solid ${({ theme }) => theme.colors.neutral300};
    padding: 4px 8px;
    text-align: left;
    white-space: nowrap;
  }
  th { background: rgba(0, 0, 0, 0.03); font-weight: 600; }
`;

const MessageRole = styled.div<{ $isUser: boolean }>`
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
  opacity: 0.7;
  color: ${({ $isUser, theme }) => ($isUser ? theme.colors.neutral0 : theme.colors.neutral600)};
`;

const TypingDots = styled.span`
  display: inline-flex;
  gap: 4px;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.neutral400};
    animation: bounce 1.4s infinite ease-in-out both;
  }
  span:nth-child(1) { animation-delay: 0s; }
  span:nth-child(2) { animation-delay: 0.2s; }
  span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    span { animation: none; opacity: 0.6; }
  }
`;

const ThinkingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
`;

const ThinkingSpinner = styled.span`
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid ${({ theme }) => theme.colors.neutral300};
  border-top-color: ${({ theme }) => theme.colors.primary600};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const ReasoningToggle = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral500};

  &:hover { color: ${({ theme }) => theme.colors.neutral600}; }

  &::before {
    content: '';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid ${({ $open }) => ($open ? 'transparent' : 'currentColor')};
    border-top: 5px solid ${({ $open }) => ($open ? 'currentColor' : 'transparent')};
    border-right: 5px solid transparent;
    border-bottom: 5px solid transparent;
  }
`;

const ReasoningBox = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.neutral600};
  background: rgba(0, 0, 0, 0.02);
  border-left: 2px solid ${({ theme }) => theme.colors.neutral300};
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 0 4px 4px 0;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ReasoningStreamDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary600};
  animation: pulse 1s ease-in-out infinite;
  margin-left: 4px;
  vertical-align: middle;

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: ${({ theme }) => theme.colors.neutral400};
`;

function isInternalPath(href: string): boolean {
  return href.startsWith('/content-manager/');
}

/**
 * Admin-internal links route in place; everything else opens in a new tab.
 *
 * A plain <a> to /content-manager would reload the whole admin SPA and lose the
 * conversation.
 */
function MarkdownLink({ href, children, ...props }: ComponentProps<'a'>) {
  if (href && isInternalPath(href)) {
    return (
      <Link to={href} {...(props as Record<string, unknown>)}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

const markdownComponents = {
  a: MarkdownLink,
} as ComponentProps<typeof Markdown>['components'];

function ReasoningDisplay({ text, isStreaming }: Readonly<{ text: string; isStreaming: boolean }>) {
  const [open, setOpen] = useState(isStreaming);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  // Keep the newest reasoning in view while it streams.
  useEffect(() => {
    if (isStreaming && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  });

  if (!text) return null;

  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;

  return (
    <>
      <ReasoningToggle type="button" $open={open} onClick={() => setOpen((v) => !v)}>
        {isStreaming ? (
          <>
            Thinking
            <ReasoningStreamDot />
          </>
        ) : (
          <>Thought for a moment</>
        )}
        {!open && <span style={{ opacity: 0.6 }}> — {preview}</span>}
      </ReasoningToggle>
      {open && <ReasoningBox ref={boxRef}>{text}</ReasoningBox>}
    </>
  );
}

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(function MessageList(
  { messages, isLoading },
  ref,
) {
  return (
    <MessagesArea>
      {messages.length === 0 && (
        <EmptyState>
          <Typography variant="beta" textColor="neutral400">
            TanStack AI
          </Typography>
          <Box paddingTop={2}>
            <Typography variant="omega" textColor="neutral500">
              Ask about your content types, search across all of them, or count what&apos;s there.
            </Typography>
          </Box>
        </EmptyState>
      )}

      {messages.map((message, index) => {
        const text = messageText(message);
        const reasoning = messageReasoningText(message);
        const toolCalls = messageToolCalls(message);

        const isAssistant = message.role === 'assistant';
        const isLastMessage = index === messages.length - 1;

        // TanStack's thinking parts carry no `state`, unlike the AI SDK's
        // reasoning parts, so "still streaming" is derived from position: the
        // last turn, still loading, with no answer text yet.
        const isReasoningStreaming = isLoading && isLastMessage && !text;

        const displayContent = isAssistant && text ? autoLinkContentTypeUids(text) : text;
        const hasToolsRunning = toolCalls.some((call) => call.output === undefined);
        const showThinking = isLoading && isLastMessage && isAssistant && !!displayContent && hasToolsRunning;

        return (
          // `data-message-role` is a test hook: it lets a browser test assert
          // on the ASSISTANT's rendered output specifically. Without it, a
          // check for "no literal ** in the transcript" also reads the user's
          // own prompt, and passes or fails on the wrong turn.
          <MessageRow
            key={message.id ?? index}
            data-message-role={message.role}
            $isUser={message.role === 'user'}
          >
            {isAssistant && (
              <SparkleIcon>
                <Sparkle />
              </SparkleIcon>
            )}
            <MessageBubble $isUser={message.role === 'user'}>
              <MessageRole $isUser={message.role === 'user'}>
                {message.role === 'user' ? 'You' : 'Assistant'}
              </MessageRole>
              {message.role === 'user' && text}
              {isAssistant && reasoning && (
                <ReasoningDisplay text={reasoning} isStreaming={isReasoningStreaming} />
              )}
              {isAssistant && !displayContent && !reasoning && isLoading && (
                <TypingDots aria-label="Assistant is replying">
                  <span />
                  <span />
                  <span />
                </TypingDots>
              )}
              {isAssistant && displayContent && (
                // `data-message-part` is the second test hook: the assertion
                // "the answer contains no literal **" has to read the RENDERED
                // answer only. The reasoning box beside it shows the model's
                // raw thinking, which legitimately quotes markdown syntax.
                <MarkdownBody data-message-part="text">
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {displayContent}
                  </Markdown>
                </MarkdownBody>
              )}
              {/*
                A finished assistant turn with tool calls but no text. The model
                used its tools and stopped without writing a reply, usually by
                exhausting its step budget mid-loop. Rendering nothing leaves an
                empty bubble and no way to tell that from a silent failure.
              */}
              {isAssistant && !displayContent && !isLoading && toolCalls.length > 0 && (
                <EmptyReplyNote>
                  The model used its tools but stopped without writing a reply. It likely hit the
                  step limit; raising <code>maxSteps</code> usually resolves it.
                </EmptyReplyNote>
              )}
              {toolCalls
                .filter((call) => !HIDDEN_TOOLS.has(call.toolName))
                .map((call, callIndex) => (
                  <ToolCallDisplay key={call.toolCallId || callIndex} toolCall={call} />
                ))}
              {showThinking && (
                <ThinkingIndicator>
                  <ThinkingSpinner />
                  Working on it…
                </ThinkingIndicator>
              )}
            </MessageBubble>
          </MessageRow>
        );
      })}

      <div ref={ref} />
    </MessagesArea>
  );
});
