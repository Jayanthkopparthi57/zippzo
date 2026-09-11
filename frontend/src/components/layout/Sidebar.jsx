import React, { useState } from 'react';
import { useTabs } from '../../context/TabContext';
import {
  BarChart3,
  ArrowDownToLine,
  ArrowRightLeft,
  Layers,
  Truck,
  Warehouse,
  Store,
  Settings2,
  BookOpen,
  Users2,
  Search,
  ChevronRight,
} from 'lucide-react';

const MENU_GROUPS = [
  {
    id: 'store-ops',
    title: 'Store Operations',
    icon: <Store size={15} style={{ color: '#2563eb' }} />,
    defaultOpen: true,
    items: [
      { id: 'store-management', title: 'Store Management', view: 'StoreManagementView', count: 'Spoke' },
      { id: 'man-power', title: 'Man Power', view: 'ManPowerView' },
    ],
  },
  {
    id: 'metrics',
    title: 'Metrics',
    icon: <BarChart3 size={15} />,
    defaultOpen: true,
    items: [
      { id: 'metrics-dashboard', title: 'Dashboard', view: 'DashboardView' },
    ],
  },
  {
    id: 'inbound',
    title: 'Inbound',
    icon: <ArrowDownToLine size={15} />,
    defaultOpen: true,
    items: [
      { id: 'inbound-asns', title: 'ASNs (Advance Shipping)', view: 'InboundView', initialSubtab: 'asns', count: 7 },
      { id: 'inbound-grns', title: 'Inwarding & GRN', view: 'InboundView', initialSubtab: 'grns', count: 4 },
      { id: 'inbound-putaway', title: 'Putaway Tasks', view: 'InboundView', initialSubtab: 'putaway', count: 6 },
      { id: 'inbound-discrepancies', title: 'Dock Discrepancies', view: 'InboundView', initialSubtab: 'discrepancies', count: 6 },
    ],
  },
  {
    id: 'outbound',
    title: 'Outbound',
    icon: <ArrowRightLeft size={15} />,
    defaultOpen: true,
    items: [
      { id: 'sto', title: 'STO', view: 'StoView', count: 20 },
      { id: 'transfer-orders', title: 'Transfer Orders', view: 'StoView' },
      { id: 'returns', title: 'Returns', view: 'StoView' },
      { id: 'cancellation-putaway', title: 'Cancellation Putaway', view: 'StoView' },
    ],
  },
  {
    id: 'outbound-process',
    title: 'Outbound Process',
    icon: <Layers size={15} />,
    defaultOpen: false,
    items: [
      { id: 'batches', title: 'Batches', view: 'PicklistView', count: 5 },
      { id: 'picklists', title: 'Picklists', view: 'PicklistView', count: 5 },
      { id: 'sorting-list', title: 'Sorting List', view: 'PicklistView' },
      { id: 'dispatch-plan', title: 'Dispatch Plan', view: 'DispatchPlanView', count: 3 },
      { id: 'manifests', title: 'Manifests', view: 'DispatchPlanView' },
      { id: 'totes-lpns', title: 'Totes / LPNs', view: 'DispatchPlanView' },
      { id: 'cross-dock', title: 'Cross Dock', view: 'InboundView', initialSubtab: 'asns' },
    ],
  },
  {
    id: 'linehaul',
    title: 'Linehaul',
    icon: <Truck size={15} />,
    defaultOpen: true,
    items: [
      { id: 'vehicle-assign', title: 'Vehicle Assignment', view: 'VehicleAssignmentView', count: 15 },
      { id: 'vehicle-checkin', title: 'Vehicle Check In', view: 'ActiveTripsView' },
      { id: 'active-trips', title: 'Active Trips', view: 'ActiveTripsView', count: 15 },
      { id: 'all-trips', title: 'All Trips', view: 'ActiveTripsView' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: <Warehouse size={15} />,
    defaultOpen: false,
    items: [
      { id: 'inventory-lots', title: 'Inventory Lots', view: 'LotsView', count: 90 },
      { id: 'transactions', title: 'Transaction Log', view: 'LotsView' },
      { id: 'droplists', title: 'Droplists (Movement)', view: 'LotsView' },
      { id: 'cycle-counts', title: 'Cycle Counts', view: 'LotsView' },
      { id: 'replenishment', title: 'Replenishment', view: 'LotsView' },
    ],
  },
  {
    id: 'mh-configs',
    title: 'MH Configs',
    icon: <Settings2 size={15} />,
    defaultOpen: false,
    items: [
      { id: 'sites', title: 'Sites Registry', view: 'MasterDataView' },
      { id: 'zones', title: 'Zones', view: 'MasterDataView' },
      { id: 'bins', title: 'Storage Bins', view: 'MasterDataView' },
      { id: 'dock-doors', title: 'Dock Doors', view: 'MasterDataView' },
      { id: 'cluster-zones', title: 'Cluster Zones', view: 'MasterDataView' },
      { id: 'vehicle-types', title: 'Vehicle Types', view: 'MasterDataView' },
    ],
  },
  {
    id: 'catalog',
    title: 'Catalog',
    icon: <BookOpen size={15} />,
    defaultOpen: false,
    items: [
      { id: 'skus', title: 'SKUs', view: 'MasterDataView', count: 15 },
      { id: 'categories', title: 'Categories', view: 'MasterDataView' },
      { id: 'vendors', title: 'Vendors', view: 'MasterDataView' },
      { id: 'transporters', title: 'Transporters', view: 'MasterDataView' },
    ],
  },
  {
    id: 'user-management',
    title: 'User Management',
    icon: <Users2 size={15} />,
    defaultOpen: false,
    items: [
      { id: 'users', title: 'Users & Roles', view: 'MasterDataView' },
      { id: 'reason-codes', title: 'Reason Codes', view: 'MasterDataView' },
    ],
  },
];

export default function Sidebar({ collapsed }) {
  const { openTab, activeTabId } = useTabs();
  const [expandedGroups, setExpandedGroups] = useState({
    metrics: true,
    inbound: true,
    outbound: true,
    'outbound-process': false,
    linehaul: true,
    inventory: false,
    'mh-configs': false,
    catalog: false,
    'user-management': false,
  });
  const [filterQuery, setFilterQuery] = useState('');

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-icon">Z</div>
          {!collapsed && (
            <div>
              <div className="brand-name">ZIPPZO</div>
              <div className="brand-sub">WMS CORE v2.4</div>
            </div>
          )}
        </div>
      </div>

      {/* Search Input */}
      {!collapsed && (
        <div className="sidebar-search-box">
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search module..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
          </div>
        </div>
      )}

      {/* Accordion Menu */}
      <div className="sidebar-menu">
        {MENU_GROUPS.map(group => {
          const isOpen = expandedGroups[group.id] || Boolean(filterQuery);
          const visibleItems = filterQuery
            ? group.items.filter(item => item.title.toLowerCase().includes(filterQuery.toLowerCase()))
            : group.items;

          if (filterQuery && visibleItems.length === 0) return null;

          return (
            <div key={group.id} className="accordion-group">
              <div
                className="accordion-header"
                onClick={() => toggleGroup(group.id)}
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
                        onClick={() => openTab({
                          id: item.id,
                          title: item.title,
                          view: item.view,
                          initialSubtab: item.initialSubtab
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
