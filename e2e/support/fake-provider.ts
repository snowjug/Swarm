/**
 * A protocol-faithful FAKE of the Ollama /api/chat endpoint, used only by the end-to-end suite.
 *
 * It lets the real ModelClient, orchestrator, persistence and UI run the model-assisted workflow
 * over real HTTP without any credential. Its answers are derived from each request (never canned
 * results presented as AI output). This is NOT evidence about any live model's reasoning quality.
 *
 * Control surface (test-only, loopback):
 *   POST /__control {latencyMs?, failOnRound?: number|null, failKind?: string|null, hostileCitation?: boolean}
 *   GET  /__stats   -> {calls, byKind, rounds, actors}
 *   POST /__reset
 *
 * `actors` counts requests per "platform:round:agentId", which is the evidence that the simulation
 * really makes one model call per proxy per platform per round.
 */
import { createServer, type IncomingMessage } from 'node:http';

type Kind =
  | 'ontology'
  | 'graph'
  | 'personas'
  | 'environment'
  | 'actor'
  | 'plan'
  | 'interview'
  | 'summary'
  | 'chapter'
  | 'entailment'
  | 'followup'
  | 'ping';

const signatures: [Kind, RegExp][] = [
  ['ontology', /Define a small ontology/u],
  ['graph', /Extract a source-grounded graph/u],
  ['personas', /Construct exactly (\d+) diverse FICTIONAL/u],
  ['environment', /Prepare initial scenario inputs/u],
  ['actor', /ACTOR DECISION/u],
  ['plan', /Plan a conditional scenario report/u],
  ['interview', /Answer as an EXPLICITLY FICTIONAL proxy/u],
  ['summary', /Write a concise conditional simulation executive summary/u],
  ['chapter', /Write the requested report chapter/u],
  ['entailment', /ENTAILMENT CHECK/u],
  ['followup', /Answer the follow-up about recorded simulation results/u],
  ['ping', /Connectivity check/u],
];

interface Controls {
  latencyMs: number;
  failOnRound: number | null;
  /** Every request of this kind (for example `chapter`) is answered with a server error. */
  failKind: Kind | null;
  hostileCitation: boolean;
}
const defaults: Controls = {
  latencyMs: 400,
  failOnRound: null,
  failKind: null,
  hostileCitation: false,
};
let controls: Controls = { ...defaults };
let calls = 0;
const byKind: Record<string, number> = {};
const rounds = new Set<number>();
const actors: Record<string, number> = {};

type Json = Record<string, unknown>;
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback;
const clamp = (value: number): number => Math.min(1, Math.max(-1, value));

function firstId(value: unknown, pattern: RegExp): string | null {
  if (typeof value === 'string') return pattern.test(value) ? value : null;
  const children = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  for (const child of children) {
    const found = firstId(child, pattern);
    if (found) return found;
  }
  return null;
}

