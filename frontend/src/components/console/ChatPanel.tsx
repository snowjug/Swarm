import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUp, RefreshCw } from 'lucide-react';
import { chatInputSchema } from '../../../../shared/types';
import type { ChatMessage, ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { dateTime } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { Citations } from './Citations';

export function ChatPanel({
  project,
  target,
  modelConfigured,
  onInspect,
}: {
  project: ProjectDetail;
  target: string;
  modelConfigured: boolean;
  onInspect: (selection: Inspection) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const send = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const completed = project.status === 'completed' && Boolean(project.report);
  const local = project.mode === 'local';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    void api.chat(project.id, target, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) {
          setMessages(response.messages);
          setLoading(false);
        }
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(failure));
          setLoadFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      controller.abort();
      send.current?.abort();
    };
  }, [project.id, target, revision]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, sending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current || loading || loadFailed || !completed || (!local && !modelConfigured))
      return;
    const parsed = chatInputSchema.safeParse({ target, message: draft });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    const controller = new AbortController();
    send.current = controller;
    locked.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await api.sendChat(
        project.id,
        target,
        parsed.data.message,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setMessages(response.messages);
        setDraft('');
        input.current?.focus();
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          `${errorMessage(failure)} Reload the conversation to confirm what was saved before resending.`,
        );
    } finally {
      if (!controller.signal.aborted) {
        locked.current = false;
        setSending(false);
      }
    }
  };
  return (
    <div className="chat-panel view-stack">
      <Notice
        title={
          local
            ? 'Local evidence lookup — no persona speaking'
            : 'Real model assistance, fictional answers'
        }
      >
        {local
          ? 'This endpoint retrieves stored evidence for the chosen context. It does not generate speech, impersonate a proxy or infer real-person thoughts.'
          : 'Answers use bounded stored context and your real configured provider. Agent responses are fictional role-play, not testimony or forecasts. Report responses are generated analysis.'}
      </Notice>
      {!local && !modelConfigured && (
        <Notice tone="warning">
          A provider is not currently configured. Saved conversations remain readable; new model
          replies are unavailable.
        </Notice>
      )}
      <div className="section-heading">
        <span className="eyebrow">
          {target === 'report' ? 'REPORT CONTEXT' : `FICTIONAL PROXY / ${target}`}
        </span>
        <button
          className="icon-button"
          type="button"
          disabled={loading || sending}
          aria-label="Reload saved conversation"
          onClick={() => setRevision((old) => old + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div
        className="conversation"
        role="region"
        ref={list}
        aria-label="Saved conversation messages"
        aria-busy={loading}
      >
        {loading ? (
          <div className="inline-pending">
            <Spinner /> Loading persisted messages…
          </div>
        ) : !messages.length && !loadFailed ? (
          <EmptyPanel title="No messages recorded">
            Ask a question about the{' '}
            {target === 'report' ? 'report' : 'fictional proxy’s recorded context'}. Replies appear
            only after the API responds.
          </EmptyPanel>
        ) : null}
        {messages.map((message) => (
          <article className={`chat-message message-${message.role}`} key={message.id}>
            <div className="section-heading">
              <strong className="eyebrow">
                {message.role === 'user'
                  ? 'YOU'
                  : message.mode === 'local'
                    ? 'LOCAL EVIDENCE LOOKUP'
                    : 'MODEL-GENERATED RESPONSE'}
              </strong>
              <time className="mono muted" dateTime={message.createdAt}>
                {dateTime(message.createdAt)}
              </time>
            </div>
            <p className="preserve-text">{message.content}</p>
            <Citations
              sourceIds={message.sourceIds}
              memoryIds={message.memoryIds}
              onInspect={onInspect}
            />
          </article>
        ))}
        {sending && (
          <div className="inline-pending" role="status">
            <Spinner /> Waiting for the {local ? 'evidence service' : 'configured model'} response…
          </div>
        )}
      </div>
      {error && (
        <Notice tone="error">
          {error}
          {loadFailed && (
            <button
              className="text-button"
              type="button"
              onClick={() => setRevision((old) => old + 1)}
            >
              Retry conversation load
            </button>
          )}
        </Notice>
      )}
      <form className="chat-compose" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`message-${target}`} className="sr-only">
          Question for {target === 'report' ? 'the report' : 'this fictional proxy context'}
        </label>
        <textarea
          id={`message-${target}`}
          ref={input}
          rows={3}
          minLength={3}
          maxLength={1_000}
          required
          value={draft}
          disabled={loading || sending || !completed || (!local && !modelConfigured) || loadFailed}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={local ? 'Find source evidence about…' : 'Ask about the recorded scenario…'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="section-heading">
          <small className="mono muted">{draft.length}/1000 · CTRL/⌘ + ENTER TO SEND</small>
          <button
            className="button button-primary button-small"
            type="submit"
            disabled={
              sending ||
              loading ||
              loadFailed ||
              !completed ||
              draft.trim().length < 3 ||
              (!local && !modelConfigured)
            }
          >
            {sending ? <Spinner label="Sending question" /> : <ArrowUp size={14} />}{' '}
            {local ? 'Look up evidence' : 'Ask model'}
          </button>
        </div>
      </form>
    </div>
  );
}
