import React, { useState } from 'react';
import {
  ArrowDownToLine, ArrowRightLeft, Boxes, ClipboardCheck, PackageCheck, ShoppingBag, Truck,
} from 'lucide-react';
import OrdersView from '../../views/darkstore/OrdersView';
import OrderPickingView from '../../views/darkstore/OrderPickingView';
import OrderPackingView from '../../views/darkstore/OrderPackingView';
import RiderHandoffView from '../../views/darkstore/RiderHandoffView';
import QcInspectionView from '../../views/darkstore/QcInspectionView';
import StorageOpsView from '../../views/darkstore/StorageOpsView';
import StockLedgerView from '../../views/darkstore/StockLedgerView';
import PutawayView from '../../views/inbound/PutawayView';
import InboundView from '../../wms-console/views/inbound/InboundView';
import LotsView from '../../wms-console/views/inventory/LotsView';

const WORKFLOWS = {
  inbound: {
    title: 'Inbound workflow',
    description: 'Receive transfers, inspect them, then put approved stock on the shelf.',
    steps: [
      { id: 'received', title: 'Received', icon: ArrowDownToLine,
        detail: 'Scan or open an incoming tote and confirm it arrived at this store.' },
      { id: 'quality', title: 'Q.C.', icon: ClipboardCheck,
        detail: 'Accept or reject each line against its purchase and batch details.' },
      { id: 'putaway', title: 'Putaway', icon: Boxes,
        detail: 'Place accepted units into a sellable bin so customers can order them.' },
    ],
  },
  inventory: {
    title: 'Stock & bin operations',
    description: 'One place to count stock, manage bins, and trace every movement.',
    steps: [
      { id: 'physical', title: 'Physical stock', icon: Boxes,
        detail: 'What is actually on the shelves, by SKU, batch and bin.' },
      { id: 'availability', title: 'Customer availability', icon: ShoppingBag,
        detail: 'What shoppers can order at this store right now.' },
      { id: 'storage', title: 'Bin operations', icon: ArrowRightLeft,
        detail: 'Register bins, print QR labels, and inspect what each bin holds.' },
      { id: 'ledger', title: 'Stock ledger', icon: ClipboardCheck,
        detail: 'Trace every balance change and catch bags waiting too long at staging.' },
    ],
  },
  outbound: {
    title: 'Outbound fulfillment',
    description: 'Follow customer orders from the ledger to the rider’s hand.',
    steps: [
      { id: 'orders', title: 'Order ledger', icon: ShoppingBag,
        detail: 'Find the orders that need work and open the right queue.' },
      { id: 'picking', title: 'Picking', icon: ArrowDownToLine,
        detail: 'Pick each unit from its bin and complete the pick.' },
      { id: 'packing', title: 'Packing', icon: PackageCheck,
        detail: 'Stage the picked bag at a slot; the rider job is raised automatically.' },
      { id: 'handoff', title: 'Rider handoff', icon: Truck,
        detail: 'Confirm collection and close the order with the customer’s code.' },
    ],
  },
};

function WorkflowContent({ workflow, step, site }) {
  if (workflow === 'inbound') {
    if (step === 'quality') return <QcInspectionView />;
    if (step === 'putaway') return <PutawayView siteId={site?.site_id || ''} darkStoreMode />;
    return (
      <InboundView
        initialSubtab="received"
        darkStoreSiteId={site?.site_id || ''}
        darkStoreMode
      />
    );
  }

  if (workflow === 'inventory') {
    if (step === 'physical') {
      return <LotsView initialTab="inventory-lots" siteId={site?.site_id || ''} siteCode={site?.code || ''} darkStoreMode />;
    }
    if (step === 'availability') {
      return <LotsView initialTab="customer-availability" siteId={site?.site_id || ''} siteCode={site?.code || ''} darkStoreMode />;
    }
    if (step === 'storage') return <StorageOpsView initialTab="locations" />;
    return <StockLedgerView />;
  }

  if (step === 'orders') return <OrdersView />;
  if (step === 'picking') return <OrderPickingView />;
  if (step === 'packing') return <OrderPackingView />;
  return <RiderHandoffView />;
}

export default function WorkflowWorkspace({ workflow, site }) {
  const config = WORKFLOWS[workflow];
  const [activeStep, setActiveStep] = useState(config.steps[0].id);
  const activeIndex = Math.max(0, config.steps.findIndex((step) => step.id === activeStep));
  const current = config.steps[activeIndex];

  return (
    <section className="workflow-workspace">
      <header className="workflow-workspace__header">
        <div>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <span className="workflow-workspace__store">
          {site?.code || 'STORE'} · {site?.name || 'Select a facility'}
        </span>
      </header>

      <nav className="workflow-workspace__steps" aria-label={`${config.title} steps`}>
        {config.steps.map(({ id, title, icon: Icon }, index) => (
          <React.Fragment key={id}>
            <button
              type="button"
              className={`workflow-workspace__step${activeStep === id ? ' active' : ''}${index < activeIndex ? ' done' : ''}`}
              aria-current={activeStep === id ? 'step' : undefined}
              onClick={() => setActiveStep(id)}
            >
              <span className="workflow-workspace__step-number">
                {index < activeIndex ? '✓' : index + 1}
              </span>
              <Icon size={15} aria-hidden="true" />
              <span>{title}</span>
            </button>
            {index < config.steps.length - 1 && (
              <span className="workflow-workspace__connector" aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </nav>

      <div className="workflow-workspace__context" aria-live="polite">
        <span className="workflow-workspace__context-step">
          Step {activeIndex + 1} of {config.steps.length}
        </span>
        <span className="workflow-workspace__context-title">{current.title}</span>
        <span className="workflow-workspace__context-detail">{current.detail}</span>
      </div>

      <div className="workflow-workspace__content">
        <WorkflowContent workflow={workflow} step={activeStep} site={site} />
      </div>
    </section>
  );
}
