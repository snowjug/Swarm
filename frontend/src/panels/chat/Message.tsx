import { memo, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ChevronDown,
  CircleCheck,
  CircleHelp,
  CircleX,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { ChatGrounding, ChatMessage, ProjectDetail } from '../../../../shared/types';
import { cx } from '../../design/cx';
import { useReducedMotion } from '../../design/motion';
import { Orbit } from '../../design/ui';
import { Orb } from '../shared/Orb';
import { clockTime, fullTime } from '../shared/time';
import { groundingView, parseReply, wordStep, words, type ReplyBlock } from './chatView';
import { Citations } from './Citations';

export interface Speaker {
  name: string;
  /** Who this is, for the sphere: the actor's identifier, or the analyst's. */
  seed: string;
  analyst: boolean;
}

/** A text whose words arrive one after another. The whole text is in the page from the first moment. */
function Words({ text, animate }: { text: string; animate: boolean }) {
  if (!animate) return <>{text}</>;
  const parts = words(text);
  const total = parts.filter((part) => part.index !== null).length;
  return (
    <span className="sw-chat__words" style={{ '--step': `${wordStep(total)}s` } as CSSProperties}>
      {parts.map((part, position) =>
        part.index === null ? (
          part.text
        ) : (
          <span
            key={position}
            className="sw-chat__word"
            style={{ '--w': Math.min(part.index, 160) } as CSSProperties}
          >
            {part.text}
          </span>
        ),
      )}
    </span>
  );
}

/** A passage the reply quotes, set as a quotation: the document it is from, and the words as they were. */
function Quoted({ block }: { block: Extract<ReplyBlock, { kind: 'passage' }> }) {
  const [open, setOpen] = useState(false);
  const long = block.text.length > 280;
  return (
    <figure className="sw-chat__passage" data-memory={block.memory || undefined}>
      <figcaption className="sw-chat__passage-head">
        <span className="sw-mono">{block.id}</span>
        <span>{block.label}</span>
        {block.memory && <span className="sw-chat__passage-tag">Simulated, not evidence</span>}
      </figcaption>
      <blockquote className={cx('sw-chat__quote', long && !open && 'is-clamped')}>
        {block.text}
      </blockquote>
      {long && (
        <button
          type="button"
          className="sw-chat__more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </figure>
  );
}

function ReplyBody({ content, animate }: { content: string; animate: boolean }) {
  const blocks = parseReply(content);
  return (
    <div className="sw-chat__reply">
      {blocks.map((block, index) => {
        if (block.kind === 'passage') return <Quoted key={index} block={block} />;
        if (block.kind === 'note') {
          return (
            <p key={index} className="sw-caption sw-chat__note">
              {block.text}
            </p>
          );
        }
        return (
          <p key={index} className="sw-chat__text">
            <Words text={block.text} animate={animate} />
          </p>
        );
      })}
    </div>
  );
}

const GROUNDING_ICONS = {
  favor: CircleCheck,
  caution: TriangleAlert,
  critical: CircleX,
  neutral: CircleHelp,
  accent: CircleHelp,
  against: CircleX,
} as const;

/** How far an answer rests on the project's evidence: a word and a glyph always, the reasons one press away. */
function Grounding({ grounding }: { grounding: ChatGrounding }) {
  const view = groundingView(grounding.status);
  const [open, setOpen] = useState(false);
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const Icon = GROUNDING_ICONS[view.tone];

  // The reasons unfold below the button; at the end of a conversation that is under the composer, so they are brought into view.
  const reveal = () =>
    group.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  useEffect(() => {
    if (open && reduced) group.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [open, reduced]);

  return (
    <div ref={group} className="sw-chat__ground" data-tone={view.tone}>
      <button
        type="button"
        className="sw-chat__why"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{view.label}</span>
        <ChevronDown
          size={14}
          className={cx('sw-chat__chev', open && 'is-open')}
          aria-hidden="true"
        />
      </button>
      <div
        id={id}
        className="sw-chat__why-body"
        data-open={open}
        inert={!open || undefined}
        onTransitionEnd={(event) => {
          if (
            open &&
            event.target === event.currentTarget &&
            event.propertyName === 'grid-template-rows'
          )
            reveal();
        }}
      >
        <div className="sw-chat__why-inner">
          <p className="sw-caption">{view.meaning}</p>
          {grounding.notes.length > 0 && (
            <ul className="sw-chat__why-notes">
              {grounding.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          )}
          {grounding.coverage !== null && (
            <p className="sw-caption num">
              The project’s material covers {Math.round(grounding.coverage * 100)}% of the
              question’s key terms.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function engineLabel(message: ChatMessage, speaker: Speaker): string {
  if (message.mode === 'local') return 'Evidence lookup';
  return speaker.analyst ? 'Generated analysis' : 'Fictional role-play';
}

export function Avatar({ speaker, size = 28 }: { speaker: Speaker; size?: number }) {
  return speaker.analyst ? (
    <span
      className="sw-chat__analyst"
      style={{ '--orb': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <Sparkles size={Math.round(size * 0.5)} />
    </span>
  ) : (
    <Orb seed={speaker.seed} size={size} />
  );
}

export const Message = memo(function Message({
  message,
  project,
  speaker,
  animate,
}: {
  message: ChatMessage;
  project: ProjectDetail;
  speaker: Speaker;
  animate: boolean;
}) {
  if (message.role === 'user') {
    return (
      <li className="sw-chat__msg sw-chat__msg--user sw-rise">
        <div className="sw-chat__bubble">{message.content}</div>
        <time
          className="sw-chat__time num"
          dateTime={message.createdAt}
          title={fullTime(message.createdAt)}
        >
          {clockTime(message.createdAt)}
        </time>
      </li>
    );
  }
  return (
    <li className={cx('sw-chat__msg sw-chat__msg--reply', !animate && 'sw-rise')}>
      <div className="sw-chat__who">
        <Avatar speaker={speaker} />
        <strong>{speaker.name}</strong>
        <span className="sw-chat__via">{engineLabel(message, speaker)}</span>
        <time
          className="sw-chat__time num"
          dateTime={message.createdAt}
          title={fullTime(message.createdAt)}
        >
          {clockTime(message.createdAt)}
        </time>
      </div>
      <ReplyBody content={message.content} animate={animate} />
      {message.grounding && <Grounding grounding={message.grounding} />}
      <Citations
        project={project}
        sourceIds={message.sourceIds}
        memoryIds={message.memoryIds}
        claimIds={message.claimIds}
      />
    </li>
  );
});

/** A question that has been sent and not yet answered: the person's own words at once, and the wait said plainly. */
export function Waiting({ question, label }: { question: string; label: string }) {
  return (
    <>
      <li className="sw-chat__msg sw-chat__msg--user sw-rise">
        <div className="sw-chat__bubble">{question}</div>
      </li>
      <li className="sw-chat__msg sw-chat__msg--reply sw-chat__thinking sw-rise">
        <Orbit size={18} label={label} />
        <span aria-hidden="true">{label}</span>
      </li>
    </>
  );
}
