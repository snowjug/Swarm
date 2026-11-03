import type { Attributes } from '@opentelemetry/api';

/**
 * The only attribute names telemetry may carry. Whatever a caller passes, a name that is not here is
 * dropped, so that a prompt, a document, a header or a person's name cannot be added to a span or a
 * metric by accident: the list is the privacy boundary, and it holds identifiers, codes and counts.
 */
export const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'swarm.request.id',
  'swarm.http.method',
  'swarm.http.route',
  'swarm.http.status',
  'swarm.http.status_class',
  'swarm.job.id',
  'swarm.job.kind',
  'swarm.job.state',
  'swarm.job.attempt',
  'swarm.job.max_attempts',
  'swarm.job.outcome',
  'swarm.job.event',
  'swarm.project.id',
  'swarm.project.branch',
  'swarm.role',
  'swarm.error.code',
  'swarm.model.provider',
  'swarm.model.name',
  'swarm.model.outcome',
  'swarm.model.repair',
  'swarm.model.direction',
  'swarm.model.role',
  'swarm.model.task',
  'swarm.model.source',
  'swarm.model.safety',
  'swarm.model.reason',
  'swarm.model.structured',
  // Derived from a prompt or a reply, so only set when TELEMETRY_TRACE_CONTENT=redacted: a size and a hash, never text.
  'swarm.model.input_chars',
  'swarm.model.output_chars',
  'swarm.model.input_hash',
  'swarm.auth.reason',
  'swarm.audit.action',
  'swarm.grounding.class',
  // Product telemetry (`product-signals.ts`): enumerations and short labels only, never an address,
  // a host name, a question, a passage or a person.
  'swarm.research.mode',
  'swarm.research.outcome',
  'swarm.research.stop_reason',
  'swarm.fetch.error_class',
  'swarm.safety.reason',
  'swarm.quarantine.reason',
  'swarm.source.category',
  'swarm.proposal.origin',
  'swarm.issue.code',
  'swarm.gate.status',
  'swarm.sim.outcome',
  'swarm.report.outcome',
  'swarm.cancel.scope',
  'swarm.deployment.mode',
  'swarm.build.version',
  'swarm.build.sha',
]);

const MAX_VALUE = 120;
const REDACTED = '[redacted]';

/** What a credential or a person looks like in text, replaced wherever it turns up in an allowed value. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/gu,
  /\b(?:Bearer|Basic)\s+\S+/giu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/giu,
  /\b(?:InstrumentationKey|AccountKey|SharedAccessKey|Password|Pwd)=[^;\s]+/giu,
  /\b(?:password|passwd|secret|token|api[_-]?key|authorization|signature|cookie)\s*[=:]\s*\S+/giu,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/gu,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu,
  // A long run of letters, digits and underscores is a key or a hash, never a label. A UUID has hyphens
  // and its parts are short, so identifiers survive.
  /\b[A-Za-z0-9_]{32,}\b/gu,
];

export function redact(value: string): string {
  let clean = value;
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, REDACTED);
  return clean.length > MAX_VALUE ? `${clean.slice(0, MAX_VALUE)}…` : clean;
}

/**
 * The attributes of a span or a measurement: allowed names only, and scalar values only. Strings are
 * redacted and shortened; an object, an array or a non-finite number is dropped.
 */
export function safeAttributes(input: Readonly<Record<string, unknown>>): Attributes {
  const clean: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    if (typeof value === 'string') clean[key] = redact(value);
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
  }
  return clean;
}
