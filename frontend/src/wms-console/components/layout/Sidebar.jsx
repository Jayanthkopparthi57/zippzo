import React, { useEffect, useState } from 'react';
import { useTabs } from '../../context/TabContext';
import { useAuth } from '../../../context/AuthContext';
import { apiClient } from '../../api/client';
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

// Live badge counts are read from the list endpoint each module actually
// renders, so a badge can never contradict the screen it opens. A failed read
// leaves the badge off instead of showing a stale literal.
const COUNT_ENDPOINTS = {
  'inbound-asns': '/supply/asns/',
  'inbound-grns': '/supply/grns/',
  'inbound-qc': '/supply/qc-inspections/',
  'inbound-putaway': '/supply/putaway-tasks/',
  'inbound-discrepancies': '/supply/dock-discrepancies/',
  sto: '/inventory/lpns/',
  'transfer-orders': '/ds-ops/transfer-orders/',
  batches: '/fulfilment/batches/',
  picklists: '/ds-ops/pick-tasks/picklists/',
  'dispatch-plan': '/transport/dispatch-plans/',
  manifests: '/transport/manifests/',
  'totes-lpns': '/inventory/lpns/',
  'vehicle-assign': '/master/vehicles/',
  'vehicle-checkin': '/master/vehicle-checkins/',
  'active-trips': '/transport/trips/',
  'all-trips': '/transport/trips/',
  'inventory-lots': '/catalog/lots/',
  sites: '/network/sites/',
  zones: '/network/zones/',
  bins: '/network/locations/',
  'dock-doors': '/network/dock-doors/',
  'cluster-zones': '/master/cluster-zones/',
  'vehicle-types': '/network/vehicle-types/',
  skus: '/catalog/skus/',
  categories: '/catalog/categories/',
  vendors: '/supply/vendors/',
  transporters: '/master/carriers/',
  users: '/iam/users/',
  'reason-codes': '/master/reason-codes/',
};

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
      { id: 'inbound-asns', title: 'ASNs (Advance Shipping)', view: 'InboundView', initialSubtab: 'asns' },
      { id: 'inbound-grns', title: 'Inwarding & GRN', view: 'InboundView', initialSubtab: 'grns' },
      { id: 'inbound-qc', title: 'QC Inspections', view: 'InboundView', initialSubtab: 'qc' },
      { id: 'inbound-putaway', title: 'Putaway Tasks', view: 'InboundView', initialSubtab: 'putaway' },
      { id: 'inbound-discrepancies', title: 'Dock Discrepancies', view: 'InboundView', initialSubtab: 'discrepancies' },
    ],
  },
  {
    id: 'outbound',
    title: 'Outbound',
    icon: <ArrowRightLeft size={15} />,
    defaultOpen: true,
    items: [
      { id: 'sto', title: 'STO', view: 'StoView' },
      { id: 'transfer-orders', title: 'Transfer Orders', view: 'StoView' },
    ],
  },
  {
    id: 'outbound-process',
    title: 'Outbound Process',
    icon: <Layers size={15} />,
    defaultOpen: false,
    items: [
      { id: 'batches', title: 'Batches', view: 'PicklistView' },
      { id: 'picklists', title: 'Picklists', view: 'PicklistView' },
      { id: 'sorting-list', title: 'Sorting List', view: 'PicklistView' },
      { id: 'dispatch-plan', title: 'Dispatch Plan', view: 'DispatchPlanView' },
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
      { id: 'vehicle-assign', title: 'Vehicle Assignment', view: 'VehicleAssignmentView' },
      { id: 'vehicle-checkin', title: 'Vehicle Check In', view: 'ActiveTripsView' },
      { id: 'active-trips', title: 'Active Trips', view: 'ActiveTripsView' },
      { id: 'all-trips', title: 'All Trips', view: 'ActiveTripsView' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: <Warehouse size={15} />,
    defaultOpen: false,
    items: [
      { id: 'inventory-lots', title: 'Inventory Lots', view: 'LotsView' },
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
      { id: 'skus', title: 'SKUs', view: 'MasterDataView' },
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
  const { user } = useAuth();
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
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(COUNT_ENDPOINTS);
    Promise.allSettled(
      entries.map(([, path]) => apiClient.get(path, { page_size: 200 }))
    ).then((results) => {
      if (cancelled) return;
      const next = {};
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        const payload = result.value;
        const total = typeof payload?.count === 'number'
          ? payload.count
          : Array.isArray(payload?.results)
            ? payload.results.length
            : Array.isArray(payload)
              ? payload.length
              : null;
        if (total != null) next[entries[index][0]] = total;
      });
      setCounts(next);
    });
    return () => { cancelled = true; };
  }, []);

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <img src="/zippzo-logo-192.png" alt="Zippzo" className="brand-icon" />
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
        {MENU_GROUPS.filter(group => {
          if (user?.is_admin) return true;
          const role = String(user?.role || '').toUpperCase();
          if (role === 'WAREHOUSE_STAFF') return ['inbound', 'inventory'].includes(group.id);
          if (role.includes('INBOUND') || role.includes('RECEIV')) return group.id === 'inbound';
          if (role.includes('PICK') || role.includes('FULFIL')) return ['outbound', 'outbound-process'].includes(group.id);
          if (role.includes('TRANSPORT') || role.includes('FLEET')) return group.id === 'linehaul';
          return true;
        }).map(group => {
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
                        {item.count == null && counts[item.id] != null && (
                          <span className="subnav-count">{counts[item.id]}</span>
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
