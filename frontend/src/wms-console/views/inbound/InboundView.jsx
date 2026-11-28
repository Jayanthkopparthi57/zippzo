import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import {
  RefreshCw,
  Plus,
  ArrowDownToLine,
  CheckCircle2,
  X,
  Search,
  ScanLine,
  Package,
  Trash2,
  QrCode,
} from 'lucide-react';

const PACKAGE_TYPES = [
  { value: 'TOTE', label: 'Tote' },
  { value: 'CARTON', label: 'Carton / Case' },
  { value: 'PALLET', label: 'Pallet' },
  { value: 'BAG', label: 'Bag' },
];

const PACKAGE_LABEL = PACKAGE_TYPES.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

function extractBarcode(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('{')) {
    try {
      const payload = JSON.parse(value);
      return payload.barcode || payload.lpn_id || '';
    } catch {
      return '';
    }
  }
  return value;
}

export default function InboundView({
  initialSubtab = 'asns',
  darkStoreSiteId = '',
  darkStoreMode = false,
}) {
  const [activeSubtab, setActiveSubtab] = useState(initialSubtab);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dataList, setDataList] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedDetailRow, setSelectedDetailRow] = useState(null);

  // Reference data
  const [vendors, setVendors] = useState([]);
  const [sites, setSites] = useState([]);
  const [skuOptions, setSkuOptions] = useState([]);

  // Create ASN bundle builder
  const [showCreateAsnModal, setShowCreateAsnModal] = useState(false);
  const [newAsn, setNewAsn] = useState({
    vendor: '',
    source_site: '',
    dest_site: '',
    package_type: 'TOTE',
    packs: 1,
  });
  const [bundleLines, setBundleLines] = useState([]);
  const [lineDraft, setLineDraft] = useState({ sku: '', qty: 1 });
  const [skuSearch, setSkuSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Physical receipt is recorded by scanning product barcodes against an ASN.
  const [showInwardModal, setShowInwardModal] = useState(false);
  const [inwardTargetAsn, setInwardTargetAsn] = useState(null);
  const [inwardCounts, setInwardCounts] = useState({});
  const [inwardScanCode, setInwardScanCode] = useState('');
  const [inwardError, setInwardError] = useState('');

  // Putaway completion (bin selection)
  const [putawayTarget, setPutawayTarget] = useState(null);
  const [putawayBins, setPutawayBins] = useState([]);
  const [putawayBin, setPutawayBin] = useState('');
  const [putawayError, setPutawayError] = useState('');
  const [putawayBusy, setPutawayBusy] = useState(false);

  // Quality control. Receiving only puts units into QC_HOLD; the inspection is
  // what accepts them and mints the putaway task.
  const [showQcModal, setShowQcModal] = useState(false);
  const [qcTarget, setQcTarget] = useState(null);
  const [qcPass, setQcPass] = useState(0);
  const [qcFail, setQcFail] = useState(0);
  const [qcNotes, setQcNotes] = useState('');
  const [qcError, setQcError] = useState('');
  const [qcBusy, setQcBusy] = useState(false);

  // Scan & receive a bundle created at another site
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanSite, setScanSite] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const skuSearchTimer = useRef(null);

  useEffect(() => {
    setActiveSubtab(initialSubtab);
  }, [initialSubtab]);

  const loadData = useCallback(async (subtab = activeSubtab) => {
    setLoading(true);
    setSelectedIds([]);
    setLoadError('');
    if (darkStoreMode && !darkStoreSiteId) {
      setDataList([]);
      setLoadError('Select an active Darkstore to view inbound records.');
      setLoading(false);
      return;
    }
    try {
      if (subtab === 'asns') {
        const res = await apiClient.get('/supply/asns/', {
          page_size: 200,
          ...(darkStoreSiteId ? { dest_site: darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      } else if (subtab === 'grns') {
        const res = await apiClient.get('/supply/grns/', {
          page_size: 200,
          ...(darkStoreSiteId ? { asn__dest_site: darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      } else if (subtab === 'qc') {
        const res = await apiClient.get('/supply/qc-inspections/', {
          page_size: 200,
          ...(darkStoreSiteId ? { grn_line__grn__asn__dest_site: darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      } else if (subtab === 'putaway') {
        const res = await apiClient.get('/supply/putaway-tasks/', {
          page_size: 200,
          ...(darkStoreSiteId ? { 'grn_line__grn__asn__dest_site': darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      } else if (subtab === 'received') {
        const res = await apiClient.get('/supply/grn-lines/', {
          page_size: 500,
          ...(darkStoreSiteId ? { grn__asn__dest_site: darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      } else if (subtab === 'discrepancies') {
        const res = await apiClient.get('/supply/dock-discrepancies/', {
          page_size: 200,
          ...(darkStoreSiteId ? { site: darkStoreSiteId } : {}),
        });
        setDataList(res.results || []);
      }
    } catch (err) {
      console.error('Failed loading inbound data:', err);
      setDataList([]);
      setLoadError(err.message || 'Failed to load inbound records.');
    } finally {
      setLoading(false);
    }
  }, [activeSubtab, darkStoreMode, darkStoreSiteId]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [vendorRes, siteRes, skuRes] = await Promise.all([
        apiClient.get('/supply/vendors/', { page_size: 500 }),
        apiClient.get('/network/sites/', { page_size: 500 }),
        apiClient.get('/catalog/skus/', { page_size: 200 }),
      ]);
      const vendorList = vendorRes.results || [];
      const siteList = siteRes.results || [];
      setVendors(vendorList);
      setSites(siteList);
      setSkuOptions(skuRes.results || []);

      const motherHubs = siteList.filter(s => s.site_type === 'MH');
      const defaultDest = darkStoreSiteId
        ? siteList.find(s => s.site_id === darkStoreSiteId)
        : darkStoreMode ? null : motherHubs[0] || siteList[0];
      setNewAsn(prev => ({
        ...prev,
        vendor: prev.vendor || vendorList[0]?.vendor_id || '',
        source_site: prev.source_site || motherHubs[0]?.site_id || '',
        dest_site: darkStoreMode ? defaultDest?.site_id || '' : prev.dest_site || defaultDest?.site_id || '',
      }));
      setScanSite(darkStoreMode ? darkStoreSiteId : prev => prev || defaultDest?.site_id || '');
    } catch (err) {
      console.error('Reference data fetch error:', err);
      setLoadError(err.message || 'Failed to load inbound reference data.');
    }
  }, [darkStoreMode, darkStoreSiteId]);

  useEffect(() => {
    loadData(activeSubtab);
  }, [activeSubtab, loadData]);

  useEffect(() => {
    if (!darkStoreMode || !darkStoreSiteId) return undefined;
    const syncConsignments = () => {
      if (!document.hidden) loadData('asns');
    };
    const timer = window.setInterval(syncConsignments, 20000);
    window.addEventListener('zippzo:live-event', syncConsignments);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('zippzo:live-event', syncConsignments);
    };
  }, [darkStoreMode, darkStoreSiteId, loadData]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  const searchSkus = (term) => {
    setSkuSearch(term);
    if (skuSearchTimer.current) clearTimeout(skuSearchTimer.current);
    skuSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/catalog/skus/', {
          search: term,
          page_size: 100,
        });
        setSkuOptions(res.results || []);
      } catch (err) {
        console.error('SKU search failed:', err);
      }
    }, 250);
  };

  const resetAsnForm = () => {
    const motherHubs = sites.filter(s => s.site_type === 'MH');
    const activeStore = sites.find(s => s.site_id === darkStoreSiteId);
    setNewAsn({
      vendor: vendors[0]?.vendor_id || '',
      source_site: motherHubs[0]?.site_id || '',
      dest_site: darkStoreMode
        ? activeStore?.site_id || ''
        : (motherHubs[0] || sites[0])?.site_id || '',
      package_type: 'TOTE',
      packs: 1,
    });
    setBundleLines([]);
    setLineDraft({ sku: '', qty: 1 });
    setSkuSearch('');
    setFormError('');
  };

  const openCreateAsn = () => {
    if (darkStoreMode && !darkStoreSiteId) {
      setFormError('Select an active Darkstore before creating an inbound transfer.');
      return;
    }
    resetAsnForm();
    setShowCreateAsnModal(true);
  };

  const addBundleLine = () => {
    setFormError('');
    const sku = skuOptions.find(item => item.sku_id === lineDraft.sku);
    if (!sku) {
      setFormError('Select a registered SKU first.');
      return;
    }
    const qty = parseInt(lineDraft.qty, 10);
    if (!qty || qty < 1) {
      setFormError('Units per pack must be at least 1.');
      return;
    }
    if (bundleLines.some(line => line.sku_id === sku.sku_id)) {
      setFormError(`${sku.sku_code} is already in this bundle. Remove it first to change the quantity.`);
      return;
    }
    setBundleLines(prev => ([
      ...prev,
      {
        sku_id: sku.sku_id,
        sku_code: sku.sku_code,
        sku_name: sku.name,
        ean: sku.ean || '',
        qty_per_pack: qty,
      },
    ]));
    setLineDraft({ sku: '', qty: 1 });
  };

  const removeBundleLine = (skuId) => {
    setBundleLines(prev => prev.filter(line => line.sku_id !== skuId));
  };

  const packs = Math.max(1, parseInt(newAsn.packs, 10) || 1);
  const unitsPerBundle = bundleLines.reduce((sum, line) => sum + line.qty_per_pack, 0);
  const totalExpectedUnits = unitsPerBundle * packs;

  const handleCreateAsn = async (e) => {
    e.preventDefault();
    setFormError('');
    if (darkStoreMode && !darkStoreSiteId) {
      setFormError('Select an active Darkstore before creating an inbound transfer.');
      return;
    }
    if (!darkStoreMode && !newAsn.vendor) {
      setFormError('Select the registered vendor sending this consignment.');
      return;
    }
    if (darkStoreMode && !newAsn.source_site) {
      setFormError('Select the mother hub sending this transfer.');
      return;
    }
    if (!newAsn.dest_site) {
      setFormError('Select the receiving facility.');
      return;
    }
    if (bundleLines.length === 0) {
      setFormError('Add at least one SKU to the bundle.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiClient.post('/supply/asns/', {
        type: darkStoreMode ? 'MH_TRANSFER' : 'VENDOR_PO',
        source_vendor: darkStoreMode ? null : newAsn.vendor,
        source_site: darkStoreMode ? newAsn.source_site : null,
        dest_site: darkStoreMode ? darkStoreSiteId : newAsn.dest_site,
        package_type: newAsn.package_type,
        total_lpns: packs,
        total_skus: bundleLines.length,
        total_qty: totalExpectedUnits,
        status: 'CONFIRMED',
      });

      // Lines are posted one at a time: `line_no` is server-assigned, and a
      // parallel burst makes every request read the same "highest line" and
      // collide on the (asn, line_no) unique key.
      try {
        for (const line of bundleLines) {
          await apiClient.post('/supply/asn-lines/', {
            asn: created.asn_id,
            sku: line.sku_id,
            ean: line.ean,
            ordered_qty: line.qty_per_pack * packs,
            line_status: 'OPEN',
          });
        }
      } catch (lineError) {
        // Half an ASN is worse than none: roll the header back so the
        // operator can retry the whole bundle instead of repairing it.
        await apiClient.delete(`/supply/asns/${created.asn_id}/`).catch(() => {});
        throw lineError;
      }

      setShowCreateAsnModal(false);
      resetAsnForm();
      await loadData('asns');
    } catch (err) {
      console.error('Failed creating ASN:', err);
      setFormError(
        err?.details?.detail
        || (err?.details && JSON.stringify(err.details))
        || 'Could not create the ASN. Check the vendor, SKU and receiving facility.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const recordInboundScan = (event) => {
    event.preventDefault();
    const barcode = extractBarcode(inwardScanCode);
    if (!inwardTargetAsn) return;
    if (!barcode) {
      setInwardError('Could not read a product barcode. Try scanning the item again.');
      return;
    }
    const line = (inwardTargetAsn.lines || []).find((item) =>
      [item.ean, item.sku_code].some((value) => String(value || '').trim().toLowerCase() === barcode.toLowerCase())
    );
    if (!line) {
      setInwardError(`Barcode ${barcode} is not part of this consignment.`);
      setInwardScanCode('');
      return;
    }
    const received = Number(inwardCounts[line.line_id] || 0);
    setInwardCounts((current) => ({ ...current, [line.line_id]: received + 1 }));
    setInwardScanCode('');
    setInwardError('');
  };

  const handleScannedReceipt = async (asn) => {
    setInwardError('');
    const lines = asn.lines || [];
    if (!lines.some((line) => Number(inwardCounts[line.line_id] || 0) > 0)) {
      setInwardError('Scan at least one product before completing this receipt.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post(`/supply/asns/${asn.asn_id}/receive-scanned/`, {
        lines: lines.map((line) => ({
          asn_line: line.line_id,
          received_qty: Number(inwardCounts[line.line_id] || 0),
        })),
      });
      setShowInwardModal(false);
      setInwardTargetAsn(null);
      setInwardCounts({});
      setInwardScanCode('');
      setActiveSubtab('grns');
      await loadData('grns');
    } catch (err) {
      console.error('Failed recording scanned receipt:', err);
      setInwardError(
        err?.details?.detail
        || (err?.details && JSON.stringify(err.details))
        || err.message
        || 'Could not generate the GRN.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openQc = (inspection) => {
    const received = Number(inspection.received_qty || 0);
    setQcTarget(inspection);
    setQcPass(received);
    setQcFail(0);
    setQcNotes('');
    setQcError('');
    setShowQcModal(true);
  };

  const handleVerifyQc = async () => {
    if (!qcTarget) return;
    const received = Number(qcTarget.received_qty || 0);
    const pass = Number(qcPass || 0);
    const fail = Number(qcFail || 0);
    if (pass < 0 || fail < 0) {
      setQcError('Passed and failed counts cannot be negative.');
      return;
    }
    if (pass + fail > received) {
      setQcError(`Only ${received} unit(s) were received, so ${pass + fail} cannot be inspected.`);
      return;
    }
    if (pass + fail !== received) {
      setQcError(`Inspect all ${received} received unit(s): ${received - pass - fail} still uninspected.`);
      return;
    }
    setQcBusy(true);
    setQcError('');
    try {
      await apiClient.post(`/supply/qc-inspections/${qcTarget.qc_id}/verify/`, {
        pass_count: pass,
        fail_count: fail,
        status: fail > 0 ? (pass > 0 ? 'PARTIAL' : 'FAILED') : 'PASSED',
        remarks: qcNotes,
        require_full_inspection: true,
      });
      setShowQcModal(false);
      setQcTarget(null);
      await loadData('qc');
    } catch (err) {
      console.error('Failed verifying QC:', err);
      setQcError(
        err?.details?.detail
        || (err?.details && JSON.stringify(err.details))
        || 'The inspection could not be recorded.',
      );
    } finally {
      setQcBusy(false);
    }
  };

  const openPutaway = async (task) => {
    setPutawayTarget(task);
    setPutawayError('');
    setPutawayBin(task.confirmed_bin || task.suggested_bin || '');
    setPutawayBins([]);
    if (!task.site_id) {
      setPutawayError('This task has no receiving site, so no bins can be listed.');
      return;
    }
    try {
      const res = await apiClient.get('/supply/putaway-bins/', {
        site: task.site_id,
        limit: 300,
      });
      setPutawayBins(res.results || []);
    } catch (err) {
      console.error('Failed loading putaway bins:', err);
      setPutawayError('Could not load bins for this facility.');
    }
  };

  const handleCompletePutaway = async () => {
    if (!putawayTarget) return;
    if (!putawayBin) {
      setPutawayError('Select the bin the units were placed in.');
      return;
    }
    setPutawayBusy(true);
    setPutawayError('');
    try {
      await apiClient.post(`/supply/putaway-tasks/${putawayTarget.task_id}/complete/`, {
        destination_location_id: putawayBin,
      });
      setPutawayTarget(null);
      await loadData('putaway');
    } catch (err) {
      console.error('Failed completing putaway:', err);
      setPutawayError(
        err?.details?.detail
        || (err?.details && JSON.stringify(err.details))
        || 'Could not confirm this putaway.',
      );
    } finally {
      setPutawayBusy(false);
    }
  };

  const handleScanLookup = async () => {
    setScanError('');
    setScanResult(null);
    const code = String(scanCode || '').trim();
    if (!code) {
      setScanError('Scan or paste a bundle barcode / QR payload.');
      return;
    }
    setScanBusy(true);
    try {
      const res = await apiClient.get('/inventory/lpns/resolve/', { code });
      setScanResult({ type: 'resolved', data: res });
    } catch (err) {
      setScanError(
        err?.details?.detail
        || err?.details?.error
        || 'No bundle matches that label.',
      );
    } finally {
      setScanBusy(false);
    }
  };

  const handleScanReceive = async () => {
    setScanError('');
    const site = sites.find(item => item.site_id === scanSite);
    if (!site) {
      setScanError('Select the receiving facility.');
      return;
    }
    const barcode = extractBarcode(scanCode) || scanResult?.data?.barcode;
    if (!barcode) {
      setScanError('Scan or paste a bundle label first.');
      return;
    }
    setScanBusy(true);
    try {
      const res = await apiClient.post('/ds-ops/receive-lpn', {
        barcode,
        store_code: site.code,
      });
      setScanResult({ type: 'received', data: res, site });
      setScanCode('');
      await loadData(activeSubtab);
    } catch (err) {
      setScanError(
        err?.details?.error
        || err?.details?.detail
        || 'The bundle could not be received at this facility.',
      );
    } finally {
      setScanBusy(false);
    }
  };

  const subtabs = [
    { id: 'asns', label: darkStoreMode ? 'Consignments' : 'ASNs (Advance Shipping)', count: activeSubtab === 'asns' ? dataList.length : undefined },
    { id: 'received', label: darkStoreMode ? 'Received from App' : 'Received Lines', count: activeSubtab === 'received' ? dataList.length : undefined },
    { id: 'grns', label: darkStoreMode ? 'Receipts' : 'Inwarding & GRN', count: activeSubtab === 'grns' ? dataList.length : undefined },
    { id: 'qc', label: darkStoreMode ? 'Q.C.' : 'QC Inspections', count: activeSubtab === 'qc' ? dataList.length : undefined },
    { id: 'putaway', label: 'Putaway Tasks', count: activeSubtab === 'putaway' ? dataList.length : undefined },
    { id: 'discrepancies', label: darkStoreMode ? 'Receipt Variances' : 'Dock Discrepancies', count: activeSubtab === 'discrepancies' ? dataList.length : undefined },
  ];
  const visibleSubtabs = subtabs;

  const asnColumns = [
    {
      label: 'ASN Number',
      key: 'asn_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {PACKAGE_LABEL[row.package_type] || row.package_type || 'Tote'} · {row.total_lpns || 1} pack(s)
          </div>
        </div>
      ),
    },
    {
      label: 'Vendor / Source',
      key: 'source_vendor_name',
      render: (val, row) => <span>{val || row.source_site_code || '—'}</span>,
    },
    {
      label: 'Destination',
      key: 'dest_site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'SKUs & Qty',
      key: 'total_qty',
      render: (val, row) => {
        const qty = val ?? (row.lines?.reduce((s, l) => s + (l.ordered_qty || 0), 0) ?? 0);
        const skus = row.total_skus ?? (row.lines?.length || 0);
        return (
          <div>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{qty} Qty</span>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{skus} SKU{skus === 1 ? '' : 's'} / bundle</div>
          </div>
        );
      },
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {['CONFIRMED', 'ARRIVED', 'CHECKED_IN'].includes(row.status) && (
            <button
              className="btn-ui primary"
              style={{ padding: '3px 8px', fontSize: 11 }}
              onClick={(e) => {
                e.stopPropagation();
                setInwardTargetAsn(row);
                setInwardCounts({});
                setInwardScanCode('');
                setInwardError('');
                setShowInwardModal(true);
              }}
            >
              Inward (GRN)
            </button>
          )}
          <button
            className="btn-ui neutral"
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDetailRow({ type: 'asn', data: row });
            }}
          >
            Lines
          </button>
        </div>
      ),
    },
  ];

  const grnColumns = [
    {
      label: 'GRN Number',
      key: 'grn_no',
      render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'ASN Ref',
      key: 'asn_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</span>,
    },
    {
      label: 'Mode',
      key: 'mode',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Discrepancy',
      key: 'has_discrepancy',
      render: (val) => (
        <span style={{ color: val ? 'var(--c-rust)' : '#48a968', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {val ? 'YES (VARIANCE)' : 'CLEAN'}
        </span>
      ),
    },
    {
      label: 'Received By',
      key: 'received_by_name',
      render: (val) => <span>{val || '—'}</span>,
    },
    {
      label: 'Created Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
  ];

  const receivedColumns = [
    {
      label: 'Product',
      key: 'sku_name',
      render: (val, row) => (
        <div>
          <strong>{val || '—'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code || '—'}{row.ean ? ` · ${row.ean}` : ''}</div>
        </div>
      ),
    },
    { label: 'GRN', key: 'grn_no', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    {
      label: 'Received',
      key: 'received_qty',
      render: (val, row) => (
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val ?? 0} units</span>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.ordered_qty ?? 0} ordered</div>
        </div>
      ),
    },
    {
      label: 'Accepted',
      key: 'accepted_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--c-emerald)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Damaged',
      key: 'damaged_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: val ? 'var(--c-rust)' : 'var(--text-muted)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Pending QC',
      key: 'pending',
      render: (_, row) => {
        const pending = Math.max(0, (row.received_qty || 0) - (row.accepted_qty || 0) - (row.damaged_qty || 0));
        return <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: pending > 0 ? 'var(--c-amber)' : 'var(--text-muted)' }}>{pending}</span>;
      },
    },
    { label: 'Lot', key: 'lot', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{val || '—'}</span> },
    { label: 'Expiry', key: 'expiry_date', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{val || '—'}</span> },
    {
      label: 'MRP',
      key: 'mrp',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>₹{Number(val || 0).toFixed(2)}</span>,
    },
  ];

  const qcColumns = [
    {
      label: 'Inspection',
      key: 'qc_id',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val ? val.slice(0, 12) : '—'}</strong>,
    },
    {
      label: 'GRN / ASN',
      key: 'grn_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ASN: {row.asn_no || '-'}</div>
        </div>
      ),
    },
    {
      label: 'Item',
      key: 'sku_name',
      render: (val, row) => (
        <div>
          <strong>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code || '-'}</div>
        </div>
      ),
    },
    {
      label: 'Received',
      key: 'received_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0}</span>,
    },
    {
      label: 'Pass / Fail',
      key: 'pass_count',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <span style={{ color: '#48a968', fontWeight: 600 }}>{val ?? 0}</span>
          {' / '}
          <span style={{ color: 'var(--c-rust)', fontWeight: 600 }}>{row.fail_count ?? 0}</span>
        </span>
      ),
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Inspector',
      key: 'tested_by_name',
      render: (val) => <span>{val || '—'}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <button
          className="btn-ui neutral"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            openQc(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>{row.status === 'PENDING' ? 'Inspect' : 'Review'}</span>
        </button>
      ),
    },
  ];

  const putawayColumns = [
    {
      label: 'Putaway ID',
      key: 'task_id',
      render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val ? val.slice(0, 12) : '—'}</strong>,
    },
    {
      label: 'GRN / ASN',
      key: 'grn_no',
      render: (val, row) => (
        <div>
          <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)' }}>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ASN: {row.asn_no || '-'}</div>
        </div>
      ),
    },
    {
      label: 'Item',
      key: 'sku_name',
      render: (val, row) => (
        <div>
          <strong>{val || '-'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{row.sku_code || '-'}</div>
        </div>
      ),
    },
    {
      label: 'Qty',
      key: 'qty',
      render: (val, row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {row.placed_qty || 0} / {val || 0}
        </span>
      ),
    },
    {
      label: 'To Bin',
      key: 'to_bin_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => row.status !== 'CONFIRMED' ? (
        <button
          className="btn-ui neutral"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            openPutaway(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>Confirm Putaway</span>
        </button>
      ) : (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Stored</span>
      ),
    },
  ];

  const discrepancyColumns = [
    {
      label: 'Discrepancy Code',
      key: 'code',
      render: (val) => <strong style={{ color: 'var(--c-rust)', fontFamily: 'var(--font-mono)' }}>{val}</strong>,
    },
    {
      label: 'GRN Number',
      key: 'grn_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'ASN Ref',
      key: 'asn_no',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span>,
    },
    {
      label: 'SKU',
      key: 'sku_name',
      render: (val, row) => <div><strong>{val || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.sku_code || ''}</div></div>,
    },
    {
      label: 'Destination',
      key: 'site_code',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span>,
    },
    {
      label: 'Type',
      key: 'discrepancy_type',
      badge: true,
    },
    {
      label: 'Expected / Received',
      key: 'expected_qty',
      render: (val, row) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{val ?? 0} / {row.received_qty ?? 0}</span>,
    },
    {
      label: 'Shortage',
      key: 'shortage_qty',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: Number(val || 0) ? 'var(--c-rust)' : 'var(--text-muted)' }}>{val ?? 0}</span>,
    },
    {
      label: 'Status',
      key: 'status',
      badge: true,
    },
    {
      label: 'Created Time',
      key: 'created_at',
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span>,
    },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => (
        <button
          className="btn-ui neutral"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedDetailRow({ type: 'discrepancy', data: row });
          }}
        >
          View
        </button>
      ),
    },
  ];

  const getActiveColumns = () => {
    switch (activeSubtab) {
      case 'asns': return asnColumns;
      case 'received': return receivedColumns;
    case 'grns': return grnColumns;
      case 'qc': return qcColumns;
      case 'putaway': return putawayColumns;
      case 'discrepancies': return discrepancyColumns;
      default: return asnColumns;
    }
  };

  const filteredData = dataList.filter(item => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (item.code && item.code.toLowerCase().includes(q)) ||
      (item.asn_no && item.asn_no.toLowerCase().includes(q)) ||
      (item.grn_no && item.grn_no.toLowerCase().includes(q)) ||
      (item.sku_name && item.sku_name.toLowerCase().includes(q)) ||
      (item.sku_code && item.sku_code.toLowerCase().includes(q)) ||
      (item.source_vendor_name && item.source_vendor_name.toLowerCase().includes(q)) ||
      (item.site_code && item.site_code.toLowerCase().includes(q)) ||
      (item.dest_site_code && item.dest_site_code.toLowerCase().includes(q))
    );
  });

  const drawerId = selectedDetailRow?.data
    ? (selectedDetailRow.data.asn_id
      || selectedDetailRow.data.grn_id
      || selectedDetailRow.data.line_id
      || selectedDetailRow.data.discrepancy_id
      || selectedDetailRow.data.task_id
      || '—')
    : '';

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>{darkStoreMode ? 'DARKSTORE INBOUND OPERATIONS' : 'INBOUND WAREHOUSE OPERATIONS'}</span>
            <span className="screen-count-tag">{filteredData.length} records</span>
          </div>
        </div>

        {loadError && <div className="form-error-banner" role="alert">{loadError}</div>}

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => loadData(activeSubtab)}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>

          {!darkStoreMode && (
            <button
              className="btn-ui neutral"
              onClick={() => { setScanResult(null); setScanError(''); setShowScanModal(true); }}
            >
              <ScanLine size={13} />
              <span>Scan Bundle In</span>
            </button>
          )}

          {!darkStoreMode && activeSubtab === 'asns' && (
            <button className="btn-ui primary" onClick={openCreateAsn}>
              <Plus size={13} />
              <span>Create Inbound ASN</span>
            </button>
          )}
        </div>
      </div>

      <div className="subtabs-rail">
        <div className="subtabs-list">
          {visibleSubtabs.map(st => (
            <button
              key={st.id}
              className={`subtab-btn ${activeSubtab === st.id ? 'active' : ''}`}
              onClick={() => setActiveSubtab(st.id)}
            >
              {st.label}
              {st.count != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({st.count})</span>}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative', paddingBottom: 6 }}>
          <input
            type="text"
            placeholder="Filter records..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              padding: '4px 26px 4px 8px',
              fontSize: 12,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)'
            }}
          />
          <Search size={12} style={{ position: 'absolute', right: 8, color: 'var(--text-muted)' }} />
        </div>
      </div>

      <DataTable
        columns={getActiveColumns()}
        data={filteredData}
        idField={activeSubtab === 'asns' ? 'asn_id' : activeSubtab === 'putaway' ? 'task_id' : activeSubtab === 'qc' ? 'qc_id' : activeSubtab === 'received' ? 'line_id' : 'grn_id'}
        selectable={activeSubtab === 'asns'}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onRowClick={(row) => {
          if (activeSubtab === 'qc') {
            openQc(row);
            return;
          }
          setSelectedDetailRow({
            type: activeSubtab === 'putaway' ? 'putaway' : activeSubtab === 'asns' ? 'asn' : activeSubtab === 'received' ? 'received' : 'grn',
            data: row,
          });
        }}
      />

      {/* Detail drawer */}
      {selectedDetailRow && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            background: 'var(--bg-card)',
            borderLeft: '1px solid var(--border-mid)',
            boxShadow: 'var(--shadow-modal)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>
                {selectedDetailRow.type === 'asn'
                  ? `ASN: ${selectedDetailRow.data.asn_no}`
                  : selectedDetailRow.type === 'putaway'
                    ? 'Putaway Task'
                    : selectedDetailRow.type === 'received'
                      ? `Product: ${selectedDetailRow.data.sku_name || selectedDetailRow.data.sku_code || 'Received line'}`
                      : `GRN: ${selectedDetailRow.data.grn_no || 'Details'}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                ID: {drawerId}
              </div>
            </div>
            <button className="btn-ui neutral" onClick={() => setSelectedDetailRow(null)} style={{ padding: '4px 6px' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
            {selectedDetailRow.type === 'asn' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <div>
                    <div className="drawer-label">Status</div>
                    <div style={{ marginTop: 4 }}><span className="status-badge teal">{selectedDetailRow.data.status}</span></div>
                  </div>
                  <div>
                    <div className="drawer-label">Bundle</div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {PACKAGE_LABEL[selectedDetailRow.data.package_type] || 'Tote'}
                      {' · '}
                      {selectedDetailRow.data.total_lpns || 1} pack(s)
                    </div>
                  </div>
                  <div>
                    <div className="drawer-label">Source Vendor</div>
                    <div style={{ marginTop: 4 }}>{selectedDetailRow.data.source_vendor_name || '—'}</div>
                  </div>
                  <div>
                    <div className="drawer-label">Destination</div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.dest_site_code || '—'}</div>
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
                  SKUs in this bundle ({selectedDetailRow.data.lines?.length || 0})
                </div>

                {selectedDetailRow.data.lines && selectedDetailRow.data.lines.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedDetailRow.data.lines.map((l, idx) => (
                      <div key={idx} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', padding: 10, borderRadius: 'var(--radius-xs)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.sku_name || '—'}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          <span>{l.sku_code}</span>
                          <span>Total: {l.ordered_qty} units</span>
                          <span style={{ color: 'var(--c-teal)' }}>{l.line_status || 'OPEN'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    No SKU lines recorded for this ASN.
                  </div>
                )}
              </>
            )}

            {selectedDetailRow.type !== 'asn' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div className="drawer-label">Status</div>
                  <div style={{ marginTop: 4 }}><span className="status-badge teal">{selectedDetailRow.data.status || '—'}</span></div>
                </div>
                {selectedDetailRow.data.grn_no && (
                  <div>
                    <div className="drawer-label">GRN</div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.grn_no}</div>
                  </div>
                )}
                {selectedDetailRow.data.asn_no && (
                  <div>
                    <div className="drawer-label">ASN</div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.asn_no}</div>
                  </div>
                )}
                {selectedDetailRow.data.sku_name && (
                  <div>
                    <div className="drawer-label">SKU</div>
                    <div style={{ marginTop: 4 }}>{selectedDetailRow.data.sku_name} ({selectedDetailRow.data.sku_code})</div>
                  </div>
                )}
                {selectedDetailRow.type === 'received' && (
                  <>
                    <div>
                      <div className="drawer-label">Quantity breakdown</div>
                      <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 4 }}>
                        <span>Ordered {selectedDetailRow.data.ordered_qty ?? 0}</span>
                        <span>Received <strong>{selectedDetailRow.data.received_qty ?? 0}</strong></span>
                        <span style={{ color: 'var(--c-emerald)' }}>Accepted {selectedDetailRow.data.accepted_qty ?? 0}</span>
                        <span style={{ color: 'var(--c-rust)' }}>Damaged {selectedDetailRow.data.damaged_qty ?? 0}</span>
                        <span style={{ color: 'var(--c-amber)' }}>Pending {Math.max(0, (selectedDetailRow.data.received_qty || 0) - (selectedDetailRow.data.accepted_qty || 0) - (selectedDetailRow.data.damaged_qty || 0))}</span>
                      </div>
                    </div>
                    {selectedDetailRow.data.expiry_date && (
                      <div>
                        <div className="drawer-label">Expiry date</div>
                        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.expiry_date}</div>
                      </div>
                    )}
                    {selectedDetailRow.data.lot && (
                      <div>
                        <div className="drawer-label">Lot / Batch</div>
                        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.lot}</div>
                      </div>
                    )}
                    {selectedDetailRow.data.mrp && (
                      <div>
                        <div className="drawer-label">MRP</div>
                        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>₹{Number(selectedDetailRow.data.mrp || 0).toFixed(2)}</div>
                      </div>
                    )}
                  </>
                )}
                {selectedDetailRow.type === 'discrepancy' && (
                  <>
                    <div>
                      <div className="drawer-label">Expected / Received</div>
                      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                        {selectedDetailRow.data.expected_qty ?? 0} / {selectedDetailRow.data.received_qty ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="drawer-label">Shortage</div>
                      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', color: selectedDetailRow.data.shortage_qty ? 'var(--c-rust)' : '#48a968' }}>
                        {selectedDetailRow.data.shortage_qty ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="drawer-label">Reason Code</div>
                      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{selectedDetailRow.data.reason_code || '—'}</div>
                    </div>
                    {selectedDetailRow.data.remarks && (
                      <div>
                        <div className="drawer-label">Remarks</div>
                        <div style={{ marginTop: 4 }}>{selectedDetailRow.data.remarks}</div>
                      </div>
                    )}
                  </>
                )}
                {selectedDetailRow.data.has_discrepancy != null && (
                  <div>
                    <div className="drawer-label">Discrepancy</div>
                    <div style={{ marginTop: 4, color: selectedDetailRow.data.has_discrepancy ? 'var(--c-rust)' : '#48a968', fontWeight: 600 }}>
                      {selectedDetailRow.data.has_discrepancy ? 'Variance recorded' : 'Clean receipt'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Inbound ASN - bundle builder */}
      {showCreateAsnModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateAsnModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 660 }}>
            <div className="modal-header">
              <div className="modal-title">Create Inbound ASN</div>
              <button className="btn-ui neutral" onClick={() => setShowCreateAsnModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateAsn}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {formError && <div className="form-error-banner">{formError}</div>}

                <div className="crud-form-grid">
                  <div className="crud-form-field">
                    <label>ASN Number</label>
                    <input
                      type="text"
                      value="Auto-generated on save"
                      readOnly
                      disabled
                      style={{ opacity: 0.75, cursor: 'not-allowed' }}
                    />
                  </div>
                  <div className="crud-form-field">
                    <label>Receiving Facility</label>
                    <select
                      value={newAsn.dest_site}
                      onChange={(e) => setNewAsn({ ...newAsn, dest_site: e.target.value })}
                      required
                    >
                      <option value="">Select facility</option>
                      {(darkStoreMode
                        ? sites.filter(s => s.site_id === darkStoreSiteId)
                        : sites.filter(s => s.site_type === 'MH')
                      ).map(s => (
                        <option key={s.site_id} value={s.site_id}>
                          {s.code} - {s.name || s.site_type}
                        </option>
                      ))}
                    </select>
                  </div>
                  {darkStoreMode ? (
                    <div className="crud-form-field">
                      <label>Source Mother Hub</label>
                      <select
                        value={newAsn.source_site}
                        onChange={(e) => setNewAsn({ ...newAsn, source_site: e.target.value })}
                        required
                      >
                        <option value="">Select source hub</option>
                        {sites.filter(s => s.site_type === 'MH').map(s => (
                          <option key={s.site_id} value={s.site_id}>
                            {s.code} - {s.name || s.site_type}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="crud-form-field">
                      <label>Vendor</label>
                      <select
                        value={newAsn.vendor}
                        onChange={(e) => setNewAsn({ ...newAsn, vendor: e.target.value })}
                        required
                      >
                        <option value="">Select registered vendor</option>
                        {vendors.map(v => (
                          <option key={v.vendor_id} value={v.vendor_id}>
                            {v.name}{v.code ? ` (${v.code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="crud-form-field">
                    <label>Package Type</label>
                    <select
                      value={newAsn.package_type}
                      onChange={(e) => setNewAsn({ ...newAsn, package_type: e.target.value })}
                    >
                      {PACKAGE_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="crud-form-field" style={{ maxWidth: 220 }}>
                  <label>Number of Packs / Bundles</label>
                  <input
                    type="number"
                    min="1"
                    value={newAsn.packs}
                    onChange={(e) => setNewAsn({ ...newAsn, packs: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                    SKUs inside each bundle
                  </div>

                  <div className="bundle-line-grid">
                    <div className="crud-form-field">
                      <label>Search registered SKU</label>
                      <input
                        type="text"
                        value={skuSearch}
                        onChange={(e) => searchSkus(e.target.value)}
                        placeholder="Type code or product name..."
                      />
                    </div>
                    <div className="crud-form-field">
                      <label>Units / pack</label>
                      <input
                        type="number"
                        min="1"
                        value={lineDraft.qty}
                        onChange={(e) => setLineDraft({ ...lineDraft, qty: e.target.value })}
                      />
                    </div>
                    <button type="button" className="btn-ui neutral" onClick={addBundleLine} style={{ height: 32 }}>
                      <Plus size={12} /> Add
                    </button>
                  </div>

                  <div className="crud-form-field" style={{ marginTop: 8 }}>
                    <label>SKU</label>
                    <select
                      value={lineDraft.sku}
                      onChange={(e) => setLineDraft({ ...lineDraft, sku: e.target.value })}
                    >
                      <option value="">Select SKU</option>
                      {skuOptions.map(s => (
                        <option key={s.sku_id} value={s.sku_id}>
                          {s.sku_code} - {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bundle-line-list">
                    {bundleLines.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: 11.5, color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
                        No SKUs added yet. A bundle must contain at least one SKU.
                      </div>
                    ) : bundleLines.map(line => (
                      <div className="bundle-line-row" key={line.sku_id}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{line.sku_name}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>
                            {line.sku_code} · {line.qty_per_pack} units/pack
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ui danger"
                          style={{ padding: '3px 6px' }}
                          onClick={() => removeBundleLine(line.sku_id)}
                          title="Remove SKU"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bundle-summary">
                  <span><strong>{bundleLines.length}</strong> SKU(s)</span>
                  <span><strong>{unitsPerBundle}</strong> units / bundle</span>
                  <span><strong>{packs}</strong> bundle(s)</span>
                  <span><strong>{totalExpectedUnits}</strong> total units</span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <Package size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>
                    The ASN records the bundle type, the number of packs and every SKU inside each pack.
                    ASN and line numbers are assigned by the server.
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ui neutral" onClick={() => setShowCreateAsnModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Confirm & Create ASN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scanned receipt GRN modal */}
      {showInwardModal && inwardTargetAsn && (
        <div className="modal-backdrop" onClick={() => !submitting && setShowInwardModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <div className="modal-title">Scan Consignment Products</div>
              <button className="btn-ui neutral" onClick={() => setShowInwardModal(false)} disabled={submitting}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {inwardError && <div className="form-error-banner">{inwardError}</div>}
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                ASN <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{inwardTargetAsn.asn_no}</strong>
                {' · '}scan each received product; only scanned units enter the QC queue.
              </div>
              <form onSubmit={recordInboundScan} style={{ display: 'flex', gap: 8 }}>
                <input
                  autoFocus
                  className="table-filter-input"
                  aria-label="Scan received product barcode"
                  value={inwardScanCode}
                  onChange={(event) => setInwardScanCode(event.target.value)}
                  placeholder="Scan product barcode and press Enter"
                  disabled={submitting}
                />
                <button className="btn-ui neutral" type="submit" disabled={!inwardScanCode.trim() || submitting}>
                  <ScanLine size={13} /> Scan
                </button>
              </form>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr><th>SKU</th><th>Barcode</th><th>Expected</th><th>Received</th></tr>
                  </thead>
                  <tbody>
                    {(inwardTargetAsn.lines || []).map((line) => (
                      <tr key={line.line_id}>
                        <td>{line.sku_name}<div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{line.sku_code}</div></td>
                        <td className="mono-num">{line.ean || line.sku_code || '—'}</td>
                        <td className="mono-num">{line.ordered_qty}</td>
                        <td className="mono-num">{inwardCounts[line.line_id] || 0}</td>
                      </tr>
                    ))}
                    {(inwardTargetAsn.lines || []).length === 0 && (
                      <tr><td colSpan={4}>This consignment has no product lines to scan.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowInwardModal(false)} disabled={submitting}>
                Cancel
              </button>
              <button className="btn-ui primary" onClick={() => handleScannedReceipt(inwardTargetAsn)} disabled={submitting || !Object.values(inwardCounts).some((qty) => qty > 0)}>
                {submitting ? 'Recording...' : 'Complete receipt & send to QC'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quality control inspection */}
      {showQcModal && qcTarget && (
        <div className="modal-backdrop" onClick={() => !qcBusy && setShowQcModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">Quality Control Inspection</div>
              <button className="btn-ui neutral" onClick={() => setShowQcModal(false)} disabled={qcBusy}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {qcError && <div className="form-error-banner">{qcError}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                GRN <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{qcTarget.grn_no || '—'}</strong>
                {' · '}ASN <strong style={{ fontFamily: 'var(--font-mono)' }}>{qcTarget.asn_no || '—'}</strong>
              </div>
              <div style={{ fontSize: 13 }}>
                <strong>{qcTarget.sku_name || qcTarget.sku_code || 'Item'}</strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {qcTarget.received_qty ?? 0} received unit(s). Only units passed here become putaway stock.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="crud-form-field">
                  <label>Passed units</label>
                  <input
                    type="number"
                    min="0"
                    max={qcTarget.received_qty ?? 0}
                    value={qcPass}
                    onChange={(e) => setQcPass(e.target.value)}
                    disabled={qcBusy}
                  />
                </div>
                <div className="crud-form-field">
                  <label>Rejected units</label>
                  <input
                    type="number"
                    min="0"
                    max={qcTarget.received_qty ?? 0}
                    value={qcFail}
                    onChange={(e) => setQcFail(e.target.value)}
                    disabled={qcBusy}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-ui neutral"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={() => { setQcPass(qcTarget.received_qty ?? 0); setQcFail(0); }}
                  disabled={qcBusy}
                >
                  Accept all
                </button>
                <button
                  type="button"
                  className="btn-ui neutral"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                  onClick={() => { setQcPass(0); setQcFail(qcTarget.received_qty ?? 0); }}
                  disabled={qcBusy}
                >
                  Reject all
                </button>
              </div>

              <div className="crud-form-field">
                <label>Inspector remarks</label>
                <input
                  type="text"
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  placeholder="Optional note for the audit trail"
                  disabled={qcBusy}
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Confirming accepts {Number(qcPass || 0)} unit(s), marks {Number(qcFail || 0)} as damaged, and
                creates the putaway task when anything passed.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowQcModal(false)} disabled={qcBusy}>Cancel</button>
              <button className="btn-ui primary" onClick={handleVerifyQc} disabled={qcBusy}>
                {qcBusy ? 'Recording...' : 'Record Inspection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Putaway confirmation */}
      {putawayTarget && (
        <div className="modal-backdrop" onClick={() => setPutawayTarget(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div className="modal-title">Confirm Putaway</div>
              <button className="btn-ui neutral" onClick={() => setPutawayTarget(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {putawayError && <div className="form-error-banner">{putawayError}</div>}
              <div style={{ fontSize: 12 }}>
                Place <strong>{putawayTarget.remaining_qty ?? putawayTarget.qty}</strong> unit(s) of{' '}
                <strong>{putawayTarget.sku_name || putawayTarget.sku_code}</strong> into a bin.
              </div>
              <div className="crud-form-field">
                <label>Destination Bin</label>
                <select value={putawayBin} onChange={(e) => setPutawayBin(e.target.value)}>
                  <option value="">Select bin</option>
                  {putawayBins.map(b => (
                    <option key={b.location_id} value={b.location_id}>
                      {b.barcode}{b.free_qty != null ? ` (free ${b.free_qty})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Confirming writes the units into the bin ledger and closes the task.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setPutawayTarget(null)}>Cancel</button>
              <button className="btn-ui primary" onClick={handleCompletePutaway} disabled={putawayBusy}>
                {putawayBusy ? 'Confirming...' : 'Confirm Putaway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan bundle in */}
      {showScanModal && (
        <div className="modal-backdrop" onClick={() => setShowScanModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div className="modal-title">Scan Bundle In</div>
              <button className="btn-ui neutral" onClick={() => setShowScanModal(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body scan-panel">
              {scanError && <div className="form-error-banner">{scanError}</div>}

              <div className="crud-form-field">
                <label>Receiving Facility</label>
                <select value={scanSite} onChange={(e) => setScanSite(e.target.value)}>
                  <option value="">Select facility</option>
                  {sites.filter(s => !darkStoreMode || s.site_id === darkStoreSiteId).map(s => (
                    <option key={s.site_id} value={s.site_id}>
                      {s.code} - {s.name || s.site_type} ({s.site_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="crud-form-field">
                <label>Bundle barcode or QR payload</label>
                <input
                  autoFocus
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleScanLookup(); }}
                  placeholder="Scan the label, or paste the QR JSON"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ui neutral" onClick={handleScanLookup} disabled={scanBusy}>
                  <QrCode size={13} /> Lookup Bundle
                </button>
                <button className="btn-ui primary" onClick={handleScanReceive} disabled={scanBusy}>
                  <ArrowDownToLine size={13} /> Receive Into Facility
                </button>
              </div>

              {scanResult?.type === 'resolved' && (
                <div className="scan-result">
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 6 }}>
                    {scanResult.data.barcode}
                  </div>
                  <div style={{ fontSize: 11.5, marginBottom: 6 }}>
                    {scanResult.data.lpn_type} · {scanResult.data.status} · {scanResult.data.total_qty} units
                  </div>
                  <div style={{ fontSize: 11.5, marginBottom: 6 }}>
                    Destination: <strong>{scanResult.data.destination?.code || '—'}</strong>
                    {scanResult.data.destination?.name ? ` - ${scanResult.data.destination.name}` : ''}
                  </div>
                  <div style={{ fontSize: 11.5 }}>
                    {(scanResult.data.contents || []).map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                        <span>{item.sku_code}</span>
                        <span>{item.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {scanResult?.type === 'received' && (
                <div className={`scan-result ${scanResult.data.already_received ? 'warn' : 'success'}`}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {scanResult.data.already_received
                      ? 'Already registered at this facility'
                      : `Received into ${scanResult.site.code}`}
                  </div>
                  <div style={{ fontSize: 11.5 }}>
                    {scanResult.data.already_received
                      ? 'No duplicate stock movement was posted. The bundle is already in custody here.'
                      : (scanResult.data.message || 'Bundle received and registered in inbound custody.')}
                  </div>
                  {!scanResult.data.already_received && (scanResult.data.stock_moved || []).length > 0 && (
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {scanResult.data.stock_moved.map((m, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>{m.sku}</span>
                          <span>{m.qty}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Receiving the same bundle twice at the same facility is safe: the server reports it as already received and does not post the stock again.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ui neutral" onClick={() => setShowScanModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
