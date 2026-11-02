import {
  Focus,
  List,
  MoreHorizontal,
  Network,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import { cx } from '../../design/cx';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
  ChipButton,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Tooltip,
} from '../../design/ui';
import { clusterColour } from '../../viz/palette';
import type { ClusterOption, Subject } from './model';

export type MapView = 'map' | 'list';

export interface ToolbarProps {
  view: MapView;
  onView: (view: MapView) => void;
  subject: Subject;
  hasActors: boolean;
  onSubject: (subject: Subject) => void;
  clusters: readonly ClusterOption[];
  hidden: ReadonlySet<string>;
  onToggleCluster: (id: string) => void;
  onShowAll: () => void;
  focus: boolean;
  canFocus: boolean;
  onFocus: (on: boolean) => void;
  canAdd: boolean;
  onAdd: () => void;
  /** The ways to start over from the list, which replace work. */
  canFind: boolean;
  onFindAgain: () => void;
  canMakeAgain: boolean;
  onMakeAgain: () => void;
}

/**
 * The few controls that change what the map shows. It floats over the picture as one quiet bar; every
 * control in it has a name, and none of them is needed to read the map. On a phone there is no room for
 * all of them in a row, so what is secondary goes into the one menu at the end.
 */
export function Toolbar(props: ToolbarProps) {
  const compact = useMediaQuery('(max-width: 40rem)');
  const hiddenCount = props.hidden.size;
  const more = props.canFind || props.canMakeAgain;
  const views = (
    <Segmented<MapView>
      size="sm"
      label="Show as"
      value={props.view}
      onChange={props.onView}
      options={[
        {
          value: 'map',
          label: <span className="sw-tb-label">Map</span>,
          icon: <Network size={15} aria-hidden="true" />,
        },
        {
          value: 'list',
          label: <span className="sw-tb-label">List</span>,
          icon: <List size={15} aria-hidden="true" />,
        },
      ]}
    />
  );
  const subjects = props.hasActors && (
    <Segmented<Subject>
      size="sm"
      label="Show"
      value={props.subject}
      onChange={props.onSubject}
      options={[
        { value: 'stakeholders', label: 'Stakeholders' },
        { value: 'actors', label: 'Actors' },
      ]}
    />
  );
  const restart = (
    <>
      {props.canFind && (
        <MenuItem icon={<Wand2 size={16} />} onSelect={props.onFindAgain}>
          Find stakeholders again…
        </MenuItem>
      )}
      {props.canMakeAgain && (
        <MenuItem icon={<RotateCcw size={16} />} onSelect={props.onMakeAgain}>
          Reset all actors…
        </MenuItem>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="sw-map__toolbar sw-glass" role="toolbar" aria-label="Map controls">
        {views}
        {subjects}
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              label={hiddenCount > 0 ? `More, ${hiddenCount} groups hidden` : 'More'}
              size="sm"
              pressed={hiddenCount > 0}
              data-stk-focus="add"
            >
              <MoreHorizontal size={17} aria-hidden="true" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>Groups</MenuLabel>
            {props.clusters.map((cluster) => (
              <MenuCheckboxItem
                key={cluster.id}
                checked={!props.hidden.has(cluster.id)}
                onSelect={(event) => {
                  event.preventDefault();
                  props.onToggleCluster(cluster.id);
                }}
                icon={
                  <span
                    className="sw-groups__dot"
                    style={{ background: clusterColour(cluster.id) }}
                    aria-hidden="true"
                  />
                }
              >
                {cluster.label}
              </MenuCheckboxItem>
            ))}
            {hiddenCount > 0 && (
              <MenuItem icon={<SlidersHorizontal size={16} />} onSelect={props.onShowAll}>
                Show all groups
              </MenuItem>
            )}
            <MenuSeparator />
            {props.view === 'map' && (
              <MenuCheckboxItem
                checked={props.focus}
                disabled={!props.canFocus}
                onSelect={(event) => {
                  event.preventDefault();
                  props.onFocus(!props.focus);
                }}
                icon={<Focus size={16} />}
              >
                Focus on what is connected
              </MenuCheckboxItem>
            )}
            {props.canAdd && (
              <MenuItem icon={<Plus size={16} />} onSelect={props.onAdd}>
                Add a stakeholder…
              </MenuItem>
            )}
            {more && <MenuSeparator />}
            {restart}
          </MenuContent>
        </Menu>
      </div>
    );
  }

  return (
    <div className="sw-map__toolbar sw-glass" role="toolbar" aria-label="Map controls">
      {views}
      {subjects}
      <Popover>
        <Tooltip label="Show or hide groups">
          <PopoverTrigger asChild>
            <ChipButton
              pressed={hiddenCount > 0}
              icon={<SlidersHorizontal size={14} aria-hidden="true" />}
              aria-label={hiddenCount > 0 ? `Groups, ${hiddenCount} hidden` : 'Groups'}
            >
              <span className="sw-tb-label">Groups</span>
              {hiddenCount > 0 && <span className="sw-tb-badge">{hiddenCount}</span>}
            </ChipButton>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent align="start" width="17rem" className="sw-groups">
          <p className="sw-eyebrow">Groups</p>
          <ul className="sw-groups__list">
            {props.clusters.map((cluster) => {
              const on = !props.hidden.has(cluster.id);
              return (
                <li key={cluster.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={cx('sw-groups__row', on && 'is-on')}
                    onClick={() => props.onToggleCluster(cluster.id)}
                  >
                    <span
                      className="sw-groups__dot"
                      style={{ background: clusterColour(cluster.id) }}
                      aria-hidden="true"
                    />
                    <span className="sw-groups__label">{cluster.label}</span>
                    <span className="sw-groups__count">{cluster.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <button type="button" className="sw-groups__all" onClick={props.onShowAll}>
              Show all
            </button>
          )}
        </PopoverContent>
      </Popover>
      {props.view === 'map' && (
        <IconButton
          label="Focus on what is connected"
          shortcut="F"
          size="sm"
          pressed={props.focus}
          disabled={!props.canFocus}
          onClick={() => props.onFocus(!props.focus)}
        >
          <Focus size={16} aria-hidden="true" />
        </IconButton>
      )}
      {props.canAdd && (
        <IconButton label="Add a stakeholder" size="sm" onClick={props.onAdd} data-stk-focus="add">
          <Plus size={17} aria-hidden="true" />
        </IconButton>
      )}
      {more && (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More" size="sm">
              <MoreHorizontal size={17} aria-hidden="true" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            {props.canFind && (
              <MenuItem icon={<Wand2 size={16} />} onSelect={props.onFindAgain}>
                Find stakeholders again…
              </MenuItem>
            )}
            {props.canFind && props.canMakeAgain && <MenuSeparator />}
            {props.canMakeAgain && (
              <MenuItem icon={<RotateCcw size={16} />} onSelect={props.onMakeAgain}>
                Reset all actors…
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}
