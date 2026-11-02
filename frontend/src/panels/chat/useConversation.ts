import { useCallback, useEffect, useRef, useState } from 'react';
import { chatInputSchema } from '../../../../shared/types';
import type { ChatMessage } from '../../../../shared/types';
import { ApiError, api, errorMessage } from '../../api';

export type ConversationError =
  { kind: 'load'; text: string } | { kind: 'send'; text: string } | { kind: 'limit'; text: string };

export interface ConversationState {
  messages: ChatMessage[];
  /** The saved messages are being read. */
  loading: boolean;
  /** The question that was sent and has not been answered yet: it is shown at once, as the person's own words. */
  pending: string | null;
  error: ConversationError | null;
  /** Replies that arrived while the person was watching, which may arrive with a little ceremony. */
  arrived: ReadonlySet<string>;
  /** Sends a question. Resolves true when the server answered; false when it did not, so that the caller can give the words back. */
  send: (message: string) => Promise<boolean>;
  reload: () => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * One conversation with the analyst (`report`) or with an actor: the saved messages, and a question sent
 * at most one at a time. Nothing is shown as saved that the server has not said it saved; a question that
 * could not be confirmed is reported with a way to read what was kept before it is sent again.
 */
export function useConversation(
  projectId: string,
  target: string,
  enabled: boolean,
): ConversationState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ConversationError | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(NONE);
  const [revision, setRevision] = useState(0);
  const sending = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const known = useRef<ReadonlySet<string>>(NONE);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError((current) => (current?.kind === 'load' ? null : current));
    void api.chat(projectId, target, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        known.current = new Set(response.messages.map((message) => message.id));
        setMessages(response.messages);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError({ kind: 'load', text: errorMessage(failure) });
        setLoading(false);
      },
    );
    return () => {
      controller.abort();
      sending.current?.abort();
    };
  }, [projectId, target, enabled, revision]);

  const send = useCallback(
    async (message: string): Promise<boolean> => {
      if (locked.current || !enabled) return false;
      const parsed = chatInputSchema.safeParse({ target, message });
      if (!parsed.success) {
        setError({
          kind: 'send',
          text: parsed.error.issues.map((issue) => issue.message).join(' '),
        });
        return false;
      }
      const controller = new AbortController();
      sending.current = controller;
      locked.current = true;
      setPending(parsed.data.message);
      setError(null);
      try {
        const response = await api.sendChat(
          projectId,
          target,
          parsed.data.message,
          controller.signal,
        );
        if (controller.signal.aborted) return false;
        const fresh = response.messages.filter(
          (item) => item.role === 'assistant' && !known.current.has(item.id),
        );
        known.current = new Set(response.messages.map((item) => item.id));
        setArrived(new Set(fresh.map((item) => item.id)));
        setMessages(response.messages);
        return true;
      } catch (failure) {
        if (controller.signal.aborted) return false;
        const limit = failure instanceof ApiError && failure.code === 'CONVERSATION_LIMIT';
        setError(
          limit
            ? { kind: 'limit', text: errorMessage(failure) }
            : {
                kind: 'send',
                text: `${errorMessage(failure)} Check what was saved before asking again.`,
              },
        );
        return false;
      } finally {
        if (!controller.signal.aborted) {
          locked.current = false;
          setPending(null);
        }
      }
    },
    [enabled, projectId, target],
  );

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { messages, loading, pending, error, arrived, send, reload };
}
