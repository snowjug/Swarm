import { useMemo } from 'react';
import { edgesOf, nodesFromActors, type EcoEdge, type EcoNode } from '../../viz/ecosystem/model';
import type { Analysis } from '../../../../shared/analysis';

/** The actors as the map draws them, from the cast the comparison copied: the same ones every round. */
export interface CastMap {
  nodes: EcoNode[];
  edges: EcoEdge[];
}

export function useCastMap(analysis: Analysis): CastMap {
  return useMemo(() => {
    const nodes = nodesFromActors(analysis.actors);
    return { nodes, edges: edgesOf(analysis.relations, new Set(nodes.map((node) => node.id))) };
  }, [analysis.actors, analysis.relations]);
}
