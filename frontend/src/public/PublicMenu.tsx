import { KeyRound, LogOut, Sparkles, UserRound } from 'lucide-react';
import { MenuItem, MenuLabel } from '../design/ui';

/** The account part of the settings menu in the public edition. It takes the place of the pilot's own. */
export function PublicMenu({
  emailMasked,
  byokEnabled,
  sampleBusy,
  onAccount,
  onKey,
  onSample,
  onSignOut,
}: {
  emailMasked: string | null;
  byokEnabled: boolean;
  sampleBusy: boolean;
  onAccount: () => void;
  onKey: () => void;
  onSample: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <MenuLabel>Signed in</MenuLabel>
      {emailMasked && (
        <div className="sw-pub-who" data-testid="menu-email">
          {emailMasked}
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
      <MenuItem icon={<LogOut size={16} />} data-testid="menu-signout" onSelect={onSignOut}>
        Sign out
      </MenuItem>
    </>
  );
}
