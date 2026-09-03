import { lazy, Suspense, useEffect, useState } from 'react';
import { Box, Flex, Loader, Main, Typography } from '@strapi/design-system';
import { PLUGIN_ID } from '../pluginId';

/**
 * LAZY, and behind the config check. This is the client half of the ESM seam.
 *
 * `@tanstack/ai-react` is an optional peer dependency. A static import here
 * would put it in the admin bundle for every install, including the ones that
 * were told they only needed the plugin for its MCP tools — so the module is
 * only evaluated once the server has said chat is on.
 */
const ChatPanel = lazy(() => import('../components/ChatPanel'));

type ChatConfig = { enabled: boolean; provider: string; model: string };

export function HomePage() {
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const token = JSON.parse(
      sessionStorage.getItem('jwtToken') ?? localStorage.getItem('jwtToken') ?? '""',
    );
    fetch(`/${PLUGIN_ID}/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`config: HTTP ${r.status}`))))
      .then((d: { chat: ChatConfig }) => setConfig(d.chat))
      .catch((e: Error) => setFailed(e.message));
  }, []);

  return (
    <Main>
      <Box padding={8}>
        <Typography variant="alpha" tag="h1">
          TanStack AI
        </Typography>

        <Box paddingTop={2} paddingBottom={6}>
          <Typography textColor="neutral600">
            This plugin contributes cross-type content tools to Strapi&apos;s MCP server. Those
            tools are always on. Chat is separate, and optional.
          </Typography>
        </Box>

        {failed && <Typography textColor="danger600">Could not read plugin config: {failed}</Typography>}

        {!config && !failed && <Loader small>Loading…</Loader>}

        {config && !config.enabled && (
          <Box background="neutral100" padding={4} hasRadius>
            <Typography fontWeight="bold">Chat is off.</Typography>
            <Box paddingTop={2}>
              <Typography textColor="neutral600">
                Your MCP tools are still registered and working — chat is a separate opt-in,
                because turning it on is what makes the plugin need the TanStack AI SDK. Enable
                it in <code>config/plugins.ts</code>:
              </Typography>
            </Box>
            <Box paddingTop={2}>
              <Typography variant="pi" tag="pre" style={{ whiteSpace: 'pre-wrap' }}>
{`'tanstack-ai': {
  config: {
    chat: { enabled: true, provider: 'ollama', model: 'qwen3:14b', baseURL: 'http://localhost:11434' },
  },
}`}
              </Typography>
            </Box>
            <Box paddingTop={2}>
              <Typography variant="pi" textColor="neutral600">
                Then install the SDK for the provider you chose — it is an optional peer
                dependency, so it is not pulled in unless you ask for it.
              </Typography>
            </Box>
          </Box>
        )}

        {config?.enabled && (
          <Suspense fallback={<Loader small>Loading chat…</Loader>}>
            <ChatPanel model={config.model} />
          </Suspense>
        )}
      </Box>
    </Main>
  );
}

export default HomePage;
