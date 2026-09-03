import { lazy, Suspense } from 'react';
import { Box, Loader, Main, Typography } from '@strapi/design-system';

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

export function HomePage() {
  return (
    <Main>
      <Box padding={8}>
        <Typography variant="alpha" tag="h1">
          TanStack AI
        </Typography>
        <Box paddingTop={2} paddingBottom={6}>
          <Typography textColor="neutral600">
            Ask about this instance&apos;s content. The model can list your content types and
            search across all of them — the same tools this plugin publishes over MCP.
          </Typography>
        </Box>

        <Suspense fallback={<Loader small>Loading chat…</Loader>}>
          <ChatPanel />
        </Suspense>
      </Box>
    </Main>
  );
}

export default HomePage;
