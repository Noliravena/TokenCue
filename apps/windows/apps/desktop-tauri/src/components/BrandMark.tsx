/**
 * TokenCue quota-bar mark.
 *
 * Three descending bars speaking the same language as the panel progress
 * tracks: a full-width track plus an accent fill that shrinks row by row.
 * Rendered inline so both bar colors follow the theme through the
 * `--tb-mark-*` custom properties instead of shipping a light and a dark
 * copy of the same art.
 *
 * Below ~16px the regular proportions turn to mush, so `dense` swaps in the
 * thicker/wider variant from the handoff (icons/tokencue-mark-16.svg).
 */
const REGULAR_ROWS = [
  { y: 14, fill: 30 },
  { y: 28, fill: 19 },
  { y: 42, fill: 8 },
];

const DENSE_ROWS = [
  { y: 11, fill: 40 },
  { y: 26.5, fill: 25 },
  { y: 42, fill: 11 },
];

export function BrandMark({
  size = 22,
  dense,
  className,
}: {
  size?: number;
  dense?: boolean;
  className?: string;
}) {
  const compact = dense ?? size <= 16;
  const rows = compact ? DENSE_ROWS : REGULAR_ROWS;
  const x = compact ? 8 : 14;
  const width = compact ? 48 : 36;
  const height = compact ? 11 : 8;
  const radius = height / 2;

  return (
    <svg
      className={["brand-mark", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable="false"
    >
      {rows.map((row) => (
        <g key={row.y}>
          <rect
            x={x}
            y={row.y}
            width={width}
            height={height}
            rx={radius}
            fill="var(--tb-mark-track)"
          />
          <rect
            x={x}
            y={row.y}
            width={row.fill}
            height={height}
            rx={radius}
            fill="var(--tb-mark-fill)"
          />
        </g>
      ))}
    </svg>
  );
}

export default BrandMark;
