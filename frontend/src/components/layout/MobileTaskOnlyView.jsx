import React from 'react';
import { Smartphone } from 'lucide-react';

/** Physical stock work belongs to the assigned facility's floor app. */
export default function MobileTaskOnlyView() {
  return (
    <section className="page-container" data-testid="mobile-task-only">
      <div className="page-header">
        <div>
          <h1>Complete this task in the operations app</h1>
          <p>Receiving, scanning, putaway, picking, packing, transfers, counts and handoffs change physical stock. Open the assigned warehouse or dark-store app to perform this work.</p>
        </div>
      </div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 22 }}>
        <Smartphone size={24} aria-hidden="true" />
        <div><strong>Stock movement is app-only</strong><div style={{ marginTop: 5, color: 'var(--text-secondary)' }}>The web console is for planning, orders, workforce, setup, oversight and audit.</div></div>
      </div>
    </section>
  );
}