function answer(kind: Kind, instructions: string, data: Json): unknown {
  const evidence = asArray(data.evidence);
  const source = asText(evidence[0]?.id, firstId(data, /^S[1-9]\d*$/u) ?? 'S1');
  switch (kind) {
    case 'ontology':
      return {
        entityTypes: [
          {
            name: 'Organization',
            description: 'An organization described in the supplied sources.',
          },
          {
            name: 'Community',
            description: 'A stakeholder group described in the supplied sources.',
          },
        ],
        relationshipTypes: [
          { name: 'informs', description: 'A source-grounded information relationship.' },
        ],
      };
    case 'graph': {
      const ontology = (data.ontology ?? {}) as Json;
      const entity = asArray(ontology.entityTypes);
      const relation = asArray(ontology.relationshipTypes);
      const first = asText(entity[0]?.name, 'Organization');
      const second = asText(entity[1]?.name, first);
      const label = asText(relation[0]?.name, 'informs');
      // A real quote, copied from the passage the request supplied, as the protocol requires.
      const passage = asText(evidence[0]?.text, '').trim();
      const quote = (offset: number) => passage.slice(offset, offset + 70).trim();
      return {
        nodes: [
          {
            id: 'n1',
            label: 'Library service',
            kind: 'organization',
            entityType: first,
            summary: 'The library service described in the supplied scenario text.',
            weight: 1,
            sourceIds: [controls.hostileCitation ? 'S999' : source],
            quote: quote(0),
          },
          {
            id: 'n2',
            label: 'Residents',
            kind: 'group',
            entityType: second,
            summary: 'Residents who use the library, as described in the sources.',
            weight: 0.7,
            sourceIds: [source],
            quote: quote(0),
          },
          {
            id: 'n3',
            label: 'Local council',
            kind: 'organization',
            entityType: first,
            summary: 'The council that funds opening hours, as described.',
            weight: 0.5,
            sourceIds: [source],
            quote: quote(0),
          },
        ],
        edges: [
          { source: 'n1', target: 'n2', label, weight: 0.8, sourceIds: [source] },
          { source: 'n3', target: 'n1', label, weight: 0.6, sourceIds: [source] },
        ],
      };
    }
    case 'personas': {
      const count = Number(/Construct exactly (\d+)/u.exec(instructions)?.[1] ?? 6);
      const nodes = asArray((data.graph as Json | undefined)?.nodes);
      return {
        agents: Array.from({ length: count }, (_, index) => ({
          id: `agent-${index + 1}`,
          name: `Fictional proxy ${index + 1}`,
          role: index % 2 ? 'Synthetic resident' : 'Synthetic service planner',
          persona:
            'An explicitly fictional stakeholder proxy with assumed interests in the proposed library hours.',
          topicIds: [asText(nodes[index % Math.max(1, nodes.length)]?.id, 'n1')],
          initialOpinion: Number((-0.8 + (1.6 * index) / Math.max(1, count - 1)).toFixed(2)),
          influence: 0.6 + (index % 3) * 0.3,
          openness: 0.3 + (index % 4) * 0.1,
          sourceIds: [source],
        })),
      };
    }
    case 'environment':
      return {
        minutesPerRound: 60,
        initialPosts: [
          {
            text: 'This is an assumed starting point for discussion, not measured public opinion.',
            platform: 'both',
            stance: 0,
            strength: 0,
            sourceIds: [source],
          },
        ],
      };
    case 'actor': {
      const self = (data.self ?? {}) as Json;
      const platform = (data.platform ?? {}) as Json;
      const heard = asArray(data.observations).filter((item) => typeof item.peerId === 'string');
      const known = asArray(data.knowledge);
      const event = data.event as Json | null;
      const current = Number(self.opinion ?? 0);
      const openness = Number(self.openness ?? 0.4);
      const reach = Number(data.maxOpinionShift ?? 0.5) * 0.9;
      const pull = openness * (heard.length ? -0.15 : -0.05) * current;
      const shock = event
        ? Number(event.strength ?? 0) * (Number(event.stance ?? 0) - current) * 0.6
        : 0;
      const tilt = platform.id === 'plaza' ? 0.02 : -0.02;
      const first = heard[0];
      return {
        // Always inside the per-round limit and the proxy's own context, so no repair call occurs.
        opinion: Number(
          clamp(current + Math.max(-reach, Math.min(reach, pull + shock + tilt))).toFixed(3),
        ),
        type: first ? 'reply' : 'post',
        content: `Simulated statement from a fictional proxy about the library hours (round ${String(data.round)}, ${asText(platform.label, 'platform')}).`,
        peerIds: first ? [asText(first.peerId, '')] : [],
        sourceIds: known[0] ? [asText(known[0].id, '')] : [],
        rationale:
          'Reacted to the visible posts and any scheduled event, using only this proxy’s own context.',
        confidence: 0.6,
      };
    }
    case 'plan':
      return {
        title: 'Conditional library-hours scenario',
        sections: ['Evidence and assumptions', 'Recorded trajectories', 'Limitations and controls'],
        evidenceQueries: ['library opening hours'],
        interviewAgentIds: ['agent-1', 'agent-2'],
        interviewQuestion: 'How did this fictional discussion about library hours unfold?',
      };
    case 'interview':
      return {
        answer:
          'As an explicitly fictional proxy I can only describe this recorded scenario, not a real person’s beliefs.',
        sourceIds: [source],
        memoryIds: [],
      };
    case 'summary':
      return {
        summary:
          'This is a conditional comparison of recorded synthetic contexts under stated assumptions. It does not establish calibrated probabilities or real-world beliefs.',
      };
    case 'chapter': {
      const passage = evidence[0];
      const cited = asText(passage?.id, firstId(data, /^S[1-9]\d*$/u) ?? '');
      const sentence = (asText(passage?.text, '').split(/(?<=[.!?])\s+/u)[0] ?? '')
        .trim()
        .slice(0, 220);
      const usable = cited !== '' && sentence.length >= 30;
      const conclusion =
        'Recorded platform positions differ under their assumed interaction structures.';
      return {
        // The first claim is a real sentence of the cited passage, quoted verbatim in the body.
        body: `${usable ? `${sentence} ` : ''}${conclusion} Review the cited source text and compare controlled scenarios before drawing conclusions.`,
        sourceIds: cited ? [cited] : [],
        memoryIds: [],
        interviewIds: [],
        claims: [
          ...(usable
            ? [
                {
                  text: sentence,
                  kind: 'source-fact',
                  sourceIds: [cited],
                  memoryIds: [],
                  quote: sentence,
                },
              ]
            : []),
          {
            text: conclusion,
            kind: 'analytical-conclusion',
            sourceIds: [],
            memoryIds: [],
            quote: null,
          },
        ],
      };
    }
    case 'entailment': {
      const passages = new Map(
        asArray(data.passages).map((entry) => [asText(entry.id, ''), asText(entry.text, '')]),
      );
      return {
        judgements: asArray(data.items).map((item) => {
          const ids = Array.isArray(item.passageIds) ? (item.passageIds as string[]) : [];
          return {
            claimId: asText(item.claimId, ''),
            label: 'supports',
            evidenceQuote: (passages.get(ids[0] ?? '') ?? '').trim().slice(0, 80),
          };
        }),
      };
    }
    case 'followup': {
      const memories = asArray(data.memories);
      // An analyst is shown the report's own statements and may cite them; a persona is not.
      const claims = asArray(((data.ledger ?? {}) as Json).claims);
      return {
        answer:
          'Based on the supplied recorded scenario only: the report states its assumptions and limitations; this reply does not describe any real person.',
        sourceIds: evidence.length ? [asText(evidence[0]?.id, 'S1')] : [],
        memoryIds: memories.length ? [asText(memories[0]?.id, '')].filter(Boolean) : [],
        claimIds: claims.length ? [asText(claims[0]?.id, '')].filter(Boolean) : [],
      };
    }
    case 'ping':
      return { status: 'ok' };
  }
}

