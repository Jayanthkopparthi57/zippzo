import React, { useState } from 'react';
import {
  ClipboardCheck,
  MapPin,
  Boxes,
  ArrowRightLeft,
  LayoutDashboard,
  ShoppingCart,
  PackageCheck,
  Package,
  Bike,
  Layers,
  Archive,
  Undo2,
  Receipt,
  CircleDollarSign,
  ScrollText,
  Bell,
  Users2,
  ChevronRight,
  Store,
  Search,
  ShieldCheck,
  Settings2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTabs } from '../../wms-console/context/TabContext';

const DARK_STORE_MENU_GROUPS = [
  {
    id: 'ds-core',
    title: 'Outbound · Customer Orders',
    icon: <Store size={15} />,
    defaultOpen: true,
    items: [
      { id: 'ds-command-center', title: 'Command Center', view: 'CommandCenterView', icon: <LayoutDashboard size={14} /> },
      { id: 'ds-orders',         title: 'Orders Queue',   view: 'OrdersView', icon: <ShoppingCart size={14} />, badge: 'LIVE' },
      { id: 'ds-picking',        title: 'Order Picking',  view: 'OrderPickingView', icon: <PackageCheck size={14} /> },
      { id: 'ds-packing',        title: 'Order Packing',  view: 'OrderPackingView', icon: <Package size={14} /> },
      { id: 'ds-rider-handoff',  title: 'Rider Handoff',  view: 'RiderHandoffView', icon: <Bike size={14} /> },
    ],
  },
  {
    id: 'ds-inventory',
    title: 'Inbound · Store Stock',
    icon: <Layers size={15} />,
    defaultOpen: true,
    items: [
      { id: 'ds-lpn-receipt',     title: 'LPN Receipt',     view: 'LpnReceiptView', icon: <Receipt size={14} /> },
      { id: 'ds-shelf-putaway',   title: 'Shelf Put-Away',  view: 'ShelfPutawayView', icon: <Layers size={14} /> },
      { id: 'ds-shelf-inventory', title: 'Shelf Inventory', view: 'ShelfInventoryView', icon: <Archive size={14} /> },
      { id: 'ds-qc-inspection', title: 'QC Inspection', view: 'QcInspectionView', icon: <ClipboardCheck size={14} /> },
      { id: 'ds-cancellation-putaway', title: 'Cancellation Putaway', view: 'CancellationPutawayView', icon: <Undo2 size={14} /> },
      { id: 'ds-storage-locations', title: 'Storage Locations', view: 'StorageOpsView', icon: <MapPin size={14} /> },
      { id: 'ds-bin-transfers', title: 'Bin Transfers', view: 'StorageOpsView', icon: <ArrowRightLeft size={14} /> },
      { id: 'ds-replenishment', title: 'Replenishment', view: 'StorageOpsView', icon: <Boxes size={14} /> },
      { id: 'ds-cycle-counts', title: 'Cycle Counts', view: 'StorageOpsView', icon: <ClipboardCheck size={14} /> },
      { id: 'ds-employee-tracking', title: 'Employee Tracking', view: 'EmployeeTrackingView', icon: <Users2 size={14} /> },
    ],
  },
  {
    id: 'ds-admin',
    title: 'Store control',
    icon: <CircleDollarSign size={15} />,
    defaultOpen: false,
    items: [
      { id: 'ds-notifications', title: 'Notifications', view: 'NotificationInboxView', icon: <Bell size={14} /> },
      { id: 'ds-cash-register', title: 'Cash Register', view: 'CashRegisterView', icon: <CircleDollarSign size={14} /> },
      { id: 'ds-stock-ledger',  title: 'Stock Ledger', view: 'StockLedgerView', icon: <ScrollText size={14} /> },
      { id: 'ds-returns',       title: 'Returns & QC', view: 'ReturnsView', icon: <Undo2 size={14} /> },
      { id: 'ds-rider-fleet',   title: 'Rider Fleet', view: 'RiderFleetView', icon: <Users2 size={14} /> },
    ],
  },
  {
    id: 'ds-administration',
    title: 'Administration',
    icon: <ShieldCheck size={15} />,
    defaultOpen: false,
    adminOnly: true,
    items: [
      { id: 'ds-admin-config', title: 'Admin & access', view: 'AdminSettingsView', icon: <Settings2 size={14} /> },
    ],
  },
];

const FLOOR_TAB_IDS = new Set([
  'ds-command-center', 'ds-picking', 'ds-packing', 'ds-rider-handoff',
  'ds-lpn-receipt', 'ds-shelf-putaway', 'ds-returns', 'ds-notifications',
  'ds-storage-locations', 'ds-replenishment', 'ds-qc-inspection',
]);

export default function DarkStoreSidebar({ collapsed, onNavigate, isFloorApp = false }) {
  const { user } = useAuth();
  const { activeTabId, openTab } = useTabs();
  const [expandedGroups, setExpandedGroups] = useState({
    'ds-core': true,
    'ds-inventory': true,
    'ds-admin': false,
    'ds-administration': false,
  });
  const [filterQuery, setFilterQuery] = useState('');

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-icon">Z</div>
          {!collapsed && (
            <div>
              <div className="brand-name">ZIPPZO</div>
              <div className="brand-sub">DARK STORE CORE v2.4</div>
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="sidebar-search-box">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search module..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              aria-label="Search Darkstore modules"
            />
            <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
          </div>
        </div>
      )}

      <div className="sidebar-menu">
        {DARK_STORE_MENU_GROUPS.filter((group) => !group.adminOnly || user?.is_admin).map((group) => {
          const isExpanded = expandedGroups[group.id] || Boolean(filterQuery);
          const visibleItems = group.items.filter((item) =>
            (!isFloorApp || FLOOR_TAB_IDS.has(item.id)) &&
            (!filterQuery || item.title.toLowerCase().includes(filterQuery.toLowerCase()))
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.id} className="accordion-group">
              <div
                className="accordion-header"
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(group.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleGroup(group.id);
                  }
                }}
                title={group.title}
                aria-expanded={isExpanded}
              >
                <span className="accordion-title">
                  <span className="accordion-icon">{group.icon}</span>
                  {!collapsed && <span>{group.title}</span>}
                </span>
                {!collapsed && (
                  <span className={`accordion-caret ${isExpanded ? 'open' : ''}`}>
                    <ChevronRight size={13} />
                  </span>
                )}
              </div>

              {isExpanded && !collapsed && (
                <div className="accordion-children">
                  {visibleItems.map((item) => {
                    const isActive = activeTabId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`subnav-item ${isActive ? 'active' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-current={isActive ? 'page' : undefined}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openTab({
                              id: item.id,
                              title: item.title,
                              view: item.view,
                            });
                            onNavigate?.();
                          }
                        }}
                        onClick={() => {
                          openTab({
                            id: item.id,
                            title: item.title,
                            view: item.view,
                          });
                          onNavigate?.();
                        }}
                      >
                        <span>{item.title}</span>
                        {item.badge && (
                          <span className="subnav-count">{item.badge}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
