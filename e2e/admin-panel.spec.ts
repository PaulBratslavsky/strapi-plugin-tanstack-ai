import { test, expect, type Page } from '@playwright/test';

/**
 * The plugin's admin panel, exercised the way a person uses it.
 *
 * WHY THESE EXIST. Every server-side path here was verified with curl and
 * passed, and the panel was still broken: the admin fetched
 * `/strapi-plugin-tanstack-ai/config` while the server registered
 * `/tanstack-ai/config`. curl could not catch it, because typing the URL by
 * hand tests that the route exists — not that the client asks for the right
 * one. Only the built admin bundle knows which id it compiled in.
 */

const EMAIL = process.env.STRAPI_ADMIN_EMAIL ?? 'paul.bratslavsky@strapi.io';
const PASSWORD = process.env.STRAPI_ADMIN_PASSWORD ?? 'Monkey1234!';

/**
 * Fail on errors the PLUGIN caused.
 *
 * Two channels, because they catch different things and one of them used to
 * catch the wrong thing:
 *
 *  - Uncaught exceptions and real console errors.
 *  - Any non-2xx response from a `/tanstack-ai/*` URL. This is the channel
 *    that matters: the two worst bugs this panel shipped were a 404 from a
 *    plugin-id mismatch and a 401 from an auth read that missed a cookie, and
 *    both were invisible to everything except a browser actually loading it.
 *
 * What it deliberately no longer does is treat every "Failed to load resource"
 * console line as a failure. Strapi's own admin boots by calling
 * `/admin/users/me`, taking a 401, and refreshing — normal behaviour that
 * shows up on a reused test session, and the console line carries no URL, so
 * it cannot be told apart from a plugin 401 by text. Watching responses
 * instead distinguishes them exactly, and keeps plugin 401s fatal.
 */
function errorGuard(page: Page): () => void {
  const IGNORE = [
    /favicon/i,
    /permissions policy/i,
    /Download the React DevTools/i,
    /Failed to load resource/i,
  ];
  const hits: string[] = [];
  const record = (t: string) => {
    if (!IGNORE.some((re) => re.test(t))) hits.push(t);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') record(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => record(`pageerror: ${e.message}`));
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/tanstack-ai/')) return;
    if (response.status() >= 400) hits.push(`${response.status()} ${new URL(url).pathname}`);
  });
  return () => expect(hits, `unexpected page errors:\n${hits.join('\n')}`).toEqual([]);
}

/**
 * Open the plugin page from the admin menu.
 *
 * Goes through the LINK rather than navigating to the URL, deliberately: a
 * plugin-id mismatch once made the page reachable by hand and broken in the
 * app, and only the link the admin bundle rendered would have caught it.
 *
 * The session comes from the stored state in `auth.setup.ts` — logging in per
 * test trips Strapi's login rate limiter partway through a run.
 */
async function openPanel(page: Page) {
  await page.goto('/admin');
  await page.getByRole('link', { name: /tanstack ai/i }).click();
  await expect(page.getByRole('heading', { name: 'TanStack AI' })).toBeVisible();
}

/** The composer, which only exists once the lazy SDK chunk has resolved. */
const composerOf = (page: Page) => page.getByRole('textbox', { name: /chat message/i });

/**
 * Send a message and wait for the WHOLE turn to finish.
 *
 * Waits for Stop to appear before waiting for Send to return, and that
 * ordering is the entire point. Send is visible the instant it is clicked —
 * the flip to Stop happens a tick later — so a test that only waits for Send
 * to be visible continues while the answer is still streaming. Downstream that
 * looks like the feature failing: the transcript has not been saved yet, so
 * the conversation is missing from the sidebar and the assertion blames
 * persistence for a race in the test.
 */
/**
 * Create a note through the plugin's API, using the page's own admin session.
 *
 * Runs inside the page so it authenticates exactly as the panel does — same
 * token lookup, same headers — rather than reproducing that in the test and
 * quietly testing a different path.
 */
