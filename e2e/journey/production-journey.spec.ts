import { expect, test } from '@playwright/test';
import {
  ADDRESSES,
  CANARIES,
  FEE,
  INJECTED,
  JOURNEY_QUESTION,
  OFFICIAL,
  OPERATORS,
  TITLES,
  type InstanceName,
} from '../../backend/test/support/journey-protocol';
import {
  DECISION_STATUS_INFO,
  EPISTEMIC_LABELS,
  EPISTEMIC_LABEL_INFO,
} from '../../shared/decision';
import { RESEARCH_STAGES } from '../../shared/research';
import { step as journeyStep, expectScene, goTo } from '../support/app';
import { expectAttached, tray } from '../support/ask';
import { claimsAgainst } from '../support/claims';
import {
  expectSound,
  inDocuments,
  ledgerOf,
  openConflicts,
  passageButton,
  passagesOf,
  pill,
  sheet,
  sourceButton,
  sourcesSection,
  stakeholdersViewOf,
} from '../support/ground-map';
import { watchPage } from '../support/helpers';
import { deployed, harness, instanceUrl, numberIn, shoot } from '../support/journey';
import {
  analysesOf,
  analysisOf,
  constraintsOf,
  critiquesOf,
  decisionOf,
  everythingSaidOf,
  exportOf,
  projectOf,
  researchOf,
} from '../support/journey-api';
import { sha256Of } from '../support/journey-hash';
import {
  ask,
  briefTools,
  canvas,
  chip,
  expectSoundExceptDimmedRows,
  figure,
  gateRegion,
  openProvenance,
  pageRow,
  pagesList,
  participantCard,
  participantNames,
  press,
  researchSection,
  reviewSheet,
  signIn,
  stage,
  useActors,
} from '../support/journey-ui';
import { NINE, viewItem } from '../support/decide';
import { quiet } from '../support/shell';
import { expectNoForecasts } from '../support/simulate';

// The critical journey, from sign-in to the decision canvas and its export, in a real browser, against the whole product
// (docs/production/journey.md). Eighteen named steps, run as a person would run them. What is real and what is replaced
// is written at the head of backend/test/support/journey-server.ts and in the docs: the application, the crawler, the
// database and the sign-in are real; Microsoft Entra, Foundry, the public web and the search provider are stand-ins.
//
// Against a deployed endpoint (SWARM_JOURNEY_URL) the same steps run with what the endpoint has: the person is signed
// in already, names a public page (SWARM_JOURNEY_SITE), and every step that needs the harness is skipped and says so.

interface Variant {
  id: string;
  title: string;
  instance: InstanceName;
  engine: 'Local rules' | 'Model assisted';
}

const VARIANTS: Variant[] = [
  {
    id: 'A-rules',
    title: 'flow A (a page is named), rules alone',
    instance: 'rules',
    engine: 'Local rules',
  },
];

/** A step that needs what only the harness has: run in the harness, said and skipped on a deployed endpoint. */
async function harnessStep(title: string, body: () => Promise<void>): Promise<void> {
  if (deployed) {
    await test.step(`${title} (skipped: needs the harness)`, async () => {
      test.info().annotations.push({ type: 'skipped step', description: title });
    });
    return;
  }
  await test.step(title, body);
}