function classify(system: string): Kind | null {
  for (const [kind, pattern] of signatures) if (pattern.test(system)) return kind;
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const port = Number(process.env.FAKE_PROVIDER_PORT || 11999);
createServer((request, response) => {
  void (async () => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/__health') return send(200, { ok: true });
      if (url.pathname === '/__stats')
        return send(200, { calls, byKind, rounds: [...rounds].sort((a, b) => a - b), actors });
      if (url.pathname === '/__reset') {
        controls = { ...defaults };
        calls = 0;
        for (const key of Object.keys(byKind)) delete byKind[key];
        for (const key of Object.keys(actors)) delete actors[key];
        rounds.clear();
        return send(200, { ok: true });
      }
      if (url.pathname === '/__control' && request.method === 'POST') {
        controls = { ...controls, ...(JSON.parse(await readBody(request)) as Partial<Controls>) };
        return send(200, controls);
      }
      if (url.pathname !== '/api/chat' || request.method !== 'POST')
        return send(404, { error: 'not found' });

      const body = JSON.parse(await readBody(request)) as {
        messages: { role: string; content: string }[];
      };
      const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
      const user = body.messages.find((message) => message.role === 'user')?.content ?? '{}';
      const data = ((JSON.parse(user) as Json).untrustedScenarioData ?? {}) as Json;
      const kind = classify(system);
      if (!kind) return send(400, { error: 'unrecognised request' });
      calls += 1;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      if (kind === 'actor') {
        rounds.add(Number(data.round));
        const key = `${asText((data.platform as Json | undefined)?.id, '?')}:${String(data.round)}:${asText((data.self as Json | undefined)?.id, '?')}`;
        actors[key] = (actors[key] ?? 0) + 1;
      }
      await sleep(controls.latencyMs);
      if (kind === 'actor' && controls.failOnRound === Number(data.round))
        return send(500, { error: 'injected provider failure' });
      if (controls.failKind === kind) return send(500, { error: 'injected provider failure' });
      const content = JSON.stringify(answer(kind, system, data));
      return send(200, {
        model: 'fake-model',
        message: { role: 'assistant', content },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: Math.ceil((system.length + user.length) / 4),
        eval_count: Math.ceil(content.length / 4),
      });
    } catch {
      return send(500, { error: 'fake provider failure' });
    }
  })();
}).listen(port, '127.0.0.1', () => {
  console.log(`fake provider listening on ${port}`);
});
