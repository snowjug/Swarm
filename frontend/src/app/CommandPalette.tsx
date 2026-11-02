import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { m } from 'motion/react';
import { Check, CornerDownLeft, Lock, Search, X } from 'lucide-react';
import { cx } from '../design/cx';
import { SPRING } from '../design/motion';
import { IconButton } from '../design/ui';
import { useReturnFocus } from '../design/useReturnFocus';
import { COMMAND_GROUPS, GROUP_LABELS, findCommands, type Command } from './commands';
import './CommandPalette.css';

/** A step of this many rows when Page Up or Page Down is pressed. */
const PAGE = 6;

/**
 * Every place and setting, one search away. It is a shortcut and never the only way: each command is also a
 * control somewhere on the page. The text field is a combobox over a listbox, so focus stays where the person
 * types and the arrows move through the rows; Enter does the one that is marked, Escape puts focus back.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const returnFocus = useReturnFocus();
  const ids = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searching = query.trim() !== '';

  const results = useMemo(() => findCommands(commands, query), [commands, query]);
  const sections = useMemo(
    () =>
      searching
        ? [{ group: null, items: results }]
        : COMMAND_GROUPS.map((group) => ({
            group,
            items: results.filter((command) => command.group === group),
          })).filter((section) => section.items.length > 0),
    [results, searching],
  );
  // The rows in the order they are shown, so that the arrows and the mark agree with the screen.
  const rows = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  // A group is named beside a found row only when the rows come from more than one: otherwise it says the same on every line.
  const mixed = new Set(rows.map((command) => command.group)).size > 1;
  const marked = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const optionId = (command: Command) => `${ids}-${command.id}`;
  const markedId = marked >= 0 ? optionId(rows[marked]!) : undefined;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (markedId) document.getElementById(markedId)?.scrollIntoView({ block: 'nearest' });
  }, [markedId]);

  const run = useCallback(
    (command: Command) => {
      onOpenChange(false);
      command.run();
    },
    [onOpenChange],
  );

  const move = (by: number) => {
    if (rows.length === 0) return;
    setActive((marked + by + rows.length) % rows.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        setActive(Math.min(rows.length - 1, Math.max(0, marked) + PAGE));
        break;
      case 'PageUp':
        event.preventDefault();
        setActive(Math.max(0, Math.max(0, marked) - PAGE));
        break;
      case 'Enter':
        if (marked >= 0) {
          event.preventDefault();
          run(rows[marked]!);
        }
        break;
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sw-scrim sw-scrim--dialog" />
        <RadixDialog.Content
          ref={returnFocus.remember}
          className="sw-cmdk sw-glass sw-glass--overlay"
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus.restore}
        >
          <RadixDialog.Title className="sr-only">Commands</RadixDialog.Title>
          <div className="sw-cmdk__field">
            <Search size={18} aria-hidden="true" />
            <input
              type="text"
              role="combobox"
              className="sw-cmdk__input"
              aria-label="Search commands"
              aria-expanded={rows.length > 0}
              aria-controls={rows.length > 0 ? `${ids}-list` : undefined}
              aria-activedescendant={markedId}
              aria-autocomplete="list"
              placeholder="Go to, open or change…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <kbd className="sw-kbd sw-cmdk__esc" aria-hidden="true">
              Esc
            </kbd>
          </div>
          {rows.length > 0 ? (
            // The rows scroll, so the list can take focus (a scrollable region has to be reachable by a keyboard) and
            // answers the arrows itself; a press on it leaves focus in the field, where the person is typing.
            <div
              id={`${ids}-list`}
              role="listbox"
              aria-label="Commands"
              aria-activedescendant={markedId}
              tabIndex={0}
              className="sw-cmdk__body"
              onKeyDown={onKeyDown}
              onMouseDown={(event) => event.preventDefault()}
            >
              {sections.map((section, index) => {
                const options = section.items.map((command) => {
                  const here = rows.indexOf(command) === marked;
                  const trailing =
                    command.hint ?? (searching && mixed ? GROUP_LABELS[command.group] : '');
                  return (
                    <div
                      key={command.id}
                      id={optionId(command)}
                      role="option"
                      aria-selected={here}
                      aria-disabled={command.locked || undefined}
                      className={cx(
                        'sw-cmdk__option',
                        here && 'is-marked',
                        command.locked && 'is-locked',
                      )}
                      onPointerMove={() => {
                        if (!here) setActive(rows.indexOf(command));
                      }}
                      onClick={() => run(command)}
                    >
                      {here && (
                        <m.span
                          layoutId="sw-cmdk-mark"
                          className="sw-cmdk__mark"
                          transition={SPRING.snappy}
                          aria-hidden="true"
                        />
                      )}
                      <span className="sw-cmdk__icon" aria-hidden="true">
                        {command.locked ? <Lock size={16} /> : <command.icon size={17} />}
                      </span>
                      <span className="sw-cmdk__label">{command.label}</span>
                      <span className="sw-cmdk__end">
                        {trailing && <span className="sw-cmdk__hint">{trailing}</span>}
                        {command.current && !command.locked && (
                          <>
                            <Check size={15} className="sw-cmdk__check" aria-hidden="true" />
                            <span className="sr-only">, on</span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                });
                return section.group ? (
                  <div
                    key={section.group}
                    role="group"
                    aria-labelledby={`${ids}-group-${section.group}`}
                    className="sw-cmdk__section"
                    data-first={index === 0 || undefined}
                  >
                    <p id={`${ids}-group-${section.group}`} className="sw-eyebrow sw-cmdk__group">
                      {GROUP_LABELS[section.group]}
                    </p>
                    {options}
                  </div>
                ) : (
                  <div key="results" className="sw-cmdk__section">
                    {options}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="sw-cmdk__empty">
              Nothing matches <span className="sw-cmdk__query">{query.trim()}</span>
            </p>
          )}
          <p className="sr-only" role="status">
            {rows.length === 0
              ? 'No commands match.'
              : `${rows.length} ${rows.length === 1 ? 'command' : 'commands'}`}
          </p>
          <div className="sw-cmdk__foot" aria-hidden="true">
            <span>
              <kbd className="sw-kbd">↑</kbd>
              <kbd className="sw-kbd">↓</kbd> Move
            </span>
            <span>
              <kbd className="sw-kbd">
                <CornerDownLeft size={12} />
              </kbd>{' '}
              Run
            </span>
          </div>
          {/* A touch screen has no Esc: the way out is a control, drawn in the field's corner where there is no key to name. */}
          <RadixDialog.Close asChild>
            <IconButton label="Close" tooltip={false} className="sw-cmdk__close">
              <X size={18} aria-hidden="true" />
            </IconButton>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
