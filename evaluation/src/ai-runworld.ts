import type { SitePage } from './ai-datasets.js';
import type { RunWorld, RunsFile } from './ai-suite-data.js';
import { worldPageIds } from './ai-suite-data.js';

/**
 * The synthetic worlds of the run dataset, made into the pages of the fixture web. Each world is
 * written (in research-runs.json) so that the stop its budget and its pages allow is the only one:
 * the pages have words of their own, so that reading never runs dry by accident, and links that
 * carry the words of the question, so that the crawler's own ranking follows them.
 */

const SYLLABLES = [
  'ba',
  'be',
  'bi',
  'bo',
  'da',
  'de',
  'di',
  'do',
  'ka',
  'ke',
  'ki',
  'ko',
  'la',
  'le',
  'li',
  'lo',
  'ma',
  'me',
  'mi',
  'mo',
  'na',
  'ne',
  'ni',
  'no',
  'pa',
  'pe',
  'pi',
  'po',
  'ra',
  're',
  'ri',
  'ro',
  'sa',
  'se',
  'si',
  'so',
  'ta',
  'te',
  'ti',
  'to',
  'va',
  've',
  'vi',
  'vo',
];

function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** `count` words of eight letters that are no word of any language: a page made of them says nothing that another page says. */
export function pseudoWords(seed: number, count: number): string[] {
  const next = stream(seed);
  return Array.from({ length: count }, () =>
    Array.from({ length: 4 }, () => SYLLABLES[Math.floor(next() * SYLLABLES.length)]).join(''),
  );
}

const paragraphs = (words: readonly string[], per = 40): string =>
  Array.from(
    { length: Math.ceil(words.length / per) },
    (_, index) => `<p>${words.slice(index * per, (index + 1) * per).join(' ')}.</p>`,
  ).join('');

const shell = (title: string, host: string, body: string): string =>
  `<!doctype html><html lang='en'><head><meta charset='utf-8'><title>${title} | ${host}</title></head><body><main><article><h1>${title}</h1>${body}</article></main></body></html>`;

const links = (items: readonly { id: string; text: string }[]): string =>
  `<ul>${items.map((item) => `<li><a href='{{url:${item.id}}}'>${item.text}</a></li>`).join('')}</ul>`;

const STUB_GOLD: SitePage['gold'] = {
  outcome: 'used',
  quarantine: null,
  failure: null,
  category: null,
  authority: null,
  hostile: false,
  main: [],
  boilerplate: [],
  injection: null,
  payloads: [],
  why: 'A page of a synthetic world: its outcome is asserted by the run that reads it, not here.',
};

const page = (
  world: RunWorld,
  id: string,
  host: string,
  path: string,
  html: string,
  extra: Partial<SitePage['response'] & object> = {},
): SitePage => ({
  id,
  split: 'dev',
  group: world.id,
  host,
  path,
  via: 'link',
  response: { html, ...extra },
  gold: STUB_GOLD,
});

const anchorOf = (world: RunWorld, n: number): string =>
  (world.anchor ?? 'Library hours, note {n}').replace('{n}', String(n));

/** The pages a world makes. */
export function worldPages(world: RunWorld, fees: RunsFile['feeSentences']): SitePage[] {
  const pages: SitePage[] = [];
  const ids = worldPageIds(world);
  const hubId = `${world.id}-0`;
  const wordsFor = (n: number, count = world.words ?? 60): string[] =>
    pseudoWords(world.seed * 1_000 + n, count);
  const sayParagraph = world.say ? `<p>${world.say}</p>` : '';

  if (world.kind === 'single') {
    pages.push(
      page(
        world,
        ids[0]!,
        world.host,
        '/page',
        shell(world.title, world.host, `<p>${world.intro}</p>${paragraphs(wordsFor(1))}`),
      ),
    );
    return pages;
  }

  const children: { id: string; text: string }[] = [];
  if (world.kind === 'fan') {
    const count = world.children ?? 0;
    const body = (n: number): string => {
      if (world.shuffle) {
        const base = pseudoWords(world.seed, 48);
        const next = stream(world.seed * 31 + n);
        const order = [...base];
        for (let at = order.length - 1; at > 0; at -= 1) {
          const to = Math.floor(next() * (at + 1));
          [order[at], order[to]] = [order[to]!, order[at]!];
        }
        return paragraphs(order, 16);
      }
      const count = world.bytes ? Math.ceil(world.bytes / 9) : (world.words ?? 60);
      return paragraphs(wordsFor(world.copies ? 1 : n, count));
    };
    for (let n = 1; n <= count; n += 1) {
      const id = `${world.id}-${n}`;
      children.push({ id, text: anchorOf(world, n) });
      const broken = world.broken?.includes(n) ?? false;
      pages.push(
        broken
          ? page(world, id, world.host, `/note-${n}`, 'not found', {
              status: 404,
              contentType: 'text/plain',
            })
          : page(
              world,
              id,
              world.host,
              `/note-${n}`,
              shell(
                world.copies ? 'The note' : `Note ${n}`,
                world.host,
                `${sayParagraph}${body(n)}`,
              ),
            ),
      );
    }
  }

  if (world.kind === 'spread') {
    (world.childHosts ?? []).forEach((host, index) => {
      const n = index + 1;
      const id = `${world.id}-${n}`;
      children.push({ id, text: anchorOf(world, n) });
      pages.push(
        page(world, id, host, `/note-${n}`, shell(`Note ${n}`, host, paragraphs(wordsFor(n)))),
      );
    });
  }

  if (world.kind === 'pair') {
    for (let n = 1; n <= (world.neutral ?? 0); n += 1) {
      const id = `${world.id}-${n}`;
      children.push({ id, text: anchorOf(world, n) });
      pages.push(
        page(
          world,
          id,
          world.host,
          `/note-${n}`,
          shell(`Note ${n}`, world.host, paragraphs(wordsFor(n))),
        ),
      );
    }
    for (const [key, side] of [
      ['A', world.a],
      ['B', world.b],
    ] as const) {
      if (!side) continue;
      const id = `${world.id}-${key}`;
      children.push({ id, text: side.anchor });
      pages.push(
        page(
          world,
          id,
          side.host,
          '/berthing-fees',
          shell(
            'Berthing fees',
            side.host,
            `<p>${fees[side.say]}</p>${paragraphs(wordsFor(key === 'A' ? 901 : 902, 40))}`,
          ),
        ),
      );
    }
  }

  pages.unshift(
    page(
      world,
      hubId,
      world.host,
      '/',
      shell(world.title, world.host, `<p>${world.intro}</p>${links(children)}`),
    ),
  );
  return pages;
}

/** Every page of every world of the dataset. */
export const expandWorlds = (file: RunsFile): SitePage[] =>
  file.worlds.flatMap((world) => worldPages(world, file.feeSentences));
