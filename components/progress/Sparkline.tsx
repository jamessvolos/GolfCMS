/**
 * Elo history as a 1px ink sparkline — a drafting line, not a chart:
 * no axes, no grid, no fill. The final point is inked as a benchmark dot
 * because "where am I now" is the only reading anyone takes from it.
 */

import { color } from '@/lib/design/tokens';

export default function Sparkline({
  values,
  width = 220,
  height = 40,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
}) {
  if (values.length < 2) {
    return (
      <p className="mono-nums text-[12px] text-ink-soft">
        Two attempts draws the line — play another.
      </p>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]!);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        label ??
        `Rating history: ${values.length} attempts, from ${values[0]} to ${values[values.length - 1]}, low ${min}, high ${max}`
      }
    >
      <path d={d} fill="none" stroke={color.ink} strokeWidth={1} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color.ink} />
    </svg>
  );
}
