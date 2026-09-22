import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, Loader, Main, Typography } from '@strapi/design-system';
import { PLUGIN_ID } from '../pluginId';
import { backendURL } from '../utils/auth';
import styled from 'styled-components';

/**
 * LAZY, which is the client half of the plugin's ESM seam.
 *
 * `@tanstack/ai-react` is an optional peer dependency. A static import here
 * would put it in the admin bundle for every install, including hosts told
 * they only needed the MCP tools — so the module lands in its own chunk and is
 * only fetched when someone opens this page.
 *
 * Fetched only once the server says chat can run, so a host missing the
 * optional packages never requests the chunk that needs them.
 */
const ChatPanel = lazy(() => import('../components/ChatPanel'));

/**
 * A full-height column: heading at its natural size, chat taking the rest.
 *
 * The chat used to size itself with `calc(100vh - 320px)`, a guess at the
 * heading's height that left a dead strip under the composer — and one that
 * would drift with any change of zoom, font size or heading length. Measuring
 * nothing and letting flex do it is both simpler and correct at every size.
 */
const Page = styled(Main)`
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
`;

const Header = styled(Box)`
  flex-shrink: 0;
`;

/* min-height: 0 so the chat can scroll internally instead of overflowing. */
const Body = styled(Box)`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

interface ChatStatus {
  enabled: boolean;
  ready: boolean;
  reason?: string;
}

/**
 * Whether chat can run, from the server.
 *
 * The menu link is always registered (see admin/src/index.ts), so THIS is
 * where "chat is off" or "chat has no API key" is handled: a notice naming the
 * setting, instead of a chat that fails on the first message. The endpoint is
 * unauthenticated and carries no credential values.
 */
function useChatStatus(): ChatStatus | 'loading' | 'unreachable' {
  const [status, setStatus] = useState<ChatStatus | 'loading' | 'unreachable'>('loading');
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const res = await fetch(`${backendURL()}/${PLUGIN_ID}/config`);
        if (!res.ok) throw new Error(String(res.status));
        const { chat } = (await res.json()) as { chat?: ChatStatus };
        // A 1.2.x server answers { enabled } only; treat that as ready-when-on.
        if (live) setStatus(chat ? { ...chat, ready: chat.ready ?? chat.enabled === true } : 'unreachable');
      } catch {
        if (live) setStatus('unreachable');
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, []);
  return status;
}

function SetupNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={8}>
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
      <Box paddingTop={3}>
        <Typography textColor="neutral600">{children}</Typography>
      </Box>
    </Box>
  );
}

function ChatOrNotice() {
  const status = useChatStatus();
  if (status === 'loading') return <Loader small>Checking chat…</Loader>;
  if (status === 'unreachable') {
    return (
      <SetupNotice title="Chat is unavailable">
        The server did not answer the chat status check. Check that the TanStack AI plugin is
        installed on the server, then reload.
      </SetupNotice>
    );
  }
  if (!status.ready) {
    return (
      <SetupNotice title={status.enabled ? 'Chat needs one more setting' : 'Chat is turned off'}>
        {status.reason} Restart Strapi after changing the config. The MCP tools work either way.
      </SetupNotice>
    );
  }
  return (
    <Suspense fallback={<Loader small>Loading chat…</Loader>}>
      <ChatPanel />
    </Suspense>
  );
}

export function HomePage() {
  return (
    <Page>
      <Header paddingLeft={8} paddingRight={8} paddingTop={8} paddingBottom={4}>
        <Typography variant="alpha" tag="h1">
          TanStack AI
        </Typography>
        <Box paddingTop={2}>
          <Typography textColor="neutral600">
            Ask about this instance&apos;s content. The model can list your content types, search
            across all of them and count what&apos;s there — the same tools this plugin publishes
            over MCP.
          </Typography>
        </Box>
      </Header>

      <Body paddingLeft={8} paddingRight={8} paddingBottom={8}>
        <ChatOrNotice />
      </Body>
    </Page>
  );
}

export default HomePage;
