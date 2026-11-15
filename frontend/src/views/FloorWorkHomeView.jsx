import React from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowRightLeft, Boxes, ClipboardCheck,
  ClipboardList, ScanLine, Send, Truck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTabs } from '../context/TabContext';

const WAREHOUSE_WORK = [
  { id: 'asns', title: 'Receive stock', detail: 'Open an expected receipt and scan cartons or items.', icon: ArrowDownToLine },
  { id: 'qc-testing', title: 'Inspect stock', detail: 'Record pass, hold, or reject for received units.', icon: ClipboardCheck },
  { id: 'putaway-tasks', title: 'Put stock away', detail: 'Scan a handling unit and its destination bin.', icon: Boxes },
  { id: 'bin-transfer', title: 'Move between bins', detail: 'Scan source, item, quantity, then destination.', icon: ArrowRightLeft },
  { id: 'pick-execute', title: 'Pick a replenishment transfer', detail: 'Complete the assigned warehouse pick task.', icon: Send },
  { id: 'pack-seal', title: 'Pack and seal a transfer', detail: 'Verify picked goods and seal the assigned tote.', icon: ClipboardList },
  { id: 'dispatch-trips', title: 'Dispatch transfer', detail: 'Verify the load and confirm handoff at the dock.', icon: Truck },
];

/** A floor-first landing screen. Every action opens the real server-backed workflow. */
export default function FloorWorkHomeView() {
  const { facility, user } = useAuth();
  const { openTab } = useTabs();
  const jobs = WAREHOUSE_WORK;

  return (
    <main className="floor-home" data-testid="floor-work-home">
      <header className="floor-home__header">
        <div className="floor-home__eyebrow"><ScanLine size={15} /> FLOOR WORK</div>
        <h1>What are you working on?</h1>
        <p>{user?.name || 'Operator'} · {facility?.name || facility?.code || 'Select a facility'}</p>
        <div className="floor-home__rule">Scan inside a task. Stock changes only after the server confirms the action.</div>
      </header>

      <section className="floor-home__jobs" aria-label="Operational workflows">
        {jobs.map(({ id, title, detail, icon: Icon }) => (
          <button
            type="button"
            className="floor-home__job"
            key={id}
            data-testid={`floor-job-${id}`}
            onClick={() => openTab(id, title, 'ScanLine')}
          >
            <span className="floor-home__job-icon"><Icon size={21} /></span>
            <span className="floor-home__job-copy"><strong>{title}</strong><small>{detail}</small></span>
            <ArrowRight size={18} />
          </button>
        ))}
      </section>
    </main>
  );
}
