import type { GuidedConsoleState, Platform, SimulationMemory } from '../../../shared/guided.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { retrieve } from '../knowledge/retrieval.js';

export function searchMemories(
  memories: SimulationMemory[],
  query: string,
  limit = 8,
  platform?: Platform,
): SimulationMemory[] {
  const candidates = memories.filter((memory) => !platform || memory.platform === platform);
  if (!query.trim()) return candidates.slice(-limit).reverse();
  const exact = candidates.find((memory) => memory.id === query);
  if (exact) return [exact];
  const indexed: EvidenceChunk[] = candidates.map((memory) => ({
    id: memory.id,
    documentId: memory.id,
    documentName: `Simulated ${memory.platform} memory`,
    text: memory.text,
    start: 0,
    end: memory.text.length,
  }));
  const byId = new Map(candidates.map((memory) => [memory.id, memory]));
  return retrieve(indexed, query, limit).map((match) => {
    const memory = byId.get(match.id);
    if (!memory) throw new Error('A retrieved memory is missing from the index.');
    return memory;
  });
}

export function timeline(state: GuidedConsoleState) {
  return state.platforms.map((run) => ({
    platform: run.platform,
    label: run.label,
    status: run.status,
    currentRound: run.currentRound,
    elapsedMinutes: run.elapsedMinutes,
    rounds: run.rounds.map((round) => ({
      round: round.round,
      meanOpinion: round.meanOpinion,
      supportShare: round.supportShare,
      oppositionShare: round.oppositionShare,
      polarization: round.polarization,
      interactions: round.interactions,
      activityCount: round.activityCount,
    })),
  }));
}

export function validateReferences(ids: string[], allowed: Set<string>, kind: string): void {
  if (ids.some((id) => !allowed.has(id))) {
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      `The model cited ${kind} that was not provided in its bounded context.`,
    );
  }
}
