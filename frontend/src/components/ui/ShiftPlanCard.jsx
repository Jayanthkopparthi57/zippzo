import React from 'react';
import { Calendar, Clock, MapPin, AlertCircle } from 'lucide-react';

export default function ShiftPlanCard({ plan }) {
  const p = plan || {
    code: 'DP-20260905-3dd10877',
    startDate: '1:00 am, 06-Sep-2026',
    endDate: '1:00 am, 07-Sep-2026',
    location: 'HYD-DRY-MH2-KANDLAKOYA (HYD080M) & 2 more',
    batch1Timing: '1:00 AM - 2:00 PM',
    batch2Timing: '2:00 PM - 1:00 AM',
    totalTrips: 104,
    plannedTrips: 100,
    adhocTrips: 4,
    batch1Assigned: '54 / 65',
    batch1Docked: '54 / 65',
    batch2Assigned: '28 / 39',
    batch2Docked: '20 / 39',
    unassignedVehicles: 19,
  };

  return (
    <div className="shift-plan-card">
      <div className="shift-plan-top">
        <div>
          <div className="plan-code-title">{p.code}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <Calendar size={12} style={{ color: 'var(--c-amber)' }} />
              <span>{p.startDate} — {p.endDate}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <MapPin size={12} style={{ color: 'var(--c-teal)' }} />
              <span>{p.location}</span>
            </div>
          </div>
        </div>

        <div className="shift-info-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} style={{ color: 'var(--c-teal)' }} />
            <span><strong>Batch_1 (Morning):</strong> {p.batch1Timing}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} style={{ color: 'var(--c-amber)' }} />
            <span><strong>Batch_2 (Evening):</strong> {p.batch2Timing}</span>
          </div>
        </div>
      </div>

      <div className="shift-metrics-grid">
        <div className="shift-metric-cell">
          <div className="shift-metric-val">{p.totalTrips}</div>
          <div className="shift-metric-label">
            Planned: {p.plannedTrips}, Adhoc: {p.adhocTrips} • Total Trips
          </div>
        </div>

        <div className="shift-metric-cell">
          <div className="shift-metric-val" style={{ color: 'var(--c-teal)' }}>{p.batch1Assigned}</div>
          <div className="shift-metric-label">Vehicle Assigned (Batch_1)</div>
        </div>

        <div className="shift-metric-cell">
          <div className="shift-metric-val" style={{ color: 'var(--c-teal)' }}>{p.batch1Docked}</div>
          <div className="shift-metric-label">Vehicle Docked (Batch_1)</div>
        </div>

        <div className="shift-metric-cell">
          <div className="shift-metric-val" style={{ color: 'var(--c-amber)' }}>{p.batch2Assigned}</div>
          <div className="shift-metric-label">Vehicle Assigned (Batch_2)</div>
        </div>

        <div className="shift-metric-cell">
          <div className="shift-metric-val" style={{ color: 'var(--c-amber)' }}>{p.batch2Docked}</div>
          <div className="shift-metric-label">Vehicle Docked (Batch_2)</div>
        </div>

        <div className="shift-metric-cell" style={{ background: 'rgba(184, 58, 50, 0.08)' }}>
          <div className="shift-metric-val" style={{ color: 'var(--c-rust)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={16} />
            <span>{p.unassignedVehicles}</span>
          </div>
          <div className="shift-metric-label" style={{ color: 'var(--c-rust)' }}>Unassigned at Source</div>
        </div>
      </div>
    </div>
  );
}
