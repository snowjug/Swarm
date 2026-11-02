import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import type { Analysis, SensitivityRow } from '../../../../shared/analysis';
import {
  Button,
  Chip,
  IconButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../design/ui';
import {
  NO_EFFECT_TO_TEST,
  ORIGIN,
  SHOWN_ASSUMPTIONS,
  noiseText,
  sensitivityView,
  unsupportedSensitive,
} from '../../lib/analysis';
import { sectionInfo } from './copy';
import { vars } from './css';
import { countText, pointsPhrase, shareText, signed } from './format';
import { DataTable, Section, type TableSpec } from './parts';
import { CHIP_TONE } from './tones';
import { sensitivityTally, tornadoOrder, tornadoReach } from './tornado';
import './tornado.css';

function Item({
  row,
  reach,
  noEffect,
  showOrigin,
}: {
  row: SensitivityRow;
  reach: number;
  noEffect: boolean;
  showOrigin: boolean;
}) {
  const view = sensitivityView(row.classification, noEffect);
  const origin = ORIGIN[row.assumptionOrigin];
  const sensitive = row.classification === 'assumption-sensitive';
  const unsupported = sensitive && !origin.evidenced;
  const half = (value: number): number => Math.min(50, (Math.abs(value) / reach) * 50);
  const barLo = row.shift < 0 ? 50 - half(row.shift) : 50;
  const noiseLo = 50 + Math.max(-50, Math.min(50, ((row.shift - row.standardError) / reach) * 50));
  const noiseHi = 50 + Math.max(-50, Math.min(50, ((row.shift + row.standardError) / reach) * 50));
  return (
    <li className="sw-cmp-tor" data-class={row.classification} data-warn={unsupported || undefined}>
      <div className="sw-cmp-tor__label">
        <p className="sw-cmp-tor__name">{row.label}</p>
        {showOrigin && (
          <Chip tone={CHIP_TONE[origin.tone]} size="sm" className="sw-cmp-tor__origin">
            {origin.label}
          </Chip>
        )}
      </div>
      <div
        className="sw-cmp-tor__zone"
        role="img"
        aria-label={`${row.label}: the share looking for an alternative or resisting moved by ${pointsPhrase(row.shift, 1)}, ${noiseText(row.standardError)}. ${view.label}. ${origin.label}.`}
        style={vars({
          '--bar-lo': barLo.toFixed(2),
          '--bar-span': half(row.shift).toFixed(2),
          '--noise-lo': noiseLo.toFixed(2),
          '--noise-span': Math.max(noiseHi - noiseLo, 0.4).toFixed(2),
        })}
      >
        <span className="sw-cmp-tor__zero" aria-hidden="true" />
        <span
          className="sw-cmp-tor__bar"
          data-dir={row.shift < 0 ? 'down' : 'up'}
          aria-hidden="true"
        />
        <span className="sw-cmp-tor__noise" aria-hidden="true" />
      </div>
      <div className="sw-cmp-tor__read">
        <p className="sw-cmp-tor__shift num">{pointsPhrase(row.shift, 1)}</p>
        <p className="sw-cmp-tor__noisetext">{noiseText(row.standardError)}</p>
        <Chip tone={CHIP_TONE[view.tone]} size="sm">
          {view.label}
        </Chip>
      </div>
    </li>
  );
}

const tableOf = (rows: readonly SensitivityRow[], noEffect: boolean): TableSpec => ({
  caption: 'Shift of the headline when one assumption is moved, on the same seeds',
  columns: [
    'Assumption moved',
    'Base',
    'Shift',
    'Noise (standard error)',
    'Result',
    'Where the assumption came from',
  ],
  rows: rows.map((row) => [
    row.label,
    shareText(row.baseMean, 1),
    signed(row.shift, 3),
    row.standardError.toFixed(3),
    sensitivityView(row.classification, noEffect).label,
    ORIGIN[row.assumptionOrigin].label,
  ]),
});

/**
 * What the result leans on: each assumption moved on its own, as a bar from nothing to how far the headline went, with
 * the noise of the paired runs as a whisker. Where the change cannot move anyone there was nothing to test, and it says
 * so rather than calling the assumptions robust. Sensitive assumptions that nothing supplied backs are called out.
 */
export function Tornado({
  analysis,
  noEffect,
  onSimulate,
}: {
  analysis: Analysis;
  noEffect: boolean;
  onSimulate: () => void;
}) {
  const [all, setAll] = useState(false);
  const info = sectionInfo('depends');
  const rows = analysis.sensitivity;

  if (rows.length === 0) {
    return (
      <Section info={info}>
        {analysis.config.sensitivity ? (
          <p className="sw-cmp-note">
            Sensitivity was asked for, but there was nothing to move: no assumption could be changed
            on its own.
          </p>
        ) : (
          <div className="sw-cmp-off">
            <p className="sw-cmp-note">
              Sensitivity was turned off for this comparison, so how far the result depends on its
              assumptions has not been tested.
            </p>
            <Button variant="glass" size="sm" onClick={onSimulate}>
              Simulate again with sensitivity
            </Button>
          </div>
        )}
      </Section>
    );
  }

  const ordered = tornadoOrder(rows);
  const reach = tornadoReach(rows);
  const unsupported = unsupportedSensitive(rows);
  const tally = sensitivityTally(rows, noEffect);
  const shown = all ? ordered : ordered.slice(0, SHOWN_ASSUMPTIONS);
  const rest = ordered.length - SHOWN_ASSUMPTIONS;
  const metric = rows[0]?.metric ?? 'The share of simulated members ending in switch or resist';
  const origins = new Set(rows.map((row) => row.assumptionOrigin));
  const sharedOrigin = origins.size === 1 ? ORIGIN[[...origins][0]!] : null;

  return (
    <Section info={info}>
      <div className="sw-cmp-tors">
        <div className="sw-cmp-tors__summary">
          {noEffect ? (
            <Notice tone="caution" title={NO_EFFECT_TO_TEST.label}>
              {NO_EFFECT_TO_TEST.explain}
            </Notice>
          ) : (
            <p className="sw-cmp-note">
              {tally.sensitive === 0
                ? `Moving any one of ${tally.total} assumptions did not clearly change the result.`
                : `${tally.sensitive} of ${tally.total} assumptions clearly change the result when moved.`}
            </p>
          )}
          {sharedOrigin && (
            <Chip tone={CHIP_TONE[sharedOrigin.tone]} size="sm">
              All of them: {sharedOrigin.label.charAt(0).toLowerCase()}
              {sharedOrigin.label.slice(1)}
            </Chip>
          )}
        </div>
        {unsupported.length > 0 && (
          <Notice
            tone="caution"
            title="Part of this result rests on assumptions with no evidence behind them"
          >
            {unsupported.length === 1
              ? 'One assumption that the result is sensitive to has no supplied evidence: '
              : `${unsupported.length} assumptions that the result is sensitive to have no supplied evidence: `}
            {unsupported.map((row) => row.label).join('; ')}. Treat conclusions that depend on them
            as hypotheses until evidence is supplied or the value is confirmed.
          </Notice>
        )}
        <div className="sw-cmp-tors__axis">
          <span className="sw-eyebrow">Assumption moved</span>
          <span className="sw-cmp-tors__ends" aria-hidden="true">
            <span>fewer</span>
            <span className="num">0</span>
            <span>more</span>
          </span>
          <span className="sw-cmp-tors__help">
            <span className="sw-eyebrow">Shift</span>
            <Popover>
              <PopoverTrigger asChild>
                <IconButton label="What the results mean" size="sm">
                  <HelpCircle size={16} aria-hidden="true" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent width="24rem" align="end">
                <p className="sw-eyebrow">What the results mean</p>
                <dl className="sw-cmp-means">
                  {(['assumption-sensitive', 'robust', 'inconclusive'] as const).map((key) => {
                    const entry = sensitivityView(key, noEffect);
                    return (
                      <div key={key}>
                        <dt>{entry.label}</dt>
                        <dd>{entry.explain}</dd>
                      </div>
                    );
                  })}
                </dl>
              </PopoverContent>
            </Popover>
          </span>
        </div>
        <ol
          className="sw-cmp-tors__list"
          aria-label="Assumptions, those that moved the result most first"
        >
          {shown.map((row) => (
            <Item
              key={row.id}
              row={row}
              reach={reach}
              noEffect={noEffect}
              showOrigin={!sharedOrigin}
            />
          ))}
        </ol>
        {rest > 0 && (
          <button type="button" className="sw-cmp-more" onClick={() => setAll((old) => !old)}>
            {all ? 'Show fewer' : `Show the other ${countText(rest)}`}
            <ChevronDown size={16} aria-hidden="true" data-up={all || undefined} />
          </button>
        )}
        <p className="sw-cmp-quiet">
          Measured on the same seeds as the unmoved run, so the noise is only that of each pair:{' '}
          {metric}. Bars to the right mean more simulated members ended that way.
        </p>
      </div>
      <DataTable spec={tableOf(ordered, noEffect)} />
    </Section>
  );
}
