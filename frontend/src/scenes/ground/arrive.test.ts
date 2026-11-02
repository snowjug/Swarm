// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { opener } from './arrive';

// Safari does not focus a button when it is pressed, so what had the person's attention is the control that was
// pressed. design/useReturnFocus is the one place that listens for the press.

const add = (tag: string): HTMLElement => document.body.appendChild(document.createElement(tag));
const press = (target: Element) =>
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

afterEach(() => document.body.replaceChildren());

describe('what had the attention when a sheet opened', () => {
  it('is the control that has focus, whatever was pressed', () => {
    const pressed = add('button');
    const focused = add('button');
    press(pressed);
    focused.focus();
    expect(opener()).toBe(focused);
  });

  it('is the control just pressed when nothing has focus, for as long as it is on the page', () => {
    const button = add('button');
    press(button);
    expect(document.activeElement).toBe(document.body);
    expect(opener()).toBe(button);
    button.remove();
    expect(opener()).toBeNull();
  });

  it('is nothing when the last press landed on no control', () => {
    press(add('button'));
    press(add('p'));
    expect(opener()).toBeNull();
  });
});
