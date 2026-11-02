/**
 * Colours belong to the design tokens.
 *
 *   node scripts/ui/colours.mjs check   fail if a stylesheet or a source file under frontend/src writes a colour
 *                                       literal (a hex colour, or rgb(), hsl(), hwb(), lab(), lch(), oklab() or oklch())
 *
 * Every colour in the product is a custom property from frontend/src/design/tokens.css, which is the one place a colour
 * is written, once for each of the three themes, and which a test holds to a contrast ratio (frontend/src/test/
 * design-contrast.test.ts). Anywhere else a colour is a `var(--token)`, a named colour (`white`, `currentColor`) or a
 * `color-mix()` of those, so that it follows the theme and cannot fall out of the contrast the tokens keep. The
 * browser's own chrome (the address-bar colour) cannot read a custom property, and is the one exception: lib/theme.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = join(root, 'frontend', 'src');

/** Where a colour may be written. */
const ALLOWED = new Set([join(source, 'design', 'tokens.css'), join(source, 'lib', 'theme.ts')]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/u;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/u;

/** Everything a colour could be written in: stylesheets and sources, but not tests. */
function files() {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') walk(path);
      } else if (/\.(?:css|tsx?)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
        found.push(path);
      }
    }
  };
  walk(source);
  return found;
}

/** The text of a file without its comments, so that a colour mentioned in a comment is not a colour used. */
const withoutComments = (text) =>
  text
    .replace(/\/\*[^]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');

export function problems() {
  const found = [];
  for (const path of files()) {
    if (ALLOWED.has(path)) continue;
    const text = withoutComments(readFileSync(path, 'utf8'));
    // A `#` in a selector, a URL or an attribute value is not a colour: a hex colour is read only where one can be a value.
    // In a stylesheet that is after a space, a colon, a comma or a bracket; in a source file a string may also begin with it.
    const css = path.endsWith('.css');
    const before = css ? /[\s:,(]/u : /[\s:,('"`]/u;
    const hex = [...text.matchAll(new RegExp(HEX, 'gu'))].find(
      (match) => match.index === 0 || before.test(text[match.index - 1]),
    );
    const literal = hex?.[0] ?? FUNCTION.exec(text)?.[0];
    if (literal) found.push(`${relative(root, path)}: colour literal ${literal}`);
  }
  return found;
}

function main(mode) {
  if (mode !== 'check') {
    console.error('Use: check');
    process.exitCode = 1;
    return;
  }
  const found = problems();
  if (found.length > 0) {
    console.error(found.join('\n'));
    process.exitCode = 1;
  } else console.log('ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]);
