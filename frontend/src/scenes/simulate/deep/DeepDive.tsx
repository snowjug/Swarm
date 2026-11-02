import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Platform } from '../../../../../shared/guided';
import { useWorkspace } from '../../../app/context';
import { useUnsavedWork } from '../../../app/unsaved-context';
import { TabPanel, Tabs, type TabItem } from '../../../design/ui';
import { useReducedMotion } from '../../../design/motion';
import { useAnnouncer } from '../../../hooks/useFocusRequest';
import { isGuided } from '../../../lib/console';
import { BranchSheet } from './Branch';
import { EngineDisclosure, Engine } from './Engine';
import { Header, RunStrip } from './Header';
import { Legacy } from './Legacy';
import { Memory } from './Memory';
import { ProxySheet } from './Cast';
import { RestartDialog } from './Restart';
import { Rounds } from './Rounds';
import { Run } from './Run';
import { SaveBar } from './SaveBar';
import { Setup } from './Setup';
import { NoRounds } from './States';
import { DeepContext, type DeepState, type DeepTab } from './context';
import { useEnvironmentDraft, useRunActions } from './controller';
import {
  NO_FILTER,
  deepPhase,
  defaultPlatform,
  phaseView,
  platformViews,
  runControls,
  savedRounds,
  unsavedWords,
  type DeepPhase,
  type MemoryFilter,
} from './model';
import './deep.css';

/** Where to open: the setup before there is a run to look at, the run while there is one, the rounds once it is done. */
function openingTab(phase: DeepPhase, branched: boolean): DeepTab {
  switch (phase) {
    case 'queued':
    case 'running':
    case 'paused':
    case 'failed':
    case 'cancelled':
      return 'run';
    case 'complete':
      return 'rounds';
    // A branch that has not started yet opens on what it declared, which is on the run.
    case 'ready':
      return branched ? 'run' : 'setup';
    default:
      return 'setup';
  }
}

const started = (phase: DeepPhase): boolean =>
  !['unprepared', 'preparing', 'prep-stopped', 'legacy', 'unavailable'].includes(phase);

/**
 * The deep dive: the older, slower engine, in which fictional proxies act on two simulated platforms round by
 * round. It is optional and secondary to the comparison, and it stays whole: set it up, run it, pause it
 * to add one assumed event, branch it from a checkpoint, look at every round of each platform, read what was
 * recorded, and see the engine's own records. Everything it shows is what the server saved.
 */
