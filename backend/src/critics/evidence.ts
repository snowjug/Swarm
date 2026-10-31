import type { Critique } from '../../../shared/critique.js';
import { byText, draft, names, plural, whole } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** Is each important statement backed by the sources, and are the sources good enough? */
const ROLE = 'evidence' as const;

function uncitedStakeholders(input: Resolved): Critique[] {
  if (!input.stakeholders) return [];
  const considered = input.facts.stakeholders.filter((s) => s.priority !== 'background');
  const uncited = considered.filter((s) => s.evidence.length === 0);
  if (uncited.length === 0) return [];
  const key = uncited.filter((s) => s.priority === 'key').length;
  const keyTotal = considered.filter((s) => s.priority === 'key').length;
  return [
    draft(input.now, {
      id: 'evidence-uncited-stakeholders',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: key > 0 ? 'major' : 'minor',
      objection: `${uncited.length} of ${considered.length} stakeholders cite no source passage, so what they want and how they respond is assumed rather than found in the evidence.`,
      basis: [
        `Stakeholders with no cited passage: ${names(uncited.map((s) => s.name))}.`,
        `Key stakeholders among them: ${key} of ${keyTotal}.`,
        'Background stakeholders are not counted.',
      ],
      impact:
        'If this stands, results that depend on these stakeholders show assumed behaviour, not behaviour found in the sources; read them as hypotheses to check.',
    }),
  ];
}

function dominantSource(input: Resolved): Critique[] {
  const { cited, citedByDocument } = input.facts;
  if (cited.length < 3) return [];
  const [top] = [...citedByDocument.entries()].sort(
    ([a, x], [b, y]) => y.length - x.length || byText(a, b),
  );
  if (!top) return [];
  const [documentId, refs] = top;
  if (refs.length / cited.length <= 0.5) return [];
  const name = refs[0]?.documentName ?? documentId;
  return [
    draft(input.now, {
      id: 'evidence-single-source',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: refs.length / cited.length >= 0.8 ? 'major' : 'minor',
      objection: `${refs.length} of the ${cited.length} cited passages come from one document (${name}), so a gap or error in it carries through most of the stakeholder assessments.`,
      basis: [
        `Cited passages: ${cited.length}, from ${plural(citedByDocument.size, 'document')}.`,
        `Most cited: ${name} (${refs.length} of ${cited.length}).`,
        `Documents supplied to the project: ${input.evidenceSummary.documents.length}.`,
      ],
      evidence: refs.slice(0, 3),
      impact:
        'If this stands, the evidence is only as reliable as that one document; corroborate its main points with a second source before relying on them.',
    }),
  ];
}

function unverifiedUrls(input: Resolved): Critique[] {
  const pages = input.evidenceSummary.documents.filter(
    (document) =>
      document.provenance?.kind === 'url' && document.provenance.fetchedByServer !== true,
  );
  if (pages.length === 0) return [];
  return [
    draft(input.now, {
      id: 'evidence-unverified-web-sources',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `${plural(pages.length, 'document')} came with a web address but ${pages.length === 1 ? 'was' : 'were'} not fetched by this server, so where the text came from has not been verified.`,
      basis: [
        `Not fetched by this server: ${names(pages.map((page) => page.name))}.`,
        'Only a page this server fetched itself counts as retrieved public evidence.',
      ],
      impact:
        'If this stands, treat those documents as text a person supplied, not as retrieved public evidence; their provenance is unverified.',
    }),
  ];
}

function openConflicts(input: Resolved): Critique[] {
  const count = input.evidenceSummary.openConflicts;
  if (count === null || count <= 0) return [];
  const contested = input.facts.cited.filter((ref) => ref.conflictId !== undefined).length;
  return [
    draft(input.now, {
      id: 'evidence-open-conflicts',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: contested > 0 ? 'major' : 'minor',
      objection: `The source ledger holds ${plural(count, 'conflict')} between sources that nobody has resolved or dismissed.`,
      basis: [
        `Open conflicts in the ledger: ${count}.`,
        `Cited stakeholder passages that come from a conflict: ${contested}.`,
      ],
      evidence: input.evidenceSummary.conflictEvidence.slice(0, 5),
      impact:
        'If this stands, statements that rest on the contested passages could be wrong in either direction until each conflict is resolved or dismissed.',
    }),
  ];
}

function undatedSources(input: Resolved): Critique[] {
  const horizon = input.scenario?.horizon?.trim();
  if (!horizon) return [];
  const { documents } = input.evidenceSummary;
  const undated = documents.filter((document) => !document.provenance?.asOf);
  if (undated.length === 0) return [];
  return [
    draft(input.now, {
      id: 'evidence-undated-sources',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `The scenario looks ahead, but ${undated.length} of ${documents.length} documents carry no date for the information they hold, so it is unclear how current they are.`,
      basis: [
        `Scenario horizon: ${horizon}.`,
        `Documents with no provenance date: ${names(undated.map((document) => document.name))}.`,
      ],
      impact:
        'If this stands, some evidence may describe conditions that no longer hold; check the dates before relying on it.',
    }),
  ];
}

export const evidenceCritic: RoleCritic = (input) => [
  ...uncitedStakeholders(input),
  ...dominantSource(input),
  ...unverifiedUrls(input),
  ...openConflicts(input),
  ...undatedSources(input),
];
