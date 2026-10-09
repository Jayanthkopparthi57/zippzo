import React from 'react';

/**
 * Maps arbitrary status strings onto the shared badge palette so every screen
 * renders the same colour for the same state.
 */
const TONE = {
  // success / complete family
  active: 'success', completed: 'success', complete: 'success', done: 'success',
  received: 'success', packed: 'success', dispatched: 'success', delivered: 'success',
  approved: 'success', passed: 'success', putawayed: 'success', verified: 'success',
  sorted: 'success', shipped: 'success', closed: 'success', available: 'success',

  // warning / attention
  pending: 'warning', partial: 'warning', in_progress: 'warning', draft: 'warning',
  'in progress': 'warning', hold: 'warning', exception: 'warning', low: 'warning',
  short: 'warning', reassign: 'warning',

  // danger / failure
  failed: 'danger', error: 'danger', rejected: 'danger', cancelled: 'danger',
  canceled: 'danger', shortage: 'danger', over: 'danger', blocked: 'danger',

  // info
  open: 'info', created: 'info', picking: 'info',
  'in_progress': 'info', sorting: 'info', packing: 'info', in_transit: 'info',
  transit: 'info', assigned: 'info', allocated: 'info', qc: 'info', inspecting: 'info',

  // accent
  picking_acc: 'accent', priority: 'accent', urgent: 'accent',
};

export default function StatusBadge({ status, tone, children, dataTestId = 'status-badge' }) {
  const key = String(status ?? children ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const resolved = tone || TONE[key] || 'neutral';

  return (
    <span
      className={`status-badge status-badge--${resolved}`}
      data-testid={dataTestId}
      data-status={key}
    >
      {children ?? status ?? 'Unknown'}
    </span>
  );
}
