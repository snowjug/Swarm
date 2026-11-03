import {
  Activity,
  Contrast,
  Copy,
  FolderClock,
  Gauge,
  History,
  MessageCircleQuestion,
  Monitor,
  Moon,
  RefreshCw,
  ScrollText,
  Sun,
  SunMoon,
  Terminal,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { MOTION_LABELS, MOTION_PREFERENCES, type MotionPreference } from '../design/motion';
import { MODE_LABELS, UI_MODES, type UiMode } from '../lib/mode';
import { PREFERENCES, THEME_LABELS, type ThemePreference } from '../lib/theme';
import { SCENE_ICONS } from './icons';
import { SCENE_LABELS, SCENE_PURPOSE, type SceneId, type SceneInfo } from './scenes';

/** The groups a command belongs to, in the order the palette lists them while nothing has been typed. */
export const COMMAND_GROUPS = ['go', 'open', 'look', 'recent'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export const GROUP_LABELS: Record<CommandGroup, string> = {
  go: 'Go to',
  open: 'Open',
  look: 'Look and feel',
  recent: 'Recent',
};

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** Other words for the same thing, so that a search finds it by what a person would say. */
  keywords?: string;
  /** Short, at the end of the row: why a step is shut, or where the person already is. */
  hint?: string;
  /** The setting that is on now, or the place the person is in. */
  current?: boolean;
  /** It cannot be used yet. It stays in the list, and running it says why, as the journey does. */
  locked?: boolean;
  icon: LucideIcon;
  run: () => void;
}

/** Everything the palette may do, handed over by the shell, which is the one place that can do it. */
export interface PaletteContext {
  /** The journey as the bar shows it; `null` before a question has been made into a project. */
  journey: SceneInfo[] | null;
  go: (scene: SceneId, options?: { view?: string | null }) => void;
  newQuestion: () => void;
  history: () => void;
  provider: () => void;
  /** What only an open project has. */
  project: {
    ask: () => void;
    refresh: () => void;
    duplicate: (() => void) | null;
    audit: () => void;
    budget: (() => void) | null;
    access: (() => void) | null;
  } | null;
  theme: { value: ThemePreference; set: (next: ThemePreference) => void };
  motion: { value: MotionPreference; set: (next: MotionPreference) => void };
  mode: { value: UiMode; set: (next: UiMode) => void };
  /** The other explorations, newest first. */
  recent: { id: string; name: string }[];
  openProject: (id: string) => void;
}

/** The views inside a scene that a person may want to land on directly. The scene falls back if its record has no such view. */
const VIEWS: { scene: SceneId; view: string; label: string; keywords: string }[] = [
  { scene: 'simulate', view: 'story', label: 'Simulate: Story', keywords: 'summary narrative' },
  { scene: 'simulate', view: 'live', label: 'Simulate: Live', keywords: 'watch replay' },
  { scene: 'simulate', view: 'network', label: 'Simulate: Network', keywords: 'relationships' },
  { scene: 'simulate', view: 'timeline', label: 'Simulate: Timeline', keywords: 'rounds chart' },
  { scene: 'map', view: 'list', label: 'Map: List', keywords: 'table stakeholders actors' },
  {
    scene: 'map',
    view: 'constraints',
    label: 'Map: Constraints',
    keywords: 'limits gate budget regulation rules',
  },
  { scene: 'decide', view: 'report', label: 'Decide: Detailed report', keywords: 'print' },
  {
    scene: 'decide',
    view: 'studio',
    label: 'Decide: Report studio',
    keywords: 'edit write versions',
  },
];

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
};

const THEME_WORDS: Record<ThemePreference, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
  'high-contrast': 'High-contrast theme',
};

const THEME_KEYWORDS: Record<ThemePreference, string> = {
  system: 'automatic device appearance',
  light: 'day bright appearance',
  dark: 'night appearance',
  'high-contrast': 'contrast accessibility appearance',
};

const MOTION_WORDS: Record<MotionPreference, string> = {
  system: 'Motion: follow device',
  reduced: 'Motion: reduced',
  full: 'Motion: full',
};

