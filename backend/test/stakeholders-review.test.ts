import { beforeAll, describe, expect, it } from 'vitest';
import { scenarioFrameSchema } from '../../shared/scenario.js';
import {
  stakeholderSchema,
  type Stakeholder,
  type StakeholderSet,
} from '../../shared/stakeholders.js';
import { stakeholderFixture } from '../../shared/lab-fixtures.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { discoverStakeholders } from '../src/stakeholders/discover.js';
import { applyReview, approveSet, reviewInputSchema } from '../src/stakeholders/review.js';
import { BRIEFS } from './support/stakeholder-briefs.js';

const NOW = new Date('2026-03-02T10:00:00.000Z');
const LATER = new Date('2026-03-02T11:00:00.000Z');

let base: StakeholderSet;
beforeAll(async () => {
  const brief = BRIEFS[1]!;
  base = await discoverStakeholders({
    project: { question: brief.question, graph: null },
    scenario: scenarioFrameSchema.parse({
      decision: 'd',
      system: 's',
      baseline: 'b',
      likelyStakeholders: brief.hints,
      origin: 'user',
    }),
    passages: chunkDocuments([{ id: 'D1', name: 'brief.md', content: brief.document }]),
    model: null,
    now: () => NOW,
  });
});

/** The set a person would send back after changing it with `change`. */
function review(
  set: StakeholderSet,
  change: (stakeholders: Stakeholder[], relations: StakeholderSet['relations']) => void,
  expectedRevision = 1,
) {
  const stakeholders = structuredClone(set.stakeholders);
  const relations = structuredClone(set.relations);
  change(stakeholders, relations);
  return reviewInputSchema.parse({ stakeholders, relations, expectedRevision });
}

const find = (set: StakeholderSet | Stakeholder[], name: string): Stakeholder => {
  const list = Array.isArray(set) ? set : set.stakeholders;
  const found = list.find((stakeholder) => stakeholder.name === name);
  if (!found) throw new Error(`No stakeholder named ${name}.`);
  return found;
};

const user = (id: string, overrides: Partial<Stakeholder> = {}): Stakeholder =>
  stakeholderSchema.parse({
    ...stakeholderFixture(id, 'other', { origin: 'user', status: 'added' }),
    uncertainty: { level: 'high', reason: 'Added by hand.' },
    ...overrides,
  });

async function refused(
  action: () => unknown,
): Promise<{ code: string; message: string; statusCode: number }> {
  try {
    await action();
  } catch (error) {
    return error as { code: string; message: string; statusCode: number };
  }
  throw new Error('Expected the change to be refused.');
}

