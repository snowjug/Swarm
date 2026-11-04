import { describe, expect, it } from 'vitest';
import { Breakers } from '../src/research/crawler/breaker.js';
import { HostGate } from '../src/research/crawler/limiter.js';
import { passEnd, wakeAfter } from '../src/research/crawler/schedule.js';
import type { CrawlEvent, PageFetcher } from '../src/research/crawler/types.js';
import {
  A,
  B,
  drive,
  FakeNetwork,
  fan,
  htmlPage,
  seedOf as seed,
  trial,
  VirtualClock,
  type Route,
  type Trial,
} from './support/research-world.js';

const START = 1_800_000_000_000;
const eventsOf = <T extends CrawlEvent['type']>(done: Trial, type: T) =>
  done.events.filter((event): event is Extract<CrawlEvent, { type: T }> => event.type === type);

/** A clock for the tests of a crawl's waits: its waits end `early` ms before the time they were asked for, and `creep` ms pass each time it is read. */
const clockWith = (early: number, creep: number): VirtualClock => {
  const clock = new VirtualClock();
  clock.earlyMs = early;
  clock.creepMs = creep;
  return clock;
};

describe('a crawl that waits on timers that end early', () => {
  // The waits of a real clock end before the time that the clock a crawl reads says has come (Node's timers
  // do, by a millisecond, in a few waits in a hundred), and time passes while the crawl works, between one
  // reading of the clock and the next. A crawl that decided what to start from one reading, and what to wait
  // for from another, was left now and then with an address queued, nothing being read and nothing to wake it
  // but the time limit of the run: it said "the time limit was reached" with pages unread (J-03).
  const crawlOn = (clock: VirtualClock, count = 4): Promise<Trial> =>
    trial(fan(count), {
      clock,
      input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 250 } },
    });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'reads every page, and stops because there is nothing left, when its waits end %i ms early and each reading of the clock takes a millisecond',
    async (early) => {
      const done = await crawlOn(clockWith(early, 1));
      expect(done.result.stoppedBecause).toBe('frontier-exhausted');
      expect(done.result.used.pages).toBe(5);
      // Nothing waited for the time limit of the run, which is two minutes.
      expect(done.result.used.elapsedMs).toBeLessThan(20_000);
    },
  );

  it.each([
    [0, 1],
    [0, 3],
    [1, 0],
    [3, 0],
    [2, 2],
    [5, 3],
  ])(
    'does the same with waits that end %i ms early and %i ms for each reading of the clock',
    async (early, creep) => {
      const done = await crawlOn(clockWith(early, creep), 6);
      expect(done.result.stoppedBecause).toBe('frontier-exhausted');
      expect(done.result.used.pages).toBe(7);
      expect(done.result.used.elapsedMs).toBeLessThan(20_000);
    },
  );

  it.each([2, 5, 7])(
    'does the same for several sites at once, with waits that end %i ms early',
    async (early) => {
      const done = await trial(
        { ...fan(3, A), ...fan(3, B) },
        {
          clock: clockWith(early, 1),
          input: {
            seeds: [seed(`${A}/`), seed(`${B}/`)],
            budget: { perDomainDelayMs: 250, maxDomains: 2 },
          },
        },
      );
      expect(done.result.stoppedBecause).toBe('frontier-exhausted');
      expect(done.result.used.pages).toBe(8);
      expect(done.result.used.elapsedMs).toBeLessThan(20_000);
    },
  );

  it('keeps the delay between requests to a site, however early its waits end', async () => {
    const done = await trial(fan(3), {
      clock: clockWith(3, 0),
      input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 1_000 } },
    });
    const times = done.network.calls.map((call) => call.at - START);
    for (let index = 1; index < times.length; index += 1) {
      // A request is let go at least the delay after the one before it ended (nothing here takes any time).
      expect(times[index]! - times[index - 1]!, `request ${index}`).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('tries again after the wait for a retry, and goes on, when its waits end early', async () => {
    const attempts: Record<string, Route> = {
      ...fan(2),
      [`${A}/p0`]: (call) =>
        call === 1 ? { status: 503, body: 'try later' } : htmlPage('Page', 2),
    };
    const done = await trial(attempts, {
      clock: clockWith(3, 1),
      input: { seeds: [seed(`${A}/`)] },
    });
    expect(done.network.asked(`${A}/p0`)).toBe(2);
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
    expect(done.result.used.pages).toBe(3);
  });

  it('stops at its time limit, and not before or long after, when the wait for the limit ends early', async () => {
    for (const early of [1, 4]) {
      const done = await trial(fan(40), {
        clock: clockWith(early, 1),
        input: { seeds: [seed(`${A}/`)], budget: { perDomainDelayMs: 1_000, maxElapsedMs: 5_000 } },
      });
      expect(done.result.stoppedBecause, `${early}`).toBe('time-limit');
      expect(done.result.used.elapsedMs, `${early}`).toBeGreaterThanOrEqual(5_000);
      expect(done.result.used.elapsedMs, `${early}`).toBeLessThan(5_500);
    }
  });

  it('reads what is queued on a site whose place a fetcher did not give back, and says that it put that right', async () => {
    const routes: Record<string, Route> = {
      [`${A}/`]: htmlPage('Home', 1, [['/leak', 'Leak']]),
      [`${A}/leak`]: htmlPage('Leak', 2, [[`${B}/after`, 'After']]),
      [`${B}/after`]: htmlPage('After', 3),
    };
    const clock = new VirtualClock();
    const network = new FakeNetwork(clock, routes);
    // A fetcher that takes a place on another site, as a request to it does, and does not give it back.
    const fetcher: PageFetcher = {
      policy: network.policy,
      async fetch(request) {
        if (request.url === `${A}/leak`) {
          await request.hooks.beforeRequest?.(
            { host: 'b.example.org', purpose: 'page' },
            request.signal,
          );
        }
        return network.fetch(request);
      },
    };
    const done = await trial(routes, {
      clock,
      deps: { fetcher },
      input: {
        seeds: [seed(`${A}/`)],
        hints: { terms: [], domains: ['b.example.org'] },
        budget: { maxDepth: 2 },
      },
    });
    expect(network.pagesAsked()).toEqual([`${A}/`, `${A}/leak`, `${B}/after`]);
    expect(done.result.used.pages).toBe(3);
    expect(done.result.stoppedBecause).toBe('frontier-exhausted');
    expect(eventsOf(done, 'scheduler-recovered')).toMatchObject([
      { reason: 'place-not-given-back', hosts: 1, queued: 1 },
    ]);
  });

  it('says nothing of the kind when nothing went wrong', async () => {
    const done = await crawlOn(clockWith(3, 1));
    expect(eventsOf(done, 'scheduler-recovered')).toEqual([]);
  });
});

