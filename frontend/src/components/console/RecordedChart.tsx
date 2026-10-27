import { useId } from 'react';
import { useElementSize } from '../../hooks/useElementSize';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  dash?: string;
  marker: 'circle' | 'square' | 'triangle' | 'diamond' | 'cross';
  points: { round: number; value: number | null }[];
}

function PointMarker({
  x,
  y,
  marker,
  color,
}: {
  x: number;
  y: number;
  marker: ChartSeries['marker'];
  color: string;
}) {
  const props = { fill: '#fff', stroke: color, strokeWidth: 2 };
  if (marker === 'square') return <rect x={x - 3.5} y={y - 3.5} width={7} height={7} {...props} />;
  if (marker === 'triangle')
    return (
      <polygon points={`${x},${y - 4.5} ${x + 4.5},${y + 3.5} ${x - 4.5},${y + 3.5}`} {...props} />
    );
  if (marker === 'diamond')
    return (
      <polygon
        points={`${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}`}
        {...props}
      />
    );
  if (marker === 'cross')
    return (
      <path
        d={`M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
    );
  return <circle cx={x} cy={y} r={3.5} {...props} />;
}

export function RecordedChart({
  title,
  summary,
  series,
  min = -1,
  max = 1,
}: {
  title: string;
  summary: string;
  series: ChartSeries[];
  min?: number;
  max?: number;
}) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const id = useId();
  const height = 280;
  const left = 52;
  const right = Math.max(left + 20, width - 18);
  const top = 18;
  const bottom = height - 42;
  const rounds = [
    ...new Set(series.flatMap((item) => item.points.map((point) => point.round))),
  ].sort((a, b) => a - b);
  const first = rounds[0] ?? 0;
  const last = rounds.at(-1) ?? first;
  const x = (round: number) =>
    first === last
      ? (left + right) / 2
      : left + ((round - first) * (right - left)) / (last - first);
  const y = (value: number) => bottom - ((value - min) * (bottom - top)) / (max - min);
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const stride = Math.max(
    1,
    Math.ceil(rounds.length / Math.max(2, Math.floor((right - left) / 60))),
  );
  const roundTicks = rounds.filter(
    (_, index) => index % stride === 0 || index === rounds.length - 1,
  );
  return (
    <figure className="recorded-chart">
      <figcaption id={`${id}-caption`}>{title}</figcaption>
      <p className="field-help" id={`${id}-description`}>
        {summary}
      </p>
      <div className="chart-surface" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${summary} ${rounds.length} recorded round positions; exact values are in the data table.`}
        >
          <title>{title}</title>
          <desc>{summary} Lines join recorded values only. Gaps mean no recorded value.</desc>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#d7dce0" />
              <text x={left - 8} y={y(tick) + 4} textAnchor="end" fill="#424e5b" fontSize={12}>
                {tick.toFixed(2)}
              </text>
            </g>
          ))}
          <line x1={left} x2={left} y1={top} y2={bottom} stroke="#65717e" />
          <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#65717e" />
          {roundTicks.map((round) => (
            <text
              key={round}
              x={x(round)}
              y={bottom + 20}
              textAnchor="middle"
              fill="#424e5b"
              fontSize={12}
            >
              {round}
            </text>
          ))}
          <text
            x={(left + right) / 2}
            y={height - 4}
            textAnchor="middle"
            fill="#424e5b"
            fontSize={12}
          >
            Recorded round
          </text>
          {series.map((item) => {
            let previous = false;
            const path = item.points
              .map((point) => {
                if (point.value === null) {
                  previous = false;
                  return '';
                }
                const command = previous ? 'L' : 'M';
                previous = true;
                return `${command}${x(point.round)},${y(point.value)}`;
              })
              .join(' ');
            return (
              <g key={item.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={2}
                  strokeDasharray={item.dash}
                  vectorEffect="non-scaling-stroke"
                />
                {item.points
                  .filter((point) => point.value !== null)
                  .map((point) => (
                    <PointMarker
                      key={point.round}
                      x={x(point.round)}
                      y={y(point.value!)}
                      marker={item.marker}
                      color={item.color}
                    />
                  ))}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="chart-legend">
        {series.map((item) => (
          <li key={item.id}>
            <svg width={38} height={20} aria-hidden="true">
              <line
                x1={0}
                x2={38}
                y1={10}
                y2={10}
                stroke={item.color}
                strokeWidth={2}
                strokeDasharray={item.dash}
              />
              <PointMarker x={19} y={10} marker={item.marker} color={item.color} />
            </svg>
            <span>
              {item.label} ({item.dash ? 'dashed' : 'solid'}, {item.marker})
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
