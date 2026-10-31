/**
 * Colour tokens for the light, dark and high-contrast themes.
 *
 *   node scripts/ui/themes.mjs rewrite   one time: turn every colour literal in the stylesheets into a
 *                                        role token, `var(--t-bg-ffffff)`, and write the light values
 *   node scripts/ui/themes.mjs tokens    write frontend/src/styles/theme-tokens.css: the tokens the stylesheets use,
 *                                        with the dark and high-contrast value derived from the light one
 *   node scripts/ui/themes.mjs check     fail if a stylesheet or a source file has a colour literal, or if
 *                                        the tokens file is not what `tokens` would write
 *
 * A token has a role, from the property that uses it: bg (backgrounds), fg (text, icons, strokes), bd
 * (borders and outlines). The role decides how the colour is derived for a theme: a light background
 * becomes a dark one, dark text becomes light text, a light border becomes a dim one, and a saturated
 * fill (a button) stays as it is, so that text on it keeps its contrast. Whatever the derivation gets
 * wrong is corrected by hand in frontend/src/styles/theme.css, which is loaded after the tokens.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const styles = join(root, 'frontend', 'src');
const TOKENS_FILE = join(styles, 'styles', 'theme-tokens.css');
const MANUAL_FILE = 'theme.css';

// ---- colour maths (OKLab, so that "lighter" means the same for every hue)

const hexToRgb = (hex) => {
  const h = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const labOf = (hex) => rgbToOklab(hexToRgb(hex.replace('#', '')));

function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (linear) => linear.every((c) => c >= -0.0005 && c <= 1.0005);
const unit = (c) => Math.min(1, Math.max(0, c));

/** An OKLab colour as a hex string, with less chroma until it fits in sRGB. */
function toHex([L, a, b]) {
  let scale = 1;
  let linear = oklabToRgb([L, a, b]);
  while (!inGamut(linear) && scale > 0) {
    scale -= 0.02;
    linear = oklabToRgb([L, a * scale, b * scale]);
  }
  return `#${linear
    .map((c) => Math.round(unit(fromLinear(unit(c))) * 255))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex.replace('#', '')).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two colours, from 1 to 21. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const chromaOf = ([, a, b]) => Math.hypot(a, b);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// ---- derivation of a theme's colour from its light colour

// The dark theme has a few quiet surfaces. The page is the lowest, the panel (white in the light theme)
// sits a step above it, and what is a little darker than white in the light theme (hover, wells, chips)
// is a little lighter than the panel here. A faint cool tint keeps them from reading as flat grey.
const DARK_PAGE = [0.17, -0.003, -0.01];
const DARK_PANEL = 0.225;
const DARK_NEUTRAL = [-0.003, -0.01];

/** Backgrounds: light surfaces become dark ones, a tint stays a tint; saturated fills stay. */
function darkBackground([L, a, b]) {
  if (L < 0.78) return [L, a, b];
  const lifted = DARK_PANEL + (1 - L) * 0.5;
  const chroma = chromaOf([L, a, b]);
  if (chroma <= 0.008) return [lifted, ...DARK_NEUTRAL];
  // A state tint (success, warning, error, accent) has to be seen on a dark surface, so it is made
  // stronger than the light one was; its hue is kept.
  const scale = clamp(chroma * 2, 0.02, 0.045) / chroma;
  return [lifted, a * scale, b * scale];
}

/**
 * Text and icons: dark text becomes light text, its colour kept; light text stays light. Body text
 * is nearly white and the further a grey is from it in the light theme the dimmer it is here, so
 * the order of importance survives.
 */
function darkForeground([L, a, b]) {
  if (L >= 0.8) return [L, a, b];
  const coloured = chromaOf([L, a, b]) > 0.05;
  return [
    clamp(0.93 - (L - 0.28) * 1.05, 0.68, 0.94),
    a * (coloured ? 0.9 : 0.4),
    b * (coloured ? 0.9 : 0.4),
  ];
}

/** Borders: a line stays a step above the surface it sits on, soft ones barely and inputs clearly. */
function darkBorder([L, a, b]) {
  return [clamp(0.28 + (0.93 - L) * 0.9, 0.26, 0.6), a * 0.6, b * 0.6];
}

function highContrastBackground(light) {
  const lab = labOf(light);
  if (lab[0] >= 0.78) return '#000000';
  // A saturated fill keeps its hue, but is darkened until white text on it reads at 7:1.
  let candidate = lab;
  let hex = light;
  for (let i = 0; i < 40 && contrast(hex, '#ffffff') < 7; i += 1) {
    candidate = [candidate[0] - 0.015, candidate[1], candidate[2]];
    hex = toHex(candidate);
  }
  return hex;
}

function highContrastForeground(light) {
  const lab = labOf(light);
  if (lab[0] >= 0.8) return '#ffffff';
  if (chromaOf(lab) > 0.06) return toHex([0.88, lab[1] * 0.8, lab[2] * 0.8]);
  return '#ffffff';
}

function highContrastBorder(light) {
  const lab = labOf(light);
  if (chromaOf(lab) > 0.06) return toHex([0.82, lab[1] * 0.8, lab[2] * 0.8]);
  return '#ffffff';
}

/** The dark and high-contrast colours for a token of this role with this light colour. */
export function derive(role, light) {
  // The page is the one surface that is darker than the panel in both themes.
  const dark =
    role === 'bg' && light === '#f7f7f5'
      ? DARK_PAGE
      : { bg: darkBackground, fg: darkForeground, bd: darkBorder }[role](labOf(light));
  const highContrast = {
    bg: highContrastBackground,
    fg: highContrastForeground,
    bd: highContrastBorder,
  }[role](light);
  return { dark: toHex(dark), 'high-contrast': highContrast };
}

// ---- reading and rewriting the stylesheets

const cssFiles = () => {
  const found = [join(styles, 'styles.css')];
  for (const name of readdirSync(join(styles, 'styles'))) {
    if (name.endsWith('.css') && name !== 'theme-tokens.css' && name !== MANUAL_FILE) {
      found.push(join(styles, 'styles', name));
    }
  }
  return found;
};

/** The sources whose colours must follow the theme: everything but tests, and lib/theme.ts. */
const sourceFiles = () => {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') walk(path);
      } else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
        // The browser's own chrome (the address-bar colour) cannot read a custom property.
        if (path !== join(styles, 'lib', 'theme.ts')) found.push(path);
      }
    }
  };
  walk(styles);
  return found;
};

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/gu;
const FUNCTION_COLOUR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/u;
const hasHex = (text) => {
  HEX.lastIndex = 0;
  const found = HEX.test(text);
  HEX.lastIndex = 0;
  return found;
};

/** Which role a colour has, from the declaration that uses it. Null: leave it alone. */
function roleOf(property) {
  if (/^background/u.test(property)) return 'bg';
  if (/^(?:border|outline|column-rule)/u.test(property)) return 'bd';
  if (
    /^(?:color|fill|stroke|caret-color|text-decoration-color|accent-color|-webkit-text-fill-color)$/u.test(
      property,
    )
  ) {
    return 'fg';
  }
  if (property.startsWith('--')) {
    if (/-tint$/u.test(property)) return 'bg';
    if (/-line$/u.test(property)) return 'bd';
    return 'fg';
  }
  return null;
}

const normal = (hex) => {
  const h = hex.slice(1).toLowerCase();
  const six = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return six.length === 8 ? six.slice(0, 6) : six;
};

function rewriteFile(path, found, unknown) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
  const out = text
    .split('\n')
    .map((line) => {
      const declaration = /^(\s*)([a-z-]+|--[A-Za-z0-9_-]+)(\s*:\s*)(.*)$/u.exec(line);
      if (!declaration || !hasHex(declaration[4])) return line;
      const [, indent, property, colon, value] = declaration;
      const role = roleOf(property);
      if (!role) {
        unknown.push(`${path}: ${property}: ${value}`);
        return line;
      }
      const replaced = value.replace(HEX, (hex) => {
        const six = normal(hex);
        found.set(`${role}-#${six}`, { role, hex: `#${six}` });
        return `var(--t-${role}-${six})`;
      });
      return `${indent}${property}${colon}${replaced}`;
    })
    .join('\n');
  return { text, out };
}

