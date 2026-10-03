"use client";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  title?: string;
}

/** Tiny inline-SVG bar sparkline (one bar per activity bucket, oldest left). */
export function Sparkline({ values, width = 240, height = 36, className, title }: Props) {
  const n = Math.max(values.length, 1);
  const max = Math.max(1, ...values);
  const barW = width / n;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={title ?? "활동 그래프"}
    >
      {title && <title>{title}</title>}
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="var(--border)" strokeWidth={1} />
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 2)) : 0;
        return <rect key={i} x={i * barW + 0.3} y={height - h} width={Math.max(0.6, barW - 0.6)} height={h} fill="var(--accent)" opacity={0.85} />;
      })}
    </svg>
  );
}