describe('how a pass of the loop of a crawl can end', () => {
  const reads = [0, 1, 3];
  const queues = [0, 1, 40];
  const readies = [0, 0.4, 1, 2, 250, 10_000, Number.POSITIVE_INFINITY];
  const timesLeft = [-5, 0, 1, 119_000];

  it('is reading, done, waiting for a place, or stuck, and only stuck leaves addresses queued with nothing to wake the crawl for them', () => {
    for (const reading of reads) {
      for (const queued of queues) {
        for (const ready of readies) {
          const end = passEnd({ reading, queued, ready });
          const label = JSON.stringify({ reading, queued, ready, end });
          if (reading > 0) expect(end, label).toBe('reading');
          else if (queued === 0) expect(end, label).toBe('done');
          else expect(end, label).toBe(Number.isFinite(ready) ? 'waiting' : 'stuck');
          for (const timeLeft of timesLeft) {
            const waits = wakeAfter({ ready, reading, timeLeft });
            // The time limit is always asked for, and never for no time at all.
            expect(waits[0], label).toBeGreaterThanOrEqual(1);
            if (end === 'waiting') {
              // Nothing is being read: the wait for the next place is asked for, whatever is left of it.
              expect(waits, label).toHaveLength(2);
              expect(waits[1], label).toBeGreaterThanOrEqual(1);
              expect(waits[1], label).toBeGreaterThanOrEqual(ready);
            }
          }
        }
      }
    }
  });

  it('asks for the wait for a place when none of it is left, which is the state in which a crawl slept to its time limit with an address waiting', () => {
    expect(passEnd({ reading: 0, queued: 3, ready: 0 })).toBe('waiting');
    expect(wakeAfter({ ready: 0, reading: 0, timeLeft: 100_000 })).toEqual([100_000, 1]);
    expect(wakeAfter({ ready: 0.4, reading: 0, timeLeft: 100_000 })).toEqual([100_000, 1]);
    expect(wakeAfter({ ready: 250, reading: 0, timeLeft: 100_000 })).toEqual([100_000, 250]);
  });

  it('does not ask for a wait that would only wake the crawl again and again while reads are going on and the places for an address that could be read are taken', () => {
    expect(wakeAfter({ ready: 0, reading: 3, timeLeft: 100_000 })).toEqual([100_000]);
    expect(wakeAfter({ ready: 250, reading: 3, timeLeft: 100_000 })).toEqual([100_000, 250]);
    expect(wakeAfter({ ready: Number.POSITIVE_INFINITY, reading: 3, timeLeft: 100_000 })).toEqual([
      100_000,
    ]);
  });
});

