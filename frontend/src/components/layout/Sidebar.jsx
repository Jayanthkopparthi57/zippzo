import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, PackageCheck, Boxes, AlertTriangle,
  ClipboardList, Truck, Tag, Users, Building2,
  ListChecks, Send, Receipt, Package, Grid,
  Search, Bell, ChevronDown, ChevronRight,
  Activity, MapPin, ArrowRightLeft, Settings, Database,
  UserCheck, ShoppingBag, Route, ShieldCheck,
} from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useAuth } from '../../context/AuthContext';
import { fetchApi } from '../../api/client';

/* ─── NAV STRUCTURE (matches Zepto WMS production screenshots) ─── */
const WMS_NAV = [
  {
    group: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Operations overview', icon: LayoutDashboard },
      { id: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    group: 'Inbound',
    collapsible: true,
    items: [
      { id: 'inbound-asns', label: 'Inbound shipments', icon: PackageCheck },
      { id: 'inwarding-grn', label: 'Receipts & GRN', icon: ClipboardList },
      { id: 'putaway-tasks', label: 'Putaway Tasks', icon: Boxes },
      { id: 'dock-discrepancies', label: 'Receiving exceptions', icon: AlertTriangle },
    ],
  },
  {
    group: 'Replenishment',
    collapsible: true,
    items: [
      { id: 'sto', label: 'Store transfer orders', icon: ShoppingBag },
      { id: 'transfer-orders', label: 'Transfer Orders', icon: ArrowRightLeft },
      { id: 'outbound-returns', label: 'Returns', icon: Package },
      { id: 'cancellation-putaway', label: 'Cancellation Putaway', icon: Boxes },
    ],
  },
  {
    group: 'Dispatch planning',
    collapsible: true,
    items: [
      { id: 'batches', label: 'Pick batches', icon: ListChecks },
      { id: 'picklists', label: 'Pick lists', icon: ClipboardList },
      { id: 'sorting-list', label: 'Sorting List', icon: Grid },
      { id: 'dispatch-plan', label: 'Dispatch plan', icon: Route },
      { id: 'shipments', label: 'Shipments', icon: Truck },
      { id: 'shipping-scans', label: 'Shipping scans', icon: ListChecks },
      { id: 'manifests', label: 'Manifests', icon: Receipt },
      { id: 'totes-lpns', label: 'Totes / LPNs', icon: Package },
      { id: 'cross-dock', label: 'Cross Dock', icon: Send },
    ],
  },
  {
    group: 'Linehaul',
    collapsible: true,
    items: [
      { id: 'vehicle-assignment', label: 'Vehicle assignment', icon: Truck },
      { id: 'vehicle-checkin', label: 'Vehicle Check In', icon: UserCheck },
      { id: 'active-trips', label: 'Trip monitoring', icon: Activity },
    ],
  },
  {
    group: 'Inventory',
    collapsible: true,
    items: [
      { id: 'inventory-lots', label: 'Inventory & Lots', icon: Boxes },
      { id: 'bin-lookup', label: 'Bin Lookup', icon: MapPin },
      { id: 'storage-bins', label: 'Storage Bins', icon: Database },
      { id: 'cycle-counts', label: 'Cycle counts', icon: ListChecks },
    ],
  },
  {
    group: 'People & assignments',
    collapsible: true,
    items: [
      { id: 'manpower', label: 'Workforce overview', icon: Users },
      { id: 'employee-roster', label: 'Staff & assignments', icon: UserCheck },
      { id: 'work-assignments', label: 'Work assignments', icon: ClipboardList },
      { id: 'productivity', label: 'Productivity', icon: Activity },
    ],
  },
  {
    group: 'Network setup',
    collapsible: true,
    items: [
      { id: 'master-organizations', label: 'Organizations', icon: Building2 },
      { id: 'master-warehouses', label: 'Facilities', icon: Building2 },
      { id: 'master-stores', label: 'Store network', icon: ShoppingBag },
      { id: 'master-zones', label: 'Zones & dock doors', icon: MapPin },
      { id: 'master-bins', label: 'Storage locations', icon: Database },
      { id: 'master-equipment', label: 'Equipment register', icon: Settings },
      { id: 'master-skus', label: 'Product catalog', icon: Tag },
      { id: 'master-vendors', label: 'Suppliers', icon: Users },
      { id: 'master-carriers', label: 'Carriers', icon: Truck },
      { id: 'master-vehicles', label: 'Vehicles', icon: Truck },
    ],
  },
  {
    group: 'Work configuration',
    collapsible: true,
    items: [
      { id: 'picker-zones', label: 'Picker-Zone Mapping', icon: Settings },
      { id: 'config-sku-slotting', label: 'SKU Slotting', icon: Grid },
    ],
  },
  {
    group: 'Administration',
    adminOnly: true,
    items: [{ id: 'admin-settings', label: 'Admin & access', icon: ShieldCheck }],
  },
];

const FLOOR_NAV = [{ group: 'My operations', items: [
  { id: 'dashboard', label: 'My work', icon: LayoutDashboard },
  { id: 'inbound-asns', label: 'Receive shipment', icon: PackageCheck },
  { id: 'putaway-tasks', label: 'Putaway', icon: Boxes },
  { id: 'batches', label: 'Picking tasks', icon: ClipboardList },
  { id: 'totes-lpns', label: 'Pack & stage', icon: Package },
  { id: 'manifests', label: 'Dispatch tasks', icon: Truck },
]}];

/* ─── Shopper nav (unchanged) ─── */
const SHOPPER_NAV = [
  {
    group: 'Shopping',
    items: [
      { id: 'shop-storefront', label: 'Order Groceries', icon: ShoppingBag },
      { id: 'shop-orders', label: 'My Orders', icon: ClipboardList },
      { id: 'shop-notifications', label: 'Notifications', icon: Bell },
      { id: 'shop-account', label: 'Account & Address Book', icon: Users },
    ],
  },
];

export default function Sidebar({ collapsed, onNavigate }) {
  const { activeTabId, openTab } = useTabs();
  const { user, facility, appKey, appBrand } = useAuth();
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);

  const isShopper = appKey === 'shopper';
  const isFloorApp =
    typeof window !== 'undefined' && (
      document.documentElement.dataset.surface === 'app' ||
      window.Capacitor?.isNativePlatform?.() === true
    );

  /* Poll unread notification count */
  useEffect(() => {
    if (isShopper || !user?.user_id) return undefined;
    let mounted = true;
    const refresh = () =>
      fetchApi('/notifications/notifications/unread_count/')
        .then((result) => { if (mounted) setUnreadCount(result?.unread || 0); })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('zippzo:live-event', refresh);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('zippzo:live-event', refresh);
    };
  }, [isShopper, user?.user_id]);

  const baseNav = isShopper ? SHOPPER_NAV : isFloorApp ? FLOOR_NAV : WMS_NAV;
  const visibleNav = baseNav.filter((section) => !section.adminOnly || user?.is_admin);

  /* Filter sections by search query */
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleNav;
    return visibleNav
      .map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (it) => it.label.toLowerCase().includes(q) || it.id.includes(q),
        ),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [visibleNav, query]);

  const toggleGroup = (group) => {
    setClosedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand header */}
      <div className="sidebar-header">
        <img className="brand-logo" src="/zippzo-logo-192.png" alt="Zippzo" />
        {!collapsed && (
          <div className="brand-block">
            <span className="brand-title">{appBrand || 'ZIPPZO'}</span>
            <span className="brand-sub">{isShopper ? 'CUSTOMER' : isFloorApp ? 'FLOOR OPERATIONS' : appKey === 'darkstore' ? 'DARK STORE' : 'WAREHOUSE'}</span>
          </div>
        )}
      </div>

      {!collapsed && !isShopper && facility && (
        <div className="sidebar-facility" title={facility.name || facility.code}>
          <span className="sidebar-facility__label">ACTIVE FACILITY</span>
          <span className="sidebar-facility__name">{facility.name || facility.code}</span>
          <span className="sidebar-facility__code">{facility.code}</span>
        </div>
      )}

      {/* Module search */}
      {!collapsed && (
        <div className="sidebar-search">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search module..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search modules"
          />
        </div>
      )}

      {/* Nav sections */}
      <div className="sidebar-content">
        {filteredSections.map((sec) => {
          const isClosed = sec.collapsible && !!closedGroups[sec.group] && !query;
          return (
            <div key={sec.group}>
              {/* Group label / collapsible header */}
              {!collapsed && (
                sec.collapsible ? (
                  <button
                    type="button"
                    className="nav-group nav-group--collapsible"
                    onClick={() => toggleGroup(sec.group)}
                    aria-expanded={!isClosed}
                  >
                    <span>{sec.group}</span>
                    {isClosed
                      ? <ChevronRight size={12} />
                      : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <div className="nav-group-label">{sec.group}</div>
                )
              )}

              {/* Nav items */}
              {!isClosed &&
                sec.items.map((item) => {
                  const IconComp = item.icon;
                  const isActive = activeTabId === item.id;
                  const isNotifItem =
                    item.id === (isShopper ? 'shop-notifications' : 'notifications');
                  const badgeCount = isNotifItem ? unreadCount : 0;

                  return (
                    <div
                      key={item.id}
                      data-testid={`nav-${item.id}`}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-current={isActive ? 'page' : undefined}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openTab(item.id, item.label, item.icon?.displayName || item.id);
                          onNavigate?.();
                        }
                      }}
                      onClick={() => {
                        openTab(item.id, item.label, item.icon?.displayName || item.id);
                        onNavigate?.();
                      }}
                      title={collapsed ? item.label : undefined}
                    >
                      <IconComp size={14} style={{ minWidth: 14, flexShrink: 0 }} />
                      {!collapsed && <span className="nav-item-label">{item.label}</span>}
                      {!collapsed && badgeCount > 0 && (
                        <span
                          className="nav-badge"
                          aria-label={`${badgeCount} items`}
                        >
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
