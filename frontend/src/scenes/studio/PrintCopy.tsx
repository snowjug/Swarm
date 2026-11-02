import { SECTION_ORIGIN_LABELS, STUDIO_STATE_LABELS } from '../../../../shared/studio';
import { dateTime } from '../../lib/format';
import { POSITIONING_STATEMENT } from '../../lib/product';
import { actorLabel } from '../../lib/studio';
import { plural, type StudioDocument } from './model';
import { Prose } from './Prose';
import './Print.css';

/**
 * What the browser's own print makes of the studio: the whole working copy, in order, with where it stands in
 * its review, and none of the controls. It is not on the screen. The printable memo is the formal record, with the
 * statements and their evidence; this says so, so that the two are never taken for each other.
 */
export function PrintCopy({ title, document }: { title: string; document: StudioDocument }) {
  const { approval } = document;
  return (
    <article className="sw-studio-print" aria-hidden="true">
      <header className="sw-studio-print__head">
        <p className="sw-studio-print__eyebrow">Report studio · working copy</p>
        <h1 className="sw-studio-print__title">{title}</h1>
        <p className="sw-studio-print__status">
          <strong>{STUDIO_STATE_LABELS[document.state]}</strong>
          {' · '}
          Revision {document.revision}
          {' · '}
          Updated {dateTime(document.updatedAt)}
        </p>
        {approval ? (
          <p className="sw-studio-print__approval">
            Approved by {actorLabel(approval.actor)}, {dateTime(approval.at)}
            {approval.alsoEdited ? ', who also wrote part of this text' : ''}. The fingerprint of
            the approved text is {approval.contentHash}.
          </p>
        ) : (
          <p className="sw-studio-print__approval">Not approved: this is not an approved text.</p>
        )}
        <p className="sw-studio-print__fine">{POSITIONING_STATEMENT}</p>
      </header>
      {document.sections.map((section) => (
        <section key={section.id} className="sw-studio-print__section">
          <h2>{section.title}</h2>
          <p className="sw-studio-print__origin">
            {SECTION_ORIGIN_LABELS[section.origin]} · version {section.version}
            {section.locked ? ' · locked as final wording' : ''}
            {section.notes.length > 0 ? ` · ${plural(section.notes.length, 'reviewer note')}` : ''}
          </p>
          <Prose body={section.body} list={section.kind === 'limitations'} />
        </section>
      ))}
      <footer className="sw-studio-print__foot">
        The statements of each chapter, the evidence behind them and the review record are in the
        printable memo (Export, then Printable memo). Text written by a person has not been checked
        statement by statement.
      </footer>
    </article>
  );
}
