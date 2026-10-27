import { vi } from 'vitest';
import { ACTOR_MARKER, type ActorContext } from '../../src/agents/actor.js';

export function isActorCall(instructions: string): boolean {
  return instructions.includes(ACTOR_MARKER);
}

export function isEntailmentCall(instructions: string): boolean {
  return instructions.includes('ENTAILMENT CHECK');
}

interface EntailmentRequest {
  passages: Array<{ id: string; text: string }>;
  items: Array<{ claimId: string; claim: string; passageIds: string[] }>;
}

/**
 * A stand-in for the independent checker: it judges every claim "supports" and quotes the start of
 * its first cited passage verbatim, as the real protocol requires. It exists to test plumbing and
 * validation; it is not evidence about the behavior of any real model.
 */
export function entailmentBrain(
  data: unknown,
  label: 'supports' | 'partial' | 'contradicts' | 'not_supported' = 'supports',
): Record<string, unknown> {
  const request = data as EntailmentRequest;
  const text = new Map(request.passages.map((passage) => [passage.id, passage.text]));
  return {
    judgements: request.items.map((item) => ({
      claimId: item.claimId,
      label,
      evidenceQuote:
        label === 'not_supported' ? null : (text.get(item.passageIds[0] ?? '') ?? '').slice(0, 70),
    })),
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * A deterministic stand-in for a model that is driven ONLY by the actor's own context, so calls can
 * run in parallel and in any order. It exists to test plumbing, validation and isolation; it is not
 * evidence about the behavior of any real model.
 */
export function actorBrain(context: ActorContext): Record<string, unknown> {
  const heard = context.observations.filter((item) => item.peerId !== null);
  const first = heard[0];
  const push = context.event ? Math.sign(context.event.stance) * context.event.strength : 0;
  const drift = (heard.length ? 0.08 : 0.03) * (context.self.openness + 0.5);
  const direction = push !== 0 ? Math.sign(push) : context.self.opinion > 0 ? -1 : 1;
  return {
    opinion: clamp(context.self.opinion + direction * drift + push * 0.1),
    type: first ? 'reply' : 'post',
    content: first
      ? `${context.self.name} on ${context.platform.label}, round ${context.round}: replying to ${first.author}.`
      : `${context.self.name} on ${context.platform.label}, round ${context.round}: sharing a view.`,
    peerIds: first?.peerId ? [first.peerId] : [],
    sourceIds: context.knowledge[0] ? [context.knowledge[0].id] : [],
    rationale: 'Fixture rationale derived only from this actor’s own context.',
    confidence: 0.6,
  };
}

interface ChatBody {
  messages?: Array<{ role: string; content: string }>;
}

/** For HTTP-level fakes: the actor context carried by a request, or null when it is not an actor call. */
export function actorContextFromRequest(init: RequestInit | undefined): ActorContext | null {
  let body: ChatBody;
  try {
    body = JSON.parse(String(init?.body)) as ChatBody;
  } catch {
    return null;
  }
  const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
  if (!isActorCall(system)) return null;
  const user = body.messages?.find((message) => message.role === 'user')?.content ?? '{}';
  return (JSON.parse(user) as { untrustedScenarioData: ActorContext }).untrustedScenarioData;
}

export function chatCompletion(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
}

/**
 * An OpenAI-compatible HTTP fake. Setup and report calls are answered from `script` in order (they
 * are sequential); per-actor calls and the grounding check are answered from the request itself,
 * because actor calls run in parallel and have no stable order.
 */
export function scriptedFetcher(script: unknown[]) {
  let cursor = 0;
  const seen = { actor: 0, entailment: 0, scripted: 0 };
  const contexts: ActorContext[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const context = actorContextFromRequest(init);
    if (context) {
      seen.actor += 1;
      contexts.push(context);
      return chatCompletion(actorBrain(context));
    }
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
    if (isEntailmentCall(system)) {
      seen.entailment += 1;
      const user = body.messages?.find((message) => message.role === 'user')?.content ?? '{}';
      const data = (JSON.parse(user) as { untrustedScenarioData: unknown }).untrustedScenarioData;
      return chatCompletion(entailmentBrain(data));
    }
    seen.scripted += 1;
    return chatCompletion(script[cursor++]);
  });
  return { fetcher, seen, contexts };
}
