import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExampleScenario } from '../../../../shared/example-scenarios';
import { visibleText } from '../../test/provider';
import { ExamplePicker, STARTER, type LoadedExample } from './ExamplePicker';

const example = (id: string, title: string): ExampleScenario => ({
  id,
  title,
  blurb: `A short line about ${title}.`,
  question: `What could happen if ${title} changes?`,
  documents: [
    {
      name: `${id}.md`,
      content: 'Synthetic evidence text, long enough to stand for a document in this test.',
      provenance: { kind: 'sample' },
    },
  ],
});

const EXAMPLES = [example('price', 'A price change'), example('launch', 'A launch')];
const LOADED: LoadedExample = {
  kind: 'example',
  title: 'A price change',
  evidence: '2 documents · sample evidence',
};

const render = (loaded: LoadedExample | null = null, disabled = false) =>
  renderToStaticMarkup(
    <ExamplePicker
      examples={EXAMPLES}
      disabled={disabled}
      loaded={loaded}
      onPick={() => undefined}
      onStarter={() => undefined}
    />,
  );

describe('the example picker before anything is chosen', () => {
  const html = render();

  it('offers every card, and names each button for its card, the fictional starter too', () => {
    expect(html.match(/class="example-card/gu)).toHaveLength(3);
    const names = [...html.matchAll(/aria-label="(Use this example: [^"]+)"/gu)].map((m) => m[1]);
    expect(names).toEqual([
      'Use this example: A price change',
      'Use this example: A launch',
      `Use this example: ${STARTER.title}`,
    ]);
    // The same words and the same arrow on every card.
    const buttons = [...html.matchAll(/<button[^>]*>([^]*?)<\/button>/gu)].map((m) =>
      visibleText(m[1] ?? ''),
    );
    expect(buttons).toEqual(['Use this example', 'Use this example', 'Use this example']);
    expect(html).not.toContain('Load fictional starter input');
  });

  it('shows its heading to everyone, and no line about a loaded example', () => {
    expect(html).toMatch(/<h3 id="[^"]+">Not sure what to ask\? Try an example<\/h3>/u);
    expect(html).not.toContain('Example loaded');
    expect(html).not.toContain('Change example');
  });
});

describe('the example picker once an example has been loaded', () => {
  const html = render(LOADED);

  it('says which, in a line where the person is looking, and what came with it', () => {
    expect(html).toMatch(/<div class="example-loaded-text" role="status">/u);
    const text = visibleText(html);
    expect(text).toContain('Example loaded: A price change (2 documents · sample evidence)');
    expect(text).toContain('No results come with an example.');
  });

  it('takes the cards away, and keeps a way to change the example', () => {
    expect(html).not.toContain('class="example-card');
    expect(html).not.toContain('class="example-list');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Change example<\/button>/u);
    expect(html).not.toContain('Keep “');
  });

  it('keeps the region and its name for a screen reader, without the heading taking room', () => {
    expect(html).toMatch(
      /<section class="example-picker" aria-labelledby="([^"]+)"><h3 id="\1" class="sr-only">Not sure what to ask\? Try an example<\/h3>/u,
    );
  });

  it('does not offer to change the example while the form is working', () => {
    expect(render(LOADED, true)).toMatch(/<button[^>]*disabled=""[^>]*>Change example<\/button>/u);
  });

  it('says that the fictional starter is invented input, in the words it always did', () => {
    const text = visibleText(
      render({ kind: 'starter', title: STARTER.title, evidence: STARTER.evidence }),
    );
    expect(text).toContain('Fictional starter INPUT loaded: Fictional library hours');
    expect(text).toContain('This editable input is invented for learning the workflow.');
    expect(text).toContain('No prerecorded outputs or case-study results are included.');
  });
});
