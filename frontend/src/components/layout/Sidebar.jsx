import React from 'react';
import {
  LayoutDashboard, PackageCheck, ShieldCheck, Boxes, ArrowRightLeft,
  Layers, Barcode, ClipboardList, MapPin, Truck, Tag, Users, Building2,
  ListChecks, Send, Receipt, Package, PackagePlus, RefreshCw, Grid, Bike,
  Undo2, Search, ShoppingBasket, Bell, History
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useAuth } from '../../context/AuthContext';

export default function Sidebar({ collapsed }) {
  const { activeTabId, openTab } = useTabs();
  const { isDarkStore, user, appKey, appBrand } = useAuth();

  const adminSystemItems = user?.is_admin ? [
    { id: 'admin-settings', label: 'Admin & System Config', icon: ShieldCheck }
  ] : [];

  // Which menu this sidebar renders is decided by which application this
  // bundle is, not by the signed-in role. The store console is one app with two
  // menu sets (hub vs dark store) selected by the facility; the customer app is
  // a different bundle entirely and never imports the operator screens.
  const isShopper = appKey === 'shopper';

  const shopperSections = [
    {
      group: 'SHOPPING',
      items: [
        { id: 'shop-storefront', label: 'Order Groceries', icon: ShoppingBasket },
        { id: 'shop-orders', label: 'My Orders', icon: ClipboardList },
        { id: 'shop-notifications', label: 'Notifications', icon: Bell },
        { id: 'shop-account', label: 'Account & Address Book', icon: Users },
      ]
    },
  ];

  // Dark store screens are keyed `ds-*` rather than reusing the hub ids, so
  // the two menu sets can never silently shadow each other.
  const menuSections = isShopper ? shopperSections
    : isDarkStore ? [
    {
      group: 'STORE OPS',
      items: [
        { id: 'ds-dashboard', label: 'Command Center', icon: LayoutDashboard },
        { id: 'ds-shelf-inventory', label: 'Shelf Inventory', icon: Layers },
        { id: 'ds-ledger', label: 'Stock Ledger', icon: History },
        { id: 'ds-returns', label: 'Returns & Restock', icon: Undo2 },
      ]
    },
    {
      group: 'FULFILLMENT',
      items: [
{ id: 'ds-order-picking', label: 'Order Picking', icon: ClipboardList },
  { id: 'ds-order-packing', label: 'Packing', icon: PackageCheck },
  { id: 'ds-rider-handoff', label: 'Rider Handoff', icon: Bike },
      ]
    },
    {
      group: 'REPLENISHMENT',
      items: [
        { id: 'ds-lpn-receipt', label: 'Receive Totes', icon: PackageCheck },
        { id: 'ds-shelf-putaway', label: 'Shelf Putaway', icon: Boxes },
      ]
    },
    {
      group: 'SYSTEM',
      items: [
        { id: 'employee-roster', label: 'Staff & Shifts', icon: Users },
        { id: 'skus', label: 'Product Catalog', icon: Tag },
        ...adminSystemItems
      ]
    }
  ] : [
    {
      group: 'INBOUND',
      items: [
        { id: 'asns', label: 'Consignments', icon: PackageCheck },
        { id: 'qc-testing', label: 'QC Testing', icon: ShieldCheck },
        { id: 'putaway-tasks', label: 'Putaway Tasks', icon: Boxes },
      ]
    },
    {
      group: 'STORAGE',
      items: [
        { id: 'bin-contents', label: 'Bin Lookup', icon: Search },
        { id: 'inventory-lots', label: 'Inventory', icon: Layers },
        { id: 'transaction-log', label: 'Stock Movements', icon: ClipboardList },
        { id: 'storage-bins', label: 'Bins & Locations', icon: MapPin },
        { id: 'bin-transfer', label: 'Bin Transfer', icon: ArrowRightLeft },
      ]
    },
    {
      group: 'REPLENISHMENT',
      items: [
        { id: 'create-orders', label: 'Create Orders', icon: PackagePlus },
        { id: 'pick-execute', label: 'Pick Execution', icon: Barcode },
        { id: 'pack-seal', label: 'Pack & Seal', icon: Package },
        { id: 'transfer-orders', label: 'Transfer Orders', icon: ArrowRightLeft },
        { id: 'sorting-list', label: 'Sorting', icon: Grid },
      ]
    },
    {
      group: 'PACKING',
      items: [
        { id: 'packing', label: 'Packing (Batches)', icon: Package },
      ]
    },
    {
      group: 'OUTBOUND',
      items: [
        { id: 'batches', label: 'Batches & Waves', icon: ArrowRightLeft },
        { id: 'picklists', label: 'Picklists', icon: ListChecks },
        { id: 'dispatch-trips', label: 'Dispatch', icon: Truck },
      ]
    },
    {
      group: 'SHIPPING',
      items: [
        { id: 'manifests', label: 'Shipments & Manifests', icon: Receipt },
        { id: 'cross-dock', label: 'Cross-Dock Transfers', icon: Send },
      ]
    },
    {
      group: 'SYSTEM',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'employee-roster', label: 'Employee Shifts & Tasks', icon: Users },
        { id: 'sites-registry', label: 'Stores', icon: Building2 },
        { id: 'skus', label: 'SKU Catalog', icon: Tag },
        { id: 'vendors', label: 'Vendors', icon: Users },
        { id: 'active-trips', label: 'Fleet & Trips', icon: Truck },
        ...adminSystemItems
      ]
    }
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-badge">Z</div>
        {!collapsed && <span className="brand-title">{appBrand}</span>}
      </div>

      <div className="sidebar-content">
        {menuSections.map((sec, idx) => (
          <div key={idx} style={{ marginBottom: '12px' }}>
            {!collapsed && (
              <div className="nav-group-title">{sec.group}</div>
            )}
            {sec.items.map(item => {
              const IconComp = item.icon;
              const isActive = activeTabId === item.id;
              return (
                <div
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => openTab(item.id, item.label, item.icon.name)}
                  title={item.label}
                >
                  <IconComp size={16} style={{ minWidth: 16 }} />
                  {!collapsed && <span>{item.label}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
