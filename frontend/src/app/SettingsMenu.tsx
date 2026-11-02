import {
  Contrast,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Gauge,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react';
import {
  MOTION_LABELS,
  MOTION_PREFERENCES,
  setMotionPreference,
  useMotionPreference,
  type MotionPreference,
} from '../design/motion';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../design/ui';
import { MODE_LABELS, MODE_SUMMARIES, UI_MODES, type UiMode } from '../lib/mode';
import { THEME_LABELS, PREFERENCES, type ThemePreference } from '../lib/theme';

const THEME_ICONS: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
};

export interface ProjectTools {
  onRefresh: () => void;
  onAudit: () => void;
  onDuplicate: () => void;
  onSnapshot: () => void;
  onBudget: (() => void) | null;
  onAccess: (() => void) | null;
  busy: boolean;
}

/**
 * Everything that is a setting or a tool and not a step of the journey, behind one button: how the page
 * looks and moves, how much of the engine is shown, the project's own tools, and the account.
 */
export function SettingsMenu({
  theme,
  onTheme,
  mode,
  onMode,
  project,
  account,
  version,
  sourceUrl,
}: {
  theme: ThemePreference;
  onTheme: (next: ThemePreference) => void;
  mode: UiMode;
  onMode: (next: UiMode) => void;
  project: ProjectTools | null;
  account: { label: string; onPeople: (() => void) | null; onSignOut: (() => void) | null };
  version: string | null;
  sourceUrl: string | null;
}) {
  const motion = useMotionPreference();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Settings and tools" size="md">
          <Ellipsis size={20} aria-hidden="true" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="sw-settings">
        <MenuLabel>Appearance</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={(value) => onTheme(value as ThemePreference)}>
          {PREFERENCES.map((name) => {
            const Icon = THEME_ICONS[name];
            return (
              <MenuRadioItem key={name} value={name} icon={<Icon size={16} />}>
                {THEME_LABELS[name]}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Motion</MenuLabel>
        <MenuRadioGroup
          value={motion}
          onValueChange={(value) => setMotionPreference(value as MotionPreference)}
        >
          {MOTION_PREFERENCES.map((name) => (
            <MenuRadioItem key={name} value={name}>
              {MOTION_LABELS[name]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Detail</MenuLabel>
        <MenuRadioGroup value={mode} onValueChange={(value) => onMode(value as UiMode)}>
          {UI_MODES.map((name) => (
            <MenuRadioItem key={name} value={name}>
              <span className="sw-settings__option">
                {MODE_LABELS[name]}
                <small>{MODE_SUMMARIES[name]}</small>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {project && (
          <>
            <MenuSeparator />
            <MenuLabel>This exploration</MenuLabel>
            <MenuItem icon={<RefreshCw size={16} />} onSelect={project.onRefresh}>
              Refresh
            </MenuItem>
            <MenuItem
              icon={<Copy size={16} />}
              disabled={project.busy}
              onSelect={project.onDuplicate}
            >
              Duplicate as a new question
            </MenuItem>
            <MenuItem icon={<Download size={16} />} onSelect={project.onSnapshot}>
              Export snapshot
            </MenuItem>
            <MenuItem icon={<ShieldCheck size={16} />} onSelect={project.onAudit}>
              Audit log
            </MenuItem>
            {project.onBudget && (
              <MenuItem icon={<Gauge size={16} />} onSelect={project.onBudget}>
                Model budget
              </MenuItem>
            )}
            {project.onAccess && (
              <MenuItem icon={<Users size={16} />} onSelect={project.onAccess}>
                Who has access
              </MenuItem>
            )}
          </>
        )}
        <MenuSeparator />
        <MenuLabel>{account.label}</MenuLabel>
        {account.onPeople && (
          <MenuItem icon={<Users size={16} />} onSelect={account.onPeople}>
            People
          </MenuItem>
        )}
        {account.onSignOut && (
          <MenuItem icon={<LogOut size={16} />} onSelect={account.onSignOut}>
            Sign out
          </MenuItem>
        )}
        <div className="sw-settings__about">
          <span>Swarm{version ? ` v${version}` : ''} · AGPL-3.0</span>
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              Source <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </MenuContent>
    </Menu>
  );
}
