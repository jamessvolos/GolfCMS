/**
 * A streak as inked tally marks — four strokes and a diagonal through
 * them, the way you'd keep count in the margin of a yardage book. Never a
 * flame.
 */

import { color } from '@/lib/design/tokens';

const GROUP_W = 30;
const H = 22;

export default function TallyStreak({ groups, days }: { groups: number[]; days: number }) {
  if (days <= 0) {
    return (
      <span className="mono-nums text-[13px] text-ink-soft">
        No streak yet — today starts one.
      </span>
    );
  }
  // Long streaks stay readable: show the last five groups and a count.
  const shown = groups.slice(-5);
  const hidden = groups.length - shown.length;

  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`${days}-day streak`}>
      {hidden > 0 && <span className="mono-nums text-[12px] text-ink-soft">+{hidden * 5}</span>}
      {shown.map((n, gi) => (
        <svg key={gi} width={GROUP_W} height={H} viewBox={`0 0 ${GROUP_W} ${H}`} aria-hidden>
          {Array.from({ length: Math.min(n, 4) }, (_, i) => (
            <line
              key={i}
              x1={4 + i * 6}
              y1={3}
              x2={4 + i * 6}
              y2={H - 3}
              stroke={color.ink}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
          {n === 5 && (
            <line
              x1={1}
              y1={H - 4}
              x2={26}
              y2={4}
              stroke={color.ink}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )}
        </svg>
      ))}
    </span>
  );
}
