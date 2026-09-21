import { lazy, Suspense } from 'react';
import { Box, Loader, Main, Typography } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * LAZY, which is the client half of the plugin's ESM seam.
 *
 * `@tanstack/ai-react` is an optional peer dependency. A static import here
 * would put it in the admin bundle for every install, including hosts told
 * they only needed the MCP tools — so the module lands in its own chunk and is
 * only fetched when someone opens this page.
 *
 * There is no "chat is disabled" branch any more. The menu link is not
 * registered when chat is off (see admin/src/index.ts), so this page is
 * unreachable in that state and a branch for it would be dead code pretending
 * to be a safeguard.
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
        <Suspense fallback={<Loader small>Loading chat…</Loader>}>
          <ChatPanel />
        </Suspense>
      </Body>
    </Page>
  );
}

export default HomePage;