describe('the wait between requests to a site', () => {
  const signal = new AbortController().signal;
  const gateOn = (clock: VirtualClock, delay = 1_000): HostGate => new HostGate(clock, () => delay);

  it('is judged by the reading of the clock a caller gives it, and not by the clock', async () => {
    const clock = new VirtualClock();
    const gate = gateOn(clock);
    (await gate.acquire('h', signal))();
    const ended = clock.now();
    expect(gate.readyIn('h', ended + 999)).toBe(1);
    expect(gate.readyIn('h', ended + 1_000)).toBe(0);
    // The clock has moved on, and what was asked of an earlier reading is still answered by it.
    clock.advance(5_000);
    expect(gate.readyIn('h', ended + 600)).toBe(400);
    expect(gate.readyIn('h')).toBe(0);
  });

  it('says Infinity while a request holds the place, and 0 for a site it has not met', async () => {
    const clock = new VirtualClock();
    const gate = gateOn(clock);
    expect(gate.readyIn('new')).toBe(0);
    const release = await gate.acquire('h', signal);
    expect(gate.readyIn('h', clock.now() + 1_000_000)).toBe(Number.POSITIVE_INFINITY);
    release();
    expect(gate.readyIn('h')).toBe(1_000);
  });

  it('gives back a place that was held, and says whether there was one', async () => {
    const clock = new VirtualClock();
    const gate = gateOn(clock);
    expect(gate.settle('h')).toBe(false);
    await gate.acquire('h', signal);
    expect(gate.settle('h')).toBe(true);
    expect(gate.settle('h')).toBe(false);
    expect(gate.readyIn('h')).toBe(1_000);
  });

  it('is waited out in full by a request, though the wait ends before the clock says the time has come', async () => {
    const clock = clockWith(4, 0);
    const gate = gateOn(clock, 250);
    (await gate.acquire('h', signal))();
    const ended = clock.now();
    const release = await drive(clock, gate.acquire('h', signal));
    expect(clock.now() - ended).toBeGreaterThanOrEqual(250);
    release();
  });

  it('does not make a site wait for however far the clock was put back as well as for the delay', async () => {
    const clock = new VirtualClock();
    const gate = gateOn(clock);
    (await gate.acquire('h', signal))();
    clock.advance(-60_000);
    expect(gate.readyIn('h')).toBeLessThanOrEqual(1_000);
    clock.advance(1_000);
    expect(gate.readyIn('h')).toBe(0);
    // A request, too, waits no longer than that.
    const started = clock.now();
    clock.advance(-120_000);
    const release = await drive(clock, gate.acquire('h', signal));
    expect(clock.now() - (started - 120_000)).toBeLessThanOrEqual(1_000 + 5);
    release();
  });
});

describe('the breaker, when the clock is put back', () => {
  it('opens again after its cooldown, and not after the cooldown and however far the clock was put back', () => {
    let now = START;
    const breakers = new Breakers(() => now, 1, 1_000);
    expect(breakers.failure('h')).toMatchObject({ opened: true });
    now = START - 60_000;
    expect(breakers.check('h')).toMatchObject({
      allowed: false,
      state: 'open',
      reopensInMs: 1_000,
    });
    now += 999;
    expect(breakers.check('h')).toMatchObject({ allowed: false, state: 'open', reopensInMs: 1 });
    now += 1;
    expect(breakers.check('h')).toMatchObject({ allowed: true, state: 'half-open' });
  });
});
