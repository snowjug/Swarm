import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Disclosure, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import type { Ontology } from '../../../../shared/guided';
import type { KnowledgeGraph } from '../../../../shared/types';

/** The few lines a reader needs about how the sources were read: short, with the longer notes one step further. */
export function Method({
  graph,
  ontology,
  trigger,
  sampleEvidence,
}: {
  graph: KnowledgeGraph | null;
  ontology: Ontology | null;
  trigger?: ReactNode;
  sampleEvidence?: boolean;
}) {
  const model = graph?.method === 'llm';
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" icon={<Info size={15} aria-hidden="true" />}>
            Method
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        width="26rem"
        align="start"
        className="sw-ground-method"
        aria-label="How this was read"
      >
        <h2 className="sw-ground-method__title">How this was read</h2>
        <ul className="sw-ground-method__list" role="list">
          <li>
            The sources are cut into numbered passages, S1, S2 and on. Everything here points back
            to them.
          </li>
          {graph &&
            (model ? (
              <li>
                A model proposed the entities and links. Each quote was checked word for word
                against its passage. It may be incomplete.
              </li>
            ) : (
              <li>
                Topics are the words the sources lean on most. A line joins two that share a
                passage: co-occurrence, not meaning.
              </li>
            ))}
          {graph && <li>A ring shows which documents cite a topic.</li>}
          {sampleEvidence && (
            <li>Sample evidence is synthetic: illustrative, not real information.</li>
          )}
        </ul>
        {graph && graph.notes.length > 0 && (
          <Disclosure summary="Notes from the engine">
            <ul className="sw-ground-method__notes" role="list">
              {graph.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </Disclosure>
        )}
        {ontology && (
          <Disclosure summary="Types it looked for">
            <dl className="sw-ground-method__types">
              {ontology.entityTypes.map((type) => (
                <div key={`e-${type.name}`}>
                  <dt>{type.name}</dt>
                  <dd>{type.description}</dd>
                </div>
              ))}
              {ontology.relationshipTypes.map((type) => (
                <div key={`r-${type.name}`}>
                  <dt>{type.name}</dt>
                  <dd>{type.description}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        )}
      </PopoverContent>
    </Popover>
  );
}
