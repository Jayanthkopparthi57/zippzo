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
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: 6,
      marginBottom: 16,
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #f1f5f9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            {p.code}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
              <Calendar size={12} style={{ color: '#9333ea' }} />
              <span>{p.startDate} — {p.endDate}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
              <MapPin size={12} style={{ color: '#9333ea' }} />
              <span>{p.location}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 11, color: '#64748b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} style={{ color: '#9333ea' }} />
            <span><strong style={{ color: '#0f172a' }}>Batch_1:</strong> {p.batch1Timing}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} style={{ color: '#d97706' }} />
            <span><strong style={{ color: '#0f172a' }}>Batch_2:</strong> {p.batch2Timing}</span>
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        background: '#ffffff'
      }}>
        <div style={{ padding: '12px 16px', borderRight: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{p.totalTrips}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Planned: {p.plannedTrips}, Adhoc: {p.adhocTrips}</div>
        </div>

        <div style={{ padding: '12px 16px', borderRight: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#9333ea' }}>{p.batch1Assigned}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Vehicle Assigned (Batch 1)</div>
        </div>

        <div style={{ padding: '12px 16px', borderRight: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{p.batch1Docked}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Vehicle Docked (Batch 1)</div>
        </div>

        <div style={{ padding: '12px 16px', borderRight: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#9333ea' }}>{p.batch2Assigned}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Vehicle Assigned (Batch 2)</div>
        </div>

        <div style={{ padding: '12px 16px', borderRight: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#d97706' }}>{p.batch2Docked}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Vehicle Docked (Batch 2)</div>
        </div>

        <div style={{ padding: '12px 16px', background: '#fff1f2' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e11d48', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={15} />
            <span>{p.unassignedVehicles}</span>
          </div>
          <div style={{ fontSize: 10.5, color: '#e11d48', marginTop: 2, fontWeight: 600 }}>Unassigned Vehicles at Source</div>
        </div>
      </div>
    </div>
  );
}
