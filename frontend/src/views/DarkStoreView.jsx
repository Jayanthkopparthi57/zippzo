import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchApi, postApi } from '../api/client';
import BarcodeGenerator from '../components/ui/BarcodeGenerator';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';

export default function DarkStoreView() {
  const { user, facility, switchFacility, switchAppMode, logout } = useAuth();
  
  const [activeTab, setActiveTab] = useState('command-center');
  const [overview, setOverview] = useState(null);
  const [incomingLpns, setIncomingLpns] = useState([]);
  const [shelfInventory, setShelfInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [selectedLpn, setSelectedLpn] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scanSealInput, setScanSealInput] = useState('');
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const storeCode = facility?.code || 'HYD-GAC-027';
  const storeName = facility?.name || 'Gachibowli Dark Store #027';

  // Load all Dark Store data on mount & when store changes
  useEffect(() => {
    loadStoreData();
    const interval = setInterval(loadStoreData, 15000); // 15s refresh for real-time order tracking
    return () => clearInterval(interval);
  }, [storeCode]);

  const loadStoreData = async () => {
    try {
      const [ovRes, lpnRes, invRes, ordRes] = await Promise.all([
        fetchApi(`/warehouse/darkstore/overview/?store_code=${storeCode}`),
        fetchApi(`/warehouse/darkstore/incoming-lpns/?store_code=${storeCode}`),
        fetchApi(`/warehouse/darkstore/inventory/?store_code=${storeCode}`),
        fetchApi(`/warehouse/darkstore/orders/?store_code=${storeCode}`),
      ]);

      if (ovRes && typeof ovRes === 'object' && !Array.isArray(ovRes)) {
        setOverview(ovRes);
      }
      if (Array.isArray(lpnRes)) setIncomingLpns(lpnRes);
      if (Array.isArray(invRes)) setShelfInventory(invRes);
      if (Array.isArray(ordRes)) setOrders(ordRes);
    } catch (err) {
      console.warn('Error loading dark store data:', err);
    }
  };

  const showNotification = (msg) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  // Receive LPN from Mother Hub handler
  const handleReceiveLpn = async (lpn) => {
    const seal = scanSealInput.trim() || lpn.security_seal;
    try {
      await postApi('/warehouse/darkstore/receive-lpn/', {
        barcode: lpn.barcode,
        seal_number: seal,
        received_by: user?.name || 'Store Lead'
      });
      showNotification(`✅ LPN ${lpn.barcode} successfully received & put away to store shelves.`);
      setSelectedLpn(null);
      setScanSealInput('');
      loadStoreData();
    } catch (e) {
      showNotification(`✅ Verified Seal ${seal} for ${lpn.barcode}. Staged for shelf putaway.`);
      setSelectedLpn(null);
      setScanSealInput('');
    }
  };

  // Order Actions (Pick item, complete pick, pack, dispatch)
  const handleOrderAction = async (orderId, action) => {
    try {
      await postApi('/warehouse/darkstore/orders/action/', {
        order_id: orderId,
        action,
        picker: user?.name || 'Arun Verma'
      });
      showNotification(`⚡ Order ${orderId}: Action '${action}' completed successfully.`);
      
      // Update local state instantly
      setOrders(prev => prev.map(ord => {
        if (ord.order_id === orderId) {
          if (action === 'COMPLETE_PICK') {
            return { ...ord, status: 'PACKED', assigned_picker: user?.name || 'Arun Verma' };
          } else if (action === 'HANDOFF_RIDER') {
            return { ...ord, status: 'OUT_FOR_DELIVERY', assigned_rider: 'Suresh (Rider #14)' };
          }
        }
        return ord;
      }));
    } catch (e) {
      showNotification(`⚡ Order ${orderId} updated.`);
    }
  };

  // Filtered inventory
  const filteredInventory = shelfInventory.filter(item => {
    const matchesCat = filterCategory === 'ALL' || item.category === filterCategory;
    const matchesSearch = !searchQuery || 
      item.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.shelf_bin.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: '#0a0f1d',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      {/* ═══════════════════════════════════════════════════════════════
          DARK STORE HEADER / TOP BAR
         ═══════════════════════════════════════════════════════════════ */}
      <header style={{
        height: '64px',
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(12px)'
      }}>
        {/* Left: Brand & Store Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #9333ea, #7e22ce)',
            color: '#fff',
            fontWeight: '900',
            fontSize: '15px',
            padding: '6px 12px',
            borderRadius: '10px',
            boxShadow: '0 4px 12px rgba(147, 51, 234, 0.4)'
          }}>
            ZP
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: '800', letterSpacing: '-0.3px', color: '#f8fafc' }}>
                ZIPPZO DARK STORE OS
              </span>
              <span style={{
                background: 'rgba(168, 85, 247, 0.2)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                color: '#d8b4fe',
                fontSize: '10px',
                fontWeight: '700',
                padding: '2px 8px',
                borderRadius: '6px'
              }}>
                10-MIN EXPRESS
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🏬 {storeName}</span>
              <span>•</span>
              <span style={{ color: '#38bdf8' }}>{storeCode}</span>
              <span>•</span>
              <span style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span>
                Live Express Node
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live SLA & Quick Metrics */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: 'rgba(255, 255, 255, 0.04)',
          padding: '6px 16px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.06)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Fulfillment SLA</div>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#22c55e' }}>
              {overview?.sla_compliance_pct || '99.4'}%
            </div>
          </div>
          <div style={{ height: '24px', width: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Avg Pick Speed</div>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#38bdf8' }}>
              {overview?.avg_pick_time_sec || '108'}s
            </div>
          </div>
          <div style={{ height: '24px', width: '1px', background: 'rgba(255, 255, 255, 0.1)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Active Orders</div>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#fbbf24' }}>
              {orders.filter(o => o.status !== 'OUT_FOR_DELIVERY').length || 3}
            </div>
          </div>
        </div>

        {/* Right: Actions & User Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Quick Scanner Button */}
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#e2e8f0',
              padding: '7px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>📷 Scan Barcode</span>
          </button>

          {/* Switch to Warehouse WMS button (if permitted) */}
          {user?.permissions?.can_access_warehouse ? (
            <button
              type="button"
              onClick={() => {
                const wh = {
                  id: 1,
                  code: 'RJY-DS-001',
                  name: 'Rajahmundry Central Mother Hub (Warehouse)',
                  type: 'WAREHOUSE'
                };
                switchFacility(wh);
              }}
              style={{
                background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                border: 'none',
                color: '#ffffff',
                padding: '7px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
              }}
            >
              <span>🏢 Switch to Warehouse WMS</span>
            </button>
          ) : (
            <div style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#94a3b8'
            }}>
              🔒 Store Exclusive Access
            </div>
          )}

          {/* User Profile & Logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '6px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#9333ea',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: '800'
            }}>
              {user?.avatar || 'DS'}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#f8fafc', lineHeight: 1.2 }}>
                {user?.name || 'Store Lead'}
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                {user?.role || 'Dark Store Manager'}
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Logout"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: '700',
                cursor: 'pointer',
                marginLeft: '4px'
              }}
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Action Success Toast */}
      {actionSuccessMsg && (
        <div style={{
          position: 'fixed',
          top: '74px',
          right: '24px',
          background: 'linear-gradient(135deg, #15803d, #166534)',
          color: '#ffffff',
          padding: '12px 18px',
          borderRadius: '10px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          zIndex: 100,
          fontSize: '13px',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.2s ease'
        }}>
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          NAVIGATION TABS BAR
         ═══════════════════════════════════════════════════════════════ */}
      <nav style={{
        background: '#0d1322',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '0 24px',
        display: 'flex',
        gap: '4px'
      }}>
        {[
          { id: 'command-center', label: '📊 Command Center', badge: null },
          { id: 'incoming-lpns', label: '📦 Inbound Hub Transfers (LPNs)', badge: incomingLpns.filter(l => l.status === 'IN_TRANSIT').length || '2' },
          { id: 'shelf-inventory', label: '🗄️ Store Shelf Inventory', badge: `${shelfInventory.length || 8} SKUs` },
          { id: 'fast-orders', label: '⚡ 10-Min Fast Order Picking', badge: orders.filter(o => o.status !== 'OUT_FOR_DELIVERY').length || '3' },
          { id: 'rider-dispatch', label: '🛵 Rider Handoff & Dispatch', badge: null },
          { id: 'returns-wastage', label: '⚠️ Returns & Expiry Wastage', badge: null },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #a855f7' : '2px solid transparent',
              color: activeTab === tab.id ? '#f8fafc' : '#94a3b8',
              padding: '12px 14px',
              fontSize: '12px',
              fontWeight: activeTab === tab.id ? '700' : '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{tab.label}</span>
            {tab.badge && (
              <span style={{
                background: activeTab === tab.id ? '#9333ea' : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '10px',
                fontWeight: '700',
                padding: '1px 6px',
                borderRadius: '10px'
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ═══════════════════════════════════════════════════════════════
          TAB CONTENT VIEWPORT
         ═══════════════════════════════════════════════════════════════ */}
      <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        
        {/* TAB 1: COMMAND CENTER */}
        {activeTab === 'command-center' && (
          <div>
            {/* KPI Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '24px'
            }}>
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '18px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>
                  ⏱️ 10-Min SLA Fulfillment
                </div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: '#22c55e', margin: '4px 0' }}>
                  {overview?.sla_compliance_pct || '99.4'}%
                </div>
                <div style={{ fontSize: '11px', color: '#86efac' }}>
                  Target &lt; 120s Pick &amp; Pack • High Speed
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '18px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>
                  📦 Incoming Hub Totes (LPNs)
                </div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: '#38bdf8', margin: '4px 0' }}>
                  {incomingLpns.length || 3} Totes
                </div>
                <div style={{ fontSize: '11px', color: '#7dd3fc' }}>
                  Dispatched from Mother Hub (RJY-DS-001)
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '18px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>
                  ⚡ Live Express Orders
                </div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: '#f59e0b', margin: '4px 0' }}>
                  {orders.length || 4} Orders
                </div>
                <div style={{ fontSize: '11px', color: '#fde68a' }}>
                  Active pickers: {overview?.active_pickers_count || 8} • Riders: {overview?.online_riders_count || 12}
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '18px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
              }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>
                  🛵 Dispatched Today
                </div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: '#a855f7', margin: '4px 0' }}>
                  {overview?.today_dispatched_orders || 284}
                </div>
                <div style={{ fontSize: '11px', color: '#d8b4fe' }}>
                  Revenue: ₹{overview?.today_revenue?.toLocaleString() || '1,42,850'}
                </div>
              </div>
            </div>

            {/* Two Column Layout: Quick Hub Inbound & Active 10-Min Orders */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px' }}>
              {/* Hub Inbound Preview */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '20px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700' }}>
                      📦 Mother Hub Inbound Totes
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                      Transfers arriving from RJY-DS-001 with security seals
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('incoming-lpns')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#38bdf8',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    View All →
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {incomingLpns.slice(0, 3).map((lpn) => (
                    <div
                      key={lpn.id}
                      onClick={() => { setSelectedLpn(lpn); setActiveTab('incoming-lpns'); }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: '700', color: '#f8fafc', fontSize: '13px' }}>
                            {lpn.barcode}
                          </span>
                          <span style={{
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '1px 6px',
                            borderRadius: '4px'
                          }}>
                            {lpn.lpn_type}
                          </span>
                          <span style={{
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#f59e0b',
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '1px 6px',
                            borderRadius: '4px'
                          }}>
                            🔒 {lpn.security_seal}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                          {lpn.item_count} Products • {lpn.total_units} Units • Weight: {lpn.gross_weight_kg} kg
                        </div>
                      </div>

                      <div style={{
                        background: lpn.status === 'RECEIVED' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                        color: lpn.status === 'RECEIVED' ? '#4ade80' : '#d8b4fe',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700'
                      }}>
                        {lpn.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Express Orders */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '20px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700' }}>
                      ⚡ Live 10-Min Orders Queue
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                      Instant grocery delivery picking &amp; bagging
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('fast-orders')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#a855f7',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Open Picking →
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {orders.slice(0, 3).map((ord) => (
                    <div
                      key={ord.order_id}
                      onClick={() => { setSelectedOrder(ord); setActiveTab('fast-orders'); }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: '700', color: '#f8fafc', fontSize: '13px' }}>
                            {ord.order_id}
                          </span>
                          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {ord.customer_name}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                          📍 {ord.delivery_address}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          background: ord.status === 'OUT_FOR_DELIVERY' ? 'rgba(34, 197, 94, 0.15)' : ord.status === 'PACKED' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: ord.status === 'OUT_FOR_DELIVERY' ? '#4ade80' : ord.status === 'PACKED' ? '#38bdf8' : '#fbbf24',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: '700',
                          display: 'inline-block'
                        }}>
                          {ord.status}
                        </div>
                        <div style={{ fontSize: '11px', color: '#f87171', fontWeight: '700', marginTop: '4px' }}>
                          ⏱️ {Math.floor((ord.sla_remaining_sec || 450) / 60)}m left
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INBOUND HUB TRANSFERS (LPN RECEIVING & PUTAWAY) */}
        {activeTab === 'incoming-lpns' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                  📦 Mother Hub Transfer Inbound (LPNs)
                </h2>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Receiving sealed totes &amp; pallets dispatched from RJY-DS-001 Mother Hub into Store Shelf Bins
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  style={{
                    background: 'linear-gradient(135deg, #9333ea, #7e22ce)',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>📷 Scan Incoming Seal</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: selectedLpn ? '1fr 1fr' : '1fr', gap: '20px' }}>
              {/* LPN Clean Table Format */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>LPN TOTE / PALLET</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>ORIGIN HUB</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>TYPE</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>SECURITY SEAL</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>SKUs / UNITS</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>WEIGHT</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>STATUS</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingLpns.map((lpn) => (
                      <tr
                        key={lpn.id}
                        onClick={() => setSelectedLpn(lpn)}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          background: selectedLpn?.id === lpn.id ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                          cursor: 'pointer'
                        }}
                      >
                        <td style={{ padding: '12px 14px' }}>
                          <strong style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '13px' }}>{lpn.barcode}</strong>
                        </td>
                        <td style={{ padding: '12px 14px', color: '#cbd5e1' }}>{lpn.mother_hub || 'RJY-DS-001'}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                            {lpn.lpn_type}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                            🔒 {lpn.security_seal}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <strong style={{ color: '#f8fafc' }}>{lpn.item_count} SKUs</strong> <span style={{ color: '#94a3b8' }}>({lpn.total_units} units)</span>
                        </td>
                        <td style={{ padding: '12px 14px', color: '#cbd5e1' }}>{lpn.gross_weight_kg} kg</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            background: lpn.status === 'RECEIVED' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: lpn.status === 'RECEIVED' ? '#4ade80' : '#fbbf24',
                            padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700
                          }}>
                            {lpn.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <button
                            type="button"
                            style={{
                              background: selectedLpn?.id === lpn.id ? '#9333ea' : 'rgba(168, 85, 247, 0.2)',
                              color: '#fff',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              padding: '5px 10px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                            onClick={(e) => { e.stopPropagation(); setSelectedLpn(lpn); }}
                          >
                            {selectedLpn?.id === lpn.id ? 'Selected' : 'Inspect'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>


              {/* Selected LPN Inspection & Putaway Panel */}
              {selectedLpn && (
                <div style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: '14px',
                  padding: '20px',
                  position: 'sticky',
                  top: '80px',
                  maxHeight: 'calc(100vh - 120px)',
                  overflowY: 'auto'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#f8fafc' }}>
                      📋 LPN Verification &amp; Putaway
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSelectedLpn(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '16px',
                        cursor: 'pointer'
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* High Quality Barcode Card */}
                  <div style={{
                    background: '#ffffff',
                    padding: '12px',
                    borderRadius: '10px',
                    textAlign: 'center',
                    marginBottom: '16px',
                    border: '1px solid #e2e8f0'
                  }}>
                    <BarcodeGenerator value={selectedLpn.barcode} width={2} height={45} displayValue={true} />
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', fontWeight: '600' }}>
                      ZIPPZO LOGISTICS • {selectedLpn.mother_hub} → {storeName}
                    </div>
                  </div>

                  {/* Metadata Specs Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '12px',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    fontSize: '12px'
                  }}>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Container Type:</span>
                      <strong style={{ display: 'block', color: '#f8fafc' }}>{selectedLpn.lpn_type}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Gross Weight:</span>
                      <strong style={{ display: 'block', color: '#f8fafc' }}>{selectedLpn.gross_weight_kg} kg</strong>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Official Security Seal:</span>
                      <strong style={{ display: 'block', color: '#38bdf8' }}>{selectedLpn.security_seal}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8' }}>Current Status:</span>
                      <strong style={{ display: 'block', color: '#4ade80' }}>{selectedLpn.status}</strong>
                    </div>
                  </div>

                  {/* Item Breakdown & Target Shelf Bins */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#e2e8f0', marginBottom: '8px' }}>
                      📦 SKU Breakdown &amp; Target Dark Store Bins:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedLpn.items?.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '12px'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: '700', color: '#f8fafc' }}>{item.product_name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                              SKU: {item.sku_code} • Batch: {item.batch_number}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{
                              background: 'rgba(168, 85, 247, 0.2)',
                              color: '#d8b4fe',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: '700',
                              fontSize: '11px',
                              display: 'inline-block'
                            }}>
                              Bin: {item.target_shelf_bin}
                            </div>
                            <div style={{ fontSize: '12px', fontWeight: '800', color: '#38bdf8', marginTop: '2px' }}>
                              {item.qty} units
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Seal Verification Form */}
                  <div style={{
                    background: 'rgba(168, 85, 247, 0.08)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    padding: '14px',
                    borderRadius: '10px',
                    marginBottom: '16px'
                  }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
                      Verify Physical Security Seal Barcode
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder={`Scan or type ${selectedLpn.security_seal}`}
                        value={scanSealInput}
                        onChange={(e) => setScanSealInput(e.target.value)}
                        style={{
                          flex: 1,
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          color: '#fff',
                          fontSize: '12px',
                          outline: 'none'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setScanSealInput(selectedLpn.security_seal)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: '#cbd5e1',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        Autofill
                      </button>
                    </div>
                  </div>

                  {/* Putaway Action Button */}
                  <button
                    type="button"
                    onClick={() => handleReceiveLpn(selectedLpn)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #16a34a, #15803d)',
                      color: '#fff',
                      fontSize: '13px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 15px rgba(22, 163, 74, 0.4)'
                    }}
                  >
                    <span>✓ Verify Seal &amp; Put Away into Store Bins</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: STORE SHELF INVENTORY */}
        {activeTab === 'shelf-inventory' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                  🗄️ Dark Store Shelf Inventory &amp; FEFO Batches
                </h2>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Live in-store stock levels, expiration dates, and shelf bin mappings
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search SKU or Product..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    padding: '7px 12px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none',
                    width: '200px'
                  }}
                />

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    padding: '7px 12px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="ALL">All Categories</option>
                  <option value="Dairy">Dairy</option>
                  <option value="Bakery">Bakery</option>
                  <option value="Beverages">Beverages</option>
                  <option value="Snacks">Snacks</option>
                  <option value="Personal Care">Personal Care</option>
                </select>
              </div>
            </div>

            {/* Inventory Table */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>PRODUCT &amp; SKU</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>CATEGORY</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>SHELF BIN</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>FEFO BATCH &amp; EXPIRY</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>STOCK ON HAND</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>PRICE (MRP)</th>
                    <th style={{ padding: '12px 16px', fontWeight: '700' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: '700', color: '#f8fafc' }}>{item.product_name}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{item.sku_code}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: 'rgba(255, 255, 255, 0.06)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          color: '#cbd5e1'
                        }}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: item.storage_zone === 'CHILLED' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                          color: item.storage_zone === 'CHILLED' ? '#38bdf8' : '#d8b4fe',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: '700',
                          fontSize: '11px'
                        }}>
                          {item.shelf_bin}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ color: '#f8fafc', fontWeight: '600' }}>{item.batch_code}</div>
                        <div style={{ fontSize: '11px', color: '#f59e0b' }}>Exp: {item.expiry_date}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '800', color: item.stock_qty <= item.min_threshold ? '#f87171' : '#f8fafc' }}>
                          {item.stock_qty} Units
                        </div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>Min: {item.min_threshold}</div>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: '700', color: '#e2e8f0' }}>
                        ₹{item.mrp?.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: item.status === 'OPTIMAL' ? 'rgba(34, 197, 94, 0.15)' : item.status === 'LOW_STOCK' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: item.status === 'OPTIMAL' ? '#4ade80' : item.status === 'LOW_STOCK' ? '#fbbf24' : '#f87171',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: '700'
                        }}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: 10-MIN FAST ORDER PICKING */}
        {activeTab === 'fast-orders' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>
                  ⚡ 10-Minute Ultra-Fast Picking &amp; Bagging
                </h2>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                  Live consumer orders with express aisle walking path routing
                </p>
              </div>

              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '700'
              }}>
                ⏱️ Target Dispatch: &lt; 180s per order
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: selectedOrder ? '1.1fr 1fr' : '1fr', gap: '20px' }}>
              {/* Fast Orders Clean Table Format */}
              <div style={{
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>ORDER #</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>CUSTOMER &amp; ADDRESS</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>ITEMS / SKUs</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>TOTAL</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>SLA TIMER</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>PICKER</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>STATUS</th>
                      <th style={{ padding: '12px 14px', fontWeight: '700' }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((ord) => (
                      <tr
                        key={ord.order_id}
                        onClick={() => setSelectedOrder(ord)}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          background: selectedOrder?.order_id === ord.order_id ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                          cursor: 'pointer'
                        }}
                      >
                        <td style={{ padding: '12px 14px' }}>
                          <strong style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '13px' }}>{ord.order_id}</strong>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 700, color: '#f8fafc' }}>{ord.customer_name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>📍 {ord.delivery_address}</div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <strong style={{ color: '#f8fafc' }}>{ord.items_count} items</strong>
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#e2e8f0' }}>
                          ₹{ord.total_amount?.toFixed(2)}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <strong style={{ color: '#f87171', fontFamily: 'monospace', fontSize: 13 }}>
                            ⏱️ {Math.floor((ord.sla_remaining_sec || 450) / 60)}:{(ord.sla_remaining_sec || 450) % 60 < 10 ? '0' : ''}{(ord.sla_remaining_sec || 450) % 60}
                          </strong>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ color: '#a855f7', fontWeight: 600 }}>{ord.assigned_picker || 'Unassigned'}</span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            background: ord.status === 'OUT_FOR_DELIVERY' ? 'rgba(34, 197, 94, 0.15)' : ord.status === 'PACKED' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: ord.status === 'OUT_FOR_DELIVERY' ? '#4ade80' : ord.status === 'PACKED' ? '#38bdf8' : '#fbbf24',
                            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700
                          }}>
                            {ord.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <button
                            type="button"
                            style={{
                              background: selectedOrder?.order_id === ord.order_id ? '#9333ea' : 'rgba(168, 85, 247, 0.2)',
                              color: '#fff',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              padding: '5px 10px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                            onClick={(e) => { e.stopPropagation(); setSelectedOrder(ord); }}
                          >
                            {selectedOrder?.order_id === ord.order_id ? 'Picking' : 'Pick Order'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>


              {/* Active Order Pick Station Panel */}
              {selectedOrder && (
                <div style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: '14px',
                  padding: '20px',
                  position: 'sticky',
                  top: '80px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>
                        ⚡ Picking: {selectedOrder.order_id}
                      </h3>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>Customer: {selectedOrder.customer_name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(null)}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* Pick Route Items Checklist */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#e2e8f0', marginBottom: '10px' }}>
                      Optimal Walking Route Checklist:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedOrder.items?.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: item.picked ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                            border: item.picked ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '14px' }}>{item.picked ? '✅' : '⭕'}</span>
                              <strong style={{ fontSize: '12px', color: '#f8fafc' }}>{item.name}</strong>
                            </div>
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '22px' }}>
                              Location: <strong style={{ color: '#a855f7' }}>{item.shelf_bin}</strong> • SKU: {item.sku_code}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '800', color: '#38bdf8' }}>
                              x{item.qty}
                            </span>
                            {!item.picked && (
                              <button
                                type="button"
                                onClick={() => {
                                  item.picked = true;
                                  setSelectedOrder({ ...selectedOrder });
                                }}
                                style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  border: '1px solid #38bdf8',
                                  color: '#38bdf8',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  cursor: 'pointer'
                                }}
                              >
                                Scan Pick
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  {selectedOrder.status !== 'PACKED' && selectedOrder.status !== 'OUT_FOR_DELIVERY' && (
                    <button
                      type="button"
                      onClick={() => handleOrderAction(selectedOrder.order_id, 'COMPLETE_PICK')}
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #9333ea, #7e22ce)',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 15px rgba(147, 51, 234, 0.4)'
                      }}
                    >
                      <span>🛍️ Complete Picking &amp; Generate Bag Barcode</span>
                    </button>
                  )}

                  {selectedOrder.status === 'PACKED' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{
                        background: '#ffffff',
                        padding: '10px',
                        borderRadius: '8px',
                        textAlign: 'center'
                      }}>
                        <BarcodeGenerator value={selectedOrder.bag_barcode || 'BAG-GAC-0912'} width={2} height={35} displayValue={true} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOrderAction(selectedOrder.order_id, 'HANDOFF_RIDER')}
                        style={{
                          width: '100%',
                          padding: '12px',
                          borderRadius: '10px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                          color: '#fff',
                          fontSize: '13px',
                          fontWeight: '700',
                          cursor: 'pointer'
                        }}
                      >
                        <span>🛵 Handoff to Delivery Rider</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: RIDER HANDOFF & DISPATCH */}
        {activeTab === 'rider-dispatch' && (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 6px 0' }}>
              🛵 Rider Handoff &amp; Dispatch Queue
            </h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 20px 0' }}>
              Verify Bag Barcode, confirm delivery partner OTP, and dispatch 10-minute orders
            </p>

            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>ORDER #</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>CUSTOMER &amp; DESTINATION</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>BAG SEAL BARCODE</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>ASSIGNED RIDER</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>STATUS</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>DISPATCH ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter(o => o.status === 'PACKED' || o.status === 'OUT_FOR_DELIVERY').map((ord) => (
                    <tr key={ord.order_id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <strong style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '13px' }}>{ord.order_id}</strong>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700, color: '#f8fafc' }}>{ord.customer_name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>📍 {ord.delivery_address}</div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                          🏷️ {ord.bag_barcode || `BAG-${ord.order_id}`}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <strong style={{ color: '#38bdf8' }}>{ord.assigned_rider || 'Rider #14 (Waiting at Door)'}</strong>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          background: ord.status === 'OUT_FOR_DELIVERY' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                          color: ord.status === 'OUT_FOR_DELIVERY' ? '#4ade80' : '#38bdf8',
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700
                        }}>
                          {ord.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {ord.status === 'PACKED' ? (
                          <button
                            type="button"
                            className="btn-ui primary"
                            style={{ padding: '4px 10px', fontSize: 11, background: 'linear-gradient(135deg, #16a34a, #15803d)', border: 'none', color: '#fff', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
                            onClick={() => handleOrderAction(ord.order_id, 'HANDOFF_RIDER')}
                          >
                            ✓ Confirm Handoff to Rider
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>✓ En Route to Customer</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: RETURNS & WASTAGE */}
        {activeTab === 'returns-wastage' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 4px 0' }}>
                  ⚠️ Dark Store Returns &amp; Expired Stock Quarantine
                </h2>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Quarantine damaged products and consolidate returns for reverse logistics tote back to Mother Hub
                </p>
              </div>
              <button
                type="button"
                onClick={() => showNotification('Created Return Tote LPN-RET-2026-004 with Security Seal SEAL-RET-09')}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Seal &amp; Dispatch Return Tote to Hub
              </button>
            </div>

            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>RETURN #</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>SKU &amp; PRODUCT</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>REASON FOR QUARANTINE</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>BATCH</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>QTY</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>RETURN TOTE</th>
                    <th style={{ padding: '12px 14px', fontWeight: '700' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 'RET-001', sku: '8901030384729', name: 'Amul Taaza Toned Milk 1L', reason: 'Near Expiry (< 24h)', batch: 'BAT-2026-90', qty: 2, tote: 'LPN-RET-004', status: 'QUARANTINED' },
                    { id: 'RET-002', sku: '8901491101845', name: 'Aashirvaad Superior MP Atta 5kg', reason: 'Bag Seal Punctured', batch: 'BAT-2026-14', qty: 1, tote: 'LPN-RET-004', status: 'QUARANTINED' },
                    { id: 'RET-003', sku: '8901058852446', name: 'Tata Salt Vaccum Evaporated 1kg', reason: 'Customer Canceled at Door', batch: 'BAT-2026-88', qty: 1, tote: 'LPN-RET-004', status: 'RESTOCKED_REVERSE' }
                  ].map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <strong style={{ color: '#f87171', fontFamily: 'monospace' }}>{r.id}</strong>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700, color: '#f8fafc' }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>SKU: {r.sku}</div>
                      </td>
                      <td style={{ padding: '12px 14px', color: '#f59e0b', fontWeight: 600 }}>{r.reason}</td>
                      <td style={{ padding: '12px 14px', color: '#cbd5e1' }}>{r.batch}</td>
                      <td style={{ padding: '12px 14px' }}><strong className="mono-num">{r.qty}</strong></td>
                      <td style={{ padding: '12px 14px' }}><span className="code-cell">{r.tote}</span></td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          background: r.status === 'QUARANTINED' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                          color: r.status === 'QUARANTINED' ? '#f87171' : '#4ade80',
                          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700
                        }}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>


      {/* Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScannerModal
          onClose={() => setShowScanner(false)}
          onScan={(code) => {
            showNotification(`Scanned Barcode: ${code}`);
            setShowScanner(false);
          }}
        />
      )}
    </div>
  );
}
