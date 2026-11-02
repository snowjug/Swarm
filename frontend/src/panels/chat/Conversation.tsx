import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, ProjectDetail } from '../../../../shared/types';
import { Button, ChipButton, Notice, Skeleton } from '../../design/ui';
import { useReducedMotion } from '../../design/motion';
import { engineNote, suggestions, type Availability } from './chatView';
import { Composer } from './Composer';
import { EngineLine } from './EngineLine';
import { Avatar, Message, Waiting, type Speaker } from './Message';
import { useConversation } from './useConversation';

function ThreadSkeleton() {
  return (
    <div className="sw-chat__skeleton" aria-hidden="true">
      <Skeleton width="55%" height="2.4rem" radius="1.2rem" />
      <div className="sw-chat__skeleton-reply">
        <Skeleton width="1.75rem" height="1.75rem" radius="50%" />
        <div className="sw-chat__skeleton-lines">
          <Skeleton width="92%" height="0.95rem" />
          <Skeleton width="78%" height="0.95rem" />
          <Skeleton width="40%" height="0.95rem" />
        </div>
      </div>
    </div>
  );
}

/** What a conversation says before anything has been asked: who is there, and a few ways to begin. */
function Opening({
  speaker,
  ideas,
  onPick,
}: {
  speaker: Speaker;
  ideas: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="sw-chat__opening sw-rise">
      <Avatar speaker={speaker} size={44} />
      <p className="sw-chat__opening-title">
        {speaker.analyst ? 'Ask the analyst about the report.' : `Ask ${speaker.name}.`}
      </p>
      {ideas.length > 0 && (
        <div className="sw-chat__ideas" role="group" aria-label="Ways to begin">
          {ideas.map((idea) => (
            <ChipButton key={idea} onClick={() => onPick(idea)}>
              {idea}
            </ChipButton>
          ))}
        </div>
      )}
    </div>
  );
}

/** One conversation: the messages so far, the question being answered, and where the next is written. */
export function Conversation({
  project,
  availability,
  target,
  speaker,
  active,
  drafts,
  seed,
  header,
}: {
  project: ProjectDetail;
  availability: Availability;
  target: string;
  speaker: Speaker;
  /** Whether it is the one in view: only that one scrolls to its latest. */
  active: boolean;
  drafts: Map<string, string>;
  /** A question to start with, written into the field but not sent. */
  seed?: string;
  /** Who is being asked: it scrolls away with the messages, so that they keep the room. */
  header?: ReactNode;
}) {
  const conversation = useConversation(project.id, target, availability.ready);
  const [draft, setDraft] = useState(() => drafts.get(target) ?? seed ?? '');
  const reduced = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);
  const note = engineNote(project, availability, !speaker.analyst);
  const { messages, pending, error, loading } = conversation;
  const limited = error?.kind === 'limit';

  useEffect(() => {
    drafts.set(target, draft);
  }, [drafts, target, draft]);

  // The latest is in view: at once when the conversation is first read, with a glide as it grows. An empty one starts at its top.
  useEffect(() => {
    if (!active || loading) return;
    const node = scroller.current;
    if (node && (messages.length > 0 || pending !== null)) {
      node.scrollTo({
        top: node.scrollHeight,
        behavior: settled.current && !reduced ? 'smooth' : 'auto',
      });
    }
    settled.current = true;
  }, [active, loading, messages.length, pending, reduced]);

  // The field is emptied as the question goes; if it did not go, the words come back unless something else was written meanwhile.
  const send = async (text: string) => {
    setDraft('');
    if (!(await conversation.send(text))) setDraft((current) => (current === '' ? text : current));
  };

  const noMessages = !loading && messages.length === 0 && !pending && error?.kind !== 'load';
  const placeholder =
    availability.local && speaker.analyst
      ? 'Find evidence about…'
      : availability.local
        ? `Look up what is recorded about ${speaker.name}…`
        : speaker.analyst
          ? 'Ask about the recorded scenario…'
          : `Ask ${speaker.name}…`;

  return (
    <div className="sw-chat__convo" data-active={active || undefined}>
      <div
        ref={scroller}
        className="sw-chat__scroll"
        role="region"
        aria-label={`Conversation with ${speaker.name}`}
        tabIndex={0}
      >
        {header}
        <div
          className="sw-chat__log"
          role="log"
          aria-label="Messages"
          aria-busy={loading || pending !== null}
        >
          {loading && messages.length === 0 && <ThreadSkeleton />}
          {noMessages && (
            <Opening
              speaker={speaker}
              ideas={suggestions(project, target)}
              onPick={(text) => {
                setDraft(text);
                input.current?.focus();
              }}
            />
          )}
          {(messages.length > 0 || pending !== null) && (
            <ol className="sw-chat__thread">
              {messages.map((message: ChatMessage) => (
                <Message
                  key={message.id}
                  message={message}
                  project={project}
                  speaker={speaker}
                  animate={conversation.arrived.has(message.id)}
                />
              ))}
              {pending && (
                <Waiting
                  question={pending}
                  label={
                    availability.local ? 'Looking through the evidence…' : 'Waiting for the model…'
                  }
                />
              )}
            </ol>
          )}
        </div>
        {error && (
          <Notice
            tone={error.kind === 'limit' ? 'caution' : 'error'}
            title={
              error.kind === 'load'
                ? 'The conversation could not be read'
                : error.kind === 'limit'
                  ? 'This conversation is full'
                  : 'That was not confirmed'
            }
            action={
              error.kind === 'limit' ? undefined : (
                <Button size="sm" variant="glass" onClick={conversation.reload}>
                  {error.kind === 'load' ? 'Retry' : 'Check what was saved'}
                </Button>
              )
            }
          >
            {error.text}
          </Notice>
        )}
      </div>
      <div className="sw-chat__dock">
        <Composer
          inputRef={input}
          value={draft}
          onChange={setDraft}
          onSend={(text) => void send(text)}
          label={speaker.analyst ? 'Question for the analyst' : `Question for ${speaker.name}`}
          placeholder={placeholder}
          sendLabel={availability.local ? 'Look up evidence' : 'Ask model'}
          busy={pending !== null}
          disabled={!availability.canReply || limited}
          blocked={loading && messages.length === 0}
          note={
            !availability.canReply
              ? 'New replies are unavailable: no provider is configured.'
              : limited
                ? 'This conversation has reached its limit.'
                : null
          }
        />
        <EngineLine note={note} />
      </div>
    </div>
  );
}
