import { Copy, ScrollText } from 'lucide-react';
import { DECISION_LABELS, STUDIO_STATE_LABELS, type StudioView } from '../../../../shared/studio';
import {
  Button,
  Disclosure,
  IconButton,
  Sheet,
  SheetContent,
  TabPanel,
  Tabs,
  type TabItem,
  useToast,
} from '../../design/ui';
import { dateTime } from '../../lib/format';
import { actorLabel } from '../../lib/studio';
import { useState } from 'react';
import type { StudioDocument } from './model';
import { plural } from './model';
import { Prose } from './Prose';
import './Record.css';

type RecordTab = 'decisions' | 'conflicts' | 'assumptions' | 'archive';

function Hash({ value }: { value: string }) {
  const toast = useToast();
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(
      () => toast({ title: 'Fingerprint copied', tone: 'success', duration: 2200 }),
      () =>
        toast({
          title: 'Could not copy it',
          description: 'Select the fingerprint and copy it by hand.',
          tone: 'error',
        }),
    );
  };
  return (
    <div className="sw-record__hash">
      <p className="sw-eyebrow">Fingerprint of the approved text · SHA-256</p>
      <div className="sw-record__hashrow">
        <code className="sw-mono">{value}</code>
        <IconButton label="Copy the fingerprint" size="sm" onClick={copy}>
          <Copy size={15} aria-hidden="true" />
        </IconButton>
      </div>
      <p className="sw-caption">
        A printed memo shows the same fingerprint, so it can be matched to what was approved.
      </p>
    </div>
  );
}

/**
 * Everything the report remembers about how it got here: who did what and when, the conflicts between sources
 * that are still open, the assumptions behind the simulated figures, and the text of earlier working copies.
 */
export function RecordSheet({
  view,
  document,
  open,
  onOpenChange,
  onAudit,
}: {
  view: StudioView;
  document: StudioDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAudit: () => void;
}) {
  const [tab, setTab] = useState<RecordTab>('decisions');
  const tabs: TabItem<RecordTab>[] = [
    { value: 'decisions', label: 'Decisions', count: document.decisions.length },
    { value: 'conflicts', label: 'Conflicts', count: view.conflicts.length },
    { value: 'assumptions', label: 'Assumptions', count: view.assumptions.length },
    ...(document.archive.length > 0
      ? [{ value: 'archive' as const, label: 'Earlier copies', count: document.archive.length }]
      : []),
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Review record"
        eyebrow="What the report remembers"
        width="lg"
        footer={
          <Button
            variant="ghost"
            icon={<ScrollText size={16} aria-hidden="true" />}
            onClick={onAudit}
          >
            Open the audit log
          </Button>
        }
      >
        <Tabs
          label="Record"
          value={tab}
          onValueChange={setTab}
          tabs={tabs}
          listClassName="sw-record__tabs"
        >
          <TabPanel value="decisions" className="sw-record__panel">
            {document.approval && <Hash value={document.approval.contentHash} />}
            <ol className="sw-timeline" role="list">
              {[...document.decisions].reverse().map((decision) => (
                <li
                  key={`${decision.revision}-${decision.action}`}
                  className="sw-timeline__item"
                  data-action={decision.action}
                >
                  <span className="sw-timeline__dot" aria-hidden="true" />
                  <p className="sw-timeline__what">{DECISION_LABELS[decision.action]}</p>
                  <p className="sw-timeline__meta">
                    {actorLabel(decision.actor)} · {dateTime(decision.at)} ·{' '}
                    <span className="num">revision {decision.revision}</span>
                  </p>
                  {decision.note && <p className="sw-timeline__note">“{decision.note}”</p>}
                </li>
              ))}
            </ol>
          </TabPanel>

          <TabPanel value="conflicts" className="sw-record__panel">
            {view.conflicts.length === 0 ? (
              <p className="sw-tool__empty">
                No conflict between the sources was detected. That is not proof that they agree.
              </p>
            ) : (
              <ul className="sw-record__list" role="list">
                {view.conflicts.map((conflict) => (
                  <li key={conflict.id} className="sw-conflict">
                    <p className="sw-conflict__topic">
                      <span className="sw-mono">{conflict.id}</span> {conflict.topic}
                    </p>
                    {[conflict.left, conflict.right].map((side) => (
                      <blockquote
                        key={`${side.passageId}-${side.start}`}
                        className="sw-conflict__side"
                      >
                        {side.quote ?? 'The whole passage'}
                        <cite>
                          {side.documentName}, {side.passageId}
                        </cite>
                      </blockquote>
                    ))}
                    <p className="sw-caption">Neither passage is declared true.</p>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>

          <TabPanel value="assumptions" className="sw-record__panel">
            {view.assumptions.length === 0 ? (
              <p className="sw-tool__empty">No assumption is recorded for the simulated figures.</p>
            ) : (
              <ul className="sw-record__list" role="list">
                {view.assumptions.map((assumption) => (
                  <li key={assumption.id} className="sw-assumption">
                    <span className="sw-mono">{assumption.id}</span>
                    <span>{assumption.statement}</span>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>

          <TabPanel value="archive" className="sw-record__panel">
            {document.archive.map((entry) => (
              <div key={entry.archivedAt} className="sw-archive">
                <p>
                  <strong>Set aside {dateTime(entry.archivedAt)}</strong> by{' '}
                  {actorLabel(entry.actor)}; it was {STUDIO_STATE_LABELS[entry.state].toLowerCase()}
                  . {plural(entry.sections.length, 'section')} kept.
                </p>
                {entry.sections.map((section) => (
                  <Disclosure key={section.id} summary={section.title}>
                    <Prose body={section.body} className="sw-archive__text" />
                  </Disclosure>
                ))}
              </div>
            ))}
          </TabPanel>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
