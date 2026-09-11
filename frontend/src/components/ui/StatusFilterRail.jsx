import React from 'react';
import { Download } from 'lucide-react';

export default function StatusFilterRail({
  stages = [],
  activeStage,
  onSelectStage,
  actionLabel = 'Download Report',
  onActionClick,
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <div className="status-counter-rail" style={{ marginBottom: 0 }}>
        {stages.map((st) => {
          const isActive = activeStage === st.id;
          return (
            <div
              key={st.id}
              className={`status-counter-pill ${isActive ? 'active' : ''}`}
              onClick={() => onSelectStage && onSelectStage(st.id)}
            >
              <span>{st.label}</span>
              {st.count != null && (
                <span className="pill-count-tag">{st.count}</span>
              )}
            </div>
          );
        })}
      </div>

      {actionLabel && (
        <button
          onClick={onActionClick}
          className="btn-ui neutral"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
        >
          <Download size={13} />
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}