for (const variant of VARIANTS) {
  test.describe(`the production journey: ${variant.title}`, () => {
    test.describe.configure({ mode: 'serial' });
    test.use({ baseURL: instanceUrl(variant.instance) });
    test.beforeEach(async () => {
      if (!deployed) await harness.reset();
    });

    test(`${variant.id}: a question, researched, becomes a decision canvas and an export that say what they rest on`, async ({
      page,
    }) => {
      test.setTimeout(540_000);
      // What the page does wrong is watched from the moment the person is in: the first visit, before signing in, is
      // refused by the server (401) as it should be, and the page goes to sign in.
      let problems: string[] = [];
      const shot = (name: string, full = true) => shoot(page, `${variant.id}-${name}`, { full });
      const model = variant.engine === 'Model assisted';
      const site = deployed ? (process.env.SWARM_JOURNEY_SITE ?? '') : ADDRESSES.fees;
      test.skip(
        deployed && site === '',
        'Name a public page that may be read: SWARM_JOURNEY_SITE.',
      );
      const question = deployed
        ? (process.env.SWARM_JOURNEY_QUESTION ?? JOURNEY_QUESTION)
        : JOURNEY_QUESTION;
      const startedAt = new Date().toISOString();
      let project = '';
      let feesHash = '';

      // -- 1 ---------------------------------------------------------------------------------
      await test.step('1 · sign in with Microsoft Entra (OIDC, Authorization Code with PKCE)', async () => {
        await signIn(page, 'analyst');
        if (!deployed) {
          const visits = await harness.identityVisits();
          expect(visits, 'the identity provider was asked once').toHaveLength(1);
          const asked = visits[0]!;
          expect(asked).toMatchObject({
            response_type: 'code',
            scope: 'openid profile',
            code_challenge_method: 'S256',
          });
          expect(asked.code_challenge, 'a PKCE challenge').toMatch(/^[A-Za-z0-9_-]{43}$/u);
          expect(asked.state?.length, 'a state').toBeGreaterThanOrEqual(16);
          expect(asked.nonce?.length, 'a nonce').toBeGreaterThanOrEqual(16);
          expect(asked, 'no client secret goes through the browser').not.toHaveProperty(
            'client_secret',
          );
          expect(asked, 'the verifier stays on the server').not.toHaveProperty('code_verifier');
        }
        // The session is a cookie that a script cannot read, and no token is anywhere that a script can reach.
        const cookie = (await page.context().cookies()).find((item) =>
          /swarm_session$/u.test(item.name),
        );
        expect(cookie, 'the session cookie').toMatchObject({
          httpOnly: true,
          sameSite: 'Lax',
          path: '/',
        });
        expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        const reachable = await page.evaluate(() => ({
          cookie: document.cookie,
          stores: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
        }));
        expect(reachable.cookie).toBe('');
        expect(reachable.stores).not.toContain(cookie!.value);
        expect(reachable.stores).not.toMatch(/eyJ|access_token|id_token/u);
        expect(await (await page.request.get('/api/session')).json()).toMatchObject({
          authenticated: true,
          via: 'session',
        });
        problems = watchPage(page);
      });

      // -- 2 ---------------------------------------------------------------------------------
      await test.step('2 · the landing page says what Swarm is and is not, and asks one thing', async () => {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          'See how a decision could unfold.',
        );
        await expect(page.getByText('Explore scenarios, not predictions.')).toBeVisible();
        await expect(
          page.getByText(
            'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.',
          ),
        ).toBeVisible();
        // There is nothing to walk until a question is asked.
        await expect(page.getByRole('navigation', { name: 'Journey' })).toHaveCount(0);
        // Research is on, and no source is attached.
        await expect(page.getByRole('switch', { name: /^Research automatically/u })).toBeChecked();
        await expectAttached(page, 0);
        await shot('01-landing');
      });

      // -- 3 ---------------------------------------------------------------------------------
      await test.step('3 · a question is entered with a page to start from, and no source attached', async () => {
        const asked = await ask(page, {
          question,
          site,
          engine: variant.engine,
          beforeGround: async () => {
            // The question is read into a scenario that says by whom: rules, or the model, and never both.
            await expect(
              page.getByText(model ? /^Read by a model · / : 'Read by rules, not a model', {
                exact: !model,
              }),
            ).toBeVisible();
            await expect(
              page
                .getByText(
                  'The harbour authority raises berthing fees for coastal vessels next spring',
                )
                .first(),
            ).toBeVisible();
          },
        });
        project = asked.project;
        expect(asked.created.question, 'the question is sent as it was written').toBe(question);
        expect(asked.created.documents, 'no source goes with it').toEqual([]);
        expect(asked.created.research).toMatchObject({ auto: true, url: site });
        expect(asked.created.settings?.mode).toBe(model ? 'llm' : 'local');
        await expect(tray(page)).toHaveCount(0);
        await expectScene(page, 'ground');
      });

      // -- 4 ---------------------------------------------------------------------------------
      await test.step('4 · automatic research runs: planning, reading, checking, and a ready set of sources', async () => {
        await expect(page.getByRole('list', { name: 'Research progress' })).toBeVisible({
          timeout: 60_000,
        });
        await expect(chip(page)).toHaveText(
          /^(?:Planning|Finding sources|Reading|Extracting evidence)$/u,
          {
            timeout: 60_000,
          },
        );
        await shot('02-research-progress');
        await expect(chip(page)).toHaveText('Ready', { timeout: 180_000 });
        for (const name of RESEARCH_STAGES) {
          await expect(stage(page, name)).toHaveAttribute('data-state', 'done');
        }
        await expect(stage(page, 'reading')).toContainText(/\d+ pages? read/u);
        await expect(stage(page, 'ready')).toContainText(/\d+ sources? used/u);
        const run = (await researchOf(page.request, project)).run!;
        expect(run).toMatchObject({ status: 'completed', stage: 'ready', mode: 'url' });
        expect(run.plan?.origin).toBe(model ? 'model' : 'rules');
        expect(run.modelUsed).toBe(model);
        // The research read what the person named and what it links to, over https, and nothing else.
        await harnessStep('4b · the web saw only what the rules allow', async () => {
          const web = await harness.web();
          expect(new Set(web.attempts.map((attempt) => attempt.host))).toEqual(
            new Set([OFFICIAL, OPERATORS]),
          );
          expect(
            web.attempts.every((attempt) => attempt.port === 443),
            'every read was over https',
          ).toBe(true);
          const paths = web.served.map((entry) => `${entry.host}${entry.path}`);
          expect(paths).toContain(`${OFFICIAL}/robots.txt`);
          expect(paths, 'a page that robots.txt closes is never asked for').not.toContain(
            `${OFFICIAL}/private/minutes`,
          );
        });
        await shot('03-research-ready');
      });

      // -- 5 ---------------------------------------------------------------------------------
      await test.step('5 · sources appear with provenance: title, site, kind, an authority ESTIMATE, the robots decision, a hash and a time', async () => {
        const record = await projectOf(page.request, project);
        const run = (await researchOf(page.request, project)).run!;
        const used = run.sources.filter((source) => source.outcome === 'used');
        expect(used.length).toBeGreaterThanOrEqual(2);
        await expect(page.getByRole('region', { name: /^Sources \d+$/u })).toBeVisible();
        expect(numberIn(await figure(page, 'Sources').first().innerText())).toBe(
          record.documents.length,
        );
        // Every page that became a source is a document the project holds, with where it came from.
        for (const source of used) {
          const held = record.documents.find((document) => document.id === source.documentId);
          expect(held, `the source ${source.id} is a document`).toBeTruthy();
          expect(held?.provenance).toMatchObject({ kind: 'url', fetchedByServer: true });
          expect(held?.provenance?.sha256).toBe(sha256Of(held!.content));
        }

        await harnessStep('5b · each page says what it is, and what became of it', async () => {
          const fees = pageRow(page, TITLES.fees).filter({ hasText: 'Used' }).first();
          await expect(fees).toContainText(OFFICIAL);
          await expect(fees).toContainText('Primary source');
          await expect(fees).toContainText('Authority estimate: High');
          // The estimate says what it is an estimate of, once, above every page.
          await expect(researchSection(page)).toContainText(
            'says nothing about whether a page is right',
          );
          // A site that nobody vouched for is not raised: it is unclassified, and its authority is unknown.
          const survey = pageRow(page, TITLES.survey).first();
          await expect(survey).toContainText('Unclassified');
          await expect(survey).toContainText('Authority estimate: Unknown');

          const card = await openProvenance(page, fees);
          await expect(card).toContainText(ADDRESSES.fees);
          await expect(card).toContainText('The site’s robots.txt allows it.');
          const hash = /SHA-256 ([0-9a-f]{64})/u.exec(await card.innerText())?.[1];
          expect(hash, 'the card shows a hash').toBeTruthy();
          const fetched = await card.locator('time').first().getAttribute('datetime');
          expect(Date.parse(fetched ?? ''), 'the time it was fetched').toBeGreaterThan(
            Date.parse(startedAt) - 60_000,
          );
          expect(Date.parse(fetched ?? '')).toBeLessThanOrEqual(Date.now());
          // The hash on the card is that of the text the project now holds.
          const document = record.documents.find((item) => item.name.includes(TITLES.fees))!;
          expect(hash).toBe(sha256Of(document.content));
          feesHash = hash!;
          await shot('04-provenance', false);
          await page.keyboard.press('Escape');

          // What was set aside is listed, each with its reason, and none of it is a source.
          await expect(pageRow(page, '/private/minutes')).toContainText('Blocked');
          await expect(pageRow(page, '/private/minutes')).toContainText(
            'robots.txt asks not to be read',
          );
          await expect(pageRow(page, '/missing/page')).toContainText('Failed');
          await expect(pageRow(page, TITLES.login)).toContainText('Quarantined');
          await expect(pageRow(page, /^Notes/u)).toContainText('Quarantined');
          await expect(pageRow(page, /^Notes/u)).toContainText('Instruction-like text');
          await expect(
            pagesList(page).getByRole('listitem').filter({ hasText: 'Duplicate' }).first(),
          ).toBeVisible();
          expect(
            run.sources
              .filter((source) => source.outcome !== 'used')
              .every((source) => source.documentId === null),
          ).toBe(true);
        });
        expect(claimsAgainst(await researchSection(page).innerText())).toEqual([]);
        await expectSound(page, 'the research, ready');
        await shot('05-sources');
      });

      // -- 6 ---------------------------------------------------------------------------------
      await test.step('6 · conflicts between sources are visible, both sides shown, and neither declared true', async () => {
        const ledger = await ledgerOf(page.request, project);
        const open = openConflicts(ledger);
        const run = (await researchOf(page.request, project)).run!;
        expect(run.conflictCount, 'the run says how many it found').toBe(open.length);
        await harnessStep('6b · the disagreement about one fee', async () => {
          expect(open).toHaveLength(1);
          await expect(researchSection(page)).toContainText(
            '1 possible conflict was found among what was read.',
          );
          const conflicts = page.getByRole('region', { name: /^Conflicts \d+$/u });
          await expect(conflicts).toContainText('Possible conflict');
          await expect(conflicts).toContainText('Different figures');
          await expect(conflicts).toContainText('3.40');
          await expect(conflicts).toContainText('3.90');
          await expect(conflicts).toContainText(FEE.authority);
          await expect(conflicts).toContainText(FEE.operators);
          await expect(conflicts).toContainText('Neither side is declared true.');
          // Each side is a passage of a different source, and both are the project's own.
          const passages = await passagesOf(page.request, project);
          const sides = [open[0]!.left, open[0]!.right].map((side) =>
            passages.find((item) => item.id === side.passageId)!,
          );
          expect(sides.map((side) => side.text).sort()).toEqual(
            expect.arrayContaining([
              expect.stringContaining('3.40'),
              expect.stringContaining('3.90'),
            ]),
          );
          expect(new Set(sides.map((side) => side.documentId)).size, 'two sources').toBe(2);
          await shot('06-conflict', false);
        });
        // The way to the conflicts from the research is a press.
        await researchSection(page).getByRole('button', { name: 'Review it' }).click();
        await expect(page).toHaveURL(/[?&]view=conflicts(?:&|$)/u);
      });

      // -- 7 ---------------------------------------------------------------------------------
      await test.step('7 · Swarm proposes participants: synthetic roles, each saying what it rests on', async () => {
        await press(page, 'Map the stakeholders').first().click();
        await expectScene(page, 'map');
        // Until a person has approved who is in play, nothing can be simulated.
        await expect(journeyStep(page, 'simulate')).toHaveAccessibleName(/locked/u);
        await page
          .getByRole('button', { name: model ? /^Ask the model/u : 'Find who is affected' })
          .click();
        const notice = page
          .getByRole('status')
          .filter({ hasText: 'Swarm proposed these participants' });
        await expect(notice).toBeVisible({ timeout: 60_000 });
        await notice.getByRole('button', { name: 'Review participants' }).click();
        await expect(page).toHaveURL(/[?&]view=review(?:&|$)/u);
        await expect(
          page.getByRole('heading', { level: 2, name: 'Review the proposed participants' }),
        ).toBeVisible();

        const names = await participantNames(page);
        expect(names.length, 'the participants').toBeGreaterThanOrEqual(5);
        const view = await stakeholdersViewOf(page.request, project);
        expect(view.stakeholders?.proposal).toMatchObject({
          version: 1,
          source: model ? 'model' : 'rules',
        });
        expect(view.review).toMatchObject({ valid: true });
        // Every card says that it is a role and not a person, and what it rests on.
        await expect(page.getByText('Synthetic role, not a person')).toHaveCount(names.length);
        await expect(page.getByText('They are synthetic roles, not real people.')).toBeVisible();
        const record = await projectOf(page.request, project);
        const live = (view.stakeholders?.stakeholders ?? []).filter(
          (item) => item.status !== 'removed',
        );
        expect(live.map((item) => item.name).sort()).toEqual([...names].sort());
        const quoted = live.filter((item) => item.evidence.length > 0);
        expect(quoted.length, 'some participants rest on a quotation').toBeGreaterThan(0);
        for (const item of quoted) {
          for (const ref of item.evidence) {
            expect(
              inDocuments(ref.quote ?? '', record.documents),
              `${item.name}: ${ref.quote}`,
            ).toBe(true);
          }
        }
        await harnessStep(
          '7b · a page that gives orders to an AI is read as text and not obeyed',
          async () => {
            await expect(
              page.getByText('Some of your sources carry text addressed to an AI system'),
            ).toBeVisible();
            expect(names, 'the group that a page ordered to be listed').not.toContain(
              INJECTED.ordered,
            );
            expect(names.length, 'the list is not only what a page asked for').toBeGreaterThan(1);
          },
        );
        await shot('07-participants');
      });

      // -- 8 ---------------------------------------------------------------------------------
      await test.step('8 · the person reviews the participants and accepts them: "Use these actors"', async () => {
        const before = await stakeholdersViewOf(page.request, project);
        expect(
          before.stakeholders?.approvedAt,
          'nothing is approved before the person says so',
        ).toBeNull();
        await expect(journeyStep(page, 'simulate')).toHaveAccessibleName(/locked/u);
        // A person reads the reasons, accepts one participant by hand, and then the rest.
        const names = await participantNames(page);
        const first = participantCard(page, names[0]!);
        await first.getByRole('button', { name: `Accept ${names[0]}` }).click();
        await expect(first.getByText('Accepted')).toBeVisible();
        await page.getByRole('button', { name: /^Accept all/u }).click();
        await expect(page.getByRole('button', { name: 'Accept all (0)' })).toBeDisabled();
        await expect(useActors(page)).toBeEnabled();
        await shot('08-use-these-actors', false);
        await useActors(page).click();
        await expect(pill(page).getByText('Synthetic stand-ins')).toBeVisible();
        await expect(journeyStep(page, 'simulate')).not.toHaveAccessibleName(/locked/u);

        const after = await stakeholdersViewOf(page.request, project);
        expect(after.stakeholders?.approvedAt, 'approved').not.toBeNull();
        const actors = (
          await page.request.get(`/api/projects/${project}/actors`)
        ).json() as Promise<{
          actors: { actors: { synthetic?: boolean; participantRole?: string }[] } | null;
        }>;
        const made = (await actors).actors?.actors ?? [];
        expect(made.length).toBeGreaterThan(0);
        expect(
          made.every((actor) => actor.synthetic === true),
          'every actor says it is synthetic',
        ).toBe(true);
        expect(names.length).toBeGreaterThan(0);
      });

      // -- 9 ---------------------------------------------------------------------------------
      await test.step('9 · Swarm proposes the constraints that limit the decision, each with where it came from', async () => {
        await page
          .getByRole('radiogroup', { name: 'Show as' })
          .getByRole('radio', { name: 'Constraints' })
          .click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'What limits the decision' }),
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { level: 2, name: 'No constraints have been read yet' }),
        ).toBeVisible();
        const read = page.getByRole('button', {
          name: model ? /^Ask the model/u : 'Read my sources for constraints',
        });
        await read.click();
        await expect(gateRegion(page)).toBeVisible({ timeout: 60_000 });

        const view = await constraintsOf(page.request, project);
        const set = view.constraints!.constraints;
        expect(set.length).toBeGreaterThan(2);
        // What was just read waits for a person: nothing is validated, reviewed or run by being proposed.
        for (const constraint of set) {
          expect(constraint.review, constraint.statement).toBe('proposed');
          expect(['unvalidated', 'assumed']).toContain(constraint.validation);
        }
        const record = await projectOf(page.request, project);
        for (const constraint of set.filter((item) => item.source === 'extracted')) {
          for (const ref of constraint.evidenceRefs) {
            expect(inDocuments(ref.quote ?? '', record.documents), ref.quote ?? '').toBe(true);
          }
        }
        // What only follows from who is involved is a suggestion: it says so, and is never marked confirmed.
        const inferred = page
          .getByRole('listitem')
          .filter({ has: page.locator('.sw-con__statement'), hasText: 'Inferred' });
        for (let at = 0; at < (await inferred.count()); at += 1) {
          await expect(inferred.nth(at).getByText('Not yet validated')).toBeVisible();
          await expect(inferred.nth(at).getByText('Confirmed', { exact: true })).toHaveCount(0);
        }
        expect(view.open.length, 'at most three questions at a time').toBeLessThanOrEqual(3);
        await shot('09-constraints');
      });

      // -- 10 --------------------------------------------------------------------------------
      await test.step('10 · the person reviews assumptions and constraints: the gate holds a simulation until they have', async () => {
        const view = await constraintsOf(page.request, project);
        const settled = view.gate!.reviewed;
        expect(settled, 'nothing has been reviewed yet').toBe(false);
        // The server refuses a comparison while the review is open, and says what to do.
        const refused = await page.request.post(`/api/projects/${project}/analysis`, {
          data: { runsPerVariant: 8, sensitivity: false },
          headers: { 'x-swarm-csrf': '1' },
        });
        expect(refused.status()).toBe(409);
        const refusal = (await refused.json()) as { error: { code: string; message: string } };
        expect(['CONSTRAINTS_BLOCKED', 'CONSTRAINTS_UNREVIEWED']).toContain(refusal.error.code);
        expect(refusal.error.message).toMatch(/Open the Map, go to Constraints/u);
        expect(await analysesOf(page.request, project), 'nothing was started').toEqual([]);
        await shot('10-gate-open', false);

        // A careful person settles the hard limits first, and then says they have been through the rest.
        const hard = view.constraints!.constraints.filter(
          (constraint) =>
            constraint.hardness === 'hard' &&
            ['legal', 'regulatory', 'safety'].includes(constraint.category),
        );
        for (const constraint of hard) {
          await page.getByRole('button', { name: `Confirm: ${constraint.statement}` }).click();
          await expect
            .poll(
              async () =>
                (await constraintsOf(page.request, project)).constraints!.constraints.find(
                  (item) => item.id === constraint.id,
                )?.validation,
            )
            .toBe('confirmed');
        }
        // What is left waits for a decision: accepted as read, or set aside. The button counts what waits.
        const waiting = view.constraints!.constraints.length - hard.length;
        if (waiting > 0) {
          const accept = page.getByRole('button', { name: /^Accept the \d+ that waits?$/u });
          await expect(accept).toBeVisible();
          await accept.click();
          await expect(accept).toHaveCount(0);
        }
        // Having been through every one is what a review is: when nothing waits, the page says it is confirmed.
        const confirm = page.getByRole('button', { name: 'Confirm the review' });
        if ((await confirm.count()) > 0 && (await confirm.isEnabled())) await confirm.click();
        await expect(page.getByRole('button', { name: 'Review confirmed' })).toBeVisible();

        const gate = (await constraintsOf(page.request, project)).gate!;
        expect(gate.reviewed).toBe(true);
        expect(gate.status).not.toBe('blocked');
        // What is not settled is said where the person looks next.
        await expect(gateRegion(page)).toContainText(/Provisional|Clear/u);
        await shot('11-gate-reviewed', false);
      });

      // -- 11 --------------------------------------------------------------------------------
      await test.step('11 · the simulation runs, under stated assumptions, and says it is not a prediction', async () => {
        await press(page, 'Go to the simulation').click();
        await expectScene(page, 'simulate');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Set the futures side by side' }),
        ).toBeVisible();
        await shot('12-simulate-setup');
        await press(page, 'Run the simulation').click();
        await expect(page.getByRole('heading', { level: 1, name: 'Watch it unfold' })).toBeVisible({
          timeout: 180_000,
        });
        await expect(
          page
            .getByText('Synthetic actors, simulated under stated assumptions. Not a prediction.')
            .first(),
        ).toBeVisible();
        await expect(journeyStep(page, 'compare')).not.toHaveAccessibleName(/locked/u);
        await expect(journeyStep(page, 'decide')).not.toHaveAccessibleName(/locked/u);

        const done = (await analysesOf(page.request, project)).filter(
          (item) => item.status === 'completed',
        );
        expect(done).toHaveLength(1);
        const analysis = await analysisOf(page.request, project, done[0]!.id);
        // The comparison says which constraints it ran under: provisional where the review left things open.
        expect(analysis.constraints?.status).toMatch(/^(?:clear|provisional)$/u);
        if (analysis.constraints?.status === 'provisional') {
          expect(analysis.constraints.label).toMatch(/^Provisional/u);
          expect(analysis.fidelity.caveats).toContain(analysis.constraints.label);
        }
        await shot('13-simulate-theatre', false);
      });

      // -- 12 --------------------------------------------------------------------------------
      await test.step('12 · the alternatives are compared, side by side, on the same seeds', async () => {
        await goTo(page, 'compare');
        await expect(page.getByText('An exploration, not a forecast.')).toBeVisible();
        await expect(page.getByRole('main')).toContainText('No change');
        await expect(page.getByRole('main')).toContainText('Proposed change');
        await expect(page.getByRole('main')).toContainText('seeded runs');
        await expectNoForecasts(page, 'the comparison');
        await shot('14-compare', false);
      });

      // -- 13 --------------------------------------------------------------------------------
      await test.step('13 · an independent critic challenges the result, and the person answers it', async () => {
        await goTo(page, 'decide');
        // The brief is written from the comparison, and the independent review is one of its tools.
        await press(page, 'Write the brief').click();
        await expect(briefTools(page)).toBeVisible();
        await expect(press(page, 'Write the brief')).toHaveCount(0);
        await briefTools(page)
          .getByRole('button', { name: /^Review/u })
          .click();
        const review = reviewSheet(page);
        await expect(review).toBeVisible();
        await expect(review).toContainText('Critics challenge the analysis and never change it.');
        // Nobody has run it yet: the critics speak when the person asks them to.
        await expect(review).toContainText('Nobody has run the review for this exploration.');
        await review.getByRole('button', { name: 'Run the independent review' }).click();
        await expect(review).toContainText(model ? /Open\s*\d+/u : 'Deterministic checks only', {
          timeout: 60_000,
        });
        const critiques = await critiquesOf(page.request, project);
        const objections = critiques.critiques?.critiques ?? [];
        expect(objections.length, 'the critics found something to say').toBeGreaterThan(0);
        await expect(
          review.getByText(new RegExp(`^Open\\s*${objections.length}$`, 'u')).first(),
        ).toBeVisible();
        await harnessStep(
          '13b · the evidence critic names the conflict between the sources',
          async () => {
            await expect(review).toContainText(
              '1 conflict between sources that nobody has resolved or dismissed',
            );
            await expect(review).toContainText(FEE.authority);
            await expect(review).toContainText(FEE.operators);
          },
        );
        await shot('15-independent-review', false);

        // A person answers one criticism: it stays in view, answered and not settled.
        const first = review.getByRole('article').first();
        await first.getByRole('button').first().click();
        const form = first.getByRole('form', { name: 'Respond to this criticism' });
        await form
          .getByRole('textbox', { name: 'Your response' })
          .fill('The two figures are for different vessel classes; I will ask the authority.');
        await form.getByRole('radio', { name: 'Respond' }).click();
        await form.getByRole('button', { name: 'Save response' }).click();
        await expect(review.getByText(/^Answered\s*1$/u).first()).toBeVisible();
        const answered = (await critiquesOf(page.request, project)).critiques?.critiques ?? [];
        expect(answered.filter((item) => item.status !== 'open')).toHaveLength(1);
        await page.keyboard.press('Escape');
        await expect(review).toBeHidden();
      });

      // -- 14 --------------------------------------------------------------------------------
      await test.step('14 · the Decision Canvas appears: status, constraints, validation plan, labels, and what Swarm is not', async () => {
        await expect(canvas(page)).toBeVisible();
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
          'Decision view',
        );
        await expect(page.getByText('Explore scenarios, not predictions.').first()).toBeVisible();
        // The nine things a decision is read by, in the order a person reads them, all in the first screen.
        const boxes: { title: string; x: number; y: number }[] = [];
        for (const title of NINE) {
          const heading = viewItem(page, title);
          await expect(heading, title).toBeVisible();
          const box = (await heading.boundingBox())!;
          boxes.push({ title, x: box.x, y: box.y });
        }
        for (let at = 1; at < boxes.length; at += 1) {
          const [before, after] = [boxes[at - 1]!, boxes[at]!];
          const below = after.y > before.y + 14;
          const beside = Math.abs(after.y - before.y) <= 14 && after.x > before.x;
          expect(below || beside, `${before.title} comes before ${after.title}`).toBe(true);
        }
        const bottoms = await page
          .locator('[data-canvas-item]')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
        expect(Math.max(...bottoms), 'the nine end inside the window').toBeLessThanOrEqual(900);

        // The answer is one of six statuses, in words, with what the status means; and it says what kind of statement it is.
        const labels = Object.values(DECISION_STATUS_INFO).map((info) => info.label);
        const status = page.locator('[data-canvas-item="answer"] h3');
        await expect(status).toHaveText(new RegExp(`^(?:${labels.join('|')})$`, 'u'));
        const decision = await decisionOf(page.request, project);
        expect(decision.canvas?.status.label).toBe((await status.innerText()).trim());
        await expect(
          page.locator('[data-canvas-item="answer"] .sw-canvas-label').first(),
        ).toHaveText('Kind of statement: Recommendation');
        // What limits it is there, with whether it is confirmed; the plan to validate it is there.
        await expect(viewItem(page, 'Material constraints')).toBeVisible();
        await expect(
          viewItem(page, 'What to validate before acting').locator('xpath=ancestor::section[1]'),
        ).toContainText(/Before acting|Soon|Later/u);
        // Every kind of statement is explained, in words.
        await page.getByRole('button', { name: 'Labels', exact: true }).click();
        const legend = page.getByRole('dialog', { name: 'What the labels mean' });
        for (const label of EPISTEMIC_LABELS) {
          await expect(legend, label).toContainText(EPISTEMIC_LABEL_INFO[label].name);
        }
        await page.keyboard.press('Escape');
        await shot('16-decision-canvas', false);
        await shot('17-decision-canvas-full');

        // The canvas says nothing that Swarm may not say.
        const said = (await canvas(page).innerText()).replace(/\s+/gu, ' ');
        expect(
          said.replace(/“[^”]*”/gu, ''),
          'a figure without what it is a figure of',
        ).not.toContain('%');
        expect(claimsAgainst(said)).toEqual([]);

        // What weakens it is not left out: the conflict between the sources is carried into it.
        await harnessStep(
          '14b · the conflict between the sources weakens the recommendation',
          async () => {
            const weakening =
              decision.canvas?.answer.recommendation?.weakeningEvidence.items.map(
                (item) => item.text,
              ) ?? [];
            expect(weakening.join(' ')).toMatch(/1 conflict between sources is still open/u);
            expect(decision.canvas?.evidence.level).toBe('limited');
            await page
              .getByRole('button', { name: 'The recommendation in full', exact: true })
              .click();
            await expect(
              page.getByText('1 conflict between sources is still open.').first(),
            ).toBeVisible();
          },
        );
        // Every detail open, as the page's own checks open them: what is folded is judged when it is unfolded.
        for (const button of await page.locator('.sw-canvas-detail .sw-disc__head').all()) {
          if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
        }
        await quiet(page);
        await expectSoundExceptDimmedRows(page, 'the decision view, every detail open');
      });

      // -- 15 --------------------------------------------------------------------------------
      await test.step('15 · the brief is exported, and the export opens on the canvas', async () => {
        // Markdown, handed over by the page, as a person gets it.
        await briefTools(page).getByRole('button', { name: 'Export' }).click();
        const downloading = page.waitForEvent('download');
        await page.getByRole('menuitem', { name: 'Markdown' }).click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe('swarm-decision-brief.md');
        const markdown = await (
          await import('node:fs/promises')
        ).readFile((await download.path())!, 'utf8');
        expect(markdown.startsWith('# Decision brief: ')).toBe(true);
        const at = (text: string) => markdown.indexOf(text);
        expect(at('## Decision view'), 'the canvas is in the export').toBeGreaterThan(0);
        expect(at('## Decision view'), 'and comes before the brief').toBeLessThan(
          at('## In short'),
        );
        expect(markdown).toMatch(/Explore scenarios, not predictions\\?\./u);
        const heading = (n: number): number =>
          markdown.search(new RegExp(`^### ${n}\\\\?\\. `, 'mu'));
        const numbered = NINE.map((_, index) => heading(index + 1));
        expect(
          numbered.every((place) => place > at('## Decision view')),
          'the nine, after the heading',
        ).toBe(true);
        expect(numbered).toEqual([...numbered].sort((a, b) => a - b));

        // JSON and the printable page, from the same record.
        const json = await exportOf(page.request, project, 'json');
        expect(json.status).toBe(200);
        const body = JSON.parse(json.text) as Record<string, unknown>;
        const keys = Object.keys(body);
        expect(keys).toContain('canvas');
        expect(
          keys.indexOf('canvas'),
          'the canvas comes before the brief it stands above',
        ).toBeLessThan(keys.indexOf('brief'));
        expect(keys.indexOf('canvas')).toBeLessThan(keys.indexOf('data'));
        expect((body.canvas as { status?: { label?: string } } | null)?.status?.label).toBeTruthy();
        const html = await exportOf(page.request, project, 'html');
        expect(html.status).toBe(200);
        expect(
          html.headers['content-security-policy'],
          'the printable page runs no script',
        ).toMatch(/script-src 'none'|default-src 'none'/u);
        expect(html.text.indexOf('Decision view')).toBeGreaterThan(0);
        expect(html.text.indexOf('Decision view')).toBeLessThan(html.text.indexOf('In short'));
        await page.keyboard.press('Escape');
        await shot('18-brief-written');
      });

      // -- 16 --------------------------------------------------------------------------------
      await test.step('16 · an evidence link resolves: a cited passage opens its source, with where it came from', async () => {
        const brief = (await (await page.request.get(`/api/projects/${project}/brief`)).json()) as {
          brief: {
            sections: {
              statements: {
                refs: { evidence: { passageId: string; quote?: string; documentName?: string }[] };
              }[];
            }[];
          } | null;
        };
        const cited = brief
          .brief!.sections.flatMap((section) => section.statements)
          .flatMap((statement) => statement.refs.evidence)
          .find((ref) => ref.quote && ref.quote.length > 20);
        expect(cited, 'the brief cites a passage').toBeTruthy();
        const passages = await passagesOf(page.request, project);
        const passage = passages.find((item) => item.id === cited!.passageId);
        expect(passage, 'the cited passage is one the project holds').toBeTruthy();
        expect(passage!.text).toContain(cited!.quote!.replace(/…$/u, '').slice(0, 40));

        // Open it as a person does: the sources of Ground, the passage, then the document it is a part of.
        await page.goto(`/?project=${project}&scene=ground`);
        await expect(sourcesSection(page)).toBeVisible();
        await passageButton(page, passage!.id).click();
        await expect(
          sheet(page).getByRole('heading', { level: 2, name: passage!.id }),
        ).toBeVisible();
        await expect(sheet(page).locator('blockquote')).toContainText(
          cited!.quote!.replace(/…$/u, '').slice(0, 40),
        );
        await page.keyboard.press('Escape');
        const record = await projectOf(page.request, project);
        const owner = record.documents.find((item) => item.id === passage!.documentId)!;
        await sourceButton(sourcesSection(page), owner.name).click();
        const opened = sheet(page);
        await expect(opened).toContainText('Retrieved by Swarm');
        await expect(opened).toContainText('Retrieved, not verified.');
        await expect(opened).toContainText('SHA-256');
        expect(owner.provenance).toMatchObject({ kind: 'url', fetchedByServer: true });
        await expect(opened).toContainText(owner.provenance!.sha256!);
        if (!deployed && owner.name.includes(TITLES.fees))
          expect(owner.provenance!.sha256).toBe(feesHash);
        await shot('19-evidence-source', false);
        await page.keyboard.press('Escape');
      });

      // -- 17 --------------------------------------------------------------------------------
      await harnessStep(
        '17 · logs and traces appear: requests, and signals for research, the model, actors, constraints and the simulation',
        async () => {
          const seen = await harness.telemetry();
          const lines = seen.logs.map((line) => JSON.stringify(line));
          // A request is logged by its method, its path and its host, and an id; the answer by its status.
          const requestsLogged = seen.logs.filter(
            (line) =>
              typeof line.reqId === 'string' && (line.req as { url?: string } | undefined)?.url,
          );
          expect(requestsLogged.length, 'request log lines').toBeGreaterThan(20);
          expect(
            requestsLogged.some(
              (line) => (line.req as { url: string }).url === `/api/projects/${project}/research`,
            ),
          ).toBe(true);
          expect(
            lines.some((line) => line.includes('"statusCode":200')),
            'answers carry a status',
          ).toBe(true);
          const names = new Set(seen.spans.map((span) => span.name));
          for (const expected of [
            'POST /api/projects',
            'GET /api/projects/:id/research',
            'POST /api/projects/:id/analysis',
            'GET /api/projects/:id/decision',
          ]) {
            expect(names.has(expected), `a span for ${expected}`).toBe(true);
          }
          expect(
            [...names].every((name) => !name.includes(project)),
            'a span carries a route, never an id',
          ).toBe(true);
          const metric = (name: string) => seen.metrics.filter((point) => point.name === name);
          expect(metric('swarm.http.server.duration').length).toBeGreaterThan(0);
          for (const name of [
            'swarm.research.runs',
            'swarm.research.pages',
            'swarm.research.crawl.duration',
            'swarm.research.sources.used',
            'swarm.research.evidence.passages',
            'swarm.research.quarantines',
            'swarm.report.duration',
          ]) {
            expect(metric(name).length, `the metric ${name}`).toBeGreaterThan(0);
          }
          await shot('20-end', false);
        },
      );

      // -- 18 --------------------------------------------------------------------------------
      await harnessStep(
        '18 · no secret or private content is anywhere that was captured',
        async () => {
          // The canaries are in the system, where the person put them: in the question, and in the evidence they own.
          const record = await projectOf(page.request, project);
          expect(record.question).toContain(CANARIES.question);
          expect(
            record.documents.some((item) => item.content.includes(CANARIES.page)),
            'the canary of the page is in the evidence the project holds',
          ).toBe(true);
          const said = await everythingSaidOf(page.request, project);
          expect(said['export.md']).toContain(CANARIES.question);
          // ...and in no log line, span, metric or row of the audit log.
          const found = await harness.scanCanaries();
          expect(found, 'where a canary was found').toEqual(
            Object.fromEntries(Object.keys(await harness.canaries()).map((name) => [name, []])),
          );
          expect(await harness.auditVerify(variant.instance)).toMatchObject({ ok: true });
          // Nor in anything the product says back, apart from the question the person wrote.
          for (const [where, text] of Object.entries(said)) {
            for (const secret of [
              CANARIES.environment,
              CANARIES.clientSecret,
              CANARIES.requestHeader,
            ]) {
              expect(text, `${where} holds a canary`).not.toContain(secret);
            }
          }
        },
      );
      if (deployed) {
        test.info().annotations.push({
          type: 'manual query',
          description: `Steps 17 and 18 are read in Application Insights: see docs/production/journey.md ("Reading a deployed run"). Window: ${startedAt} to now.`,
        });
      }

      expect(problems, 'what the page logged or failed at').toEqual([]);
    });
  });
}
