import { ClipboardPaste, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../../../app/context';
import { Button, IconButton, useToast } from '../../../design/ui';
import { EvidenceMenu } from '../../ask/EvidenceMenu';
import { keyOf, sizeText, type DocumentInput } from '../../ask/evidence';
import { useEvidence } from '../../ask/useEvidence';
import { useGroundResearch } from './context';

/**
 * Sources of a person's own, for a project that research found none for: pasted text and attached files, read here or by
 * the server as they are in the first screen, and added to the project. Nothing is fetched, and research does not read
 * them: the server adds them and goes on to read the evidence. Where the project can take no more (it is being read, or
 * it was), the way on is the question again, with room for them.
 */
export function Manual() {
  const research = useGroundResearch();
  const { config, busy, duplicate } = useWorkspace();
  const toast = useToast();
  const [documents, setDocuments] = useState<DocumentInput[]>([]);
  const allowed = research?.controls.add === true;
  const working = research?.state.working === 'add-documents';
  const evidence = useEvidence({
    config,
    documents,
    onChange: setDocuments,
    disabled: busy || (research?.state.working ?? null) !== null,
  });
  if (!research) return null;
  const { state } = research;
  const refused = state.problem?.kind === 'add-documents' ? state.problem.message : null;

  const add = async () => {
    if (documents.length === 0 || state.working) return;
    const ok = await state.addDocuments(documents);
    if (!ok) return;
    toast({
      title: 'Sources added',
      description: 'Swarm is reading them.',
      tone: 'success',
      duration: 3600,
    });
    setDocuments([]);
  };

  return (
    <div className="sw-research-manual">
      <h3 className="sw-research-sub" id="ground-research-own">
        Use sources of your own
      </h3>
      {allowed ? (
        <>
          <p className="sw-research-quiet sw-caption">
            Paste text or attach files. Swarm reads them as the sources of this question, and
            nothing is fetched from the web.
          </p>
          {documents.length > 0 && (
            <ul className="sw-research-own" aria-label="Sources to add">
              {documents.map((document, index) => (
                <li key={keyOf(document)} className="sw-research-own__item">
                  <span className="sw-research-own__name">{document.name}</span>
                  <span className="sw-research-own__size num">
                    {sizeText(document.content.length)}
                  </span>
                  <IconButton
                    label={`Remove ${document.name}`}
                    size="sm"
                    disabled={working}
                    onClick={() => evidence.remove(index)}
                  >
                    <X size={14} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {refused && (
            <p className="sw-research-own__problem" role="alert">
              {refused}
            </p>
          )}
          <div className="sw-research-own__actions">
            <EvidenceMenu
              evidence={evidence}
              urlEnabled={false}
              disabled={busy || state.working !== null}
              trigger={
                <Button
                  variant="glass"
                  size="sm"
                  icon={<ClipboardPaste size={15} aria-hidden="true" />}
                  disabled={busy || state.working !== null}
                >
                  Paste or attach
                </Button>
              }
            />
            {documents.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={15} aria-hidden="true" />}
                busy={working}
                disabled={busy || (state.working !== null && !working)}
                onClick={() => void add()}
              >
                {documents.length === 1
                  ? 'Use this source'
                  : `Use these ${documents.length} sources`}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="sw-research-quiet sw-caption">
            Open the question again to paste text, attach files or add pages. Swarm reads what you
            give it, and your question comes with you.
          </p>
          <Button
            variant="glass"
            size="sm"
            icon={<ClipboardPaste size={15} aria-hidden="true" />}
            disabled={busy}
            onClick={duplicate}
          >
            Open the question to add sources
          </Button>
        </>
      )}
    </div>
  );
}
