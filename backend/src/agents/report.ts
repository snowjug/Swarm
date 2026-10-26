import type { ProjectDetail, SimulationReport } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { retrieve } from '../knowledge/retrieval.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { mean } from './state.js';

export function reportMetrics(project: ProjectDetail): SimulationReport['metrics'] {
  const last = project.rounds.at(-1);
  if (!last || project.rounds.length !== project.settings.rounds) {
    throw new AppError(
      409,
      'INCOMPLETE_SIMULATION',
      'A complete simulation is required before reporting.',
    );
  }
  return {
    initialMean: mean(project.agents.map((agent) => agent.initialOpinion)),
    finalMean: last.meanOpinion,
    finalSupport: last.supportShare,
    finalOpposition: last.oppositionShare,
    polarization: last.polarization,
    totalInteractions: project.rounds.reduce((sum, round) => sum + round.interactions, 0),
  };
}

export function reviewLimitations(project: ProjectDetail): string[] {
  const metrics = reportMetrics(project);
  const limitations = [
    'This is a conditional synthetic scenario, not a calibrated forecast or a probability of a real-world outcome.',
    "Personas are fictional proxies. Their outputs do not reveal any real individual or organization's beliefs.",
    'A single small population and one scenario run do not establish statistical significance or causal effects.',
    'Source passages are unverified input data; citations establish provenance, not truth.',
  ];
  if (project.mode === 'local') {
    limitations.push(
      'The local engine does not semantically reason about the question. Topic frequencies weight assigned personas; explicit peer-influence rules drive their states.',
      'Initial inclinations, openness, confidence bounds and event effects are modeling assumptions, not estimates fitted to observed behavior.',
      'Local topic co-occurrence is not a verified semantic or causal relationship.',
    );
  } else {
    limitations.push(
      'Model outputs may contain unsupported interpretations despite citation checks. Citations are checked for valid IDs, not semantic entailment.',
      'Model behavior may vary across identical runs; the seed controls local setup, not provider-side determinism.',
      'Context is bounded; long sources may only be represented by selected excerpts.',
      'Model interaction counts are selected peer references reported in structured decisions, not verified real-world interactions.',
    );
  }
  if (metrics.polarization > 0.45) {
    limitations.push(
      'The final population has substantial inclination dispersion; the mean alone hides disagreement.',
    );
  }
  if (project.settings.intervention) {
    limitations.push(
      'The scheduled intervention is an assumed scenario input; no counterfactual control run was performed.',
    );
  }
  return limitations;
}

export function buildLocalReport(
  project: ProjectDetail,
  chunks: EvidenceChunk[],
): SimulationReport {
  const metrics = reportMetrics(project);
  const evidence = retrieve(chunks, project.question, 4);
  const support = Math.round(metrics.finalSupport * project.agentCount);
  const opposition = Math.round(metrics.finalOpposition * project.agentCount);
  const intervention = project.settings.intervention;
  const sourceIds = evidence.map((chunk) => chunk.id);
  return {
    generatedBy: 'local',
    title: `${project.name}: scenario findings`,
    executiveSummary:
      `Across ${project.rounds.length} rule-based rounds with ${project.agentCount} fictional proxies, ` +
      `${support} finished at or above the supportive threshold and ${opposition} at or below the opposing threshold. ` +
      `The mean inclination moved from ${metrics.initialMean.toFixed(3)} to ${metrics.finalMean.toFixed(3)}. ` +
      'These are calculated properties of this configured simulation, not AI-generated predictions.',
    sections: [
      {
        title: 'Scenario and evidence',
        body:
          `Question: ${project.question}\n\n` +
          `${project.documents.length} source document(s) produced ${chunks.length} overlapping, citable passages. ` +
          `The local graph contains ${project.graph?.nodes.length || 0} frequent terms and ` +
          `${project.graph?.edges.length || 0} co-occurrence links. The graph supplies topic interests and influence weights, not real-person identities or causal claims.`,
        sourceIds,
      },
      {
        title: 'Observed trajectory',
        body:
          `Mean inclination: ${metrics.initialMean.toFixed(3)} initially, ${metrics.finalMean.toFixed(3)} finally, on a -1 to +1 scale.\n\n` +
          `Final synthetic cohort: ${support} supportive (>= +0.2), ${opposition} opposing (<= -0.2), ` +
          `${project.agentCount - support - opposition} undecided. Final polarization, defined as population standard deviation, ` +
          `was ${metrics.polarization.toFixed(3)}. The run recorded ${metrics.totalInteractions} peer exposures. ` +
          'Cohort shares are not probabilities about the real world.',
        sourceIds: [],
      },
      {
        title: 'Mechanism and intervention',
        body:
          (project.settings.network === 'community'
            ? 'Community mode uses up to five compatible peers per agent, prioritizing shared source topics and similar inclinations. A confidence bound excludes peers more than 0.95 inclination units away.'
            : 'Broadcast mode exposes each agent to up to four highest-influence peers, regardless of inclination similarity.') +
          ` Updates are simultaneous, weighted by peer influence and individual openness, with small seeded noise (seed ${project.settings.seed}).\n\n` +
          (intervention
            ? `At round ${intervention.round}, "${intervention.label}" introduced assumed stance ${intervention.stance.toFixed(2)} and strength ${intervention.strength.toFixed(2)}. No causal benefit is established without a separate control scenario.`
            : 'No scheduled intervention was applied.'),
        sourceIds: [],
      },
      {
        title: 'Source inspection and next experiments',
        body:
          (evidence.length
            ? 'The source references below are the highest lexical-similarity matches to your question. Inspect the original passages before treating them as supporting evidence.'
            : 'No source passage shared informative terms with the question. Add relevant evidence or rephrase the question; this run does not establish source support for it.') +
          '\n\nCompare different seeds, population sizes, network settings and a no-intervention control. For semantic extraction and generated stakeholder interactions, explicitly configure and select model-assisted mode.',
        sourceIds,
      },
    ],
    limitations: reviewLimitations(project),
    metrics,
  };
}
