import { describe, expect, it } from 'vitest';
import { clip, embed } from '../src/brief/text.js';

describe('shortening a text for a sentence of the brief', () => {
  const text = 'The finding held in fourteen of thirty seeded runs under the proposed change';

  it('leaves a text that fits as it is', () => {
    expect(clip(text, 200)).toBe(text);
  });

  it('ends at a word when that loses little of the room, so that no word is cut in two', () => {
    const out = clip(text, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(50);
    // What is kept is the start of the text and ends where a space was.
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
    expect(text[out.length - 1]).toBe(' ');
  });

  it('cuts where the room ends when a long word would otherwise lose most of it', () => {
    const word = 'x'.repeat(100);
    const out = clip(`a ${word}`, 40);
    expect(out).toBe(`a ${'x'.repeat(37)}…`);
  });

  it('puts the shortened text in curly quotation marks, so that it reads as someone else’s', () => {
    const out = embed(text, 50);
    expect(out.startsWith('“')).toBe(true);
    expect(out.endsWith('…”')).toBe(true);
  });
});
