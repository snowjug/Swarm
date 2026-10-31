import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModeSwitch } from './ModeSwitch';

describe('the interface mode switch', () => {
  const render = (mode: 'guided' | 'advanced') =>
    renderToStaticMarkup(<ModeSwitch mode={mode} onChoose={() => {}} />);

  it('is one named group of two buttons, Guided first', () => {
    const html = render('guided');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Interface mode"');
    expect([...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)].map((m) => m[1])).toEqual([
      'Guided',
      'Advanced',
    ]);
  });

  it('presses exactly the current mode, so that it is told by more than colour', () => {
    expect(render('guided').match(/aria-pressed="true"[^>]*>Guided/gu)).toHaveLength(1);
    expect(render('guided')).toContain('aria-pressed="false"');
    expect(render('advanced').match(/aria-pressed="true"[^>]*>Advanced/gu)).toHaveLength(1);
    expect(render('advanced').match(/aria-pressed="true"/gu)).toHaveLength(1);
  });

  it('says what each mode does, as a hint that does not carry the meaning alone', () => {
    const html = render('guided');
    expect(html).toContain('title="Plain-language help under each step."');
    expect(html).toContain('title="Engine terms and diagnostics, open by default."');
  });
});