function tokensCss(tokens) {
  const sorted = [...tokens.values()].sort((a, b) =>
    (a.role + a.hex).localeCompare(b.role + b.hex),
  );
  const derived = new Map(sorted.map((t) => [`${t.role}-${t.hex}`, derive(t.role, t.hex)]));
  const block = (selector, pick, extra = '') =>
    `${selector} {\n${extra}${sorted
      .map((t) => `  --t-${t.role}-${t.hex.slice(1)}: ${pick(t)};`)
      .join('\n')}\n}\n`;
  return (
    '/* Generated by scripts/ui/themes.mjs: edit a light value, or use a new colour in a stylesheet and run\n' +
    '   `node scripts/ui/themes.mjs rewrite`, then `node scripts/ui/themes.mjs tokens`. A colour that a derived\n' +
    '   theme gets wrong is corrected by hand in theme.css, which is loaded after this file. */\n' +
    block(':root', (t) => t.hex) +
    '\n' +
    block(
      "[data-theme='dark']",
      (t) => derived.get(`${t.role}-${t.hex}`).dark,
      '  color-scheme: dark;\n',
    ) +
    '\n' +
    block(
      "[data-theme='high-contrast']",
      (t) => derived.get(`${t.role}-${t.hex}`)['high-contrast'],
      '  color-scheme: dark;\n',
    )
  );
}

/** Every token the stylesheets use. The colour is in its name, so the light value needs no other source. */
function referencedTokens() {
  const tokens = new Map();
  for (const path of cssFiles()) {
    for (const match of readFileSync(path, 'utf8').matchAll(
      /var\(--t-(bg|fg|bd)-([0-9a-f]{6})\)/gu,
    )) {
      tokens.set(`${match[1]}-#${match[2]}`, { role: match[1], hex: `#${match[2]}` });
    }
  }
  return tokens;
}
function main(mode) {
  if (mode === 'rewrite') {
    const found = new Map();
    const unknown = [];
    for (const path of cssFiles()) {
      const { text, out } = rewriteFile(path, found, unknown);
      if (out !== text) writeFileSync(path, out);
    }
    writeFileSync(TOKENS_FILE, tokensCss(referencedTokens()));
    console.log(`${referencedTokens().size} tokens`);
    if (unknown.length)
      console.log(`Not rewritten (the property has no role):\n${unknown.join('\n')}`);
  } else if (mode === 'tokens') {
    writeFileSync(TOKENS_FILE, tokensCss(referencedTokens()));
    console.log(`${referencedTokens().size} tokens written`);
  } else if (mode === 'check') {
    const problems = [];
    for (const path of [...cssFiles(), ...sourceFiles()]) {
      const text = readFileSync(path, 'utf8');
      const literal = text.match(HEX)?.[0] ?? text.match(FUNCTION_COLOUR)?.[0];
      if (literal) problems.push(`${path}: colour literal ${literal}`);
    }
    const current = readFileSync(TOKENS_FILE, 'utf8').replace(/\r\n/gu, '\n');
    if (current !== tokensCss(referencedTokens()))
      problems.push('theme-tokens.css is not what `tokens` writes.');
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
    } else console.log('ok');
  } else {
    console.error('Use: rewrite | tokens | check');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]);