describe('accepting, editing and re-prioritising', () => {
  it('accepts a stakeholder without touching anything else', () => {
    const next = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').status = 'accepted';
      }),
      LATER,
    );
    expect(find(next, 'Resellers').status).toBe('accepted');
    expect(next.stakeholders.filter((s) => s.status === 'proposed')).toHaveLength(
      base.stakeholders.length - 1,
    );
    expect(next.relations).toEqual(base.relations);
    expect(next.discovery).toEqual(base.discovery);
  });

  it('marks a change to what a stakeholder is as an edit, whatever status the request says', () => {
    const next = applyReview(
      base,
      review(base, (list) => {
        const target = find(list, 'Resellers');
        target.name = 'Channel partners';
        target.priority = 'key';
        target.populationSize = 1;
        target.status = 'accepted';
      }),
      LATER,
    );
    expect(find(next, 'Channel partners')).toMatchObject({
      status: 'edited',
      priority: 'key',
      origin: 'rules',
      expectedImpact: { origin: 'system-assumption' },
    });
  });

  it('takes the impact as the person’s own when they change it, and only then', () => {
    const next = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Support teams').expectedImpact = {
          direction: 'harmed',
          rationale: 'They absorb the extra tickets.',
          origin: 'evidence',
        };
        find(list, 'Resellers').description = 'Edited description.';
      }),
      LATER,
    );
    expect(find(next, 'Support teams').expectedImpact).toEqual({
      direction: 'harmed',
      rationale: 'They absorb the extra tickets.',
      origin: 'user',
    });
    expect(find(next, 'Resellers').expectedImpact.origin).toBe('system-assumption');
  });

  it('does not let a request claim an origin for an impact it did not change', () => {
    const next = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').expectedImpact.origin = 'evidence';
      }),
      LATER,
    );
    expect(find(next, 'Resellers').expectedImpact.origin).toBe('system-assumption');
  });

  it('keeps the status it had when a request says "edited" without changing anything', () => {
    const next = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').status = 'edited';
      }),
      LATER,
    );
    expect(find(next, 'Resellers').status).toBe('proposed');
    const edited = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').description = 'Changed.';
      }),
      LATER,
    );
    const again = applyReview(
      edited,
      review(edited, (list) => {
        find(list, 'Resellers').status = 'edited';
      }),
      LATER,
    );
    expect(find(again, 'Resellers').status).toBe('edited');
  });

  it('refuses a status the stakeholder could not have reached', async () => {
    const added = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          find(list, 'Resellers').status = 'added';
        }),
        LATER,
      ),
    );
    expect(added).toMatchObject({ statusCode: 400, code: 'STATUS_INVALID' });
  });

  it('keeps who found a stakeholder as it was', async () => {
    const error = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          find(list, 'Resellers').origin = 'user';
        }),
        LATER,
      ),
    );
    expect(error.code).toBe('STAKEHOLDER_ORIGIN_LOCKED');
  });
});

describe('removing and restoring', () => {
  it('keeps a removed stakeholder in the set, so the review can be read back, and brings it back', () => {
    const removed = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').status = 'removed';
      }),
      LATER,
    );
    expect(find(removed, 'Resellers').status).toBe('removed');
    expect(removed.stakeholders).toHaveLength(base.stakeholders.length);
    expect(removed.gaps).toContain('channel');
    const back = applyReview(
      removed,
      review(removed, (list) => {
        find(list, 'Resellers').status = 'proposed';
      }),
      LATER,
    );
    expect(find(back, 'Resellers').status).toBe('proposed');
    expect(back.gaps).not.toContain('channel');
  });

  it('refuses to delete one: a stakeholder is removed, never dropped', async () => {
    const error = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          list.splice(list.indexOf(find(list, 'Resellers')), 1);
        }),
        LATER,
      ),
    );
    expect(error).toMatchObject({ statusCode: 400, code: 'STAKEHOLDER_MISSING' });
  });

  it('refuses two stakeholders with one id', async () => {
    const error = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          find(list, 'Resellers').id = find(list, 'Support teams').id;
        }),
        LATER,
      ),
    );
    expect(error.code).toBe('STAKEHOLDER_ID_DUPLICATE');
  });
});

