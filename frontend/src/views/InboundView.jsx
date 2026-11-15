import React, { useState, useEffect } from 'react';
import { PackageCheck, ShieldCheck, Boxes, Plus, RefreshCw, CheckCircle2, Truck, ArrowRight, AlertTriangle, X, Building2, Layers, MapPin, Package, Camera, ScanLine, Box as BoxIcon, RotateCcw, Search, Loader2, Trash2, ClipboardList, ArrowRightLeft } from 'lucide-react';

// lucide's Box is an <svg>; used as a layout wrapper its children land in the
// SVG namespace and never render. Layout boxes here are plain divs.
const Box = ({ children, ...rest }) => <div {...rest}>{children}</div>;

import DataTable from '../components/ui/DataTable';
import LpnModal from '../components/ui/LpnModal';
import BarcodeScannerModal from '../components/ui/BarcodeScannerModal';
import BinTransferView from './BinTransferView';
import BinContentsView from './BinContentsView';
import TransferOrderView from './TransferOrderView';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../api/client';
import { resolveBin, binLabel } from '../utils/bins';

const SCAN_TITLES = {
  batch: 'Scan Consignment / ASN',
  product: 'Scan Product',
  bin: 'Scan Bin',
  putaway_product: 'Scan Product to Put Away',
  transfer_item: 'Scan Item to Transfer',
};

const SCAN_EXPECTED = {
  batch: 'ASN number or PO reference',
  product: 'product barcode, SKU code or EAN',
  bin: 'bin code or barcode',
  putaway_product: 'product barcode, SKU code or EAN',
  transfer_item: 'product barcode, SKU code or lot',
};

