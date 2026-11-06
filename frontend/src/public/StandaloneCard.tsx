import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Aurora } from '../design/ambient/Aurora';
import { Mark } from '../design/ui/Mark';
import '../panels/standalone.css';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * A screen that stands alone, without the shell: a sign-in that did not work, a service that is down, a service that
 * cannot be reached. It is the pilot's own standalone card (`panels/standalone.css`), so it looks like it.
 */
export function StandaloneCard({
  icon: Icon,
  tone = 'accent',
  title,
  children,
  testId,
  role = 'status',
  data,
}: {
  icon: LucideIcon;
  tone?: 'accent' | 'caution' | 'critical';
  title: string;
  children: ReactNode;
  testId: string;
  role?: 'alert' | 'status';
  data?: Record<string, string>;
}) {
  useDocumentTitle(`${title} · Swarm`);
  return (
    <>
      <Aurora />
      <div className="sw-stand">
        <header className="sw-stand__brand">
          <Mark size={26} />
          <span className="sw-stand__word">Swarm</span>
        </header>
        <main id="main-content" className="sw-stand__main">
          <div
            className="sw-stand__card sw-glass sw-glass--overlay sw-rise"
            role={role}
            data-tone={tone}
            data-testid={testId}
            {...Object.fromEntries(
              Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]),
            )}
          >
            <span className="sw-stand__badge" aria-hidden="true">
              <Icon size={22} />
            </span>
            <h1 className="sw-stand__title">{title}</h1>
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
