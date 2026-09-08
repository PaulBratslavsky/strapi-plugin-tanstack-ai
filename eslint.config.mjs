import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import regexp from 'eslint-plugin-regexp';

/**
 * Static analysis for this plugin.
 *
 * WHY IT EXISTS. The repo had prettier and a stray `.eslintignore` but no
 * linter, so the only static analysis happening was the author's IDE — which
 * meant every finding was relayed by hand. Four in one sitting
 * (`prefer-string-replace-all`, cognitive complexity 39, a nested ternary, a
 * duplicated character in a regex class) were all in freshly written code that
 * had passed typecheck and tests and been reported as verified.
 *
 * The three plugins are chosen to catch that class of thing rather than to
 * enforce taste — formatting stays with prettier, which already has a config
 * here.
 */
export default tseslint.config(
  {
    // Flat config replaces .eslintignore; `dist` was all it held.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  regexp.configs['flat/recommended'],

  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      /*
       * The four that were reported by hand, stated explicitly so a future
       * change to a plugin's "recommended" set cannot quietly drop one.
       */
      'sonarjs/cognitive-complexity': ['error', 15],

      // An underscore prefix is how this codebase says "required by the
      // signature, unused here" — Strapi hands every lifecycle a context
      // object whether or not the hook needs it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'unicorn/prefer-string-replace-all': 'error',
      'regexp/no-dupe-characters-character-class': 'error',
      'unicorn/no-nested-ternary': 'error',

      /*
       * TASTE, TURNED OFF.
       *
       * `unicorn/recommended` is kept rather than cherry-picked, so a useful
       * new rule arrives on its own — but its style half is disabled here. The
       * first run reported 283 problems, of which 190 were these five: a
       * naming dictionary, comment formatting, and two spread/nesting
       * preferences. None describes a defect, and acting on them would have
       * rewritten working code in bulk while burying the dozen findings that
       * do matter.
       */

      // Wants `doc` -> `document`, `props` -> `properties`, `params` ->
      // `parameters`. Strapi's own vocabulary is abbreviated, and this code
      // should read like the framework it plugs into.
      'unicorn/name-replacements': 'off',
      'unicorn/prevent-abbreviations': 'off',

      // Would convert every `//` explanation to a block comment. The comment
      // style here is deliberate: `//` for a line, `/* */` for a paragraph.
      'unicorn/single-line-block-comment-style': 'off',

      // `a(b(c(d)))` is sometimes the clearest way to say it, especially in
      // test fixtures.
      'unicorn/max-nested-calls': 'off',

      // `...(cond ? { k: v } : {})` is the shape used throughout for "omit
      // this key entirely", which matters where absent and present-but-false
      // differ.
      'unicorn/consistent-conditional-object-spread': 'off',

      // Would rename `strip`, `truncated`, `more` to `isStrip`, `wasTruncated`.
      'unicorn/consistent-boolean-name': 'off',

      // `catch (error)` vs `catch (cause)` — both are used deliberately here,
      // `cause` where the value is passed on as one.
      'unicorn/catch-error-name': 'off',

      // Strapi plugins export anonymous factory functions by convention.
      'unicorn/no-anonymous-default-export': 'off',

      // `null` is not interchangeable here: the SDK, Strapi's document API and
      // JSON bodies all use it, and "absent" versus "explicitly nothing" is a
      // distinction this code relies on.
      'unicorn/no-null': 'off',

      // Server modules are kebab-case, React components PascalCase. One rule
      // cannot express both.
      'unicorn/filename-case': 'off',
    },
  },

  {
    // Build scripts run in Node, not the browser or Strapi's sandbox.
    files: ['scripts/**/*.mjs', 'eslint.config.mjs', '*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    // Tests describe intent; a fixture repeated three times is clearer inline
    // than hoisted into a helper nobody reads.
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      'sonarjs/no-duplicate-string': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // A test may repeat a string to say something plainly.
      'unicorn/prefer-string-repeat': 'off',
      // A one-line predicate reads better beside the case that uses it.
      'unicorn/consistent-function-scoping': 'off',
    },
  },

  {
    /*
     * `page.evaluate` callbacks run in the BROWSER, where `document`,
     * `fetch` and `localStorage` all exist. The rule cannot know Playwright
     * serialises the function across that boundary, so it reports every one of
     * them as using an undefined variable. Off here only — the isolation it
     * describes is real everywhere else.
     */
    files: ['e2e/**/*.ts'],
    rules: {
      'unicorn/isolated-functions': 'off',
      // A spec file IS top-level calls: `test(...)` at module scope is the
      // only way to declare one.
      'unicorn/no-top-level-side-effects': 'off',
      // `(await request).postData()` reads fine and naming the intermediate
      // adds a line that says nothing.
      'unicorn/no-await-expression-member': 'off',
      // The local dev admin's password, already env-overridable, reaching
      // nothing but a Strapi on localhost. Keeping it here is what makes the
      // suite runnable on a fresh clone.
      'sonarjs/no-hardcoded-passwords': 'off',
      // `setup(...)` is a test declaration, not a skipped test.
      'sonarjs/explicit-test-skip': 'off',
    },
  },

  {
    /*
     * Build-time CLI scripts. They read this repo's own output, never
     * untrusted input, and their whole job is to exit non-zero when a check
     * fails — which is what `no-process-exit` forbids.
     */
    files: ['scripts/**/*.mjs'],
    rules: {
      'unicorn/no-process-exit': 'off',
      'sonarjs/super-linear-regex': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
    },
  },
);