describe('adding', () => {
  it('adds a stakeholder as the person’s own, and the gap it fills closes', () => {
    expect(base.gaps).toContain('beneficiary');
    const next = applyReview(
      base,
      review(base, (list) => {
        list.push(user('early-adopters', { name: 'Early adopters', category: 'beneficiary' }));
      }),
      LATER,
    );
    expect(find(next, 'Early adopters')).toMatchObject({
      origin: 'user',
      status: 'added',
      evidence: [],
      expectedImpact: { origin: 'user' },
    });
    expect(next.gaps).not.toContain('beneficiary');
  });

  it('keeps an added stakeholder added when the person edits it, and lets them remove it', () => {
    const one = applyReview(
      base,
      review(base, (list) => {
        list.push(user('early-adopters', { name: 'Early adopters' }));
      }),
      LATER,
    );
    const two = applyReview(
      one,
      review(
        one,
        (list) => {
          find(list, 'Early adopters').description = 'Changed my mind about this.';
        },
        2,
      ),
      LATER,
    );
    expect(find(two, 'Early adopters').status).toBe('added');
    const three = applyReview(
      two,
      review(
        two,
        (list) => {
          find(list, 'Early adopters').status = 'removed';
        },
        3,
      ),
      LATER,
    );
    expect(find(three, 'Early adopters').status).toBe('removed');
  });

  it('refuses a new stakeholder that is not the person’s, or that brings evidence of its own', async () => {
    const notTheirs = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          list.push(user('other-group', { origin: 'rules', status: 'proposed' }));
        }),
        LATER,
      ),
    );
    expect(notTheirs.code).toBe('STAKEHOLDER_ORIGIN_LOCKED');
    const wrongStatus = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          list.push(user('other-group', { status: 'accepted' }));
        }),
        LATER,
      ),
    );
    expect(wrongStatus.code).toBe('STAKEHOLDER_ORIGIN_LOCKED');
    const forged = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          list.push(user('other-group', { evidence: find(list, 'Resellers').evidence }));
        }),
        LATER,
      ),
    );
    expect(forged.code).toBe('EVIDENCE_NOT_VERIFIED');
  });

  it('lets a person build a whole set by hand, from nothing', () => {
    const set = applyReview(
      null,
      reviewInputSchema.parse({
        stakeholders: [
          user('first-group', { name: 'First group' }),
          user('second-group', { name: 'Second group' }),
        ],
        relations: [],
        expectedRevision: 0,
      }),
      LATER,
    );
    expect(set.discovery).toEqual({
      mode: 'user',
      model: null,
      generatedAt: LATER.toISOString(),
      note: 'Added by hand; nothing was discovered.',
    });
    expect(set.stakeholders.map((s) => s.status)).toEqual(['added', 'added']);
    expect(set.approvedAt).toBeNull();
  });
});

describe('evidence', () => {
  it('can be taken away from a stakeholder, which is an edit, and never added', async () => {
    const withEvidence = base.stakeholders.find((s) => s.evidence.length > 1)!;
    const fewer = applyReview(
      base,
      review(base, (list) => {
        const target = list.find((s) => s.id === withEvidence.id)!;
        target.evidence = target.evidence.slice(0, 1);
      }),
      LATER,
    );
    const after = fewer.stakeholders.find((s) => s.id === withEvidence.id)!;
    expect(after.evidence).toHaveLength(1);
    expect(after.status).toBe('edited');

    const borrowed = base.stakeholders
      .flatMap((s) => s.evidence)
      .find((ref) => !withEvidence.evidence.some((own) => own.quote === ref.quote))!;
    const forged = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          list.find((s) => s.id === withEvidence.id)!.evidence.push(borrowed);
        }),
        LATER,
      ),
    );
    expect(forged.code).toBe('EVIDENCE_NOT_VERIFIED');
    const invented = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          const target = list.find((s) => s.id === withEvidence.id)!;
          target.evidence = [{ ...target.evidence[0]!, quote: 'A sentence nobody wrote.' }];
        }),
        LATER,
      ),
    );
    expect(invented.code).toBe('EVIDENCE_NOT_VERIFIED');
  });
});

