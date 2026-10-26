import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUp, BookOpen, MessageSquare, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import type { ChatMessage, ProjectDetail } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { dateTime } from '../lib/format';
import { EmptyPanel, Notice, SourceLinks, Spinner } from './ui';

export function InterviewView({
  project,
  target,
  onTarget,
  onSource,
}: {
  project: ProjectDetail;
  target: string;
  onTarget: (target: string) => void;
  onSource: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const sendController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendLock = useRef(false);
  const local = project.mode === 'local';
  const completed = project.status === 'completed';

  useEffect(() => {
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    sendController.current?.abort();
    sendLock.current = false;
    setSending(false);
    setMessages([]);
    setDraft('');
    setError(null);
    if (!completed) {
      setLoading(false);
      return () => {
        generation.current += 1;
        controller.abort();
      };
    }
    setLoading(true);
    void api.chat(project.id, target, controller.signal).then(
      (response) => {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        setMessages(response.messages);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => {
      generation.current += 1;
      controller.abort();
      sendController.current?.abort();
    };
  }, [project.id, target, completed, revision]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendLock.current || loading || !completed) return;
    const message = draft.trim();
    if (message.length < 3 || message.length > 1_000) {
      setError('Use a question of 3–1,000 characters.');
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const controller = new AbortController();
    sendController.current = controller;
    const currentGeneration = generation.current;
    sendLock.current = true;
    setSending(true);
    setError(null);
    try {
      const response = await api.sendChat(project.id, target, message, controller.signal);
      if (controller.signal.aborted || currentGeneration !== generation.current) return;
      setMessages(response.messages);
      setDraft('');
      inputRef.current?.focus();
    } catch (failure) {
      if (!controller.signal.aborted && currentGeneration === generation.current)
        setError(errorMessage(failure));
    } finally {
      if (currentGeneration === generation.current) {
        sendLock.current = false;
        setSending(false);
      }
    }
  };

  if (!completed) {
    return (
      <EmptyPanel
        title={
          local
            ? 'Evidence inspection opens after completion'
            : 'AI interviews open after completion'
        }
        icon={<MessageSquare size={27} aria-hidden="true" />}
      >
        Finish the experiment first. You can already explore any available source documents and
        partial outputs in the other views.
      </EmptyPanel>
    );
  }
  const targetName =
    target === 'report'
      ? 'Scenario report'
      : (project.agents.find((agent) => agent.id === target)?.name ?? target);
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {local ? 'LOOK CLOSER, WITHOUT AI' : 'ASK THE SIMULATED WORLD'}
          </span>
          <h2>{local ? 'Evidence, not an AI interview.' : 'A conversation with the scenario.'}</h2>
        </div>
        <span className={`method-tag ${local ? '' : 'method-tag-violet'}`}>
          {local ? (
            <BookOpen size={13} aria-hidden="true" />
          ) : (
            <Sparkles size={13} aria-hidden="true" />
          )}
          {local ? 'LOCAL EVIDENCE LOOKUP' : 'MODEL-ASSISTED INTERVIEW'}
        </span>
      </div>
      <Notice
        title={local ? 'Rules-based evidence inspection' : 'AI-generated, fictional perspectives'}
      >
        {local
          ? 'Questions retrieve and inspect stored evidence. Responses are not generated by a language model and do not represent a persona thinking or speaking.'
          : 'Questions are sent with bounded source and persona context to the selected model provider. Answers are generated role-play or report analysis, not real-person thoughts, verified facts, or predictions.'}
      </Notice>
      <section
        className="card interview-card"
        aria-label={local ? 'Local evidence inspector' : 'Model-assisted scenario interview'}
      >
        <div className="interview-toolbar">
          <div className="field">
            <label htmlFor="chat-target">
              {local ? 'Inspect context for' : 'Choose a conversation'}
            </label>
            <select
              id="chat-target"
              value={target}
              onChange={(event) => onTarget(event.target.value)}
            >
              <option value="report">Scenario report</option>
              {project.agents.map((agent) => (
                <option value={agent.id} key={agent.id}>
                  {agent.name} — fictional persona
                </option>
              ))}
            </select>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading || sending}
            aria-label="Reload conversation"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
        <div
          className="conversation"
          ref={listRef}
          aria-label={`Conversation about ${targetName}`}
          aria-busy={loading}
        >
          {loading ? (
            <div className="loading-panel">
              <Spinner label="Loading conversation" />
              <span>Opening this conversation…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              <div className="empty-icon">
                {local ? <FileIcon /> : <MessageSquare size={24} aria-hidden="true" />}
              </div>
              <h3>
                {local ? 'Start with a source question.' : 'What would you like to understand?'}
              </h3>
              <p>
                {local
                  ? 'Look up a theme from your material or inspect evidence supporting the report.'
                  : 'Ask about a fictional perspective, the report’s reasoning, or the scenario’s assumptions.'}
              </p>
              <button
                className="suggestion-button"
                type="button"
                onClick={() => {
                  setDraft(
                    local
                      ? 'Which source excerpts support this scenario?'
                      : 'Which assumptions most shaped this scenario?',
                  );
                  inputRef.current?.focus();
                }}
              >
                {local ? 'Find supporting source excerpts' : 'Explore the underlying assumptions'}{' '}
                <ArrowUp size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="chat-message-list">
              {messages.map((message) => (
                <article className={`chat-message chat-${message.role}`} key={message.id}>
                  <span className="chat-avatar" aria-hidden="true">
                    {message.role === 'user' ? (
                      <UserRound size={16} />
                    ) : local ? (
                      <BookOpen size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                  </span>
                  <div>
                    <div className="chat-message-heading">
                      <strong>
                        {message.role === 'user'
                          ? 'You'
                          : message.mode === 'local'
                            ? 'Evidence inspector · not AI'
                            : target === 'report'
                              ? 'Report analyst · AI'
                              : 'Fictional persona · AI'}
                      </strong>
                      <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>
                    </div>
                    <p className="plain-text">{message.content}</p>
                    <SourceLinks ids={message.sourceIds} onOpen={onSource} />
                  </div>
                </article>
              ))}
            </div>
          )}
          {sending && (
            <div className="chat-pending" role="status">
              <Spinner label={local ? 'Looking up evidence' : 'Waiting for model response'} />
              <span>
                {local ? 'Looking through stored evidence…' : 'Waiting for the configured model…'}
              </span>
            </div>
          )}
        </div>
        {error && (
          <div className="chat-error">
            <Notice
              tone="error"
              title="Conversation request failed"
              action={
                <button
                  className="text-button"
                  type="button"
                  disabled={sending || loading}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Reload
                </button>
              }
            >
              {error} Your question is kept if a send fails; retry it below. Reloading retrieves the
              saved conversation.
            </Notice>
          </div>
        )}
        <form className="chat-composer" onSubmit={(event) => void send(event)}>
          <label htmlFor="chat-message" className="sr-only">
            {local ? 'Ask an evidence lookup question' : 'Ask the model a scenario question'}
          </label>
          <textarea
            id="chat-message"
            ref={inputRef}
            rows={2}
            placeholder={
              local ? 'Ask about your source material…' : 'Ask about this simulated scenario…'
            }
            minLength={3}
            maxLength={1_000}
            value={draft}
            disabled={loading || sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            aria-describedby="chat-message-help"
          />
          <div className="chat-composer-bottom">
            <span id="chat-message-help">{draft.length} / 1,000 · Ctrl / ⌘ + Enter to send</span>
            <button
              className="button button-primary button-small"
              type="submit"
              disabled={loading || sending || draft.trim().length < 3}
            >
              {sending ? (
                <Spinner label="Sending question" />
              ) : (
                <ArrowUp size={16} aria-hidden="true" />
              )}{' '}
              {local ? 'Look up evidence' : 'Send to model'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FileIcon() {
  return <BookOpen size={25} aria-hidden="true" />;
}
