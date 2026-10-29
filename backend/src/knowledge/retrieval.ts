import type { EvidenceChunk, EvidenceMatch, SourceDocument } from '../../../shared/types.js';

const stopWords = new Set(
  (
    'about after again against also among and any are around because been before being between both ' +
    'but can could did does doing down during each even every few for from further had has have having ' +
    'her here hers herself him himself his how however into its itself just many may might more most ' +
    'much must nor not now off once only other our ours ourselves out over own same shall she should ' +
    'some such than that the their theirs them themselves then there these they this those through ' +
    'too under until upon use used using very was were what when where which while who whom why will ' +
    'with would you your yours yourself yourselves document notes said says one two new also'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]+/gu) || []
  ).filter(
    (word) => word.length >= 3 && word.length <= 40 && !stopWords.has(word) && !/^\d+$/u.test(word),
  );
}

export function frequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

/** Identifies how passages were cut, so a later change to the chunker is visible in the evidence. */
export const PARSER_VERSION = 'chunker-1';

export function chunkDocuments(documents: SourceDocument[]): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  for (const document of documents) {
    let start = 0;
    while (start < document.content.length) {
      let end = Math.min(start + 1_200, document.content.length);
      if (end < document.content.length) {
        const boundary = document.content.lastIndexOf(' ', end);
        if (boundary > start + 600) end = boundary;
      }
      const text = document.content.slice(start, end);
      chunks.push({
        id: `S${chunks.length + 1}`,
        documentId: document.id,
        documentName: document.name,
        text,
        start,
        end,
      });
      if (end === document.content.length) break;
      start = end - 120;
    }
  }
  return chunks;
}

export function retrieve(chunks: EvidenceChunk[], query: string, limit = 5): EvidenceMatch[] {
  const corpus = chunks.map((chunk) => frequencies(chunk.text));
  const documentFrequency = new Map<string, number>();
  for (const counts of corpus) {
    for (const term of counts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }
  const vector = (counts: Map<string, number>): Map<string, number> =>
    new Map(
      [...counts].map(([term, count]) => [
        term,
        (1 + Math.log(count)) *
          (1 + Math.log((chunks.length + 1) / ((documentFrequency.get(term) || 0) + 1))),
      ]),
    );
  const norm = (values: Map<string, number>): number =>
    Math.sqrt([...values.values()].reduce((sum, value) => sum + value * value, 0));
  const queryVector = vector(frequencies(query));
  const queryNorm = norm(queryVector);
  if (!queryNorm) return [];
  return chunks
    .map((chunk, index) => {
      const counts = corpus[index];
      if (!counts) throw new Error('The retrieval corpus is inconsistent.');
      const chunkVector = vector(counts);
      const product = [...queryVector].reduce(
        (sum, [term, weight]) => sum + weight * (chunkVector.get(term) || 0),
        0,
      );
      return {
        ...chunk,
        score: product / (queryNorm * norm(chunkVector) || 1),
      };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function selectContext(
  chunks: EvidenceChunk[],
  query: string,
  budget = 14_000,
): EvidenceChunk[] {
  const candidates: EvidenceChunk[] = retrieve(chunks, query, 6);
  const documentIds = new Set(chunks.map((chunk) => chunk.documentId));
  for (const documentId of documentIds) {
    const documentChunks = chunks.filter((chunk) => chunk.documentId === documentId);
    for (const index of [0, Math.floor(documentChunks.length / 2), documentChunks.length - 1]) {
      const chunk = documentChunks[index];
      if (chunk) candidates.push(chunk);
    }
  }
  const selected: EvidenceChunk[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const chunk of candidates) {
    if (seen.has(chunk.id) || used + chunk.text.length > budget) continue;
    selected.push(chunk);
    seen.add(chunk.id);
    used += chunk.text.length;
  }
  return selected;
}
