import type { ResearchRun } from '../../../../../shared/research';
import { Disclosure } from '../../../design/ui';
import { budgetLines, modelLine } from './model';

/**
 * What the run may use, and what it has: pages, sites, size, time, an estimated model cost. Each is a limit the server
 * keeps, outside any model, and the ceilings are the server's own: they are shown here and never set from here.
 */
export function Limits({ run }: { run: ResearchRun }) {
  return (
    <Disclosure summary="Limits for this run" heading={3} className="sw-research-disclosure">
      <dl className="sw-research-limits">
        {budgetLines(run).map((line) => (
          <div key={line.id} className="sw-research-limits__row">
            <dt>{line.label}</dt>
            <dd>
              <span className="num">{line.value}</span>
              {line.hint && <span className="sw-caption">{line.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="sw-caption">
        The server sets these ceilings, and they cannot be raised from this page. {modelLine(run)}
      </p>
    </Disclosure>
  );
}
