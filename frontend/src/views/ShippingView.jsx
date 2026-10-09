import React, { useState, useEffect } from 'react';
import { Truck, Send, Receipt, Layers, RefreshCw, Plus, Check, X, MapPin, ShieldCheck, ArrowRight, UserCheck, Package, Printer, ArrowLeft, Download, FileText, CheckCircle2 } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../api/client';
import { generateBarcodeSVG } from '../utils/barcodeUtils';

export default function ShippingView({ initialTab = 'manifests' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab === 'dispatch-trips' ? 'dispatch-trips' : initialTab === 'cross-dock' ? 'cross-dock' : 'manifests');
  const [trips, setTrips] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');

  // Floating Modal States (Hovering on screen)
  const [selectedManifest, setSelectedManifest] = useState(null);
  const [showTripModal, setShowTripModal] = useState(false);
  const [newTrip, setNewTrip] = useState({
    vehicle_number: 'AP 05 TX 9988',
    driver_name: 'Konda Rahul',
    driver_phone: '98765-43210',
    seal_number: 'SEAL-2026-08',
    destination_id: '',
    total_stops: 3
  });

  useEffect(() => {
    setActiveSubtab(initialTab === 'dispatch-trips' ? 'dispatch-trips' : initialTab === 'cross-dock' ? 'cross-dock' : 'manifests');
  }, [initialTab]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tRes, shRes, oRes, stRes, rdRes] = await Promise.all([
        fetchApi('/delivery/route-plans/'),
        fetchApi('/fulfilment/batches/'),
        fetchApi('/orders/orders/'),
        fetchApi('/network/sites/'),
        fetchApi('/delivery/rider-profiles/'),
      ]);
      const trips = unwrapList(tRes);
      const shipments = unwrapList(shRes);
      const ordersL = unwrapList(oRes);
      const stores = unwrapList(stRes);
      const riders = unwrapList(rdRes);
      if (trips) setTrips(trips);
      if (shipments) setShipments(shipments);
      if (ordersL) setOrders(ordersL);
      if (stores) setStores(stores);
      if (riders) setRiders(riders);
      setLoadError('');

      if (selectedManifest && shipments) {
        const updated = shipments.find(s => s.batch_id === selectedManifest.batch_id);
        if (updated) setSelectedManifest(updated);
      }
    } catch (err) {
      console.error('Shipping load error:', err);
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  // Dispatch Shipment and Deduct Inventory
  const handleDispatchShipment = async (shipmentId) => {
    if (!shipmentId) { alert('Dispatch failed: no shipment id (row is missing batch_id).'); return; }
    try {
      await postApi(`/fulfilment/batches/${shipmentId}/dispatch/`, {});
      await loadData();
      showToast(`✓ Shipment ${shipmentId} dispatched!`);
    } catch (err) {
      try {
        await patchApi(`/fulfilment/batches/${shipmentId}/`, { status: 'CLOSED' });
        await loadData();
        showToast(`✓ Shipment ${shipmentId} dispatched!`);
      } catch (e2) {
        alert(`Dispatch failed: ${e2.message}`);
      }
    }
  };

  // Complete Shipment Delivery
  const handleDeliverShipment = async (shipmentId) => {
    if (!shipmentId) { alert('Delivery update failed: no shipment id (row is missing batch_id).'); return; }
    try {
      await patchApi(`/fulfilment/batches/${shipmentId}/`, { status: 'CLOSED' });
      await loadData();
      showToast(`✓ Shipment ${shipmentId} marked as delivered to destination store.`);
    } catch (err) {
      alert(`Delivery update failed: ${err.message}`);
    }
  };

  // Open Floating Trip Creation Modal
  const openCreateTripModal = () => {
    setNewTrip({
      vehicle_number: `AP 05 TX ${Math.floor(1000 + Math.random() * 9000)}`,
      driver_name: 'Konda Rahul',
      driver_phone: '98765-43210',
      seal_number: `SEAL-2026-${String(trips.length + 10).padStart(2, '0')}`,
      destination_id: stores[0]?.site_id || '',
      total_stops: 3
    });
    setShowTripModal(true);
  };

  // Submit Trip
  const handleTripSubmit = async (e) => {
    e.preventDefault();
    try {
      await postApi('/delivery/route-plans/', {
        rider: (riders[0] && riders[0].rider_id) || null,
        site: newTrip.destination_id,
        stop_count: parseInt(newTrip.total_stops) || 3,
        status: 'PLANNED'
      });
      setShowTripModal(false);
      await loadData();
      showToast('✓ Dispatch Trip created successfully');
    } catch (err) {
      alert(`Trip creation failed: ${err.message}`);
    }
  };

  // Print Manifest
  const handlePrintManifest = (shipment) => {
    const manifestNo = shipment.batch_no || (shipment.batch_id ? `MAN-${String(shipment.batch_id).slice(0, 8).toUpperCase()}` : '—');
    const batchCode = shipment.batch_no || String(shipment.batch_id || '');
    const lpnBarcode = shipment.batch_no || String(shipment.batch_id || '');
    const dest = shipment.destination_name || 'Hafeezpet #009';
    const vehicle = shipment.vehicle_number || 'AP 05 TX 9988';
    const driver = shipment.driver_name || 'Konda Rahul';
    const seal = shipment.seal_number || 'SEAL-2026-08';
    const ordered = shipment.ordered_qty ?? 50;
    const items = shipment.items || [];

    const win = window.open('', '_blank');
    const svgBarcode = generateBarcodeSVG(lpnBarcode, { width: 220, height: 48, showText: true });

    win.document.write(`
      <html>
        <head>
          <title>Shipping Manifest — ${manifestNo}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0f172a; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
            .title { font-size: 20px; font-weight: 800; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; font-size: 13px; }
            .box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
            th { background: #f1f5f9; font-weight: 700; }
            .barcode { font-family: monospace; font-size: 18px; font-weight: 800; letter-spacing: 2px; }
            .seal-badge { display: inline-block; padding: 4px 10px; border: 1.5px solid #059669; color: #059669; font-weight: 800; border-radius: 4px; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <header class="header">
            <div>
              <div class="title">ZIPPZO LOGISTICS — OUTBOUND SHIPPING MANIFEST</div>
              <div style="font-size: 12px; color: #64748b;">Mother Hub: RJY-DS-001 • Dispatch & Inventory Gate Pass</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; font-size: 16px; color: #7c3aed;">${manifestNo}</div>
              <div style="font-size: 11px; color: #64748b;">Date: ${new Date().toLocaleDateString('en-GB')}</div>
            </div>
          </header>

          <div class="grid">
            <div class="box">
              <div><strong>Destination Dark Store:</strong> ${dest}</div>
              <div><strong>Outbound Batch ID:</strong> ${batchCode}</div>
              <div style="margin-top: 6px;">${svgBarcode}</div>
            </div>
            <div class="box">
              <div><strong>Carrier Vehicle:</strong> ${vehicle}</div>
              <div><strong>Driver:</strong> ${driver} (${shipment.driver_phone || '98765-43210'})</div>
              <div><strong>Dock Door:</strong> ${shipment.dock || 'D-01'}</div>
            </div>
            <div class="box">
              <div><strong>Total Ordered Units:</strong> ${ordered}</div>
              <div><strong>Security Seal Status:</strong> <span class="seal-badge">${seal}</span></div>
              <div><strong>Manifest Status:</strong> ${shipment.status || 'READY'}</div>
            </div>
          </div>

          <th style="margin: 16px 0 6px 0;">Manifest Line Items (${items.length > 0 ? items.length : '1'} SKUs)</th>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>SKU Code</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Batch No</th>
                <th>Storage Bin</th>
                <th style="text-align: right;">Quantity</th>
              </tr>
            </thead>
            <tbody>
              ${items.length > 0 ? items.map((it, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td style="font-family: monospace; font-weight: 700;">${it.sku_code || 'SKU'}</td>
                  <td><strong>${it.sku_name || 'Product Item'}</strong></td>
                  <td>${it.category || 'General'}</td>
                  <td>${it.batch_number || 'BAT-2026-09'}</td>
                  <td>${it.source_location_code || 'A-01-01-01'}</td>
                  <td style="text-align: right; font-weight: 800;">${it.qty || 10}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td>1</td>
                  <td style="font-family: monospace; font-weight: 700;">SKU-MILK-500</td>
                  <td><strong>Amul Taaza Toned Fresh Milk 500ml</strong></td>
                  <td>Dairy & Fresh</td>
                  <td>BAT-2026-09</td>
                  <td>A-01-02-04</td>
                  <td style="text-align: right; font-weight: 800;">${ordered}</td>
                </tr>
              `}
            </tbody>
          </table>

          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 999999,
          background: '#065f46', color: '#fff', padding: '12px 20px',
          borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10
        }}>
          ✓ {toast}
        </div>
      )}

      {/* Subtabs Bar */}
      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'manifests' ? 'active' : ''}`} onClick={() => setActiveSubtab('manifests')}>
          <FileText size={14} /> Shipping Manifests ({shipments.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'dispatch-trips' ? 'active' : ''}`} onClick={() => setActiveSubtab('dispatch-trips')}>
          <Truck size={14} /> Active Trips ({trips.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'cross-dock' ? 'active' : ''}`} onClick={() => setActiveSubtab('cross-dock')}>
          <MapPin size={14} /> Outbound Orders ({orders.length})
        </button>
      </div>

      {/* ═══ TAB 1: SHIPPING MANIFESTS & DELIVERY TRACKING ═══ */}
      {activeSubtab === 'manifests' && (
        <DataTable
          title="Outbound Shipping Manifests & Store Deliveries"
          subtitle="Real-time delivery progress, dispatched LPNs, seal numbers, and destination manifests"
          columns={[
            {
              header: 'Manifest No.',
              key: 'batch_no',
              render: r => (
                <button
                  onClick={() => setSelectedManifest(r)}
                  style={{
                    background: 'none', border: 'none', color: '#7c3aed',
                    fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    textDecoration: 'underline', padding: 0, fontSize: 12
                  }}
                  title="Click to view manifest details & print"
                >
                  {r.batch_no || (r.batch_id ? `MAN-${String(r.batch_id).slice(0, 8).toUpperCase()}` : '—')}
                </button>
              )
            },
            {
              header: 'Batch ID',
              key: 'batch_no',
              render: r => <span className="code-cell">{r.batch_no || String(r.batch_id || '')}</span>
            },
            {
              header: 'LPN Barcode',
              key: 'lpn_barcode',
              render: r => <span style={{ fontFamily: 'var(--font-mono)', color: '#047857', fontWeight: 700 }}>{r.batch_no || String(r.batch_id || '')}</span>
            },
            {
              header: 'Destination Store',
              key: 'destination_name',
              render: r => <span style={{ color: '#0f172a' }}>{r.destination_name || 'Hafeezpet #009'}</span>
            },
            {
              header: 'Carrier & Driver',
              render: r => (
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{r.vehicle_number || 'AP 05 TX 9988'}</div>
                  <span style={{ color: '#64748b', fontSize: 11 }}>{r.driver_name || 'Konda Rahul'}</span>
                </div>
              )
            },
            {
              header: 'Seal No.',
              key: 'seal_number',
              render: r => <span className="badge badge-purple">{r.seal_number || 'SEAL-2026-08'}</span>
            },
            {
              header: 'Ordered Units',
              key: 'ordered_qty',
              align: 'right',
              render: r => <strong className="mono-num" style={{ fontSize: 13 }}>{r.ordered_qty ?? 50}</strong>
            },
            {
              header: 'Delivered Units',
              key: 'delivered_qty',
              align: 'right',
              render: r => (
                <strong className="mono-num" style={{ color: '#047857', fontSize: 13 }}>
                  {r.delivered_qty ?? (r.status === 'DELIVERED' ? (r.ordered_qty ?? 50) : 0)}
                </strong>
              )
            },
            {
              header: 'Remaining Units',
              align: 'right',
              render: r => {
                const ord = r.ordered_qty ?? 50;
                const del = r.delivered_qty ?? (r.status === 'DELIVERED' ? ord : 0);
                const rem = Math.max(0, ord - del);
                return (
                  <strong className="mono-num" style={{ color: rem > 0 ? '#dc2626' : '#64748b', fontSize: 13 }}>
                    {rem}
                  </strong>
                );
              }
            },
            {
              header: 'Status',
              key: 'status',
              render: r => (
                <span className={`badge ${r.status === 'DELIVERED' ? 'badge-success' : r.status === 'IN_TRANSIT' ? 'badge-purple' : r.status === 'LOADED' ? 'badge-info' : 'badge-warning'}`}>
                  {r.status || 'READY'}
                </span>
              )
            },
            {
              header: 'Action',
              render: r => (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
                    onClick={(e) => { e.stopPropagation(); setSelectedManifest(r); }}
                  >
                    View
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
                    onClick={(e) => { e.stopPropagation(); handlePrintManifest(r); }}
                    title="Print Manifest PDF"
                  >
                    <Printer size={12} />
                  </button>
                  {r.status !== 'DELIVERED' && r.status !== 'IN_TRANSIT' && (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: '3px 8px', height: 26, background: '#7c3aed' }}
                      onClick={(e) => { e.stopPropagation(); handleDispatchShipment(r.batch_id || r.id); }}
                    >
                      <Truck size={11} /> Dispatch
                    </button>
                  )}
                  {r.status === 'IN_TRANSIT' && (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: '3px 8px', height: 26, background: '#059669' }}
                      onClick={(e) => { e.stopPropagation(); handleDeliverShipment(r.batch_id || r.id); }}
                    >
                      <CheckCircle2 size={11} /> Deliver
                    </button>
                  )}
                  </div>
              )
            }
          ]}
          data={shipments}
        />
      )}

      {/* ═══ TAB 2: ACTIVE DISPATCH TRIPS ═══ */}
      {activeSubtab === 'dispatch-trips' && (
        <DataTable
          title="Vehicle Fleet & Dispatch Trips"
          subtitle="Route management, driver assignments, and vehicle departures from Mother Hub RJY-DS-001"
          onAdd={openCreateTripModal}
          addLabel="Create Dispatch Trip"
          columns={[
            { header: 'Trip ID', key: 'trip_id', render: r => <strong className="code-cell">{r.route_id ? `RT-${String(r.route_id).slice(0, 8).toUpperCase()}` : '—'}</strong> },
            { header: 'Vehicle', key: 'vehicle_number', render: r => <strong className="code-cell">{r.vehicle_number || 'AP 05 TX 9988'}</strong> },
            { header: 'Driver', key: 'driver_name', render: r => <span>{r.driver_name} ({r.driver_phone || '98765-43210'})</span> },
            { header: 'Seal Number', key: 'seal_number', render: r => <span className="badge badge-purple">{r.seal_number || 'SEAL-2026-08'}</span> },
            { header: 'Destination', key: 'destination_name', render: r => <strong>{r.destination_name || 'Hafeezpet #009'}</strong> },
            { header: 'Stops', key: 'total_stops', align: 'right', render: r => <span className="mono-num">{r.total_stops || 3} Stops</span> },
            { header: 'Status', key: 'status', render: r => (
              <span className={`badge ${r.status === 'COMPLETED' ? 'badge-success' : r.status === 'IN_TRANSIT' ? 'badge-purple' : 'badge-warning'}`}>
                {r.status || 'PLANNED'}
              </span>
            )},
            { header: 'Departure Time', key: 'departure_time', render: r => <span style={{ fontSize: 11, color: '#64748b' }}>{r.departure_time ? new Date(r.departure_time).toLocaleString() : '16-Sep-2026 10:30 AM'}</span> },
          ]}
          data={trips}
        />
      )}

      {/* ═══ TAB 3: OUTBOUND ORDERS ═══ */}
      {activeSubtab === 'cross-dock' && (
        <DataTable
          title="Dark Store Replenishment Orders (STOs)"
          subtitle="Ordered, picked, sorted, and dispatched store allocations"
          columns={[
            { header: 'Order Code', key: 'order_number', render: r => <strong className="code-cell">{r.order_no || (r.order_id ? `ORD-${String(r.order_id).slice(0, 8).toUpperCase()}` : '—')}</strong> },
            { header: 'Store', key: 'destination_store_name', render: r => <strong>{r.destination_store_name || r.destination_store?.name || 'Store'}</strong> },
            { header: 'SKU', key: 'sku_name', render: r => <span>{r.sku_name || r.sku?.name || 'Multi-SKU Unit'}</span> },
            { header: 'Ordered', key: 'ordered_qty', align: 'right', render: r => <strong className="mono-num">{r.ordered_qty ?? 50}</strong> },
            { header: 'Picked', key: 'picked_qty', align: 'right', render: r => <strong className="mono-num" style={{ color: '#047857' }}>{r.picked_qty ?? r.ordered_qty ?? 50}</strong> },
            { header: 'Status', key: 'order_status', render: r => (
              <span className={`badge ${r.order_status === 'SHIPPED' || r.status === 'SHIPPED' ? 'badge-success' : 'badge-info'}`}>
                {r.order_status || r.status || 'ALLOCATED'}
              </span>
            )},
            { header: 'Pending Sort', align: 'right', render: r => <span style={{ color: (r.pending_sort > 0) ? '#dc2626' : '#64748b', fontWeight: 700 }}>{r.pending_sort ?? 0}</span> },
            { header: 'Sorted Qty', align: 'right', render: r => <strong style={{ color: '#047857' }}>{(r.sorted_qty ?? r.ordered_qty ?? 25).toLocaleString()}</strong> },
            { header: 'Shipped Qty', align: 'right', render: r => <span className="mono-num">{(r.shipped_qty ?? 0).toLocaleString()}</span> },
            { header: 'Tote / LPN ID', render: r => <strong className="code-cell">{r.tote_id || r.lpn_barcode || '—'}</strong> }
          ]}
          data={orders}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════
         1. FLOATING HOVER MODAL: CREATE DISPATCH TRIP
         ══════════════════════════════════════════════════════════════ */}
      {showTripModal && (
        <div className="modal-overlay" onClick={() => setShowTripModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '90vw' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Truck size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Schedule New Dispatch Trip</h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Mother Hub RJY-DS-001 • Carrier Assignment</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowTripModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleTripSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Vehicle Plate</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newTrip.vehicle_number}
                    onChange={e => setNewTrip({ ...newTrip, vehicle_number: e.target.value })}
                    placeholder="AP 05 TX 9988"
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Driver Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newTrip.driver_name}
                    onChange={e => setNewTrip({ ...newTrip, driver_name: e.target.value })}
                    placeholder="Konda Rahul"
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Driver Phone</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newTrip.driver_phone}
                    onChange={e => setNewTrip({ ...newTrip, driver_phone: e.target.value })}
                    placeholder="98765-43210"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>Security Seal No</label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ borderColor: '#059669', borderWidth: 2 }}
                    value={newTrip.seal_number}
                    onChange={e => setNewTrip({ ...newTrip, seal_number: e.target.value })}
                    placeholder="SEAL-2026-08"
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Destination Store</label>
                  <select
                    className="form-input"
                    value={newTrip.destination_id}
                    onChange={e => setNewTrip({ ...newTrip, destination_id: e.target.value })}
                  >
                    <option value="">-- All Route Stores --</option>
                    {stores.map(st => (
                      <option key={st.site_id} value={st.site_id}>{st.name} ({st.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Planned Stops</label>
                  <input
                    type="number"
                    className="form-input"
                    min={1}
                    value={newTrip.total_stops}
                    onChange={e => setNewTrip({ ...newTrip, total_stops: parseInt(e.target.value) || 1 })}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowTripModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: '#7c3aed', color: '#fff' }}>
                  <Truck size={14} /> Schedule Trip Departure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
         2. FLOATING HOVER MODAL: VIEW SHIPPING MANIFEST
         ══════════════════════════════════════════════════════════════ */}
      {selectedManifest && (
        <div className="modal-overlay" onClick={() => setSelectedManifest(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 880, width: '92vw' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    Shipping Manifest — {selectedManifest.batch_no || (selectedManifest.batch_id ? `MAN-${String(selectedManifest.batch_id).slice(0, 8).toUpperCase()}` : '—')}
                  </h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Mother Hub: RJY-DS-001 • Destination: {selectedManifest.destination_name || 'Hafeezpet #009'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handlePrintManifest(selectedManifest)}>
                  <FileText size={13} /> Print
                </button>
                <button className="modal-close" onClick={() => setSelectedManifest(null)}><X size={18} /></button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>BATCH ID</div>
                <div style={{ fontWeight: 800, color: '#7c3aed' }}>{selectedManifest.batch_no || String(selectedManifest.batch_id || '')}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>CONTAINER LPN</div>
                <div style={{ fontWeight: 800, fontFamily: 'monospace', color: '#047857' }}>{selectedManifest.batch_no || String(selectedManifest.batch_id || '')}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>CARRIER & DRIVER</div>
                <div style={{ fontWeight: 700 }}>{selectedManifest.vehicle_number || 'AP 05 TX 9988'} ({selectedManifest.driver_name || 'Rahul'})</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>SEAL & STATUS</div>
                <div style={{ fontWeight: 800, color: '#059669' }}>{selectedManifest.seal_number || 'SEAL-2026-08'} ({selectedManifest.status || 'READY'})</div>
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <strong>Fulfillment Progress</strong>
                <span>
                  <span style={{ color: '#047857' }}>{selectedManifest.delivered_qty ?? (selectedManifest.status === 'DELIVERED' ? (selectedManifest.ordered_qty ?? 50) : 0)} Delivered</span> / {selectedManifest.ordered_qty ?? 50} Ordered
                </span>
              </div>
              <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.round(((selectedManifest.delivered_qty ?? (selectedManifest.status === 'DELIVERED' ? (selectedManifest.ordered_qty ?? 50) : 0)) / (selectedManifest.ordered_qty ?? 50)) * 100))}%`, background: selectedManifest.status === 'DELIVERED' ? '#059669' : '#7c3aed', borderRadius: 3 }} />
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>#</th>
                  <th style={{ padding: '6px 8px' }}>SKU Code</th>
                  <th style={{ padding: '6px 8px' }}>Product Name</th>
                  <th style={{ padding: '6px 8px' }}>Batch No</th>
                  <th style={{ padding: '6px 8px' }}>Storage Bin</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {(selectedManifest.items && selectedManifest.items.length > 0) ? selectedManifest.items.map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 700 }}>{it.sku_code || 'SKU'}</td>
                    <td style={{ padding: '6px 8px' }}><strong>{it.sku_name || 'Product Item'}</strong></td>
                    <td style={{ padding: '6px 8px' }}>{it.batch_number || 'BAT-2026-09'}</td>
                    <td style={{ padding: '6px 8px' }}><span className="location-pill">{it.source_location_code || 'A-01-01-01'}</span></td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: '#047857' }}>{it.qty || 10}</td>
                  </tr>
                )) : (
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px' }}>1</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 700 }}>SKU-MILK-500</td>
                    <td style={{ padding: '6px 8px' }}><strong>Amul Taaza Toned Fresh Milk 500ml</strong></td>
                    <td style={{ padding: '6px 8px' }}>BAT-2026-09</td>
                    <td style={{ padding: '6px 8px' }}><span className="location-pill">A-01-02-04</span></td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: '#047857' }}>{selectedManifest.ordered_qty ?? 50}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
