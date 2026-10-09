import React from 'react';

/**
 * Circular completion indicator for pick/pack, where "how much is left" is the
 * single most important number on screen.
 */
export default function ProgressRing({
  value = 0,
  total = 0,
  size = 64,
  stroke = 7,
  label = '',
  sublabel = '',
  dataTestId = 'progress-ring',
}) {
  const safeTotal = Number(total) || 0;
  const safeValue = Math.max(0, Math.min(Number(value) || 0, safeTotal || Infinity));
  const pct = safeTotal > 0 ? Math.min(100, (safeValue / safeTotal) * 100) : 0;

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const tone = pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--accent)' : 'var(--warning)';

  return (
    <div className="progress-ring" data-testid={dataTestId}>
      <div className="progress-ring__track" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--bg-inset)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 300ms ease, stroke 300ms ease' }}
          />
        </svg>
        <div className="progress-ring__value" data-testid={`${dataTestId}-value`}>
          {Math.round(pct)}%
        </div>
      </div>
      {(label || sublabel) && (
        <div className="progress-ring__label">
          {label && <span className="progress-ring__label-main">{label}</span>}
          {sublabel && <span className="progress-ring__label-sub">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
