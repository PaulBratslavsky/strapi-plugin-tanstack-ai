import { Box, Button, TextInput } from '@strapi/design-system';
import { Sparkle, Cross } from '@strapi/icons';
import styled from 'styled-components';

/**
 * The composer.
 *
 * Ported from the reference plugin's `ChatInput`, with one addition: while a
 * turn is streaming, Send becomes Stop. The reference disables Send and shows a
 * spinner on it, which leaves no way out of a long answer — and a tool-using
 * turn here can run for a while. One control, because a permanently visible
 * Stop is dead weight for the rest of the time.
 */

const InputArea = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
`;

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}

export function ChatInput({ input, isLoading, onInputChange, onSend, onStop }: ChatInputProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <InputArea>
        <Box flex="1">
          <TextInput
            placeholder="Type your message..."
            aria-label="Chat message"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onInputChange(e.target.value)}
          />
        </Box>
        {isLoading ? (
          // type="button": inside the form, a submit would send the draft
          // instead of stopping the run.
          <Button type="button" variant="danger-light" size="L" startIcon={<Cross />} onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()} size="L" startIcon={<Sparkle />}>
            Send
          </Button>
        )}
      </InputArea>
    </form>
  );
}
