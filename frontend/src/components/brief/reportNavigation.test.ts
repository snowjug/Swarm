import { describe, expect, it } from 'vitest';
import { BRIEF_SECTION_IDS } from '../../../../shared/brief';
import { isPlainClick, openByDefault, sectionFromHash } from './reportNavigation';

describe('which sections of the brief are open until they are wanted', () => {
  it('opens the answer and what was found, and closes the reference, by id', () => {
    const open = BRIEF_SECTION_IDS.filter(openByDefault);
    expect(open).toEqual([
      'executive-answer',
      'decision',
      'reaction-patterns',
      'alternative-outcomes',
      'first-order',
      'second-order',
      'drivers',
      'risks-opportunities',
      'recommendations',
    ]);
    // What a person checks before acting on it, and what the brief cannot tell them, are closed but listed.
    expect(openByDefault('validation-plan')).toBe(false);
    expect(openByDefault('limitations')).toBe(false);
  });
});

describe('the section a URL hash names', () => {
  it('finds a section by the anchor the contents link to, and by its number in the contents', () => {
    expect(sectionFromHash('#brief-validation-plan')).toBe('validation-plan');
    expect(sectionFromHash('brief-limitations')).toBe('limitations');
    expect(sectionFromHash('#brief-13')).toBe('recommendations');
    expect(sectionFromHash('#brief-1')).toBe('executive-answer');
    expect(sectionFromHash('#brief-17')).toBe('technical-appendix');
  });

  it('leaves alone a hash that is not about a section of this brief', () => {
    for (const hash of [
      '',
      '#',
      '#main-content',
      '#brief-',
      '#brief-0',
      '#brief-18',
      '#brief-nope',
    ]) {
      expect(sectionFromHash(hash), hash).toBeNull();
    }
    // A brief without a section does not offer it, by name or by number.
    const present = BRIEF_SECTION_IDS.filter((id) => id !== 'limitations');
    expect(sectionFromHash('#brief-limitations', present)).toBeNull();
    expect(sectionFromHash('#brief-16', present)).toBe('technical-appendix');
  });
});

describe('which clicks the page answers itself', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('leaves a click that opens a new tab or window to the browser', () => {
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
  });
});