describe('merging', () => {
  const merge = (list: Stakeholder[], from: string, into: string): void => {
    const source = find(list, from);
    const target = find(list, into);
    source.status = 'removed';
    target.mergedFrom = [...target.mergedFrom, source.id];
    target.evidence = [...target.evidence, ...source.evidence];
    target.name = `${target.name} and ${source.name.toLowerCase()}`;
  };

  it('keeps the merged stakeholder, removed, named by the one it went into, with the evidence of both', () => {
    const smallEvidence = find(base, 'Small customers').evidence;
    const newEvidence = find(base, 'New customers').evidence;
    const next = applyReview(
      base,
      review(base, (list) => merge(list, 'New customers', 'Small customers')),
      LATER,
    );
    const target = next.stakeholders.find((s) => s.id === find(base, 'Small customers').id)!;
    expect(target.status).toBe('edited');
    expect(target.mergedFrom).toEqual([find(base, 'New customers').id]);
    expect(target.evidence.map((ref) => ref.quote)).toEqual(
      [...smallEvidence, ...newEvidence].map((ref) => ref.quote),
    );
    expect(find(next, 'New customers').status).toBe('removed');
  });

  it('can be undone by restoring the merged stakeholder and taking it out of the list', () => {
    const merged = applyReview(
      base,
      review(base, (list) => merge(list, 'New customers', 'Small customers')),
      LATER,
    );
    const undone = applyReview(
      merged,
      review(
        merged,
        (list) => {
          list.find((s) => s.mergedFrom.length > 0)!.mergedFrom = [];
          find(list, 'New customers').status = 'proposed';
        },
        2,
      ),
      LATER,
    );
    expect(find(undone, 'New customers').status).toBe('proposed');
    expect(undone.stakeholders.every((s) => s.mergedFrom.length === 0)).toBe(true);
  });

  it('refuses a merge that is not one: unknown, itself, into a removed one, of one that is not removed, or twice', async () => {
    const cases: [string, (list: Stakeholder[]) => void][] = [
      [
        'unknown',
        (list) => {
          find(list, 'Resellers').mergedFrom = ['nobody'];
        },
      ],
      [
        'itself',
        (list) => {
          const t = find(list, 'Resellers');
          t.mergedFrom = [t.id];
        },
      ],
      [
        'not removed',
        (list) => {
          find(list, 'Resellers').mergedFrom = [find(list, 'Support teams').id];
        },
      ],
      [
        'into removed',
        (list) => {
          const t = find(list, 'Resellers');
          const s = find(list, 'Support teams');
          s.status = 'removed';
          t.status = 'removed';
          t.mergedFrom = [s.id];
        },
      ],
      [
        'twice',
        (list) => {
          const s = find(list, 'Support teams');
          s.status = 'removed';
          find(list, 'Resellers').mergedFrom = [s.id];
          find(list, 'Finance teams').mergedFrom = [s.id];
        },
      ],
    ];
    for (const [name, change] of cases) {
      const error = await refused(() =>
        applyReview(
          base,
          review(base, (list) => change(list)),
          LATER,
        ),
      );
      expect(error.code, name).toBe('MERGE_INVALID');
    }
  });

  it('refuses to hide a merge by dropping it from the list while the merged stakeholder stays removed', async () => {
    const merged = applyReview(
      base,
      review(base, (list) => merge(list, 'New customers', 'Small customers')),
      LATER,
    );
    const error = await refused(() =>
      applyReview(
        merged,
        review(
          merged,
          (list) => {
            list.find((s) => s.mergedFrom.length > 0)!.mergedFrom = [];
          },
          2,
        ),
        LATER,
      ),
    );
    expect(error).toMatchObject({ code: 'MERGE_INVALID' });
  });

  it('refuses a merge that carries evidence from a stakeholder that was not merged in', async () => {
    const error = await refused(() =>
      applyReview(
        base,
        review(base, (list) => {
          const source = find(list, 'New customers');
          source.status = 'removed';
          const target = find(list, 'Small customers');
          target.mergedFrom = [source.id];
          target.evidence = [...target.evidence, ...find(list, 'Support teams').evidence];
        }),
        LATER,
      ),
    );
    expect(error.code).toBe('EVIDENCE_NOT_VERIFIED');
  });

  it('allows a merge to be merged again: the trail through each stays', () => {
    const one = applyReview(
      base,
      review(base, (list) => merge(list, 'New customers', 'Small customers')),
      LATER,
    );
    const intoNext = one.stakeholders.find((s) => s.mergedFrom.length > 0)!;
    const two = applyReview(
      one,
      review(
        one,
        (list) => {
          const target = find(list, 'Enterprise customers');
          const source = list.find((s) => s.id === intoNext.id)!;
          source.status = 'removed';
          target.mergedFrom = [source.id];
          target.evidence = [...target.evidence, ...source.evidence];
        },
        2,
      ),
      LATER,
    );
    expect(two.stakeholders.find((s) => s.id === intoNext.id)).toMatchObject({ status: 'removed' });
    expect(find(two, 'Enterprise customers').mergedFrom).toEqual([intoNext.id]);
  });
});

