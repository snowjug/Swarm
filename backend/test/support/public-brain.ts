/**
 * The one thing the public edition's tests ask of a model that does not need a fixture: reading a what-if question into a
 * scenario frame. The answer is made from the question, and says nothing that the question did not. It is a stand-in for
 * a model, held to the real schema by the product's own checks, and says nothing about any real model.
 */

interface Message {
  role: string;
  content: string;
}

/** The question the person asked, as the client wrapped it for the model (`untrustedScenarioData`). */
export function questionIn(body: unknown): string {
  const messages = (body as { messages?: Message[] } | null)?.messages ?? [];
  const user = messages.find((message) => message.role === 'user')?.content ?? '{}';
  try {
    const data = (JSON.parse(user) as { untrustedScenarioData?: { question?: unknown } })
      .untrustedScenarioData;
    return String(data?.question ?? '');
  } catch {
    return '';
  }
}

/** What a model that reads the question as asked would answer: a frame with nothing in it that the question did not say. */
export function frameOf(question: string): string {
  const asked = (question.split('?')[0] ?? question).trim();
  const bare = asked.replace(/^what (?:could|would|might|will) happen if /iu, '');
  return JSON.stringify({
    decision: `Whether ${bare}`,
    system: '',
    geography: null,
    horizon: null,
    changes: [],
    baseline: 'The current situation continues without the change.',
    alternatives: [],
    requestedDecision: null,
    desiredOutput: null,
    evidenceMissing: ['What a change like this did in earlier years.'],
    assumptions: [
      {
        id: 'read-as-asked',
        text: 'Assumed the question is about the change it names and nothing else.',
        origin: 'system',
      },
    ],
    likelyStakeholders: ['Residents', 'The organisation that decides'],
    ambiguities: [],
  });
}
