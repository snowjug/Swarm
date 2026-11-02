import { useMemo, useRef, useState } from 'react';
import { ArrowRight, ClipboardList, MessageCircleQuestion, Sparkles, Users } from 'lucide-react';
import type { SurveyRecord } from '../../../shared/guided';
import type { Agent, AppConfig, ProjectDetail } from '../../../shared/types';
import { Button, EmptyState, Sheet, SheetContent, TabPanel, Tabs } from '../design/ui';
import {
  ANALYST_TARGET,
  WAIT_TITLES,
  availability,
  resolveSeed,
  splitRole,
  stanceView,
  type AskTab,
} from './chat/chatView';
import { ActorPicker } from './chat/ActorPicker';
import { Conversation } from './chat/Conversation';
import { Orb } from './shared/Orb';
import { StanceTrack } from './chat/StanceTrack';
import { Surveys } from './chat/Surveys';
import type { Speaker } from './chat/Message';
import { usePanelLifecycle } from './shared/usePanelLifecycle';
import './chat/chat.css';

export interface AskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  config: AppConfig | null;
  onSurvey: (record: SurveyRecord) => void;
  /**
   * Opens the deep dive, where the report that Ask reads from is written, and leaves the sheet. Null where the
   * deep dive cannot be opened yet: the sheet then says what opens it instead of offering a way that is shut.
   */
  onDeepDive?: (() => void) | null;
  /** An actor or the analyst to open on, and a question to start with. */
  initialTarget?: string;
  initialMessage?: string;
}

const LEDES: Record<AskTab, string> = {
  analyst: 'The analyst answers from the report and its evidence.',
  actors: 'Actors stand in for groups. They are synthetic, not people.',
  survey: 'Put one question to several actors at once.',
};

/** Who an actor is, said once: the kind of actor, what it does, and where it stands now against where it began. */
function ActorHeader({ agent }: { agent: Agent }) {
  const role = splitRole(agent.role);
  const now = stanceView(agent.opinion);
  return (
    <div className="sw-chat__actor">
      <Orb seed={agent.id} size={44} />
      <div className="sw-chat__actor-main">
        <h3 className="sw-chat__actor-name">{agent.name}</h3>
        <p className="sw-caption">
          {role.kind}
          {role.what ? `: ${role.what}` : ''}
        </p>
        <div className="sw-chat__actor-stance">
          <StanceTrack now={agent.opinion} start={agent.initialOpinion} />
          <span className="sw-caption num">
            {now.label}, {now.signed}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Opens on the field, where a pointer can type at once; a phone is left alone, so that its keyboard does not hide the sheet. */
function focusStart(event: Event): void {
  event.preventDefault();
  const root = event.target;
  if (!(root instanceof HTMLElement)) return;
  const fine =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  const input = fine
    ? root.querySelector<HTMLTextAreaElement>('.sw-chat__convo[data-active] textarea')
    : null;
  (input ?? root).focus({ preventScroll: true });
}

/**
 * "Ask": the conversation with the analyst about the report and with the synthetic actors, and the
 * surveys that put one question to several of them. Everything it says is read from the project; the
 * analyst never speaks before there is a report to speak from.
 */
export function AskSheet({
  open,
  onOpenChange,
  project,
  config,
  onSurvey,
  onDeepDive = null,
  initialTarget,
  initialMessage,
}: AskSheetProps) {
  const lifecycle = usePanelLifecycle(open, onOpenChange);
  const state = useMemo(() => availability(project, config), [project, config]);
  const start = useRef(resolveSeed(project, initialTarget));
  const [tab, setTab] = useState<AskTab>(start.current.tab);
  const [actorId, setActorId] = useState(start.current.actorId ?? '');
  const drafts = useRef(new Map<string, string>());

  const actor = project.agents.find((agent) => agent.id === actorId) ?? project.agents[0] ?? null;
  const analyst: Speaker = { name: 'The analyst', seed: `${project.id}:analyst`, analyst: true };
  const seedFor = (target: string): string | undefined =>
    start.current.tab === 'analyst' && target === ANALYST_TARGET
      ? initialMessage
      : start.current.tab === 'actors' && target === start.current.actorId
        ? initialMessage
        : undefined;

  const openActor = (id: string) => {
    setActorId(id);
    setTab('actors');
  };

  return (
    <Sheet open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <SheetContent
        eyebrow={project.name}
        title="Ask"
        description={state.ready ? LEDES[tab] : undefined}
        width="lg"
        className="sw-chat-sheet"
        onOpenAutoFocus={focusStart}
      >
        {!state.ready ? (
          <EmptyState
            icon={<MessageCircleQuestion size={22} aria-hidden="true" />}
            title={WAIT_TITLES[state.wait ?? 'none']}
            action={
              onDeepDive ? (
                <Button
                  variant="primary"
                  iconEnd={<ArrowRight size={16} aria-hidden="true" />}
                  onClick={onDeepDive}
                >
                  {state.wait === 'running' ? 'Watch it run' : 'Open the deep dive'}
                </Button>
              ) : undefined
            }
          >
            {onDeepDive
              ? state.waiting
              : `${state.waiting} The deep dive opens once the actors are made.`}
          </EmptyState>
        ) : (
          <Tabs<AskTab>
            value={tab}
            onValueChange={setTab}
            label="Who to ask"
            variant="pill"
            className="sw-chat__tabs-root"
            listClassName="sw-chat__tabs"
            tabs={[
              { value: 'analyst', label: 'Analyst', icon: <Sparkles aria-hidden="true" /> },
              {
                value: 'actors',
                label: 'Actors',
                icon: <Users aria-hidden="true" />,
                count: project.agents.length,
                disabled: project.agents.length === 0,
              },
              {
                value: 'survey',
                label: 'Survey',
                icon: <ClipboardList aria-hidden="true" />,
                count: project.console?.surveys.length || undefined,
              },
            ]}
          >
            <TabPanel value="analyst" forceMount className="sw-chat__panel">
              <Conversation
                project={project}
                availability={state}
                target={ANALYST_TARGET}
                speaker={analyst}
                active={tab === 'analyst'}
                drafts={drafts.current}
                seed={seedFor(ANALYST_TARGET)}
              />
            </TabPanel>
            <TabPanel value="actors" forceMount className="sw-chat__panel">
              {actor ? (
                <>
                  <ActorPicker agents={project.agents} value={actor.id} onChange={setActorId} />
                  <Conversation
                    key={actor.id}
                    project={project}
                    availability={state}
                    target={actor.id}
                    speaker={{ name: actor.name, seed: actor.id, analyst: false }}
                    active={tab === 'actors'}
                    drafts={drafts.current}
                    seed={seedFor(actor.id)}
                    header={<ActorHeader agent={actor} />}
                  />
                </>
              ) : (
                <EmptyState
                  icon={<Users size={22} aria-hidden="true" />}
                  title="No actors recorded"
                >
                  This record has no actors to talk to.
                </EmptyState>
              )}
            </TabPanel>
            <TabPanel value="survey" forceMount className="sw-chat__panel">
              <Surveys
                project={project}
                config={config}
                availability={state}
                onSurvey={onSurvey}
                onOpenActor={openActor}
                seed={start.current.tab === 'survey' ? initialMessage : undefined}
              />
            </TabPanel>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
