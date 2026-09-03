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

/** Fail on any console error the app itself caused. */
function errorGuard(page: Page): () => void {
  const IGNORE = [/favicon/i, /permissions policy/i, /Download the React DevTools/i];
  const hits: string[] = [];
  const record = (t: string) => {
    if (!IGNORE.some((re) => re.test(t))) hits.push(t);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') record(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => record(`pageerror: ${e.message}`));
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
    const newChat = page.getByRole('button', { name: /^new chat$/i });
    if (await newChat.isEnabled()) await newChat.click();

    const question = `Reply with only the word saved (${Date.now()})`;
    await composer.fill(question);
    await page.getByRole('button', { name: /^send$/i }).click();
    // Wait for the turn to END: saving is triggered by the streaming edge.
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({
      timeout: 280_000,
    });

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
    await page.getByRole('button', { name: /history/i }).click();
    const savedRow = page.getByRole('button', { name: /^Delete conversation: Reply with only/ });
    await expect(savedRow.first()).toBeVisible({ timeout: 30_000 });

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
      page.getByRole('button', { name: /^Delete conversation: Reply with only/ }).first(),
    ).toBeVisible();
  });

  test('New chat leaves the saved conversation alone', async ({ page }) => {
    // "New chat" clears the view. If it only cleared the view without
    // detaching from the active row, the next reply would append to a
    // conversation the user believed they had left.
    await openPanel(page);
    await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });

    const before = await page.locator('[data-message-role]').count();
    expect(before).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^new chat$/i }).click();
    await expect(page.locator('[data-message-role]')).toHaveCount(0);

    // The history it left is still on the server.
    await page.reload();
    await page.getByRole('button', { name: /history/i }).click();
    await expect(page.getByText(/no conversations yet/i)).toHaveCount(0);
  });

  test('a memory saved by hand reaches the next conversation', async ({ page }) => {
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

    await composerOf(page).fill('What is my project codename? Answer with just the codename.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible({
      timeout: 280_000,
    });

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
});