/** What can be done, as one flat list in the order of its groups. */
export function buildCommands(context: PaletteContext): Command[] {
  const commands: Command[] = [];
  const { journey, project } = context;

  if (journey) {
    for (const step of journey) {
      const locked = step.state === 'locked';
      commands.push({
        id: `go:${step.id}`,
        group: 'go',
        label: step.id === 'ask' ? 'New question' : SCENE_LABELS[step.id],
        keywords: `${SCENE_PURPOSE[step.id]}${step.id === 'ask' ? ' ask start again' : ''}`,
        hint: locked ? step.reason : step.current && step.id !== 'ask' ? 'Here' : undefined,
        current: step.current && step.id !== 'ask',
        locked,
        icon: SCENE_ICONS[step.id],
        run: step.id === 'ask' ? context.newQuestion : () => context.go(step.id),
      });
    }
    for (const entry of VIEWS) {
      const step = journey.find((candidate) => candidate.id === entry.scene);
      const locked = step?.state === 'locked';
      commands.push({
        id: `go:${entry.scene}:${entry.view}`,
        group: 'go',
        label: entry.label,
        keywords: entry.keywords,
        hint: locked ? step?.reason : undefined,
        locked,
        icon: SCENE_ICONS[entry.scene],
        run: () => context.go(entry.scene, { view: entry.view }),
      });
    }
  }

  commands.push({
    id: 'open:history',
    group: 'open',
    label: 'History',
    keywords: 'explorations projects past previous',
    icon: History,
    run: context.history,
  });
  if (project) {
    commands.push({
      id: 'open:ask',
      group: 'open',
      label: 'Ask about this',
      keywords: 'analyst chat question help',
      icon: MessageCircleQuestion,
      run: project.ask,
    });
    commands.push({
      id: 'open:audit',
      group: 'open',
      label: 'Audit log',
      keywords: 'activity record trail',
      icon: ScrollText,
      run: project.audit,
    });
    if (project.budget) {
      commands.push({
        id: 'open:budget',
        group: 'open',
        label: 'Model budget',
        keywords: 'cost spend limit tokens',
        icon: Gauge,
        run: project.budget,
      });
    }
    if (project.access) {
      commands.push({
        id: 'open:access',
        group: 'open',
        label: 'Who has access',
        keywords: 'share people permissions',
        icon: Users,
        run: project.access,
      });
    }
    commands.push({
      id: 'open:refresh',
      group: 'open',
      label: 'Refresh',
      keywords: 'reload read again update',
      icon: RefreshCw,
      run: project.refresh,
    });
    if (project.duplicate) {
      commands.push({
        id: 'open:duplicate',
        group: 'open',
        label: 'Duplicate as a new question',
        keywords: 'copy start again from this',
        icon: Copy,
        run: project.duplicate,
      });
    }
  }
  commands.push({
    id: 'open:provider',
    group: 'open',
    label: 'Model status',
    keywords: 'provider rules offline connection engine',
    icon: Activity,
    run: context.provider,
  });

  for (const name of PREFERENCES) {
    commands.push({
      id: `look:theme:${name}`,
      group: 'look',
      label: THEME_WORDS[name],
      keywords: `${THEME_LABELS[name]} ${THEME_KEYWORDS[name]}`,
      current: context.theme.value === name,
      icon: THEME_ICONS[name],
      run: () => context.theme.set(name),
    });
  }
  for (const name of MOTION_PREFERENCES) {
    commands.push({
      id: `look:motion:${name}`,
      group: 'look',
      label: MOTION_WORDS[name],
      keywords: `${MOTION_LABELS[name]} animation`,
      current: context.motion.value === name,
      icon: Waves,
      run: () => context.motion.set(name),
    });
  }
  for (const name of UI_MODES) {
    commands.push({
      id: `look:mode:${name}`,
      group: 'look',
      label: `Detail: ${MODE_LABELS[name].toLowerCase()}`,
      keywords:
        name === 'advanced' ? 'engine terms diagnostics logs technical' : 'plain language help',
      current: context.mode.value === name,
      icon: name === 'advanced' ? Terminal : SunMoon,
      run: () => context.mode.set(name),
    });
  }

  for (const entry of context.recent) {
    commands.push({
      id: `recent:${entry.id}`,
      group: 'recent',
      label: entry.name,
      keywords: 'open exploration project',
      icon: FolderClock,
      run: () => context.openProject(entry.id),
    });
  }
  return commands;
}

/** Lower-case, without accents, with every run of other characters as one space: what is compared. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** How well a command answers a search, lower being better; `null` when it does not answer it at all. */
export function matchRank(command: Command, query: string): number | null {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return 0;
  const label = normalise(command.label);
  const all = `${label} ${normalise(command.keywords ?? '')}`;
  if (!words.every((word) => all.includes(word))) return null;
  const joined = words.join(' ');
  if (label.startsWith(joined)) return 0;
  if (words.every((word) => label.split(' ').some((part) => part.startsWith(word)))) return 1;
  if (label.includes(joined)) return 2;
  if (words.every((word) => label.includes(word))) return 3;
  return 4;
}

/**
 * The commands a search finds, best first and, among equals, in the order they were listed. With nothing typed it
 * is the whole list, so the palette can show it by group.
 */
export function findCommands(commands: Command[], query: string): Command[] {
  if (!normalise(query)) return commands;
  return commands
    .map((command, order) => ({ command, order, rank: matchRank(command, query) }))
    .filter(
      (entry): entry is { command: Command; order: number; rank: number } => entry.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.command);
}

/** The key that opens the palette, as the device writes it. */
export function paletteShortcut(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  const platform = navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad/u.test(platform) ? '⌘K' : 'Ctrl K';
}

/** Whether a key press is the one that opens the palette (Ctrl or ⌘, and K, with nothing else held). */
export function opensPalette(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}
