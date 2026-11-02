import { describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../../../shared/types';
import { projectFixture } from '../test/project';
import {
  GROUP_LABELS,
  buildCommands,
  findCommands,
  matchRank,
  normalise,
  opensPalette,
  type Command,
  type PaletteContext,
} from './commands';
import { sceneInfos } from './scenes';

/** A guided project with the work at the given point, and the context the shell would hand the palette. */
function contextFor(
  lab: Partial<NonNullable<ProjectDetail['lab']>> | null,
  over: Partial<PaletteContext> = {},
): PaletteContext {
  let journey: PaletteContext['journey'] = null;
  if (lab) {
    const project = projectFixture();
    project.console!.steps.knowledge = 'ready';
    project.lab = {
      scenario: true,
      stakeholders: 'none',
      actors: 0,
      analysis: 'none',
      critiques: false,
      brief: false,
      ...lab,
    };
    journey = sceneInfos(project, 'ground');
  }
  return {
    journey,
    go: vi.fn(),
    newQuestion: vi.fn(),
    history: vi.fn(),
    provider: vi.fn(),
    project: lab
      ? {
          ask: vi.fn(),
          refresh: vi.fn(),
          duplicate: vi.fn(),
          audit: vi.fn(),
          budget: null,
          access: null,
        }
      : null,
    theme: { value: 'system', set: vi.fn() },
    motion: { value: 'system', set: vi.fn() },
    mode: { value: 'guided', set: vi.fn() },
    recent: [],
    openProject: vi.fn(),
    ...over,
  };
}

const byId = (commands: Command[], id: string): Command => {
  const found = commands.find((command) => command.id === id);
  if (!found) throw new Error(`No command ${id}`);
  return found;
};

describe('what the palette offers', () => {
  it('lists only what needs no project before there is one', () => {
    const commands = buildCommands(contextFor(null));
    expect(commands.some((command) => command.group === 'go')).toBe(false);
    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining(['open:history', 'open:provider', 'look:theme:dark']),
    );
    expect(commands.some((command) => command.id === 'open:audit')).toBe(false);
  });

  it('keeps a step that is shut in the list, says what opens it, and does not mark it as a place to be', () => {
    const commands = buildCommands(contextFor({}));
    const simulate = byId(commands, 'go:simulate');
    expect(simulate.locked).toBe(true);
    expect(simulate.hint).toBe('Needs actors');
    expect(byId(commands, 'go:ground').current).toBe(true);
    expect(byId(commands, 'go:ground').hint).toBe('Here');
    // A view of a scene is as shut as the scene is.
    expect(byId(commands, 'go:simulate:network').locked).toBe(true);
    expect(byId(commands, 'go:decide:report').hint).toBe('Run a simulation first');
  });

  it('opens a scene and a view of it through the shell', () => {
    const context = contextFor({ stakeholders: 'approved', actors: 12, analysis: 'completed' });
    const commands = buildCommands(context);
    byId(commands, 'go:compare').run();
    byId(commands, 'go:simulate:network').run();
    byId(commands, 'go:ask').run();
    expect(context.go).toHaveBeenNthCalledWith(1, 'compare');
    expect(context.go).toHaveBeenNthCalledWith(2, 'simulate', { view: 'network' });
    expect(context.newQuestion).toHaveBeenCalledOnce();
    expect(byId(commands, 'go:ask').label).toBe('New question');
  });

  it('offers a project its own tools, and the budget and access only where they exist', () => {
    const plain = buildCommands(contextFor({}));
    expect(plain.some((command) => command.id === 'open:budget')).toBe(false);
    expect(plain.some((command) => command.id === 'open:access')).toBe(false);
    const full = buildCommands(
      contextFor(
        {},
        {
          project: {
            ask: vi.fn(),
            refresh: vi.fn(),
            duplicate: null,
            audit: vi.fn(),
            budget: vi.fn(),
            access: vi.fn(),
          },
        },
      ),
    );
    expect(full.some((command) => command.id === 'open:budget')).toBe(true);
    expect(full.some((command) => command.id === 'open:access')).toBe(true);
    // A busy project cannot be copied.
    expect(full.some((command) => command.id === 'open:duplicate')).toBe(false);
  });

  it('marks the setting that is on, and changes it when run', () => {
    const context = contextFor(null, {
      theme: { value: 'dark', set: vi.fn() },
      mode: { value: 'advanced', set: vi.fn() },
    });
    const commands = buildCommands(context);
    expect(byId(commands, 'look:theme:dark').current).toBe(true);
    expect(byId(commands, 'look:theme:light').current).toBe(false);
    expect(byId(commands, 'look:mode:advanced').current).toBe(true);
    byId(commands, 'look:theme:high-contrast').run();
    expect(context.theme.set).toHaveBeenCalledWith('high-contrast');
  });

  it('lists recent explorations by name and opens the one chosen', () => {
    const context = contextFor(null, {
      recent: [
        { id: 'a1', name: 'Cloud pricing' },
        { id: 'b2', name: 'Library hours' },
      ],
    });
    const commands = buildCommands(context);
    const recent = commands.filter((command) => command.group === 'recent');
    expect(recent.map((command) => command.label)).toEqual(['Cloud pricing', 'Library hours']);
    recent[1]!.run();
    expect(context.openProject).toHaveBeenCalledWith('b2');
  });

  it('names each group in words', () => {
    expect(GROUP_LABELS).toEqual({
      go: 'Go to',
      open: 'Open',
      look: 'Look and feel',
      recent: 'Recent',
    });
  });
});

