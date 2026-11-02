// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, reduceMotion, renderWithApp, screen, setBox } from '../../test/dom';
import { Scrubber } from './Scrubber';
import { usePlayback } from './usePlayback';

// The scrubber is what a person watches a run with: it plays, pauses, steps and seeks, and it is a slider,
// so everything it does can be done from the keyboard. It is used here with the playback it is made for.

const EVENTS = new Map([
  [2, 1],
  [5, 2],
]);

function Run({
  first = 1,
  last = 8,
  autoplay = false,
}: {
  first?: number;
  last?: number;
  autoplay?: boolean;
}) {
  const playback = usePlayback(first, last, { autoplay });
  return <Scrubber playback={playback} first={first} last={last} changeRound={3} events={EVENTS} />;
}

const slider = () => screen.getByRole('slider', { name: 'Round' });
const round = () => Number(slider().getAttribute('aria-valuenow'));
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

/** The clock is the test's: a round is 900 ms long, and none goes by unless a test lets it. */
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('the slider', () => {
  it('is named, says where it is in words, and starts on the last round of a run that is not played', () => {
    renderWithApp(<Run />);
    expect(slider().getAttribute('aria-valuemin')).toBe('1');
    expect(slider().getAttribute('aria-valuemax')).toBe('8');
    expect(round()).toBe(8);
    expect(slider().getAttribute('aria-valuetext')).toBe('Round 8 of 8');
    expect(slider().tabIndex).toBe(0);
  });

  it('steps with the arrows one round at a time, and with the page keys three, and stops at its ends', async () => {
    const { user } = renderWithApp(<Run />);
    slider().focus();

    await user.keyboard('{ArrowLeft}');
    expect(round()).toBe(7);
    await user.keyboard('{ArrowDown}');
    expect(round()).toBe(6);
    await user.keyboard('{ArrowRight}');
    expect(round()).toBe(7);
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(round()).toBe(8);

    await user.keyboard('{PageDown}');
    expect(round()).toBe(5);
    await user.keyboard('{PageUp}');
    expect(round()).toBe(8);
    await user.keyboard('{PageDown}{PageDown}{PageDown}{PageDown}');
    expect(round()).toBe(1);
    await user.keyboard('{ArrowLeft}');
    expect(round()).toBe(1);
    expect(slider().getAttribute('aria-valuetext')).toBe('Round 1 of 8');
  });

  it('jumps to the first round with Home and the last with End', async () => {
    const { user } = renderWithApp(<Run />);
    slider().focus();
    await user.keyboard('{Home}');
    expect(round()).toBe(1);
    await user.keyboard('{End}');
    expect(round()).toBe(8);
  });

  it('keeps the keys it uses from also scrolling the page, and leaves the others alone', () => {
    renderWithApp(<Run />);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']) {
      expect(fireEvent.keyDown(slider(), { key }), key).toBe(false);
    }
    expect(fireEvent.keyDown(slider(), { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(slider(), { key: 'a' })).toBe(true);
  });

  it('is set by a press on the track, and follows the pointer while it is held', async () => {
    const { user } = renderWithApp(<Run />);
    setBox(slider(), { width: 700, height: 12, left: 0, top: 0 });

    await user.pointer({ keys: '[MouseLeft>]', target: slider(), coords: { clientX: 300 } });
    // 300 of 700 is 43% of the way from round 1 to round 8.
    expect(round()).toBe(4);
    await user.pointer({ target: slider(), coords: { clientX: 700 } });
    expect(round()).toBe(8);
    await user.pointer({ target: slider(), coords: { clientX: 0 } });
    expect(round()).toBe(1);
    await user.pointer({ keys: '[/MouseLeft]', target: slider(), coords: { clientX: 0 } });
    // Once it is let go, the pointer does not move it.
    await user.pointer({ target: slider(), coords: { clientX: 500 } });
    expect(round()).toBe(1);
  });
});

describe('playing', () => {
  it('plays from the first round when asked to, a round at a time, and stops on the last', async () => {
    vi.useFakeTimers();
    renderWithApp(<Run autoplay />);
    expect(round()).toBe(1);
    expect(button('Pause').getAttribute('aria-pressed')).toBe('true');

    await later(950);
    expect(round()).toBe(2);
    await later(900);
    expect(round()).toBe(3);
    // A round is one timer, set when the one before it has been drawn.
    for (let rounds = 0; rounds < 5; rounds += 1) await later(900);
    expect(round()).toBe(8);
    // It has reached the end: it is not playing, and the way on is to play it again.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(button('Play again')).toBeTruthy();
  });

  it('pauses where it is with the button, and plays on from there', async () => {
    vi.useFakeTimers();
    const { user } = renderWithApp(<Run autoplay />);
    await later(950);
    expect(round()).toBe(2);

    await user.click(button('Pause'));
    expect(button('Play').getAttribute('aria-pressed')).toBe('false');
    await later(3000);
    expect(round()).toBe(2);

    await user.click(button('Play'));
    expect(button('Pause').getAttribute('aria-pressed')).toBe('true');
    await later(950);
    expect(round()).toBe(3);
  });

  it('plays and pauses with Space on the slider, and says so on the button', async () => {
    vi.useFakeTimers();
    const { user } = renderWithApp(<Run autoplay />);
    slider().focus();
    expect(button('Pause')).toBeTruthy();

    await user.keyboard(' ');
    expect(button('Play').getAttribute('aria-pressed')).toBe('false');
    await later(2000);
    expect(round()).toBe(1);

    await user.keyboard(' ');
    expect(button('Pause').getAttribute('aria-pressed')).toBe('true');
    await later(950);
    expect(round()).toBe(2);
  });

  it('plays a run again from its start, when it has reached its end', async () => {
    vi.useFakeTimers();
    const { user } = renderWithApp(<Run />);
    expect(round()).toBe(8);
    await user.click(button('Play again'));

    expect(round()).toBe(1);
    expect(button('Pause').getAttribute('aria-pressed')).toBe('true');
    await later(950);
    expect(round()).toBe(2);
  });

  it('stops when the person steps or seeks, so that the run is never moved against them', async () => {
    vi.useFakeTimers();
    const { user } = renderWithApp(<Run autoplay />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(round()).toBe(2);
    expect(button('Play').getAttribute('aria-pressed')).toBe('false');
    await later(3000);
    expect(round()).toBe(2);

    await user.click(button('Next round'));
    expect(round()).toBe(3);
    slider().focus();
    await user.keyboard('{End}');
    expect(round()).toBe(8);
  });

  it('plays twice as fast, half as fast, and as it was, with the speed button', async () => {
    vi.useFakeTimers();
    const { user } = renderWithApp(<Run autoplay />);
    expect(button('1× speed. Change').textContent).toBe('1×');

    await user.click(button('1× speed. Change'));
    expect(button('2× speed. Change').textContent).toBe('2×');
    await later(500);
    expect(round()).toBe(2);

    await user.click(button('2× speed. Change'));
    expect(button('0.5× speed. Change').textContent).toBe('0.5×');
    await later(1000);
    expect(round()).toBe(2);
    await later(900);
    expect(round()).toBe(3);

    await user.click(button('0.5× speed. Change'));
    expect(button('1× speed. Change').textContent).toBe('1×');
  });

  it('is never played to a person who has asked for less motion: it waits on the last round', async () => {
    reduceMotion(true);
    vi.useFakeTimers();
    renderWithApp(<Run autoplay />);
    expect(round()).toBe(8);
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    await later(5000);
    expect(round()).toBe(8);
  });
});

describe('the buttons beside the slider', () => {
  it('step back and forward, and are not offered where there is nowhere to go', async () => {
    const { user } = renderWithApp(<Run />);
    expect(button('Next round').disabled).toBe(true);
    expect(button('Previous round').disabled).toBe(false);

    await user.click(button('Previous round'));
    expect(round()).toBe(7);
    expect(button('Next round').disabled).toBe(false);
    await user.click(button('Next round'));
    expect(round()).toBe(8);

    slider().focus();
    await user.keyboard('{Home}');
    expect(button('Previous round').disabled).toBe(true);
    expect(round()).toBe(1);
  });

  it('can all be reached by Tab, in the order they are used, with the slider after them', async () => {
    const { user } = renderWithApp(<Run />);
    await user.tab();
    expect(document.activeElement).toBe(button('Play again'));
    await user.tab();
    expect(document.activeElement).toBe(button('Previous round'));
    await user.tab();
    // The next round is not offered at the last round, so the slider is next.
    expect(document.activeElement).toBe(slider());
    await user.tab();
    expect(document.activeElement).toBe(button('1× speed. Change'));
  });
});
