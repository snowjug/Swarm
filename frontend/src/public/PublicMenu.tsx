import { KeyRound, LogOut, Sparkles, UserRound } from 'lucide-react';
import { MenuItem, MenuLabel } from '../design/ui';
import { guestReminderWords } from './guest';

/**
 * The account part of the settings menu in the public edition. It takes the place of the pilot's own. A guest has no
 * address and nothing to sign out of: deleting their data, in the account panel, is how a guest leaves. The menu says
 * for how long (`guestHours`) their data is kept.
 */
export function PublicMenu({
  emailMasked,
  guest = false,
  guestHours,
  byokEnabled,
  sampleBusy,
  onAccount,
  onKey,
  onSample,
  onSignOut,
}: {
  emailMasked: string | null;
  guest?: boolean;
  guestHours?: number;
  byokEnabled: boolean;
  sampleBusy: boolean;
  onAccount: () => void;
  onKey: () => void;
  onSample: () => void;
  onSignOut: () => void;
}) {
  const who = guest ? 'Guest' : emailMasked;
  return (
    <>
      <MenuLabel>{guest ? 'Using Swarm as' : 'Signed in'}</MenuLabel>
      {who && (
        <div className="sw-pub-who" data-testid="menu-email">
          {who}
        </div>
      )}
      {guest && guestHours !== undefined && (
        <div className="sw-pub-who sw-pub-who--note" data-testid="menu-guest-reminder">
          {guestReminderWords(guestHours)}
        </div>
      )}
      <MenuItem icon={<UserRound size={16} />} data-testid="menu-account" onSelect={onAccount}>
        Account
      </MenuItem>
      {byokEnabled && (
        <MenuItem icon={<KeyRound size={16} />} data-testid="menu-byok" onSelect={onKey}>
          Use your own Google key
        </MenuItem>
      )}
      <MenuItem
        icon={<Sparkles size={16} />}
        disabled={sampleBusy}
        data-testid="try-sample-menu"
        onSelect={onSample}
      >
        Try a sample
      </MenuItem>
      {!guest && (
        <MenuItem icon={<LogOut size={16} />} data-testid="menu-signout" onSelect={onSignOut}>
          Sign out
        </MenuItem>
      )}
    </>
  );
}
