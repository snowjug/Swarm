/**
 * A protocol-faithful FAKE of the Ollama /api/chat endpoint, used only by the end-to-end suite.
 *
 * It lets the real ModelClient, orchestrator, persistence and UI run the model-assisted workflow
 * over real HTTP without any credential. Its answers are derived from each request (never canned
 * results presented as AI output). This is NOT evidence about any live model's reasoning quality.
 *
 * Control surface (test-only, loopback):
 *   POST /__control {latencyMs?, failOnRound?: number|null, hostileCitation?: boolean}
 *   GET  /__stats   -> {calls, byKind, rounds}
 *   POST /__reset
 */
import { createServer, type IncomingMessage } from 'node:http';

type Kind =
  | 'ontology'
  | 'graph'
  | 'personas'
  | 'environment'
  | 'decisions'
  | 'plan'
  | 'interview'
  | 'summary'
  | 'chapter'
  | 'followup';

const signatures: [Kind, RegExp][] = [
  ['ontology', /Define a small ontology/u],
  ['graph', /Extract a source-grounded graph/u],
  ['personas', /Construct exactly (\d+) diverse FICTIONAL/u],
  ['environment', /Prepare initial scenario inputs/u],
  ['decisions', /Simulate one simultaneous round/u],
  ['plan', /Plan a conditional scenario report/u],
  ['interview', /Answer as an EXPLICITLY FICTIONAL proxy/u],
  ['summary', /Write a concise conditional simulation executive summary/u],
  ['chapter', /Write the requested report chapter/u],
  ['followup', /Answer the follow-up about recorded simulation results/u],
];

interface Controls {
  latencyMs: number;
  failOnRound: number | null;
  hostileCitation: boolean;
}
const defaults: Controls = { latencyMs: 400, failOnRound: null, hostileCitation: false };
let controls: Controls = { ...defaults };
let calls = 0;
const byKind: Record<string, number> = {};
const rounds = new Set<number>();

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
          },
          {
            id: 'n2',
            label: 'Residents',
            kind: 'group',
            entityType: second,
            summary: 'Residents who use the library, as described in the sources.',
            weight: 0.7,
            sourceIds: [source],
          },
          {
            id: 'n3',
            label: 'Local council',
            kind: 'organization',
            entityType: first,
            summary: 'The council that funds opening hours, as described.',
            weight: 0.5,
            sourceIds: [source],
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
    case 'decisions': {
      const agents = asArray(data.agents);
      const mean =
        agents.reduce((sum, agent) => sum + Number(agent.opinion ?? 0), 0) /
        Math.max(1, agents.length);
      const event = data.intervention as Json | null;
      const platform = asText((data.scenarioContext as Json | undefined)?.platform, 'plaza');
      return {
        decisions: agents.map((agent, index) => {
          const id = asText(agent.id, `agent-${index + 1}`);
          const current = Number(agent.opinion ?? 0);
          const pull = Number(agent.openness ?? 0.4) * (mean - current);
          const shock = event
            ? Number(event.strength ?? 0) * (Number(event.stance ?? 0) - current) * 0.6
            : 0;
          const tilt = platform === 'plaza' ? 0.02 : -0.02;
          return {
            agentId: id,
            opinion: Number(clamp(current + pull + shock + tilt).toFixed(3)),
            type: 'post',
            content: `Simulated statement from a fictional proxy about the library hours (round ${String(data.round)}).`,
            peerIds: [asText(agents[(index + 1) % agents.length]?.id, 'agent-1')].filter(
              (peer) => peer !== id,
            ),
            sourceIds: [source],
          };
        }),
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
      const cited = firstId(data, /^S[1-9]\d*$/u);
      return {
        body: 'Recorded platform positions differ under their assumed interaction structures. Review the cited source text and compare controlled scenarios before drawing conclusions.',
        sourceIds: cited ? [cited] : [],
        memoryIds: [],
        interviewIds: [],
      };
    }
    case 'followup': {
      const memories = asArray(data.memories);
      return {
        answer:
          'Based on the supplied recorded scenario only: the report states its assumptions and limitations; this reply does not describe any real person.',
        sourceIds: evidence.length ? [asText(evidence[0]?.id, 'S1')] : [],
        memoryIds: memories.length ? [asText(memories[0]?.id, '')].filter(Boolean) : [],
      };
    }
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
        return send(200, { calls, byKind, rounds: [...rounds].sort((a, b) => a - b) });
      if (url.pathname === '/__reset') {
        controls = { ...defaults };
        calls = 0;
        for (const key of Object.keys(byKind)) delete byKind[key];
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
      if (kind === 'decisions') rounds.add(Number(data.round));
      await sleep(controls.latencyMs);
      if (kind === 'decisions' && controls.failOnRound === Number(data.round))
        return send(500, { error: 'injected provider failure' });
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
