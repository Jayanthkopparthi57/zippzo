import React from 'react';
import { Menu, Home, ChevronRight, QrCode, User, Building2, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTabs } from '../../context/TabContext';

export default function Header({ onToggleSidebar, onOpenScanner }) {
  const { user, facility, logout, facilitiesList, switchFacility, appKey } = useAuth();
  const { activeTabId } = useTabs();

  // The facility picker and barcode scanner are store-operator tools. The
  // customer app has neither in its bundle, and the rider app has no header at
  // all, so both are gated on the store console specifically.
  const isStoreConsole = appKey === 'store';

  // switchFacility() already existed on the context but nothing ever called it,
  // so the menu could only ever be whatever target_app_for() returned at login.
  // No seeded role maps to DARK_STORE either, so the store screens were
  // unreachable from the UI entirely. This selector is the entry point: picking
  // a site re-renders the sidebar for that facility's flow.
  const sites = facilitiesList.all_facilities || [];
  const canSee = (s) => {
    if (s.site_type === 'MH') return !!user?.can_access_warehouse;
    if (s.site_type === 'DS') return !!user?.can_access_dark_store;
    return true;
  };
  const visibleSites = sites.filter(canSee);
  const darkStores = visibleSites.filter(s => s.site_type === 'DS');
  const warehouses = visibleSites.filter(s => s.site_type !== 'DS');
  const currentCode = facility?.code || '';
  const currentInList = !!currentCode && visibleSites.some(s => s.code === currentCode);

  // Generate breadcrumb text
  const getBreadcrumb = () => {
    switch (activeTabId) {
      case 'sto': return { module: 'Outbound', view: 'STO' };
      case 'batches': return { module: 'Outbound Process', view: 'Batches & Waves' };
      case 'picklists': return { module: 'Outbound Process', view: 'Picklists' };
      case 'pick-execute': return { module: 'Outbound Process', view: 'Pick & Pack Execution' };
      case 'sorting-list': return { module: 'Outbound Process', view: 'Sorting List' };
      case 'totes-lpns': return { module: 'Outbound Process', view: 'Totes & LPNs' };
      case 'dispatch-plan': return { module: 'Outbound Process', view: 'Dispatch Plan' };
      case 'packing': return { module: 'Packing Station', view: 'Packing & Sealing' };
      case 'shipping': return { module: 'Shipping', view: 'Dispatch Trips & Manifests' };
      case 'inventory-lots': return { module: 'Storage & Inventory', view: 'Inventory Lots' };
      case 'lpns': return { module: 'Storage & Inventory', view: 'LPN Barcode Registry' };
      case 'asns': return { module: 'Inbound Process', view: 'ASNs' };
      case 'qc-testing': return { module: 'Inbound Process', view: 'QC Testing' };
      case 'putaway-tasks': return { module: 'Inbound Process', view: 'Putaway Tasks' };
      case 'active-trips': return { module: 'Fleet & Logistics', view: 'Active Trips' };
      case 'sites-registry': return { module: 'Facility Management', view: 'Sites Registry' };

      // Dark store screens: grouped by the stage of the store's own flow, so
      // the breadcrumb tells the operator where in receive -> put away -> pick
      // -> hand off they are standing. They are WMS sections, not a second app.
      case 'ds-dashboard': return { module: 'WMS · Store Ops', view: 'Command Center' };
      case 'ds-lpn-receipt': return { module: 'WMS · Store Ops · Replenishment', view: 'Receive Totes' };
      case 'ds-shelf-putaway': return { module: 'WMS · Store Ops · Replenishment', view: 'Shelf Putaway' };
      case 'ds-shelf-inventory': return { module: 'WMS · Store Ops', view: 'Shelf Inventory' };
      case 'ds-order-picking': return { module: 'WMS · Store Ops · Fulfillment', view: 'Order Picking' };
      case 'ds-order-packing': return { module: 'WMS · Store Ops · Fulfillment', view: 'Packing' };
      case 'ds-rider-handoff': return { module: 'WMS · Store Ops · Fulfillment', view: 'Rider Handoff' };
      case 'ds-returns': return { module: 'WMS · Store Ops', view: 'Returns & Restock' };

      default: return { module: 'Dashboard', view: 'Overview' };
    }
  };

  const bc = getBreadcrumb();

  return (
    <header className="header">
      <div className="header-left">
        <button className="icon-btn" onClick={onToggleSidebar} title="Toggle Sidebar">
          <Menu size={16} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <Home size={14} style={{ color: 'var(--text-muted)' }} />
          <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
          <span>{bc.module}</span>
          <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontWeight: '600', color: 'var(--accent-purple-dark)' }}>{bc.view}</span>
        </div>
      </div>

      <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {isStoreConsole && (
          <button className="btn-scanner" onClick={onOpenScanner} title="Handheld Laser Scanner Tool">
            <QrCode size={14} /> <span>Scan Barcode</span>
          </button>
        )}



        {/* Site picker - drives which sidebar sections render inside the store
            console. Both site types stay in the store app; only the menu
            changes. A customer has no facility to pick, so it is not rendered
            for them. */}
        {isStoreConsole && (
        <select
          data-testid="facility-switcher"
          aria-label="Switch facility"
          value={currentInList ? currentCode : ''}
          onChange={(e) => {
            const site = visibleSites.find(s => s.code === e.target.value);
            if (site) switchFacility(site);
          }}
          style={{
            border: '1px solid #bae6fd',
            background: '#f0f9ff',
            color: '#0369a1',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            maxWidth: 230,
          }}
        >
          {!currentInList && (
            <option value="" disabled>
              {currentCode || 'Select site'}
            </option>
          )}
          {darkStores.length > 0 && (
            <optgroup label="Dark stores">
              {darkStores.map(s => (
                <option key={s.code} value={s.code}>{s.code} — {s.name || s.code}</option>
              ))}
            </optgroup>
          )}
          {warehouses.length > 0 && (
            <optgroup label="Warehouses & hubs">
              {warehouses.map(s => (
                <option key={s.code} value={s.code}>{s.code} — {s.name || s.code}</option>
              ))}
            </optgroup>
          )}
        </select>
        )}

        {/* Current Facility Badge — a store operator's site, not a customer's. */}
        {isStoreConsole && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '700',
          color: '#0369a1'
        }}>
          <Building2 size={13} style={{ color: '#0284c7' }} />
          <span>{facility?.code || '—'} • {facility?.name ? facility.name.toUpperCase() : 'NO FACILITY SELECTED'}</span>
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', marginLeft: '2px' }} title="Online Live Fulfillment" />
        </div>
        )}

        {/* User Profile & Logout */}
        <div className="user-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: '800'
          }}>
            {user?.avatar || 'Z'}
          </div>
          <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)' }}>
              {user?.name || '—'}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {user?.role || '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Logout"
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