export default function InboundView({ initialTab = 'asns' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [consignments, setConsignments] = useState([]);
  const [qcLines, setQcLines] = useState([]);
  const [putawayTasks, setPutawayTasks] = useState([]);
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');

  // Floating Modal States
  const [showRegModal, setShowRegModal] = useState(false);
  const [showLpnModal, setShowLpnModal] = useState(false);
  const [selectedQcLine, setSelectedQcLine] = useState(null);
  const [selectedPutTask, setSelectedPutTask] = useState(null);

  // Barcode Scanner States
  const [showScanner, setShowScanner] = useState(false);
  const [scannedBatch, setScannedBatch] = useState(null);
  const [scanningMode, setScanningMode] = useState(null); // 'batch' | 'product' | 'bin' | 'putaway_product'
  // Handed to <useState, useEf /> when a bin is scanned on this screen.
  const [binContentsCode, setBinContentsCode] = useState('');
  const [selectedConsignment, setSelectedConsignment] = useState(null);

  // Registration Form State
  const [regVendor, setRegVendor] = useState('');
  const [regRefNo, setRegRefNo] = useState('');
  const [regVehicleNo, setRegVehicleNo] = useState('');
  const [regDriverName, setRegDriverName] = useState('');
  const [regDriverPhone, setRegDriverPhone] = useState('');
  const [regItems, setRegItems] = useState([{ sku_id: '', expected_qty: 100, batch_number: '', expiry_date: '' }]);

  // QC Form State
  const [qcForm, setQcForm] = useState({
    received_qty: 0,
    accepted_qty: 0,
    damaged_qty: 0,
    rejected_qty: 0,
    expired_qty: 0,
    batch_number: '',
    mfg_date: '',
    expiry_date: '',
    remarks: '',
  });

  // Putaway Form State
  const [putDestBin, setPutDestBin] = useState('');


  useEffect(() => { setActiveSubtab(initialTab); }, [initialTab]);
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [inbRes, qcRes, putRes, prodRes, venRes, locRes] = await Promise.all([
        fetchApi('/supply/asns/'),
        fetchApi('/supply/qc-inspections/'),
        fetchApi('/supply/putaway-tasks/'),
        fetchApi('/catalog/skus/'),
        fetchApi('/supply/vendors/'),
        fetchApi('/network/locations/'),
      ]);
      const inbList = unwrapList(inbRes);
      const qcList = unwrapList(qcRes);
      const putList = unwrapList(putRes);
      const prodList = unwrapList(prodRes);
      const venList = unwrapList(venRes);
      const locList = unwrapList(locRes);
      if (inbList) setConsignments(inbList);
      if (qcList) setQcLines(qcList);
      if (putList) setPutawayTasks(putList);
      if (prodList) setProducts(prodList);
      if (venList) setVendors(venList);
      if (locList) setLocations(locList);
      setLoadError('');
    } catch (err) {
      console.error('Inbound load error:', err);
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  // ”—€ REGISTRATION MODAL HANDLERS ”—€
  const openRegisterModal = () => {
    setRegVendor(vendors[0]?.id || '');
    setRegRefNo(`PO-${Date.now().toString().slice(-6)}`);
    setRegVehicleNo('AP-05-TX-4421');
    setRegDriverName('Ravi Kumar');
    setRegDriverPhone('9876543210');
    setRegItems([{
      sku_id: products[0]?.id || '',
      expected_qty: 100,
      batch_number: `BAT-${new Date().toISOString().slice(0, 7)}`,
      expiry_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    }]);
    setShowRegModal(true);
  };

  const addItemRow = () => {
    setRegItems(prev => [...prev, {
      sku_id: products[0]?.id || '',
      expected_qty: 50,
      batch_number: `BAT-${new Date().toISOString().slice(0, 7)}-${prev.length + 1}`,
      expiry_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    }]);
  };

  const removeItemRow = (idx) => {
    if (regItems.length <= 1) return;
    setRegItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx, field, val) => {
    setRegItems(prev => { const c = [...prev]; c[idx] = { ...c[idx], [field]: val }; return c; });
  };

  const submitRegistration = async (e) => {
    e.preventDefault();
    try {
      // Asn has no vendor_id/reference_number/vehicle_number/driver_*/items.
      // The header goes to /supply/asns/ and each line to /supply/asn-lines/.
      const totalQty = regItems.reduce(
        (t, it) => t + Math.max(1, Number(it.expected_qty) || 1), 0
      );
      const asn = await postApi('/supply/asns/', {
        asn_no: regRefNo,
        type: 'INBOUND',
        source_vendor: regVendor || vendors[0]?.vendor_id || '',
        po_ref: regRefNo,
        expected_vehicle: regVehicleNo || null,
        total_skus: regItems.length,
        total_qty: totalQty,
        status: 'EXPECTED',
      });

      for (let i = 0; i < regItems.length; i++) {
        const it = regItems[i];
        await postApi('/supply/asn-lines/', {
          asn: asn.asn_id,
          line_no: i + 1,
          sku: it.sku_id || products[0]?.sku_id,
          ordered_qty: Math.max(1, Number(it.expected_qty) || 100),
          expected_expiry: it.expiry_date || null,
          line_status: 'PENDING',
        });
      }
      setShowRegModal(false);
      await loadData();
      showToast(`Consignment ${regRefNo} registered with ${regItems.length} line(s). Ready for QC Testing.`);
      setActiveSubtab('qc-testing');
    } catch (err) {
      alert(`Registration failed: ${err.message}`);
    }
  };

  // ”—€ QC TESTING MODAL HANDLERS ”—€
  const openQcModal = (line) => {
    setSelectedQcLine(line);
    setQcForm({
      received_qty: line.received_qty || line.expected_qty || 0,
      accepted_qty: line.accepted_qty > 0 ? line.accepted_qty : (line.expected_qty || 0),
      damaged_qty: line.damaged_qty || 0,
      rejected_qty: line.rejected_qty || 0,
      expired_qty: line.expired_qty || 0,
      batch_number: line.batch_number || '',
      mfg_date: line.mfg_date || '',
      expiry_date: line.expiry_date || '',
      remarks: line.remarks || '',
    });
  };

  const submitQc = async (e) => {
    e.preventDefault();
    if (!selectedQcLine) return;
    try {
      const accepted = Number(qcForm.accepted_qty) || 0;
      const damaged = Number(qcForm.damaged_qty) || 0;
      const rejected = Number(qcForm.rejected_qty) || 0;
      const expired = Number(qcForm.expired_qty) || 0;
      const rec = Number(qcForm.received_qty) || (accepted + damaged + rejected + expired);
      const sampleSize = Math.max(1, accepted + damaged + rejected);
      const failCount = damaged + rejected + expired;

      // QcInspectionViewSet.verify reads sample_size / pass_count / fail_count /
      // status / remarks / tested_by. The old payload sent received_qty,
      // accepted_qty, batch_number, mfg_date... none of which exist, so QC could
      // never be recorded.
      await postApi(`/supply/qc-inspections/${selectedQcLine.qc_id || selectedQcLine.id}/verify/`, {
        sample_size: sampleSize,
        pass_count: accepted,
        fail_count: failCount,
        status: failCount === 0 ? 'PASSED' : (accepted > 0 ? 'PARTIAL' : 'FAILED'),
        remarks: [
          qcForm.remarks,
          `Received ${rec}.`,
          damaged ? `Damaged ${damaged}.` : null,
          rejected ? `Rejected ${rejected}.` : null,
          expired ? `Expired ${expired}.` : null,
        ].filter(Boolean).join(' '),
        tested_by: 'console',
      });
      setSelectedQcLine(null);
      await loadData();
      showToast(`QC recorded for ${selectedQcLine.sku_name || selectedQcLine.sku?.name}. ${accepted} units accepted.`);
      setActiveSubtab('putaway-tasks');
    } catch (err) {
      showToast(`QC submission failed: ${describeError(err)}`);
    }
  };

  // ”—€ PUTAWAY MODAL HANDLERS ”—€
  // Location exposes location_type, not type.
  const storageBins = locations.filter(l => l.location_type === 'BIN');
  // PutawayTask.sku is a Sku UUID; resolve it to a display name/code.
  const putawaySku = selectedPutTask
    ? products.find(p => p.sku_id === selectedPutTask.sku)
    : null;

  const openPutawayModal = (task) => {
    setSelectedPutTask(task);
    // Location.location_id is a UUID; Number(uuid) is NaN. The task's
    // confirmed_bin/suggested_bin are human bin codes, so they are resolved
    // to a UUID before being sent to /complete/.
    setPutDestBin('');
  };

  const submitPutaway = async (e) => {
    e.preventDefault();
    if (!selectedPutTask) return;
    try {
      // Accept either an already-resolved UUID or a human bin code.
      const rawDest = (putDestBin || selectedPutTask.confirmed_bin || selectedPutTask.suggested_bin || '').trim();
      if (!rawDest) {
        showToast('Choose or scan the destination bin.');
        return;
      }
      const dest = await resolveBin(rawDest);
      if (!dest || dest.candidates) {
        showToast(
          dest?.candidates?.length
            ? `"${rawDest}" matches ${dest.candidates.length} bins. Scan the exact bin barcode.`
            : `No bin matches "${rawDest}".`
        );
        return;
      }
      await postApi(`/supply/putaway-tasks/${selectedPutTask.task_id}/complete/`, {
        destination_location_id: dest.location_id,
      });
      setSelectedPutTask(null);
      setPutDestBin('');
      await loadData();
      showToast(`Putaway complete. Stock added to ${dest.label}.`);
    } catch (err) {
      showToast(`Putaway failed: ${describeError(err)}`);
    }
  };

  // ”—€ LPN CREATION MODAL HANDLERS ”—€
  const openLpnModal = () => {
    setShowLpnModal(true);
  };

  const handleLpnCreate = async (payload) => {
    try {
      // First create the LPN master
      const lpnRes = await postApi('/inventory/lpns/', {
        lpn_id: payload.barcode,
        barcode: payload.barcode,
        lpn_type: payload.type || 'TOTE',
        current_site: payload.destination_id || '',
        status: 'CREATED',
        created_by: 'inbound@zippzo.in',
      });
      const lpnId = lpnRes.lpn_id || lpnRes.id;

      // Then create LPN contents for each item, validating against available stock
      for (const item of payload.items) {
        const qty = parseInt(item.quantity) || 1;
        // Check available stock at the source location
        const stockRes = await fetchApi(
          `/inventory/balances/?site=${encodeURIComponent(payload.destination_id || '')}&sku=${encodeURIComponent(item.sku)}&container=BIN&container_ref=${encodeURIComponent(item.source_location_id)}`
        );
        const balances = unwrapList(stockRes) || [];
        const available = balances.reduce((sum, b) => sum + (b.qty || 0), 0);
        if (available < qty) {
          throw new Error(`Insufficient stock for SKU ${item.sku}: ${available} available, ${qty} requested`);
        }
        await postApi('/inventory/lpn-contents/', {
          lpn: lpnId,
          sku: item.sku,
          lot: item.lot,
          qty,
        });
      }
      await loadData();
      showToast(`âœ“ LPN ${payload.barcode} created with ${payload.items.length} item(s).`);
    } catch (err) {
      alert(`LPN creation failed: ${describeError(err)}`);
    }
  };

  // ”—€ BARCODE SCANNER HANDLERS ”—€
  const handleScanComplete = (code) => {
    const cleanCode = code.trim().toUpperCase();
    setScannedBatch(cleanCode);
    setShowScanner(false);
    
    switch (scanningMode) {
      case 'batch':
        handleBatchScan(cleanCode);
        break;
      case 'product':
        handleProductScan(cleanCode);
        break;
      case 'bin':
        handleBinScan(cleanCode);
        break;
      case 'putaway_product':
        handlePutawayProductScan(cleanCode);
        break;
      default:
        setScannedBatch(cleanCode);
    }
  };

  const openBatchScanner = () => {
    setScanningMode('batch');
    setShowScanner(true);
  };

  const openProductScanner = () => {
    setScanningMode('product');
    setShowScanner(true);
  };

  const openBinScanner = () => {
    setScanningMode('bin');
    setShowScanner(true);
  };

  const openPutawayProductScanner = () => {
    setScanningMode('putaway_product');
    setShowScanner(true);
  };

  const openBinContentsModal = (binCode) => {
    // Bin contents live on their own tab; hand the scanned code over so
    // <eact, { useStat /> starts on that bin. The previous version set a
    // `showBinContentsModal` flag that was never rendered, so the scan did
    // nothing visible.
    setBinContentsCode(binCode);
    setActiveSubtab('bin-contents');
  };

  const handleBatchScan = async (code) => {
    try {
      // Asn exposes asn_no and po_ref; there is no reference_number field, so
      // the old filter was silently ignored and returned the first ASN.
      const res = await fetchApi(`/supply/asns/?search=${encodeURIComponent(code)}`);
      const data = unwrapList(res);
      const hit = Array.isArray(data)
        ? data.find(a => a.asn_no === code || a.po_ref === code)
        : null;
      if (hit) {
        setSelectedConsignment(hit);
        setActiveSubtab('qc-testing');
        showToast(`Consignment ${hit.asn_no} found. Ready for QC.`);
      } else {
        showToast(`Consignment ${code} not found. Register it as new?`);
      }
    } catch (err) {
      showToast(`Error: ${describeError(err)}`);
    }
  };

  const handleProductScan = async (code) => {
    if (!selectedConsignment) {
      showToast('Scan a consignment (ASN) barcode first.');
      return;
    }
    try {
      // Asn exposes no nested `items`, and AsnLine has no `sku_barcode` /
      // `expected_qty`. The real contract is a separate call to
      // /supply/asn-lines/?asn=<ct } f> matched on `ean`.
      const lines = unwrapList(await fetchApi(
        `/supply/asn-lines/?asn=${encodeURIComponent(selectedConsignment.asn_id)}`
      ));
      const wanted = String(code).trim().toUpperCase();
      const line = (Array.isArray(lines) ? lines : []).find(l =>
        String(l.ean || '').trim().toUpperCase() === wanted
      );
      if (!line) {
        showToast(`Product ${code} not found on ${selectedConsignment.asn_no}.`);
        return;
      }
      const sku = products.find(p => p.sku_id === line.sku);
      setQcForm({
        received_qty: line.ordered_qty || 0,
        accepted_qty: line.ordered_qty || 0,
        damaged_qty: 0,
        rejected_qty: 0,
        expired_qty: 0,
        batch_number: '',
        mfg_date: '',
        expiry_date: line.expected_expiry || '',
        remarks: '',
      });
      setSelectedQcLine({
        ...line,
        asn_no: selectedConsignment.asn_no,
        ean: line.ean,
        sku_code: sku?.sku_code || line.sku,
        sku_name: sku?.name || sku?.sku_code || line.sku,
        expected_qty: line.ordered_qty,
      });
      setActiveSubtab('qc-testing');
      showToast(`âœ“ ${sku?.sku_code || line.ean} scanned for QC.`);
    } catch (err) {
      showToast(`Error: ${describeError(err)}`);
    }
  };

  const handleBinScan = (code) => {
    // Open bin contents modal when bin is scanned
    openBinContentsModal(code);
  };

  const handlePutawayProductScan = async (code) => {
    if (!selectedPutTask) {
      showToast('Open a putaway task first.');
      return;
    }
    try {
      // PutawayTask has no `sku_barcode` / `sku.barcode`; `sku` is a Sku UUID.
      // Match the scanned code against the catalog SKU it points at.
      const wanted = String(code).trim().toUpperCase();
      const lines = unwrapList(await fetchApi(
        `/supply/putaway-tasks/?status=CONFIRMED&page_size=200`
      ));
      const tasks = Array.isArray(lines) ? lines : [];
      const task = tasks.find(t => {
        if (t.task_id === selectedPutTask.task_id || t.task_id === selectedPutTask.id) return true;
        const sku = products.find(p => p.sku_id === t.sku);
        return [sku?.sku_code, sku?.ean, sku?.barcode, t.lot, t.confirmed_bin]
          .some(f => String(f ?? '').trim().toUpperCase() === wanted);
      });
      if (task) {
        setPutDestBin(task.confirmed_bin || task.suggested_bin || putDestBin);
        showToast(`âœ“ ${task.sku} scanned. Bin ${task.confirmed_bin || 'from task'} selected.`);
      } else {
        showToast(`Product ${code} not found in the open putaway tasks.`);
      }
    } catch (err) {
      showToast(`Error: ${describeError(err)}`);
    }
  };

  // Bin transfer and bin-contents are rendered by <BinTransferView /> and
  // <BinContentsView /> on the tabs below. An earlier inline transfer modal
  // used to live here; it was unreachable (never rendered) and fed raw scanned
  // codes to /inventory/relocate, which only accepts Location.location_id.

  // ”—€ DARK STORE TRANSFER ORDER ”—€
  // Rendered by <eState, useEffect /> on the transfer-order tab. The inline
  // form that used to live here was never rendered, hard-coded
  // source_site/dest_site UUIDs, and invented a non-UUID picklist_id.

  return (
    <div>
      {/* Toast Notification */}
      {toast && (
        <Box style={{
          position: 'fixed', top: 20, right: 24, zIndex: 999999,
          background: '#065f46', color: '#fff', padding: '12px 20px',
          borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10
        }}>
          âœ“ {toast}
        </Box>
      )}

      {/* Subtabs Bar */}
      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'asns' ? 'active' : ''}`} onClick={() => setActiveSubtab('asns')}>
          <PackageCheck size={14} /> Consignments ({consignments.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'qc-testing' ? 'active' : ''}`} onClick={() => setActiveSubtab('qc-testing')}>
          <ClipboardList size={14} /> QC Inspection ({qcLines.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'putaway-tasks' ? 'active' : ''}`} onClick={() => setActiveSubtab('putaway-tasks')}>
          <ArrowRightLeft size={14} /> Putaway Tasks ({putawayTasks.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'bin-transfer' ? 'active' : ''}`} onClick={() => setActiveSubtab('bin-transfer')}>
          <MapPin size={14} /> Bin Transfer
        </button>
        <button className={`subtab-btn ${activeSubtab === 'bin-contents' ? 'active' : ''}`} onClick={() => setActiveSubtab('bin-contents')}>
          <MapPin size={14} /> Bin Contents
        </button>
        <button className={`subtab-btn ${activeSubtab === 'transfer-order' ? 'active' : ''}`} onClick={() => setActiveSubtab('transfer-order')}>
          <ArrowRight size={14} /> Transfer Order
        </button>
        <button className="btn-secondary" style={{ marginLeft: 'auto', marginRight: 8 }} onClick={openLpnModal}>
          <Plus size={14} /> Create LPN
        </button>
        <button className="btn-primary" style={{ marginLeft: 8 }} onClick={openBatchScanner}>
          <ScanLine size={14} /> Scan Batch
        </button>
        <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={openBinScanner}>
          <MapPin size={14} /> Scan Bin
        </button>
        <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={openTransferOrderModal}>
          <ArrowRight size={14} /> Create Transfer Order
        </button>
      </div>

      {/* â•â•â• TAB 1: CONSIGNMENTS â•â•â• */}
      {activeSubtab === 'asns' && (
        <DataTable
          title="Inbound Vendor Consignments"
          subtitle="Dock arrivals and supplier delivery purchase orders — Warehouse: RJY-DS-001"
          onAdd={openRegisterModal}
          addLabel="Register Consignment"
          columns={[
            { header: 'Inbound #', key: 'id', render: r => <span className="code-cell">INB-{String(r.id).padStart(6, '0')}</span> },
            { header: 'PO / Ref #', key: 'reference_number', render: r => <strong className="code-cell">{r.reference_number || '—'}</strong> },
            { header: 'Supplier / Vendor', key: 'vendor_name', render: r => (
              <span style={{ fontWeight: 600 }}>{r.vendor_name || r.vendor?.name || '—'}</span>
            )},
            { header: 'Vehicle', key: 'vehicle_number', render: r => <span className="code-cell">{r.vehicle_number || '—'}</span> },
            { header: 'Driver', render: r => <span>{r.driver_name ? `${r.driver_name} (${r.driver_phone || ''})` : '—'}</span> },
            { header: 'Items', render: r => <span className="mono-num">{r.items_count || r.items?.length || 1} SKUs</span> },
            { header: 'Total Expected', render: r => <strong className="mono-num" style={{ fontSize: 13 }}>{r.total_expected_qty || r.items?.reduce((s, it) => s + (it.expected_qty || 0), 0) || '—'}</strong> },
            { header: 'Status', key: 'status', render: r => (
              <span className={`badge ${r.status === 'PUTAWAY_DONE' || r.status === 'COMPLETED' ? 'badge-success' : r.status === 'QC_IN_PROGRESS' || r.status === 'QC_PENDING' ? 'badge-warning' : 'badge-info'}`}>
                {r.status || 'GATE_IN'}
              </span>
            )},
            { header: 'Arrival Time', key: 'created_at', render: r => <span style={{ fontSize: 11, color: '#64748b' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : '16-Sep-2026 09:30 AM'}</span> },
          ]}
          data={consignments}
        />
      )}

      {/* â•â•â• TAB 2: QC TESTING â•â•â• */}
      {activeSubtab === 'qc-testing' && (
        <DataTable
          title="Dock Quality Control Inspection"
          subtitle="Test incoming batches for damages, rejections, expiry dates, and verify quantities"
          columns={[
            { header: 'QC ID', key: 'id', render: r => <span className="code-cell">QC-{String(r.id).padStart(5, '0')}</span> },
            { header: 'Inbound No.', render: r => <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{r.asn_number || (r.inbound_id ? `INB-${String(r.inbound_id).padStart(6, '0')}` : `INB-${r.inbound}`)}</span> },
            { header: 'SKU Code', key: 'sku_code', render: r => <strong className="code-cell">{r.sku_code || r.sku?.sku_code || '—'}</strong> },
            { header: 'Product Name', key: 'sku_name', render: r => <strong>{r.sku_name || r.sku?.name || '—'}</strong> },
            { header: 'Expected', key: 'expected_qty', align: 'right', render: r => <strong className="mono-num" style={{ fontSize: 13 }}>{r.expected_qty}</strong> },
            { header: 'Accepted', key: 'accepted_qty', align: 'right', render: r => <strong className="mono-num" style={{ color: '#047857' }}>{r.accepted_qty || 0}</strong> },
            { header: 'Damaged', key: 'damaged_qty', align: 'right', render: r => <span className="mono-num" style={{ color: r.damaged_qty > 0 ? '#dc2626' : '#94a3b8' }}>{r.damaged_qty || 0}</span> },
            { header: 'Batch No.', key: 'batch_number', render: r => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.batch_number || 'BAT-2026-09'}</span> },
            { header: 'QC Status', key: 'status', render: r => (
              <span className={`badge ${r.status === 'PASSED' ? 'badge-success' : r.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                {r.status || 'PENDING'}
              </span>
            )},
            { header: 'Action', render: r => (
              <button className="btn-primary" style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
                onClick={(e) => { e.stopPropagation(); openQcModal(r); }}>
                {r.status === 'PASSED' ? 'Re-inspect' : 'Perform QC'}
              </button>
            )},
          ]}
          data={qcLines}
        />
      )}

      {/* â•â•â• TAB 3: PUTAWAY TASKS â•â•â• */}
      {activeSubtab === 'putaway-tasks' && (
        <DataTable
          title="Putaway Tasks"
          subtitle="Move tested products from docks into warehouse storage bins"
          columns={[
            { header: 'Task', key: 'id', render: r => <span className="code-cell">PUT-{String(r.id).padStart(5, '0')}</span> },
            { header: 'Inbound No.', render: r => <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{r.asn_no || `INB-${r.inbound_id || r.id}`}</span> },
            { header: 'SKU', key: 'sku_code', render: r => <strong className="code-cell">{r.sku_code || r.sku?.sku_code || '—'}</strong> },
            { header: 'Item', key: 'sku_name', render: r => <strong>{r.sku_name || r.sku?.name || '—'}</strong> },
            { header: 'Qty', key: 'qty', align: 'right', render: r => <strong className="mono-num" style={{ fontSize: 13 }}>{r.qty}</strong> },
            { header: 'From', key: 'source_location_code', render: r => <span className="badge badge-default">{r.source_location_code || r.source_location?.code || 'DOCK'}</span> },
            { header: 'To (Bin)', key: 'destination_location_code', render: r => (
              <span className="location-pill">{r.destination_location_code || r.destination_location?.code || 'UNASSIGNED'}</span>
            )},
            { header: 'Priority', render: r => <span className={`badge ${r.priority === 'HIGH' ? 'badge-danger' : 'badge-warning'}`}>{r.priority || 'Normal'}</span> },
            { header: 'Worker', render: r => <span style={{ fontSize: 12, fontWeight: 600 }}>{r.assigned_to_name || 'Unassigned'}</span> },
            { header: 'Status', key: 'status', render: r => (
              <span className={`badge ${r.status === 'COMPLETED' ? 'badge-success' : 'badge-info'}`}>
                {r.status === 'COMPLETED' ? 'Completed' : 'In Progress'}
              </span>
            )},
            { header: 'Action', render: r => r.status !== 'COMPLETED' ? (
              <button className="btn-primary" style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
                onClick={(e) => { e.stopPropagation(); openPutawayModal(r); }}>
                Confirm Bin
              </button>
            ) : <span style={{ color: '#047857', fontSize: 12, fontWeight: 600 }}>âœ“ Verified</span> },
          ]}
          data={putawayTasks}
        />
)}

      {/* â•â•â• TAB 4: BIN TRANSFER â•â•â• */}
      {activeSubtab === 'bin-transfer' && (
        <BinTransferView />
      )}

      {/* â•â•â• TAB 5: BIN CONTENTS LOOKUP â•â•â• */}
      {activeSubtab === 'bin-contents' && (
        <BinContentsView initialCode={binContentsCode} />
      )}

      {/* â•â•â• TAB 6: TRANSFER ORDER â•â•â• */}
      {activeSubtab === 'transfer-order' && (
        <TransferOrderView />
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         1. FLOATING HOVER MODAL: REGISTER CONSIGNMENT
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {showRegModal && (
        <div className="modal-overlay" onClick={() => setShowRegModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 880, width: '92vw' }}>
            <div className="modal-header">
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Box style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PackageCheck size={18} />
                </Box>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Register Vendor Delivery Consignment</h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Mother Hub: RJY-DS-001 €¢ Dock Staging & QC Registry</div>
                </div>
              </Box>
              <button className="modal-close" onClick={() => setShowRegModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={submitRegistration}>
              <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Vendor / Supplier</span>
                  <select className="form-input" value={regVendor} onChange={e => setRegVendor(e.target.value)}>
                    {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name} ({v.code})</option>)}
                  </select>
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>PO Reference #</span>
                  <input className="form-input" value={regRefNo} onChange={e => setRegRefNo(e.target.value)} placeholder="PO-AMUL-9901" required />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Vehicle Plate</span>
                  <input className="form-input" value={regVehicleNo} onChange={e => setRegVehicleNo(e.target.value)} placeholder="AP 05 TX 1122" />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Driver Name</span>
                  <input className="form-input" value={regDriverName} onChange={e => setRegDriverName(e.target.value)} placeholder="Ravi Shankar" />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Driver Phone</span>
                  <input className="form-input" value={regDriverPhone} onChange={e => setRegDriverPhone(e.target.value)} placeholder="98490-11223" />
                </label>
              </Box>

              <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong style={{ fontSize: 12, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Delivery Line Items ({regItems.length} Products)
                </strong>
                <button type="button" className="btn-secondary" onClick={addItemRow} style={{ fontSize: 11, padding: '4px 10px', fontWeight: 600 }}>
                  <Plus size={12} /> Add SKU
                </button>
              </Box>

              <Box style={{ background: '#f8fafc', borderRadius: 8, padding: 12, border: '1px solid #e2e8f0', maxHeight: 240, overflowY: 'auto', marginBottom: 18 }}>
                {regItems.map((item, idx) => (
                  <Box key={idx} style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 1.2fr auto',
                    gap: 8, marginBottom: 8, padding: 8, background: '#ffffff', borderRadius: 6, border: '1px solid #cbd5e1'
                  }}>
                    <div>
                      <select className="form-input" value={item.sku_id} onChange={e => updateItem(idx, 'sku_id', e.target.value)}>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku_code})</option>)}
                      </select>
                    </div>
                    <div>
                      <input className="form-input" type="number" min="1" placeholder="Qty" value={item.expected_qty}
                        onChange={e => updateItem(idx, 'expected_qty', e.target.value)} />
                    </div>
                    <div>
                      <input className="form-input" placeholder="Batch #" value={item.batch_number}
                        onChange={e => updateItem(idx, 'batch_number', e.target.value)} />
                    </div>
                    <div>
                      <input className="form-input" type="date" value={item.expiry_date}
                        onChange={e => updateItem(idx, 'expiry_date', e.target.value)} />
                    </div>
                    <button type="button" onClick={() => removeItemRow(idx)}
                      style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 4, cursor: 'pointer', height: 32, padding: '0 8px', fontWeight: 700 }}>
                      âœ•
                    </button>
                  </Box>
                ))}
              </Box>

              <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowRegModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: '#7c3aed', color: '#fff' }}>
                  <PackageCheck size={14} /> Register & Send to QC
                </button>
              </Box>
            </form>
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         2. FLOATING HOVER MODAL: QC INSPECTION
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {selectedQcLine && (
        <div className="modal-overlay" onClick={() => setSelectedQcLine(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '90vw' }}>
            <div className="modal-header">
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Box style={{ width: 34, height: 34, borderRadius: 8, background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ClipboardList size={18} />
                </Box>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    QC Inspection — {selectedQcLine.sku_name || selectedQcLine.sku?.name || `QC-${selectedQcLine.id}`}
                  </h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Expected: {selectedQcLine.expected_qty} units | SKU: {selectedQcLine.sku_code || selectedQcLine.sku?.sku_code}
                  </div>
                </div>
              </Box>
              <button className="modal-close" onClick={() => setSelectedQcLine(null)}><X size={18} /></button>
            </div>

            <form onSubmit={submitQc}>
              <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Received Qty</span>
                  <input className="form-input" type="number" min="0" value={qcForm.received_qty}
                    onChange={e => setQcForm(f => ({ ...f, received_qty: e.target.value }))} required />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>âœ“ Accepted Qty</span>
                  <input className="form-input" type="number" min="0" value={qcForm.accepted_qty}
                    onChange={e => setQcForm(f => ({ ...f, accepted_qty: e.target.value }))} style={{ borderColor: '#059669', borderWidth: 2 }} required />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600, color: '#dc2626' }}>âœ• Damaged Qty</span>
                  <input className="form-input" type="number" min="0" value={qcForm.damaged_qty}
                    onChange={e => setQcForm(f => ({ ...f, damaged_qty: e.target.value }))} />
                </label>
              </Box>

              <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600, color: '#dc2626' }}>âœ• Rejected Qty</span>
                  <input className="form-input" type="number" min="0" value={qcForm.rejected_qty}
                    onChange={e => setQcForm(f => ({ ...f, rejected_qty: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600, color: '#d97706' }}>âš  Expired Qty</span>
                  <input className="form-input" type="number" min="0" value={qcForm.expired_qty}
                    onChange={e => setQcForm(f => ({ ...f, expired_qty: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Batch Number</span>
                  <select className="form-input" value={qcForm.batch_number}
                    onChange={e => setQcForm(f => ({ ...f, batch_number: e.target.value }))} />
                </label>
              </Box>

              <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Manufacturing Date</span>
                  <input className="form-input" type="date" value={qcForm.mfg_date}
                    onChange={e => setQcForm(f => ({ ...f, mfg_date: e.target.value }))} />
                </label>
                <label className="form-group">
                  <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Expiry Date</span>
                  <input className="form-input" type="date" value={qcForm.expiry_date}
                    onChange={e => setQcForm(f => ({ ...f, expiry_date: e.target.value }))} />
                </label>
              </Box>

              <label className="form-group" style={{ marginBottom: 18 }}>
                <span className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Inspection Remarks</span>
                <textarea className="form-input" rows="2" value={qcForm.remarks}
                  placeholder="Temperature checked, seal intact..."
                  onChange={e => setQcForm(f => ({ ...f, remarks: e.target.value }))}></textarea>
              </label>

              <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setSelectedQcLine(null)}>Cancel</button>
                <button type="submit" className="btn-primary">
                  <ClipboardList size={14} /> Save QC &amp; Create Putaway
                </button>
              </Box>
            </form>
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         3. FLOATING HOVER MODAL: PUTAWAY BIN ASSIGNMENT
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {selectedPutTask && (
        <div className="modal-overlay" onClick={() => setSelectedPutTask(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540, width: '90vw' }}>
            <div className="modal-header">
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Box style={{ width: 34, height: 34, borderRadius: 8, background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ArrowRight size={18} />
                </Box>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    Assign Storage Bin — {String(selectedPutTask.task_id).slice(0, 8).toUpperCase()}
                  </h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {putawaySku?.name || putawaySku?.sku_code || 'SKU'} ({selectedPutTask.qty} Units)
                  </div>
                </div>
              </Box>
              <button className="modal-close" onClick={() => setSelectedPutTask(null)}><X size={18} /></button>
            </div>

            <form onSubmit={submitPutaway}>
              <Box style={{ background: '#f8fafc', padding: 12, borderRadius: 6, marginBottom: 14, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <div><strong>SKU Code:</strong> {putawaySku?.sku_code || selectedPutTask.sku}</div>
                <div><strong>Lot:</strong> {selectedPutTask.lot} &nbsp;|&nbsp; <strong>From:</strong> {selectedPutTask.from_container || 'QC_PASSED_STAGING'}</div>
              </Box>

              <label className="form-group" style={{ marginBottom: 20 }}>
                <span className="form-label" style={{ fontWeight: 700, fontSize: 13 }}>Destination Storage Bin</span>
                <select className="form-input" value={putDestBin} onChange={e => setPutDestBin(e.target.value)} required>
                  <option value="">— Select a storage bin —</option>
                  {storageBins.map(b => (
                    <option key={b.location_id} value={b.location_id}>
                      {binLabel(b)} ({b.location_type}{b.aisle ? ` €¢ Aisle ${b.aisle}` : ''}{b.rack ? ` €¢ Rack ${b.rack}` : ''})
                    </option>
                  ))}
                </select>
              </label>

              <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setSelectedPutTask(null)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: '#059669', color: '#fff' }}>
                  <ArrowRight size={14} /> Complete Putaway
                </button>
              </Box>
            </form>
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         FLOATING HOVER MODAL: CREATE LPN FROM RECEIVED STOCK
         â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {showLpnModal && (
        <LpnModal
          mode="CREATE"
          onClose={() => setShowLpnModal(false)}
          onCreateLpn={handleLpnCreate}
        />
      )}

      {/* The scanner was imported and every "Scan" button set scanningMode, but
          the modal was never mounted — so all six scan entry points on this page
          were dead ends. */}
      {scanningMode && (
        <BarcodeScannerModal
          title={SCAN_TITLES[scanningMode] || 'Scan'}
          expected={SCAN_EXPECTED[scanningMode] || 'barcode or code'}
          onClose={() => setScanningMode(null)}
          onScan={handleScanComplete}
        />
      )}
    </div>
  );
}
