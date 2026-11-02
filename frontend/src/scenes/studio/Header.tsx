import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../design/ui';
import './Header.css';

/**
 * The top of the studio: a way back, what this is and what it is of, and the few things that belong to the
 * whole report and not to a section. The title is quiet on purpose; the section being read is the page.
 */
export function StudioHeader({
  title,
  onBack,
  tools,
  menu,
}: {
  title: string;
  onBack: () => void;
  /** The buttons that belong to the whole report, for a screen with room for them. */
  tools: ReactNode;
  /** The same, as one menu, for a phone. */
  menu: ReactNode;
}) {
  return (
    <header className="sw-studio__head">
      <div className="sw-studio__crumbs">
        <Button
          variant="ghost"
          size="sm"
          className="sw-studio__back"
          icon={<ArrowLeft size={16} aria-hidden="true" />}
          onClick={onBack}
        >
          Back to the brief
        </Button>
        <span className="sw-eyebrow">Report studio</span>
        <span className="sw-studio__lede">
          A working copy. Every change is a version; the generated report stays as it was.
        </span>
      </div>
      <div className="sw-studio__titles">
        <h1 className="sw-studio__title sw-title">{title}</h1>
        <div className="sw-studio__tools">{tools}</div>
        <div className="sw-studio__more">{menu}</div>
      </div>
    </header>
  );
}
