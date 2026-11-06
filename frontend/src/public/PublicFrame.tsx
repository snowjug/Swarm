import type { ReactNode } from 'react';
import { Aurora } from '../design/ambient/Aurora';
import { Mark } from '../design/ui/Mark';
import type { PublicSession } from '../../../shared/public';
import { PageLink } from './PageLink';
import { PAGE_PATHS } from './pages';
import './public.css';

/** The frame of every page that is not the application: the brand, the page, and the links every visitor may need. */
export function PublicFrame({
  session,
  action,
  children,
  wide,
}: {
  session: Pick<PublicSession, 'legal'> | null;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <Aurora />
      <div className="sw-pub" data-wide={wide || undefined}>
        <a className="sw-skip" href="#main-content">
          Skip to content
        </a>
        <header className="sw-pub__bar">
          <PageLink to="/" className="sw-pub__brand" aria-label="Swarm: home">
            <Mark size={26} />
            <span className="sw-pub__word">Swarm</span>
          </PageLink>
          {action}
        </header>
        <main id="main-content" className="sw-pub__main" tabIndex={-1}>
          {children}
        </main>
        <footer className="sw-pub__foot">
          <nav className="sw-pub__footnav" aria-label="About this site">
            <PageLink to={session?.legal.terms ?? PAGE_PATHS.terms}>Terms</PageLink>
            <PageLink to={session?.legal.privacy ?? PAGE_PATHS.privacy}>Privacy</PageLink>
            <PageLink to={PAGE_PATHS.faq}>FAQ</PageLink>
            <PageLink to={PAGE_PATHS.status}>Status</PageLink>
          </nav>
        </footer>
      </div>
    </>
  );
}
