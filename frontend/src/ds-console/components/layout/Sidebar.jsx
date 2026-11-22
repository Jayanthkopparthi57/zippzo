import React, { useState } from 'react';
import { useTabs } from '../../context/TabContext';
import { useAuth } from '../../../context/AuthContext';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Warehouse,
  Store,
  Search,
  ChevronRight,
  Bike,
  Undo2,
  ShieldCheck,
} from 'lucide-react';

const MENU_GROUPS = [
  {
    id: 'store-ops',
    title: 'Store Operations',
    icon: <Store size={15} style={{ color: '#0ea5e9' }} />,
    defaultOpen: true,
    items: [
      { id: 'ds-command-center', title: 'Dashboard', view: 'CommandCenterView', count: 'Live' },
      { id: 'ds-employee-tracking', title: 'Employee Tracking', view: 'EmployeeTrackingView' },
    ],
  },
  {
    id: 'inbound',
    title: 'Inbound Workflow',
    icon: <ArrowDownToLine size={15} />,
    defaultOpen: true,
    items: [
      { id: 'ds-inbound-workflow', title: 'Consignment → QC → Putaway', view: 'InboundWorkflowView' },
    ],
  },
  {
    id: 'outbound',
    title: 'Outbound Workflow',
    icon: <ArrowRightLeft size={15} />,
    defaultOpen: true,
    items: [
      { id: 'ds-outbound-workflow', title: 'Order → Pick → Handoff', view: 'OutboundWorkflowView' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory & Stock',
    icon: <Warehouse size={15} />,
    defaultOpen: true,
    items: [
      { id: 'ds-product-registration', title: 'Product Registration', view: 'ProductRegistrationView' },
      { id: 'ds-inventory-workflow', title: 'Stock & Bin Operations', view: 'InventoryWorkflowView' },
      { id: 'ds-pricing-offers', title: 'Pricing & Offers', view: 'PricingOffersView', adminOnly: true },
      { id: 'ds-stock-ledger', title: 'Stock Ledger', view: 'StockLedgerView' },
    ],
  },
  {
    id: 'returns',
    title: 'Returns & QC',
    icon: <Undo2 size={15} />,
    defaultOpen: false,
    items: [
      { id: 'ds-returns', title: 'Returns & QC', view: 'ReturnsView' },
      { id: 'ds-cancellation-putaway', title: 'Cancellation Putaway', view: 'CancellationPutawayView' },
    ],
  },
  {
    id: 'rider',
    title: 'Rider Fleet',
    icon: <Bike size={15} />,
    defaultOpen: false,
    items: [
      { id: 'ds-rider-fleet', title: 'Rider Fleet', view: 'RiderFleetView' },
    ],
  },
  {
    id: 'storage',
    title: 'Storage',
    icon: <Warehouse size={15} />,
    defaultOpen: false,
    items: [
      { id: 'ds-bins', title: 'Storage Bins', view: 'MasterDataView', initialTab: 'bins' },
      { id: 'ds-categories', title: 'Categories', view: 'MasterDataView', initialTab: 'categories' },
    ],
  },
  {
    id: 'admin',
    title: 'Operations Admin',
    icon: <ShieldCheck size={15} />,
    defaultOpen: false,
    items: [
      { id: 'ds-authentication', title: 'Authentication', view: 'AuthenticationView' },
      { id: 'ds-employee-register', title: 'Employee Register', view: 'EmployeeRegisterView' },
      { id: 'ds-notifications', title: 'Notifications', view: 'NotificationInboxView' },
      { id: 'ds-cash-register', title: 'Cash Register', view: 'CashRegisterView' },
      { id: 'ds-service-areas', title: 'Service Areas', view: 'ServiceAreasView' },
    ],
  },
];

export default function Sidebar({ collapsed }) {
  const { openTab, activeTabId } = useTabs();
  const { user } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  const [expandedGroups, setExpandedGroups] = useState({
    'store-ops': true,
    'inbound': true,
    'outbound': true,
    'inventory': true,
    'returns': false,
    'rider': false,
    'storage': false,
    'admin': false,
  });
  const [filterQuery, setFilterQuery] = useState('');

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="brand-badge">
          <img className="brand-icon" src="/zippzo-logo-192.png" alt="Zippzo" />
          {!collapsed && (
            <div>
              <div className="brand-name" style={{ color: '#c4b5fd' }}>ZIPPZO</div>
              <div className="brand-sub">DARK STORE v2.4</div>
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
              aria-label="Search Darkstore modules"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
          </div>
        </div>
      )}

      <div className="sidebar-menu">
        {MENU_GROUPS.map(group => {
          const isOpen = expandedGroups[group.id] || Boolean(filterQuery);
          const roleAllowed = (item) => {
            if (item.adminOnly || ['admin', 'storage'].includes(group.id)) return Boolean(user?.is_admin);
            if (role.includes('INBOUND') || role.includes('RECEIV')) return ['inbound', 'inventory'].includes(group.id);
            if (role.includes('PICK') || role.includes('FULFIL')) return ['outbound', 'returns'].includes(group.id);
            if (role.includes('RIDER') || role.includes('DELIVERY')) return group.id === 'rider';
            return true;
          };
          const visibleItems = group.items.filter((item) =>
            roleAllowed(item) &&
            (!item.adminOnly || user?.is_admin) &&
            (!filterQuery || item.title.toLowerCase().includes(filterQuery.toLowerCase()))
          );

          if (filterQuery && visibleItems.length === 0) return null;

          return (
            <div key={group.id} className="accordion-group">
              <div
                className="accordion-header"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleGroup(group.id);
                  }
                }}
                title={group.title}
              >
                <div className="accordion-title">
                  <span className="accordion-icon">{group.icon}</span>
                  {!collapsed && <span>{group.title}</span>}
                </div>
                {!collapsed && (
                  <span className={`accordion-caret ${isOpen ? 'open' : ''}`}>
                    <ChevronRight size={13} />
                  </span>
                )}
              </div>

              {isOpen && !collapsed && (
                <div className="accordion-children">
                  {visibleItems.map(item => {
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
                              initialSubtab: item.initialSubtab,
                              initialTab: item.initialTab,
                            });
                          }
                        }}
                        onClick={() => openTab({
                          id: item.id,
                          title: item.title,
                          view: item.view,
                          initialSubtab: item.initialSubtab,
                          initialTab: item.initialTab,
                        })}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            background: isActive ? 'var(--c-teal)' : 'var(--border-mid)'
                          }}></span>
                          <span>{item.title}</span>
                        </div>
                        {item.count != null && (
                          <span className="subnav-count">{item.count}</span>
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
