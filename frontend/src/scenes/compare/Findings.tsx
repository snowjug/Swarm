import { useState } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { Analysis, Finding } from '../../../../shared/analysis';
import { SPRING } from '../../design/motion';
import { Segmented } from '../../design/ui';
import {
  SHOWN_FINDINGS,
  STABILITY,
  holdsText,
  intervalText,
  rankFindings,
} from '../../lib/analysis';
import { useCompare } from './context';
import { FINDING_KIND_LABELS, REPEATABILITY_NOTE, sectionInfo } from './copy';
import { countText } from './format';
import type { Pair } from './pair';
import { RepeatMeter, Section, StabilityChip } from './parts';
import './findings.css';

function Item({
  finding,
  scenario,
  advanced,
}: {
  finding: Finding;
  scenario: string;
  advanced: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stability = STABILITY[finding.classification];
  return (
    <m.li
      layout="position"
      transition={SPRING.smooth}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="sw-cmp-fnd"
      data-class={finding.classification}
    >
      <div className="sw-cmp-fnd__main">
        <p className="sw-cmp-fnd__kind">
          <span className="sw-eyebrow">{FINDING_KIND_LABELS[finding.kind] ?? finding.kind}</span>
          <span className="sw-cmp-fnd__scenario">{scenario}</span>
        </p>
        <p className="sw-cmp-fnd__text">{finding.statement}</p>
        <button
          type="button"
          className="sw-cmp-fnd__why"
          aria-expanded={open}
          onClick={() => setOpen((old) => !old)}
        >
          What this means and how it was tested
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <div className="sw-cmp-fnd__more" data-open={open} inert={!open}>
          <div className="sw-cmp-fnd__more-in">
            <p>{stability.explain(finding.of)}</p>
            <p>
              <span className="sw-cmp-fnd__label">Tested as</span> {finding.predicate}
            </p>
          </div>
        </div>
      </div>
      <div className="sw-cmp-fnd__count">
        <StabilityChip classification={finding.classification} size="sm" />
        <RepeatMeter finding={finding} />
        <p className="sw-cmp-fnd__holds">
          <b className="num">{finding.holdsIn}</b> of <b className="num">{finding.of}</b> runs
        </p>
        <p className="sw-cmp-fnd__interval num">95% interval {intervalText(finding)}</p>
        <p className="sr-only">It {holdsText(finding)}.</p>
        {advanced && (
          <p className="sw-cmp-fnd__engine sw-mono">
            {finding.id} · {finding.kind}
          </p>
        )}
      </div>
    </m.li>
  );
}

/**
 * What held across the seeded runs: each finding in its own words, how steady it was, and what that means, ranked as
 * the engine ranks them. The first few are shown; the rest are one press away, unchanged. The page's two scenarios
 * come first; every scenario's findings are one press away.
 */
export function Findings({
  analysis,
  pair,
  labels,
}: {
  analysis: Analysis;
  pair: Pair;
  labels: ReadonlyMap<string, string>;
}) {
  const { advanced } = useCompare();
  const [scope, setScope] = useState<'pair' | 'all'>('pair');
  const [all, setAll] = useState(false);
  const info = sectionInfo('holds');
  const ranked = rankFindings(analysis.findings, analysis.config.variants);
  if (ranked.length === 0) {
    return (
      <Section info={info}>
        <p className="sw-cmp-note">No findings could be counted from these runs.</p>
      </Section>
    );
  }
  const inPair = ranked.filter(
    (finding) => finding.variantId === pair.a || finding.variantId === pair.b,
  );
  const narrowable = inPair.length > 0 && inPair.length < ranked.length;
  const pool = scope === 'pair' && narrowable ? inPair : ranked;
  const shown = all ? pool : pool.slice(0, SHOWN_FINDINGS);
  const rest = pool.length - SHOWN_FINDINGS;
  const nameOf = (id: string): string =>
    labels.get(id) ?? analysis.config.variants.find((variant) => variant.id === id)?.label ?? id;

  return (
    <Section
      info={info}
      aside={
        narrowable ? (
          <Segmented
            label="Findings of"
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'pair', label: 'This pair' },
              { value: 'all', label: `All ${analysis.config.variants.length} scenarios` },
            ]}
          />
        ) : undefined
      }
    >
      <div className="sw-cmp-fnds">
        <p className="sw-cmp-quiet">{REPEATABILITY_NOTE}</p>
        <LayoutGroup>
          <ol className="sw-cmp-fnds__list" aria-label="Findings, the steadiest first">
            <AnimatePresence initial={false}>
              {shown.map((finding) => (
                <Item
                  key={finding.id}
                  finding={finding}
                  scenario={nameOf(finding.variantId)}
                  advanced={advanced}
                />
              ))}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
        {rest > 0 && (
          <button type="button" className="sw-cmp-more" onClick={() => setAll((old) => !old)}>
            {all ? 'Show fewer' : `Show the other ${countText(rest)}`}
            <ChevronDown size={16} aria-hidden="true" data-up={all || undefined} />
          </button>
        )}
      </div>
    </Section>
  );
}