export default function DeepDive() {
  const ws = useWorkspace();
  const { project, config, mode } = ws;
  const [message, announce] = useAnnouncer();
  const phase = deepPhase(project);
  const guided = isGuided(project);
  const whatIf = guided && Boolean(config?.capabilities.whatIf);
  const advanced = mode === 'advanced';

  const [tab, setTab] = useState<DeepTab>(() =>
    openingTab(phase, Boolean(project.console?.branch)),
  );
  const [platform, setPlatform] = useState<Platform>(() => defaultPlatform(project));
  const [filter, setFilter] = useState<MemoryFilter>(NO_FILTER);
  const [proxy, setProxy] = useState<string | null>(null);
  const [branch, setBranch] = useState<{ from: number | undefined } | null>(null);
  const [restart, setRestart] = useState(false);

  // The round in view follows the run as rounds are saved, until the person moves it to an earlier one.
  const saved = savedRounds(project);
  const latest = useRef(ws);
  useEffect(() => {
    latest.current = ws;
  });
  const [pinned, setPinned] = useState<number | null>(null);
  const round = pinned === null ? saved : Math.min(pinned, saved);
  const setRound = useCallback(
    (next: number) =>
      setPinned(next >= savedRounds(latest.current.project) ? null : Math.max(0, next)),
    [],
  );

  const environment = useEnvironmentDraft(ws);
  // While the setup holds edits that are not saved (the bar at the foot of the page says so), the shell asks before it
  // lets the person out of the scene.
  useUnsavedWork(unsavedWords(environment.editable ? (environment.changes?.total ?? 0) : 0));
  const controls = useMemo(() => runControls(project, whatIf), [project, whatIf]);
  const platforms = useMemo(() => platformViews(project), [project]);
  const actions = useRunActions(ws, { onStarted: () => setTab('run'), announce });

  // A change in where the run stands is said aloud once; a round that was just saved while it runs, too.
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    const view = phaseView(project);
    const text = `${view.label}. ${view.detail}`;
    if (spoken.current !== null && spoken.current !== text) announce(text);
    spoken.current = text;
  }, [project, announce]);

  // A link inside one tab can lead to another while the person is far down the page: bring the tabs back into view. How
  // it gets there is read when it happens, so that a change of the motion setting is not itself a reason to scroll.
  const reduced = useReducedMotion();
  const reducedNow = useRef(reduced);
  useEffect(() => {
    reducedNow.current = reduced;
  }, [reduced]);
  const root = useRef<HTMLElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    const tabs = root.current?.querySelector<HTMLElement>('.sw-deep-tabs');
    if (tabs && tabs.getBoundingClientRect().top < 0)
      tabs.scrollIntoView({ block: 'start', behavior: reducedNow.current ? 'auto' : 'smooth' });
  }, [tab]);
  const followInMemory = useCallback((patch: Partial<MemoryFilter>) => {
    setFilter({ ...NO_FILTER, ...patch });
    setTab('memory');
  }, []);

  // A sheet or a dialog that is opened from state has no trigger to give focus back to, so it is remembered here.
  const opener = useRef<HTMLElement | null>(null);
  const remember = useCallback(() => {
    if (opener.current === null && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
  }, []);
  const giveBack = useCallback(() => {
    const target = opener.current;
    opener.current = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, []);
  // A sheet that closes into another panel (asking a proxy opens Ask) leaves the focus to that panel: nothing is given back
  // to the control that opened it, which would take the focus from the panel on the next frame.
  const closeIntoPanel = useCallback(() => {
    opener.current = null;
  }, []);
  const openProxy = useCallback(
    (id: string) => {
      remember();
      setProxy(id);
    },
    [remember],
  );
  const openBranch = useCallback(
    (from?: number) => {
      remember();
      setBranch({ from });
    },
    [remember],
  );
  const askRestart = useCallback(() => {
    remember();
    setRestart(true);
  }, [remember]);

  const state = useMemo<DeepState>(
    () => ({
      project,
      whatIf,
      advanced,
      controls,
      platforms,
      actions,
      environment,
      tab,
      setTab,
      platform,
      setPlatform,
      round,
      setRound,
      filter,
      setFilter,
      openProxy,
      openBranch,
      askRestart,
      announce,
      followInMemory,
    }),
    [
      project,
      whatIf,
      advanced,
      controls,
      platforms,
      actions,
      environment,
      tab,
      platform,
      round,
      setRound,
      filter,
      openProxy,
      openBranch,
      askRestart,
      announce,
      followInMemory,
    ],
  );

  const memories = project.console?.memories.length ?? 0;
  const items: TabItem<DeepTab>[] = [
    { value: 'setup', label: 'Setup' },
    { value: 'run', label: 'Run' },
    { value: 'rounds', label: 'Rounds', ...(saved > 0 ? { count: saved } : {}) },
    { value: 'memory', label: 'Memory', ...(memories > 0 ? { count: memories } : {}) },
    ...(advanced ? [{ value: 'engine' as const, label: 'Advanced' }] : []),
  ];
  const shown: DeepTab = tab === 'engine' && !advanced ? 'run' : tab;

  return (
    <DeepContext.Provider value={state}>
      <section className="sw-deep" aria-labelledby="deep-title" data-phase={phase} ref={root}>
        <Header />
        {guided ? (
          <>
            <RunStrip />
            <Tabs
              className="sw-deep-tabs"
              label="Parts of the deep dive"
              value={shown}
              onValueChange={setTab}
              tabs={items}
            >
              <TabPanel value="setup" className="sw-deep-panel">
                <Setup />
              </TabPanel>
              <TabPanel value="run" className="sw-deep-panel">
                {started(phase) ? <Run /> : <NoRounds what="The run" />}
              </TabPanel>
              <TabPanel value="rounds" className="sw-deep-panel">
                <Rounds />
              </TabPanel>
              <TabPanel value="memory" className="sw-deep-panel">
                <Memory />
              </TabPanel>
              {advanced && (
                <TabPanel value="engine" className="sw-deep-panel">
                  <Engine />
                </TabPanel>
              )}
            </Tabs>
            {!advanced && <EngineDisclosure />}
          </>
        ) : (
          <Legacy />
        )}
        <SaveBar />
        {proxy && (
          <ProxySheet
            id={proxy}
            onOpen={setProxy}
            onClose={() => {
              setProxy(null);
              giveBack();
            }}
            onAsk={() => {
              setProxy(null);
              closeIntoPanel();
            }}
          />
        )}
        {branch && (
          <BranchSheet
            from={branch.from}
            onClose={() => {
              setBranch(null);
              giveBack();
            }}
          />
        )}
        {restart && (
          <RestartDialog
            onClose={() => {
              setRestart(false);
              giveBack();
            }}
          />
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {message}
        </p>
      </section>
    </DeepContext.Provider>
  );
}
