import React from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowRightLeft, Boxes, ClipboardCheck,
  ClipboardList, ScanLine, Send, Warehouse, Truck, Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTabs } from '../context/TabContext';

const WAREHOUSE_STEPS = [
  {
    step: '01', title: 'Receive supplier stock', detail: 'Check expected deliveries and scan items into receiving.',
    tab: 'asns', label: 'Receipts & consignments', icon: ArrowDownToLine,
  },
  {
    step: '02', title: 'Inspect received stock', detail: 'Pass, hold, or reject quantities before storage.',
    tab: 'qc-testing', label: 'Quality checks', icon: ClipboardCheck,
  },
  {
    step: '03', title: 'Put stock away', detail: 'Scan the unit and destination bin to confirm its location.',
    tab: 'putaway-tasks', label: 'Putaway tasks', icon: Boxes,
  },
  {
    step: '04', title: 'Move stock between bins', detail: 'Scan the source, each item, and the destination bin.',
    tab: 'bin-transfer', label: 'Bin transfers', icon: ArrowRightLeft,
  },
  {
    step: '05', title: 'Replenish a store', detail: 'Build, pick, pack, and dispatch a store transfer.',
    tab: 'create-orders', label: 'Replenishment orders', icon: Send,
  },
  {
    step: '06', title: 'Dispatch outbound', detail: 'Work pick waves, shipments, manifests, and trips.',
    tab: 'dispatch-trips', label: 'Dispatch & trips', icon: Truck,
  },
];

function FlowStep({ item, onOpen }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className="ops-flow-step"
      onClick={() => onOpen(item)}
      data-testid={`ops-flow-${item.tab}`}
    >
      <span className="ops-flow-step__number">{item.step}</span>
      <span className="ops-flow-step__icon"><Icon size={17} /></span>
      <span className="ops-flow-step__copy">
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </span>
      <ArrowRight size={16} className="ops-flow-step__arrow" />
    </button>
  );
}

export default function OperationsHomeView() {
  const { facility, user } = useAuth();
  const { openTab } = useTabs();
  const steps = WAREHOUSE_STEPS;
  const facilityType = 'Warehouse';

  const open = (item) => openTab(item.tab, item.label, 'Boxes');

  const quickLinks = [
    { id: 'inventory-lots', label: 'Inventory & lots', hint: 'Balances by SKU, lot, and location', icon: Boxes },
    { id: 'bin-lookup', label: 'Find a bin', hint: 'Scan or search a storage location', icon: ScanLine },
    { id: 'employee-roster', label: 'Staff & assignments', hint: 'See shifts and assign operational work', icon: Users },
    { id: 'transaction-log', label: 'Stock movement history', hint: 'Trace a movement back to its task', icon: ClipboardList },
  ];

  return (
    <div className="ops-home" data-testid="operations-home">
      <div className="ops-home__intro">
        <div>
          <div className="ops-home__eyebrow"><ScanLine size={14} /> STOCK OPERATIONS</div>
          <h1>Work starts here</h1>
          <p>Follow the stock from receipt to its next destination. Each step opens the live work queue.</p>
        </div>
        <div className="ops-home__facility" data-testid="operations-home-facility">
          <Warehouse size={17} />
          <span>
            <small>WORKING AT</small>
            <strong>{facility?.name || facility?.code || 'Select a facility'}</strong>
            <small>{facility?.code ? `${facilityType} · ${facility.code}` : 'Choose a facility in the top bar'}</small>
          </span>
        </div>
      </div>

      <section className="ops-home__section" aria-labelledby="ops-flow-title">
        <div className="ops-home__section-heading">
          <div>
            <span className="ops-home__eyebrow">WAREHOUSE FLOW</span>
            <h2 id="ops-flow-title">From supplier receipt to store dispatch</h2>
          </div>
          <span className="ops-home__scan-note"><ScanLine size={14} /> Scan at each physical handoff</span>
        </div>
        <div className="ops-flow-list">
          {steps.map((item) => <FlowStep key={item.tab} item={item} onOpen={open} />)}
        </div>
      </section>

      <section className="ops-home__support" aria-label="Other operations">
        <div className="ops-home__support-heading">
          <div>
            <span className="ops-home__eyebrow">SUPPORTING TOOLS</span>
            <h2>Look up, move, and assign</h2>
          </div>
        </div>
        <div className="ops-home__quick-links">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button
                type="button"
                className="ops-quick-link"
                key={link.id}
                onClick={() => openTab(link.id, link.label, 'Boxes')}
              >
                <Icon size={17} />
                <span><strong>{link.label}</strong><small>{link.hint}</small></span>
                <ArrowRight size={15} />
              </button>
            );
          })}
        </div>
      </section>

      <footer className="ops-home__footer">
        <ClipboardCheck size={15} />
        <span>Signed in as {user?.name || 'operator'}. Stock updates are recorded when the task is confirmed.</span>
      </footer>
    </div>
  );
}