describe('relations', () => {
  it('refuses one that joins a stakeholder that is not in the list, or itself, or repeats one', async () => {
    const [relation] = base.relations;
    expect(relation).toBeDefined();
    for (const change of [
      (relations: StakeholderSet['relations']) => {
        relations.push({ ...relation!, to: 'nobody' });
      },
      (relations: StakeholderSet['relations']) => {
        relations.push({ ...relation!, to: relation!.from });
      },
      (relations: StakeholderSet['relations']) => {
        relations.push({ ...relation! });
      },
    ]) {
      const error = await refused(() =>
        applyReview(
          base,
          review(base, (_list, relations) => change(relations)),
          LATER,
        ),
      );
      expect(error.code).toBe('RELATION_INVALID');
    }
  });

  it('says a relation the person writes, or rewrites, is an assumption', () => {
    const a = find(base, 'Support teams').id;
    const b = find(base, 'Resellers').id;
    const next = applyReview(
      base,
      review(base, (_list, relations) => {
        relations.push({
          from: a,
          to: b,
          type: 'depends-on',
          strength: 0.3,
          rationale: 'They share a queue.',
        });
        relations[0]!.rationale = 'It is certain.';
      }),
      LATER,
    );
    expect(next.relations.at(-1)?.rationale).toBe('Assumption (you): They share a queue.');
    expect(next.relations[0]?.rationale).toBe('Assumption (you): It is certain.');
    expect(next.relations[1]?.rationale).toMatch(/^Assumed from categories/u);
  });
});

describe('the approval', () => {
  it('is taken away by any change to what was approved, and kept by one that changes nothing', () => {
    const approved = approveSet(base, NOW);
    expect(approved.approvedAt).toBe(NOW.toISOString());
    const same = applyReview(
      approved,
      review(approved, () => undefined, 2),
      LATER,
    );
    expect(same.approvedAt).toBe(NOW.toISOString());
    const changed = applyReview(
      approved,
      review(
        approved,
        (list) => {
          find(list, 'Resellers').priority = 'key';
        },
        2,
      ),
      LATER,
    );
    expect(changed.approvedAt).toBeNull();
  });

  it('needs at least two stakeholders that are not removed, and says so plainly', async () => {
    const few = applyReview(
      base,
      review(base, (list) => {
        for (const s of list.slice(1)) s.status = 'removed';
      }),
      LATER,
    );
    const error = await refused(() => approveSet(few, NOW));
    expect(error).toMatchObject({ statusCode: 409, code: 'STAKEHOLDERS_TOO_FEW' });
    expect(error.message).toContain('at least two');
  });

  it('accepts what is still only proposed, and leaves edited, added and removed as they are', () => {
    const reviewed = applyReview(
      base,
      review(base, (list) => {
        find(list, 'Resellers').description = 'Edited.';
        find(list, 'Support teams').status = 'removed';
        list.push(user('early-adopters', { name: 'Early adopters' }));
      }),
      LATER,
    );
    const approved = approveSet(reviewed, NOW);
    expect(find(approved, 'Resellers').status).toBe('edited');
    expect(find(approved, 'Support teams').status).toBe('removed');
    expect(find(approved, 'Early adopters').status).toBe('added');
    expect(find(approved, 'Analysts').status).toBe('accepted');
    expect(approved.stakeholders.some((s) => s.status === 'proposed')).toBe(false);
  });
});