describe('searching', () => {
  const commands = buildCommands(
    contextFor(
      { stakeholders: 'approved', actors: 12, analysis: 'completed' },
      { recent: [{ id: 'a1', name: 'Cloud pricing' }] },
    ),
  );
  const labels = (query: string) => findCommands(commands, query).map((command) => command.label);

  it('returns everything, in the order of the groups, when nothing is typed', () => {
    expect(findCommands(commands, '  ')).toBe(commands);
  });

  it('finds a setting by the word a person would use, and ranks a name that starts with it first', () => {
    expect(labels('dark')[0]).toBe('Dark theme');
    expect(labels('night')).toContain('Dark theme');
    expect(labels('sim')[0]).toBe('Simulate');
    expect(labels('sim')).toContain('Simulate: Network');
  });

  it('needs every word, in any order, and ignores accents and punctuation', () => {
    expect(labels('theme high')).toEqual(['High-contrast theme']);
    expect(labels('Détail:  ADVANCED')).toEqual(['Detail: advanced']);
    expect(labels('zzzz')).toEqual([]);
  });

  it('finds a scene by what it is for, and an exploration by its name', () => {
    expect(labels('evidence')).toContain('Ground');
    expect(labels('cloud')).toEqual(['Cloud pricing']);
  });

  it('keeps commands of equal rank in the order they were listed', () => {
    const motion = labels('motion');
    expect(motion).toEqual(['Motion: follow device', 'Motion: reduced', 'Motion: full']);
  });
});

describe('the words that are compared', () => {
  it('lower-cases, strips accents and folds every run of other characters to one space', () => {
    expect(normalise('  Détail: High—Contrast!  ')).toBe('detail high contrast');
    expect(normalise('')).toBe('');
  });

  it('ranks a match at the start of the name above one inside it, and no match as null', () => {
    const command = { label: 'Report studio', keywords: 'edit' } as Command;
    expect(matchRank(command, 'report')).toBe(0);
    expect(matchRank(command, 'stud')).toBe(1);
    expect(matchRank(command, 'edit')).toBe(4);
    expect(matchRank(command, 'nothing')).toBeNull();
  });
});

describe('the key that opens it', () => {
  const press = (over: Partial<Parameters<typeof opensPalette>[0]>) =>
    opensPalette({
      key: 'k',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...over,
    });

  it('is Ctrl K or ⌘K and nothing else', () => {
    expect(press({ ctrlKey: true })).toBe(true);
    expect(press({ metaKey: true, key: 'K' })).toBe(true);
    expect(press({})).toBe(false);
    expect(press({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press({ ctrlKey: true, altKey: true })).toBe(false);
    expect(press({ ctrlKey: true, key: 'j' })).toBe(false);
  });
});
