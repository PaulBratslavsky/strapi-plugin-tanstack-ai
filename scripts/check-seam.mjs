/**
 * Fail if the AI SDK is loaded statically.
 *
 * The plugin's central promise is that a host installing it for the MCP tools
 * never has to install @tanstack/ai — it is an OPTIONAL peer, reached only
 * through a dynamic import behind `chat.enabled`. That promise is not a
 * comment, it is a property of the built bundle, and this asserts it.
 *
 * A static require of the SDK means a host with chat off crashes at boot with
 * a module-not-found for a package they were told they did not need. That
 * failure happens at THEIR install, which is exactly why it has to be caught
 * at ours.
 */
import { readFileSync, existsSync } from 'node:fs';

const BUNDLES = ['dist/server/index.js', 'dist/server/index.mjs'];
const SDK = /@tanstack\/ai(-[a-z]+)?/;

let failed = false;

for (const file of BUNDLES) {
  if (!existsSync(file)) {
    console.error(`  x ${file} missing - run the build first`);
    failed = true;
    continue;
  }

  const src = readFileSync(file, 'utf8');

  const statics = [
    // CJS
    ...src.matchAll(/require\(\s*["'](@tanstack\/ai[^"']*)["']\s*\)/g),
    // ESM with bindings
    ...src.matchAll(/^\s*import\s[^;]*?from\s*["'](@tanstack\/ai[^"']*)["']/gm),
    // ESM BARE side-effect import. Easy to miss and just as fatal: when the
    // bundler tree-shakes an unused binding it keeps `import "pkg";`, which
    // still loads the module. The first version of this check required a
    // `from` clause and passed the ESM bundle while the CJS one failed —
    // caught only by deliberately breaking it.
    ...src.matchAll(/^\s*import\s*["'](@tanstack\/ai[^"']*)["']\s*;?\s*$/gm),
  ].map((m) => m[1]);

  if (statics.length > 0) {
    console.error(`  x ${file} loads the SDK statically: ${[...new Set(statics)].join(', ')}`);
    failed = true;
    continue;
  }

  const dynamic = [...src.matchAll(/import\(\s*["'](@tanstack\/ai[^"']*)["']\s*\)/g)].map((m) => m[1]);
  const mentions = src.split('\n').filter((l) => SDK.test(l)).length;
  console.error(
    `  ok ${file}: no static SDK load ` +
      `(${dynamic.length} dynamic import site(s), ${mentions} line(s) mentioning it)`,
  );
}

process.exit(failed ? 1 : 0);
