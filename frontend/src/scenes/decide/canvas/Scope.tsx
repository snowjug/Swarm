import { UserCheck } from 'lucide-react';
import { SCOPE_DOMAIN_WORDS, type DecisionScope } from '../../../../../shared/decision';
import { COPY } from './model';

/**
 * What Swarm does not decide, said calmly and where it is seen first: beside the title of the decision view,
 * whatever state the page is in. It is shown when the question touches employment, credit, legal, medical or
 * safety matters, and it names which. It is not a refusal and it blocks nothing: the picture is still there.
 */
export function ScopeNotice({ scope }: { scope: DecisionScope }) {
  if (!scope.notice) return null;
  return (
    <div className="sw-canvas-scope" role="note" aria-label={COPY.scopeLabel}>
      <UserCheck size={18} aria-hidden="true" className="sw-canvas-scope__icon" />
      <p className="sw-canvas-scope__text">
        {scope.notice}{' '}
        <span className="sw-canvas-scope__domains">
          <span className="sw-canvas-scope__what">{COPY.scopeMatched}</span>
          {scope.domains.map((domain) => (
            <span key={domain} className="sw-canvas-scope__domain">
              {SCOPE_DOMAIN_WORDS[domain].label}
            </span>
          ))}
        </span>
      </p>
    </div>
  );
}
