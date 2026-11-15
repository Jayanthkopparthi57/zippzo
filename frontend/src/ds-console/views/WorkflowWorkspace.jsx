import React, { useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, Boxes, ClipboardCheck, PackageCheck, ShoppingBag, Truck } from 'lucide-react';
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
    description: 'Receive transfers into this store, complete quality checks, then put approved stock away. Products come in from the app.',
    steps: [
      { id: 'received', title: 'Received', icon: ArrowDownToLine },
      { id: 'quality', title: 'Q.C.', icon: ClipboardCheck },
      { id: 'putaway', title: 'Putaway', icon: Boxes },
    ],
  },
  inventory: {
    title: 'Inventory & stock',
    description: 'See physical stock and customer availability, then manage bin work and stock history.',
    steps: [
      { id: 'physical', title: 'Physical stock', icon: Boxes },
      { id: 'availability', title: 'Customer availability', icon: ShoppingBag },
      { id: 'storage', title: 'Bin operations', icon: ArrowRightLeft },
      { id: 'ledger', title: 'Stock ledger', icon: ClipboardCheck },
    ],
  },
  outbound: {
    title: 'Outbound fulfillment',
    description: 'Follow customer orders from the store ledger through picking, packing and rider handoff.',
    steps: [
      { id: 'orders', title: 'Order ledger', icon: ShoppingBag },
      { id: 'picking', title: 'Picking', icon: ArrowDownToLine },
      { id: 'packing', title: 'Packing', icon: PackageCheck },
      { id: 'handoff', title: 'Rider handoff', icon: Truck },
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
    if (step === 'storage') return <StorageOpsView initialTab="bin-transfers" />;
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

  return (
    <section className="workflow-workspace">
      <header className="workflow-workspace__header">
        <div>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
      </header>
      <nav className="workflow-workspace__steps" aria-label={`${config.title} steps`}>
        {config.steps.map(({ id, title, icon: Icon }, index) => (
          <button
            type="button"
            key={id}
            className={`workflow-workspace__step${activeStep === id ? ' active' : ''}`}
            aria-current={activeStep === id ? 'step' : undefined}
            onClick={() => setActiveStep(id)}
          >
            <span className="workflow-workspace__step-number">{index + 1}</span>
            <Icon size={15} aria-hidden="true" />
            <span>{title}</span>
          </button>
        ))}
      </nav>
      <div className="workflow-workspace__content">
        <WorkflowContent workflow={workflow} step={activeStep} site={site} />
      </div>
    </section>
  );
}