async function seedNote(page: Page, note: { title: string; content: string }) {
  const status = await page.evaluate(async (payload) => {
    const stored = localStorage.getItem('jwtToken') ?? sessionStorage.getItem('jwtToken');
    let token = stored;
    if (stored) {
      try {
        token = JSON.parse(stored);
      } catch {
        token = stored;
      }
    }
    if (!token) {
      const match = /(?:^|;\s*)jwtToken=([^;]*)/.exec(document.cookie);
      token = match ? decodeURIComponent(match[1]) : null;
    }
    const response = await fetch('/tanstack-ai/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return response.status;
  }, note);
  expect(status, 'seeding a note should succeed').toBe(201);
}

async function sendAndWait(page: Page, text: string) {
  await composerOf(page).fill(text);
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.getByRole('button', { name: /^stop$/i })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({ timeout: 280_000 });
}

test.describe('TanStack AI admin panel', () => {
  test('shows the menu link and opens a working panel', async ({ page }) => {
    // TWO REGRESSIONS LIVE HERE, both invisible to curl:
    //   - a plugin-id mismatch, where the admin fetched
    //     /strapi-plugin-tanstack-ai/config while the server served
    //     /tanstack-ai/config. A hand-typed curl URL tests that the route
    //     exists, not that the client asks for the right one.
    //   - an auth read that only looked at localStorage, missing the cookie
    //     Strapi also uses, producing a 401 on a perfectly valid session.
    const assertClean = errorGuard(page);
    await openPanel(page);

    await expect(page.getByText(/could not read plugin config/i)).toHaveCount(0);
    // The composer only renders once the lazy chunk resolves, so its presence
    // also proves the SDK chunk loads.
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    assertClean();
  });

  test('answers using its own MCP tools', async ({ page }) => {
    test.setTimeout(300_000);
    const assertClean = errorGuard(page);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('What content types exist? Use your tools.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // The user's turn appears immediately.
    await expect(page.getByText('What content types exist? Use your tools.')).toBeVisible();

    // The tool actually firing is the point — an answer alone could be the
    // model reciting its training data, which is what this plugin exists to
    // prevent.
    await expect(page.getByText(/list_content_types/).first()).toBeVisible({ timeout: 280_000 });
    assertClean();
  });

  test('renders markdown as elements, not literal asterisks', async ({ page }) => {
    // The first version printed raw text, so a model's ordinary markdown answer
    // showed literal ** and un-indented numbered lists — which reads as the
    // model formatting badly rather than the panel not rendering.
    test.setTimeout(300_000);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Reply with one bolded word, then a bullet list of two items.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Scoped to the ASSISTANT's turn. An unscoped check reads the whole
    // transcript, including the user's own prompt — which is how the first
    // version of this test failed on text the panel had rendered correctly.
    const answer = page
      .locator('[data-message-role="assistant"]')
      .last()
      .locator('[data-message-part="text"]');
    await expect(answer.locator('strong, li').first()).toBeVisible({ timeout: 280_000 });
    // Scoped to the rendered answer, NOT the whole bubble: the reasoning box
    // shows the model's raw thinking, which quotes markdown syntax verbatim —
    // an earlier version of this assertion failed on exactly that, against a
    // panel that had rendered the answer correctly.
    await expect(answer).not.toContainText('**');
  });

  test('Stop cancels a running answer', async ({ page }) => {
    test.setTimeout(300_000);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Write a long essay about content modelling.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Send becomes Stop while streaming — one control, so there is always a
    // way out of a long answer.
    const stopButton = page.getByRole('button', { name: /^stop$/i });
    await expect(stopButton).toBeVisible({ timeout: 60_000 });
    await stopButton.click();

    // And it comes back, which is what proves the run actually ended rather
    // than the button merely being clicked.
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({ timeout: 30_000 });
  });

  test('chat history survives a reload and can be switched', async ({ page }) => {
    // The whole point of persistence, and the only check that can catch the
    // subtle failure here: the panel adopts a new conversation id the moment
    // the first turn is saved, which re-runs the effect that seeds the
    // transcript. Seeded from the wrong state, that effect wipes the messages
    // one render AFTER saving them — the reload is what exposes it.
    test.setTimeout(300_000);
    await openPanel(page);

    const composer = composerOf(page);
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // START A NEW CONVERSATION FIRST, and this is what makes the test able to
    // fail. On mount the panel reopens the most recent conversation, so a save
    // takes the UPDATE path; the bug lives in the CREATE path, where adopting
    // the brand-new id re-runs the seeding effect. Without this click the test
    // passes with the bug present — verified by mutation.
    //
    // Clicked in the SIDEBAR, not the top bar. The top-bar button is disabled
    // until the history load lands, so `if (enabled) click()` silently skipped
    // it while that request was in flight — and the test then appended to the
    // previous conversation and blamed persistence for the missing row.
    await page.getByRole('button', { name: /history/i }).click();
    await page.getByRole('button', { name: 'New Chat', exact: true }).click();
    await expect(page.locator('[data-message-role]')).toHaveCount(0);

    const question = `Reply with only the word saved (${Date.now()})`;
    await sendAndWait(page, question);

    // BEFORE reloading, and only AFTER the save has been adopted.
    //
    // Saving a new conversation adopts its fresh id, which re-runs the effect
    // that seeds the transcript — and seeded from the empty list this
    // conversation began with, that effect blanks the panel one render after
    // the answer arrives. The data is stored safely either way, so a reload
    // repaints from the server and hides the bug completely.
    //
    // Asserting straight after the turn is not enough either: `toHaveCount`
    // polls until true and is satisfied TRANSIENTLY, passing on an observation
    // taken before the wipe. Verified — with the bug present, this test passed
    // until the wait below was added. So wait for the sidebar row to appear,
    // which is the observable signal that the create completed and its id was
    // adopted, and only then check that the transcript survived it.
    // Matched on THIS run's unique question, not a prefix. A prefix matches
    // rows left by earlier runs, so the wait completed immediately and the
    // assertion below raced the very wipe it exists to catch — passing or
    // failing depending on timing.
    //
    // The sidebar is ALREADY open from the New Chat click above, so it is not
    // toggled again here: /history/i also matches "Hide history", and a
    // collapsed sidebar is aria-hidden, which removes the row from the
    // accessibility tree and fails the assertion on a conversation that saved
    // perfectly.
    // `exact: true`, because Playwright matches accessible names by SUBSTRING
    // by default — which matched two elements while the row and its delete
    // control were nested, and read as a duplicated conversation.
    const savedRow = page.getByRole('button', {
      name: `Delete conversation: ${question}`,
      exact: true,
    });
    await expect(savedRow).toHaveCount(1, { timeout: 60_000 });

    await expect(
      page.locator('[data-message-role="user"]').filter({ hasText: question }),
    ).toHaveCount(1);

    await page.reload();
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    // The most recent conversation is reopened on mount, so the question is
    // back in the TRANSCRIPT without touching the sidebar. Scoped to the user
    // turn: the sidebar row carries the same text as its title (it is in the
    // DOM even while collapsed), so an unscoped match is ambiguous rather than
    // wrong.
    const restored = page.locator('[data-message-role="user"]').filter({ hasText: question });
    await expect(restored).toHaveCount(1, { timeout: 30_000 });

    // And it is still listed in the sidebar, titled from the first user
    // message.
    await page.getByRole('button', { name: /history/i }).click();
    await expect(
      page.getByRole('button', { name: `Delete conversation: ${question}`, exact: true }),
    ).toHaveCount(1);
  });

  test('New chat leaves the saved conversation alone', async ({ page }) => {
    // "New chat" clears the view. If it only cleared the view without
    // detaching from the active row, the next reply would append to a
    // conversation the user believed they had left.
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    // WAIT for the auto-opened conversation to paint before counting. The
    // history load is asynchronous, so a count taken as soon as the composer
    // appears reads zero and fails on a panel that is simply still loading.
    await expect(page.locator('[data-message-role]').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /^new chat$/i }).click();
    await expect(page.locator('[data-message-role]')).toHaveCount(0);

    // The history it left is still on the server.
    await page.reload();
    await page.getByRole('button', { name: /history/i }).click();
    await expect(page.getByText(/no conversations yet/i)).toHaveCount(0);
  });

  test('@model a memory saved by hand reaches the next conversation', async ({ page }) => {
    // Memory is only worth anything if it crosses conversations, so the check
    // is: save a fact, start a NEW conversation, and ask about it. The panel
    // never sends the fact — if the answer contains it, it came from the
    // system prompt the server built.
    test.setTimeout(300_000);
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    const secret = `orbital-${Date.now().toString().slice(-6)}`;

    await page.getByRole('button', { name: /^memories/i }).click();
    const memoryInput = page.getByRole('textbox', { name: /new memory/i });
    await memoryInput.fill(`The user's project codename is ${secret}`);
    await memoryInput.press('Enter');
    await expect(page.locator('[data-memory]').filter({ hasText: secret })).toHaveCount(1);

    // A brand-new conversation: nothing in the transcript mentions the
    // codename, so the model can only know it from the injected memories.
    const newChat = page.getByRole('button', { name: /^new chat$/i });
    if (await newChat.isEnabled()) await newChat.click();

    await sendAndWait(page, 'What is my project codename? Answer with just the codename.');

    const answer = page.locator('[data-message-role="assistant"]').last();
    await expect(answer).toContainText(secret, { timeout: 30_000 });
  });

  test('memories survive a reload and can be deleted', async ({ page }) => {
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^memories/i }).click();

    const fact = `likes-tabs-${Date.now().toString().slice(-6)}`;
    const memoryInput = page.getByRole('textbox', { name: /new memory/i });
    await memoryInput.fill(fact);
    await memoryInput.press('Enter');

    await page.reload();
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^memories/i }).click();

    const row = page.locator('[data-memory]').filter({ hasText: fact });
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    await row.getByRole('button', { name: /^Delete memory/ }).click();
    await expect(row).toHaveCount(0);

    // Gone on the server too, not just out of the list in this tab.
    await page.reload();
    await page.getByRole('button', { name: /^memories/i }).click();
    await expect(page.locator('[data-memory]').filter({ hasText: fact })).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test('@model the model saves a note via its own tool', async ({ page }) => {
    // Notes differ from memories in that the user is expected to USE them
    // later, so the check is not just that one was stored — it is that a
    // stored note can be corrected. A store the user cannot edit is a store
    // they stop trusting.
    test.setTimeout(300_000);
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    const marker = `kestrel-${Date.now().toString().slice(-6)}`;
    await sendAndWait(
      page,
      `Use your save_note tool to save a note titled ${marker} with the content "one two three". Then say done.`,
    );

    // The panel refreshes notes on the same edge it saves the transcript, so
    // the new note is here without a reload.
    await page.getByRole('button', { name: /^notes/i }).click();
    await expect(page.locator('[data-note]').filter({ hasText: marker })).toHaveCount(1, {
      timeout: 30_000,
    });
  });

  test('a note can be edited, and the edit sticks', async ({ page }) => {
    // The note is SEEDED through the API rather than talked out of the model.
    // Whether a model calls a tool is its decision, and gating this on that
    // decision makes a test that fails when the local model has an off day —
    // reporting a problem in code that is working. The model-driven path is
    // covered by the @model test above.
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    const marker = `seeded-${Date.now().toString().slice(-6)}`;
    await seedNote(page, { title: marker, content: 'before' });

    await page.reload();
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^notes/i }).click();

    const row = page.locator('[data-note]').filter({ hasText: marker });
    await expect(row).toHaveCount(1, { timeout: 30_000 });

    await row.click();
    const body = page.getByRole('textbox', { name: /content/i });
    await expect(body).toBeVisible();
    // Unique per run: a fixed string would also match notes left by earlier
    // runs, and the count assertion would fail on a feature that works.
    const corrected = `corrected-${marker}`;
    await body.fill(corrected);
    await page.getByRole('button', { name: /^save$/i }).click();

    await page.reload();
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^notes/i }).click();
    await expect(page.locator('[data-note]').filter({ hasText: corrected })).toHaveCount(1, {
      timeout: 30_000,
    });
  });

  test('the tool picker lists every source, and a toggle reaches the server', async ({ page }) => {
    // The picker is the answer to "what can this thing actually do, and where
    // did each tool come from" — so the test checks that a THIRD-PARTY
    // plugin's tools are listed under their own source, and that switching it
    // off is actually sent with the next request rather than only looking
    // switched off.
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /^tools \(/i }).click();
    const menu = page.getByRole('dialog', { name: /tool sources/i });
    await expect(menu).toBeVisible();

    // This plugin's own tools, always on and not switchable.
    await expect(menu.getByText('list_content_types')).toBeVisible();
    const builtIn = menu.getByRole('checkbox', { name: /enable strapi content/i });
    await expect(builtIn).toBeChecked();
    await expect(builtIn).toBeDisabled();

    // A plugin installed from npm, contributing through its `ai-tools`
    // service, with its tools namespaced by source.
    await expect(menu.getByText('youtube-transcripts__listTranscripts')).toBeVisible();
    const youtube = menu.getByRole('checkbox', { name: /enable youtube transcripts/i });
    await expect(youtube).toBeEnabled();

    // Turning it off must travel: capture what the panel actually sends.
    await youtube.uncheck();
    await page.keyboard.press('Escape');

    const sent = page.waitForRequest(
      (request) => request.url().endsWith('/tanstack-ai/chat') && request.method() === 'POST',
    );
    await composerOf(page).fill('hello');
    await page.getByRole('button', { name: /^send$/i }).click();
    const body = JSON.parse((await sent).postData() ?? '{}');
    expect(body.forwardedProps?.enabledToolSources).not.toContain('youtube-transcripts');

    await page.getByRole('button', { name: /^stop$/i }).click().catch(() => undefined);

    // And the choice is remembered across a reload — it is a per-person
    // preference, kept in localStorage rather than on the server.
    await page.reload();
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^tools \(/i }).click();
    await expect(
      page.getByRole('checkbox', { name: /enable youtube transcripts/i }),
    ).not.toBeChecked();
  });
});
