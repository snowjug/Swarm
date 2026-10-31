import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PIPELINE, POSITIONING_STATEMENT } from '../../lib/product';
import { visibleText } from '../../test/provider';
import { LandingHero } from './LandingHero';

describe('landing hero', () => {
  const html = renderToStaticMarkup(<LandingHero />);

  it('leads with the question the product answers, as the one h1 on the page', () => {
    expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>What could happen if…\?<\/h1>/u);
    expect(html).toContain('aria-labelledby="landing-heading"');
  });

  it('states in the exact words that Swarm explores scenarios and does not guarantee or predict', () => {
    expect(POSITIONING_STATEMENT).toBe(
      'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
    );
    expect(html).toContain(`<p class="positioning-statement">${POSITIONING_STATEMENT}</p>`);
  });

  it('draws the whole path from evidence to a decision as a numbered list', () => {
    expect(html).toContain('<ol class="pipeline" aria-label="How Swarm works">');
    const items = [...html.matchAll(/<li>[\s\S]*?<\/li>/gu)].map((match) => visibleText(match[0]));
    expect(items).toHaveLength(8);
    PIPELINE.forEach((step, index) => {
      expect(items[index]).toContain(step.label);
      expect(items[index]).toContain(step.caption);
    });
    expect(visibleText(html).indexOf('Evidence')).toBeLessThan(
      visibleText(html).indexOf('Decision'),
    );
  });

  it('says nothing that promises a result: it is an exploration', () => {
    const rest = visibleText(html.replace(POSITIONING_STATEMENT, ''));
    expect(rest).not.toMatch(/\b(predicts?|predicted|forecasts?|guarantees?)\b/iu);
  });
});
