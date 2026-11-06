import { afterAll, describe, expect, it } from 'vitest';
import { frameOf, questionIn } from '../support/public-brain.js';
import { closeWorlds, openWorld, own, KEY } from '../support/public-world.js';

afterAll(closeWorlds);

const QUESTION = 'What could happen if the night bus route moves to a new corridor next spring?';
const read = (
  w: Awaited<ReturnType<typeof openWorld>>,
  who: Awaited<ReturnType<typeof w.person>>,
  headers = {},
) =>
  w.send(
    who,
    'POST',
    '/api/scenario/parse',
    { question: QUESTION, documents: [], useModel: true },
    headers,
  );

/** The first model-assisted step of every person: the question is read into a scenario, by a model, or by rules with a note. */
describe('a question that a person asks a model to read', () => {
  it('is read by the free model, and by rules with the refusal in its own words once the free tier is used up', async () => {
    const w = await openWorld({ environment: { FREE_USER_DAILY_CALLS: '1' } });
    w.foundry.reply = (_call, body) => w.foundry.ok(undefined, frameOf(questionIn(body)));
    const alice = await w.person();
    const first = await read(w, alice);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ mode: 'model' });
    expect(w.foundry.seen).toHaveLength(1);

    // The page asks again: the free tier says no, and the reading is made by rules, with the words of the refusal.
    const second = await read(w, alice);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ mode: 'rules', model: null });
    const notes = (second.json().notes as string[]).join('\n');
    expect(notes).toContain(
      'The model was not used: You have used today’s free runs. They come back at 00:00 UTC, or you can use your own key now. The rules read this question instead.',
    );
    expect(notes).not.toMatch(/something went wrong|FREE_TIER_USER_CAP/u);
    expect(w.foundry.seen).toHaveLength(1);

    // Somebody else on the free tier is not held to it, and a person on their own key never is.
    const bob = await w.person();
    w.gemini.reply = (_call, seen) => w.gemini.ok(frameOf(questionIn(seen.body)));
    const mine = await read(w, alice, own());
    expect(mine.json()).toMatchObject({ mode: 'model', model: 'gemini-2.5-flash' });
    expect(w.foundry.seen).toHaveLength(1);
    expect((await read(w, bob)).json()).toMatchObject({ mode: 'model' });
    expect(w.answers.join('\n')).not.toContain(KEY);
  });

  it('is read by rules when the free tier is switched off or a key is not accepted, and says which, in plain words', async () => {
    const w = await openWorld({ environment: { FREE_TIER_ENABLED: 'false' } });
    const alice = await w.person();
    const off = await read(w, alice);
    expect(off.json()).toMatchObject({ mode: 'rules' });
    expect((off.json().notes as string[]).join('\n')).toContain(
      'The model was not used: The free tier is switched off right now. You can still use your own key. The rules read this question instead.',
    );
    expect(w.foundry.seen).toHaveLength(0);

    const refused = await read(w, alice, own('AIzaSyUnknownUnknownUnknownUnknownUn_00'));
    expect(refused.json()).toMatchObject({ mode: 'rules' });
    const notes = (refused.json().notes as string[]).join('\n');
    expect(notes).toMatch(/^The model was not used: .+ The rules read this question instead\.$/mu);
    expect(notes).not.toMatch(/something went wrong|BYOK_|AIzaSy/u);
  });
});
