import { useTween } from '../../design/motion';
import { Tooltip } from '../../design/ui';
import { vars } from './css';
import { figure } from './model';

/**
 * A count in the serif. A figure the page does not know yet is a dash; one that arrives while the page is open
 * counts up to its value, and one that was there when the page opened is simply there.
 */
function Numeral({ value }: { value: number | null }) {
  const shown = useTween(value ?? 0);
  if (value === null) {
    return (
      <span className="sw-ground__dash" role="img" aria-label="Not known yet">
        –
      </span>
    );
  }
  return <span className="num">{figure(Math.round(shown))}</span>;
}

export interface FigureSpec {
  id: string;
  label: string;
  value: number | null;
  /** One short phrase under the label, where the figure needs one. */
  note?: string;
  tone?: 'caution';
  tip: string;
  /** Where the figure leads. Null where there is nowhere to go: the figure is then only read. */
  onPress: (() => void) | null;
}

/** The four figures that answer what the evidence is: each is a way into the part of the page it counts. */
export function Figures({ items }: { items: readonly FigureSpec[] }) {
  return (
    <ul className="sw-ground__figures" role="list">
      {items.map((item, index) => {
        const body = (
          <>
            <span className="sw-ground__num sw-numeral">
              <Numeral value={item.value} />
            </span>
            <span className="sw-ground__cap">{item.label}</span>
            <span className="sw-ground__note">{item.note ?? ' '}</span>
          </>
        );
        return (
          <li key={item.id} className="sw-rise" style={vars({ '--i': index + 2 })}>
            {item.onPress ? (
              <Tooltip label={item.tip} side="bottom" align="start">
                <button
                  type="button"
                  className="sw-ground__figure"
                  data-tone={item.tone}
                  data-known={item.value !== null}
                  onClick={item.onPress}
                >
                  {body}
                </button>
              </Tooltip>
            ) : (
              <div
                className="sw-ground__figure"
                data-static
                data-tone={item.tone}
                data-known={item.value !== null}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
