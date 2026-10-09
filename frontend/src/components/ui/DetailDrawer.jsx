import React from 'react';
import { 
  X, Package, Barcode, CheckCircle, Truck, Clock, MapPin, 
  Printer, ArrowRight, Layers, Boxes, AlertTriangle, Calendar,
  ShieldCheck, ArrowDownToLine, Phone, User, CheckCircle2, XCircle,
  Tag, ArrowRightLeft, Sparkles, Building2, Receipt
} from 'lucide-react';
import BarcodeGenerator from './BarcodeGenerator';
import { openBarcodePrintWindow } from '../../utils/barcodeUtils';

export default function DetailDrawer({ isOpen, onClose, title = '', data, onAction }) {
  if (!isOpen || !data) return null;

  // ── ENTITY TYPE DETECTION ──
  const isBatch = Boolean(
    data.batch_code || 
    (data.barcode && String(data.barcode).startsWith('LPN')) || 
    title.includes('Packing') || 
    title.includes('Batch')
  );

  const isInboundConsignment = Boolean(
    ((data.reference_number && data.vehicle_number && !data.trip_no) || 
    data.inbound_type || 
    (data.asn_number && !data.putaway_id && !data.testing_id) ||
    title.includes('Advance Shipping') || 
    title.includes('Goods Receipt') ||
    title.includes('Consignment') ||
    title.includes('Inbound Vendor')) && !isBatch
  );

  const isQcLine = Boolean(
    (data.testing_id !== undefined || data.test_id !== undefined || (data.accepted_qty !== undefined && data.damaged_qty !== undefined && !isInboundConsignment) || title.includes('Quality') || title.includes('QC')) &&
    !isInboundConsignment && !isBatch
  );

  const isPutawayTask = Boolean(
    (data.putaway_id !== undefined || data.task_id !== undefined || title.includes('Putaway') || (data.source_location_code && data.destination_location_code && data.qty)) &&
    !isQcLine && !isBatch && !isInboundConsignment
  );

  const isManifest = Boolean(
    data.manifest_no || (data.seal_number && data.destination_name && data.ordered_qty !== undefined) || title.includes('Manifest')
  );

  const isTrip = Boolean(
    (data.trip_id || data.trip_no || (data.vehicle_number && data.driver_name && data.total_stops !== undefined)) && !isManifest
  );

  const isOrder = Boolean(
    data.order_no || (data.order_type && !data.inbound_type) || (data.order_number && data.destination_store_name) || title.includes('Order') || title.includes('STO')
  );

  const isMovement = Boolean(
    data.movement_type || (data.from_location_code && data.to_location_code && data.movement_type) || title.includes('Movement')
  );

  const isInventory = Boolean(
    (data.location_code || data.lot_code || (data.bin_code && data.qty !== undefined && !isPutawayTask)) && !isBatch && !isOrder && !isMovement && !isManifest
  );

  const isSku = Boolean(
    (data.sku_code || data.ean || data.mrp) && !isInventory && !isQcLine && !isBatch
  );

  // Quick Barcode for Entity
  const barcodeValue = data.lpn_barcode || data.barcode || data.ean || (data.batch_code ? data.lpn_barcode : '') || (data.sku_code ? data.sku_code : '');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" style={{ width: '580px', maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="drawer-header" style={{ background: '#0f172a', color: '#ffffff', borderBottom: '1px solid #1e293b', padding: '16px 20px' }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="brand-badge" style={{ background: '#7c3aed', color: '#fff', width: '24px', height: '24px', fontSize: '12px', fontWeight: 800, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Z</span>
              <span className="drawer-title" style={{ color: '#ffffff', fontSize: '15px', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isBatch
                  ? (data.batch_code || `BATCH-${data.id}`)
                  : isManifest
                  ? (data.manifest_no || `MANIFEST-${data.id}`)
                  : isInboundConsignment 
                  ? (data.reference_number || data.asn_number || `INB-${String(data.id).padStart(6, '0')}`)
                  : isQcLine
                  ? `QC INSPECTION #${data.testing_id || data.id}`
                  : isPutawayTask
                  ? `PUTAWAY TASK #PUT-${String(data.putaway_id || data.id).padStart(5, '0')}`
                  : isTrip
                  ? (data.trip_id || data.trip_no || `TRIP-${data.id}`)
                  : isOrder
                  ? (data.order_no || data.order_number || `STO-${data.id}`)
                  : isMovement
                  ? `MOVEMENT MV-${String(data.id).padStart(4, '0')}`
                  : isInventory
                  ? `${data.sku_name || data.sku?.name || 'Inventory Stock'}`
                  : (data.name || data.sku_code || 'Record Details')}
              </span>
            </div>
            <div className="drawer-subtitle" style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
              {isBatch && `Outbound Multi-Product Unit • To: ${data.destination_name || 'Dark Store Network'}`}
              {isManifest && `Outbound Shipping Gate Pass • Destination: ${data.destination_name || 'Dark Store'}`}
              {isInboundConsignment && `Supplier Inbound Delivery • ${data.vendor_name || data.vendor?.name || 'Vendor Consignment'}`}
              {isQcLine && `Dock QC Stage • ${data.sku_name || data.sku?.name || 'Product Line'}`}
              {isPutawayTask && `Storage Allocation Task • ${data.sku_name || data.sku?.name || 'Item'}`}
              {isTrip && `Transport Departure Fleet • Vehicle ${data.vehicle_number || data.vehicle_no}`}
              {isOrder && `Store Replenishment STO • ${data.destination_store_name || data.remarks || 'Store'}`}
              {isMovement && `Internal Stock Relocation & Audit Ledger`}
              {isInventory && `Storage Bin Stock Position • Bin ${data.location_code || data.bin_code || 'A-01-01'}`}
              {isSku && `Product SKU Catalog • MRP ₹${data.mrp || 0}`}
            </div>
          </div>
          <button className="icon-btn" style={{ background: '#1e293b', borderColor: '#334155', color: '#ffffff', cursor: 'pointer' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body" style={{ padding: '16px 20px', background: '#f8fafc', overflowY: 'auto', flex: 1 }}>
          
          {/* ═══════════════════════════════════════════════════════════
             CASE 1: OUTBOUND PACKING BATCH & MULTI-PRODUCT UNIT
             ═══════════════════════════════════════════════════════════ */}
          {isBatch && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Outbound Unit Status
                  </span>
                  <span className="badge badge-success">{data.status || 'ALLOCATED'}</span>
                </div>

                {/* Scannable Code 128 Barcode */}
                <div style={{ textAlign: 'center', margin: '12px 0', padding: '10px', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <BarcodeGenerator value={data.lpn_barcode || data.barcode || `LPN-RJY-2026-${100 + data.id}`} width={300} height={60} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Destination Store</span>
                    <strong style={{ color: '#7c3aed', fontSize: '13px' }}>{data.destination_name || 'Hafeezpet #009'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Total Units</span>
                    <strong style={{ fontSize: '14px', color: '#047857' }}>{data.total_units || data.total_packed_qty || data.ordered_qty || 25} Units</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Container Weight</span>
                    <strong>{data.gross_weight_kg ? `${data.gross_weight_kg} kg` : '6.5 kg'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Container Type</span>
                    <span className="badge badge-purple">{data.lpn_type || 'TOTE / PALLET'}</span>
                  </div>
                </div>
              </div>

              {/* Packed Line Items */}
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Boxes size={16} style={{ color: '#7c3aed' }} /> Packed Products Breakdown ({data.items?.length || data.sku_count || 1})
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(data.items && data.items.length > 0 ? data.items : [{
                    sku_name: 'Amul Taaza Toned Fresh Milk 500ml',
                    sku_code: 'SKU-MILK-500',
                    qty: data.total_units || 25,
                    batch_number: 'BAT-2026-09',
                    source_location_code: 'A-01-02-04'
                  }]).map((item, idx) => (
                    <div key={idx} style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ color: '#0f172a' }}>{item.sku_name || item.sku?.name || item.sku_code || `Product #${idx + 1}`}</strong>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          Bin: <strong style={{ color: '#7c3aed', fontFamily: 'monospace' }}>{item.source_location_code || 'A-01-01-01'}</strong> • Batch: {item.batch_number || 'BAT-2026-09'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="badge badge-success" style={{ fontSize: '12px', fontWeight: 800 }}>
                          {item.qty} units
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
             CASE 2: SHIPPING MANIFEST
             ═══════════════════════════════════════════════════════════ */}
          {isManifest && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Manifest Status
                  </span>
                  <span className={`badge ${data.status === 'DELIVERED' ? 'badge-success' : data.status === 'IN_TRANSIT' ? 'badge-purple' : 'badge-warning'}`}>
                    {data.status || 'READY'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Destination Store</span>
                    <strong style={{ color: '#7c3aed', fontSize: '13px' }}>{data.destination_name || 'Hafeezpet #009'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Batch ID</span>
                    <strong style={{ fontFamily: 'monospace' }}>{data.batch_code || `XHYD08000K${800 + data.id}`}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Carrier Vehicle</span>
                    <strong>{data.vehicle_number || 'AP 05 TX 9988'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Driver Name</span>
                    <span>{data.driver_name || 'Konda Rahul'}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Security Seal</span>
                    <span className="badge badge-purple">{data.seal_number || 'SEAL-2026-08'}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Ordered Units</span>
                    <strong style={{ color: '#047857', fontSize: '13px' }}>{data.ordered_qty ?? 50} Units</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
             CASE 3: INBOUND CONSIGNMENT
             ═══════════════════════════════════════════════════════════ */}
          {isInboundConsignment && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Inbound Delivery Status
                  </span>
                  <span className={`badge ${data.status === 'PUTAWAY_DONE' || data.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'}`}>
                    {data.status || 'GATE_IN'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Supplier Vendor</span>
                    <strong style={{ color: '#7c3aed', fontSize: '13px' }}>{data.vendor_name || data.vendor?.name || 'Supplier'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>PO Reference #</span>
                    <strong style={{ fontFamily: 'monospace', fontSize: '13px' }}>{data.reference_number || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Vehicle Plate</span>
                    <strong style={{ fontFamily: 'monospace' }}>{data.vehicle_number || '—'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Driver</span>
                    <span>{data.driver_name || 'Driver'} {data.driver_phone ? `(${data.driver_phone})` : ''}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Expected Quantity</span>
                    <strong style={{ color: '#047857', fontSize: '14px' }}>{data.total_expected_qty || (data.items ? data.items.reduce((s, it) => s + (it.expected_qty || 0), 0) : 100)} Units</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Arrival Time</span>
                    <span>{data.created_at ? new Date(data.created_at).toLocaleTimeString() : '09:30 AM'}</span>
                  </div>
                </div>
              </div>

              {/* Delivery Line Items */}
              {Array.isArray(data.items) && data.items.length > 0 && (
                <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Boxes size={16} style={{ color: '#7c3aed' }} /> Delivery Products ({data.items.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {data.items.map((item, idx) => (
                      <div key={idx} style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{item.sku_name || item.sku?.name || `SKU #${item.sku_id || item.sku}`}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            Batch: {item.batch_number} • Expiry: {item.expiry_date || '—'}
                          </div>
                        </div>
                        <span className="badge badge-success" style={{ fontSize: '12px', fontWeight: 800 }}>
                          {item.expected_qty} Units
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
             CASE 4: QC INSPECTION LINE
             ═══════════════════════════════════════════════════════════ */}
          {isQcLine && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Inspection Status
                  </span>
                  <span className={`badge ${data.status === 'PASSED' ? 'badge-success' : data.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                    {data.status || 'PENDING'}
                  </span>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{data.sku_name || data.sku?.name}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>
                    SKU Code: {data.sku_code || data.sku?.sku_code || '—'}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', marginBottom: '12px' }}>
                  <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Expected</span>
                    <strong style={{ fontSize: '15px' }}>{data.expected_qty || 0}</strong>
                  </div>
                  <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '4px', border: '1px solid #a7f3d0' }}>
                    <span style={{ fontSize: '10px', color: '#047857', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Accepted</span>
                    <strong style={{ fontSize: '15px', color: '#059669' }}>{data.accepted_qty ?? 0}</strong>
                  </div>
                  <div style={{ background: '#fef2f2', padding: '8px', borderRadius: '4px', border: '1px solid #fecaca' }}>
                    <span style={{ fontSize: '10px', color: '#b91c1c', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Damaged/Rej</span>
                    <strong style={{ fontSize: '15px', color: '#dc2626' }}>{(data.damaged_qty || 0) + (data.rejected_qty || 0)}</strong>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Batch Number</span>
                    <strong style={{ fontFamily: 'monospace' }}>{data.batch_number || 'BAT-2026-09'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Expiry Date</span>
                    <strong style={{ color: '#dc2626' }}>{data.expiry_date || '—'}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
             CASE 5: STORAGE INVENTORY LOT
             ═══════════════════════════════════════════════════════════ */}
          {isInventory && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Storage Bin Stock Position
                  </span>
                  <span className="badge badge-success">IN STOCK</span>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{data.sku_name || data.sku?.name}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>
                    SKU Code: {data.sku_code || data.sku?.sku_code} • Storage Bin: {data.location_code}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', marginBottom: '12px' }}>
                  <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '4px', border: '1px solid #a7f3d0' }}>
                    <span style={{ fontSize: '10px', color: '#047857', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Total Qty</span>
                    <strong style={{ fontSize: '16px', color: '#059669' }}>{data.qty ?? 0} Units</strong>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Available</span>
                    <strong style={{ fontSize: '14px', color: '#047857' }}>{(data.qty || 0) - (data.blocked_qty || 0)}</strong>
                  </div>
                  <div style={{ background: '#fef2f2', padding: '8px', borderRadius: '4px', border: '1px solid #fecaca' }}>
                    <span style={{ fontSize: '10px', color: '#b91c1c', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Reserved</span>
                    <strong style={{ fontSize: '14px', color: '#dc2626' }}>{data.blocked_qty || 0}</strong>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', background: '#f8fafc', padding: '10px', borderRadius: '6px' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Batch Number</span>
                    <strong style={{ fontFamily: 'monospace' }}>{data.batch_number || 'BAT-2026-09'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Expiry Date</span>
                    <strong style={{ color: '#d97706' }}>{data.expiry_date || '14-Dec-2027'}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
             CASE 6: STOCK MOVEMENT LEDGER
             ═══════════════════════════════════════════════════════════ */}
          {isMovement && (
            <div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
                    Movement Type
                  </span>
                  <span className="badge badge-purple">{data.movement_type}</span>
                </div>

                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: 8 }}>{data.sku_name || data.sku?.name}</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>From Location</span>
                    <strong style={{ fontFamily: 'monospace' }}>{data.from_location_code || 'DOCK'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>To Location</span>
                    <strong style={{ fontFamily: 'monospace', color: '#059669' }}>{data.to_location_code || 'STORAGE'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Quantity</span>
                    <strong style={{ color: '#047857', fontSize: '14px' }}>{data.qty} Units</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>Timestamp</span>
                    <span>{data.created_at ? new Date(data.created_at).toLocaleString() : 'Just now'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div style={{ padding: '14px 20px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
          {isBatch && (
            <button
              className="btn-primary"
              style={{ flex: 1, justifyContent: 'center', background: '#0f172a', color: '#fff' }}
              onClick={() => openBarcodePrintWindow({
                barcode: data.lpn_barcode || data.barcode || `LPN-RJY-2026-${100 + data.id}`,
                batch_code: data.batch_code || `XHYD08000K${800 + data.id}`,
                destination_name: data.destination_name || 'Hafeezpet #009',
                total_units: data.total_units || data.total_packed_qty || data.ordered_qty || 25,
                items: data.items || [],
                sku_count: data.sku_count || data.items?.length || 1,
                gross_weight_kg: data.gross_weight_kg || 6.5,
                warehouse: 'RJY-DS-001 (Mother Hub)'
              })}
            >
              <Printer size={15} /> Print Barcode Label
            </button>
          )}
          <button className="btn-secondary" style={{ padding: '0 20px' }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
