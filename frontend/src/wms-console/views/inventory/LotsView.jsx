import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Download, Search, CheckCircle2, ImagePlus, MapPin } from 'lucide-react';

const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];
const skuLabel = (sku) => sku ? `${sku.sku_code || ''} — ${sku.name || ''}`.trim() : '';
const locationText = (container, ref) => [container, ref].filter(Boolean).join(': ') || '—';
const scopeText = (scope) => {
  if (!scope) return '—';
  if (typeof scope === 'string') return scope;
  return Object.entries(scope)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join(' • ') || '—';
};

function InventoryProductImage({ url, name }) {
  const [broken, setBroken] = useState(false);
  return (
    <div style={{
      width: 42, height: 42, display: 'grid', placeItems: 'center',
      overflow: 'hidden', border: '1px solid var(--border-subtle)',
      borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-muted)',
    }}>
      {url && !broken
        ? <img src={url} alt={name || ''} loading="lazy"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <ImagePlus size={16} aria-label={`No image for ${name || 'product'}`} />}
    </div>
  );
}

export default function LotsView({
  initialTab = 'inventory-lots',
  siteId = '',
  siteCode = '',
  darkStoreMode = false,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [lots, setLots] = useState([]);
  const [inventoryProducts, setInventoryProducts] = useState([]);
  const [customerAvailability, setCustomerAvailability] = useState([]);
  const [storefrontInfo, setStorefrontInfo] = useState(null);
  const [pincode, setPincode] = useState('');
  const [deliveryAreas, setDeliveryAreas] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [droplists, setDroplists] = useState([]);
  const [cycleCounts, setCycleCounts] = useState([]);
  const [replenishments, setReplenishments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const loadSequence = useRef(0);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    const requestSequence = ++loadSequence.current;
    if (!quiet) setLoading(true);
    setLoadError('');
    setActionError('');
    if (activeTab === 'customer-availability') {
      setCustomerAvailability([]);
      setStorefrontInfo(null);
    }
    if (darkStoreMode && !siteId) {
      setLots([]);
      setInventoryProducts([]);
      setCustomerAvailability([]);
      setTransactions([]);
      setDroplists([]);
      setCycleCounts([]);
      setReplenishments([]);
      setLoadError('Select an active Darkstore to view inventory records.');
      if (!quiet) setLoading(false);
      return;
    }
    try {
      if (activeTab === 'customer-availability') {
        if (!siteCode) {
          throw new Error('Select an active Darkstore to view customer availability.');
        }
        if (!pincode) {
          setCustomerAvailability([]);
          setStorefrontInfo(null);
          setActionError('Pick a delivery pincode below to see what shoppers in that area can buy.');
          if (!quiet) setLoading(false);
          return;
        }
        const res = await apiClient.get('/orders/storefront', { site: siteCode, pincode });
        if (requestSequence !== loadSequence.current) return;
        setStorefrontInfo(res);
        setCustomerAvailability(resultsFrom(res.items || []));
      } else if (activeTab === 'transactions') {
        const [res, skusData, sitesData] = await Promise.all([
          apiClient.get('/inventory/movements/', { page_size: 200, ...(siteId ? { site: siteId } : {}) }),
          apiClient.get('/catalog/skus/', { page_size: 1000 }),
          apiClient.get('/network/sites/', { page_size: 500 }),
        ]);
        if (requestSequence !== loadSequence.current) return;
        const skuById = new Map(resultsFrom(skusData).map(sku => [sku.sku_id, sku]));
        const siteCodeById = new Map(resultsFrom(sitesData).map(site => [site.site_id, site.code]));
        setTransactions(resultsFrom(res).map(row => {
          const sku = skuById.get(row.sku);
          return {
            ...row,
            tx_id: row.entry_id,
            sku_code: sku?.sku_code || '',
            sku_name: skuLabel(sku),
            site_code: siteCodeById.get(row.site) || row.site || '—',
            flow: row.movement_type || row.movement_ref || '—',
            ref_type: row.movement_ref || '—',
            from_bin: locationText(row.from_container, row.from_ref_id),
            to_bin: locationText(row.to_container, row.to_ref_id),
          };
        }));
      } else if (activeTab === 'droplists') {
        const res = await apiClient.get('/ds-ops/droplists/', { page_size: 200, ...(siteId ? { site: siteId } : {}) });
        if (requestSequence !== loadSequence.current) return;
        setDroplists(resultsFrom(res));
      } else if (activeTab === 'cycle-counts') {
        const res = await apiClient.get('/counting/cycle-counts/', { page_size: 200, ...(siteId ? { site: siteId } : {}) });
        if (requestSequence !== loadSequence.current) return;
        setCycleCounts(resultsFrom(res));
      } else if (activeTab === 'replenishment') {
        const res = await apiClient.get('/inventory/replenishment-tasks/', { page_size: 200, ...(siteId ? { site: siteId } : {}) });
        if (requestSequence !== loadSequence.current) return;
        setReplenishments(resultsFrom(res).map(row => ({
          ...row,
          sku_name: row.sku_name ? `${row.sku_code} — ${row.sku_name}` : row.sku_code || '—',
          from_location: locationText(row.from_container, row.from_container_ref),
          to_location: locationText(row.to_container, row.to_container_ref),
        })));
      } else {
        const [res, skusData, sitesData, balancesData, listingsData, vendorsData, locationsData] = await Promise.all([
          apiClient.get('/catalog/lots/', { page_size: 1000, ...(siteId ? { site: siteId } : {}) }),
          apiClient.get('/catalog/skus/', { page_size: 1000 }),
          apiClient.get('/network/sites/', { page_size: 500 }),
          apiClient.get('/inventory/balances/', { page_size: 1000, ...(siteId ? { site: siteId } : {}) }),
          darkStoreMode && siteId
            ? apiClient.get('/catalog/listings/', { page_size: 1000, site: siteId })
            : Promise.resolve([]),
          darkStoreMode
            ? apiClient.get('/supply/vendors/', { page_size: 1000 })
            : Promise.resolve([]),
          darkStoreMode && siteId
            ? apiClient.get('/network/locations/', { page_size: 1000, site: siteId })
            : Promise.resolve([]),
        ]);
        if (requestSequence !== loadSequence.current) return;
        const skuById = new Map(resultsFrom(skusData).map(sku => [sku.sku_id, sku]));
        const siteCodeById = new Map(resultsFrom(sitesData).map(site => [site.site_id, site.code]));
        const lotRows = resultsFrom(res);
        const balances = resultsFrom(balancesData);
        const qtyByLot = new Map();
        const binByLot = new Map();
        balances.forEach(balance => {
          qtyByLot.set(balance.lot, (qtyByLot.get(balance.lot) || 0) + Number(balance.qty || 0));
          if (balance.container === 'BIN' && balance.container_ref && !binByLot.has(balance.lot)) {
            binByLot.set(balance.lot, balance.container_ref);
          }
        });
        setLots(lotRows.map(row => {
          const sku = skuById.get(row.sku);
          return {
            ...row,
            lot_code: row.batch_number,
            sku_code: sku?.sku_code || '',
            sku_name: sku?.name || '',
            site_code: siteCodeById.get(row.site) || row.site || '—',
            bin_code: binByLot.get(row.lot_id) || '—',
            qty: qtyByLot.get(row.lot_id) || 0,
          };
        }));

        if (darkStoreMode) {
          const vendorById = new Map(resultsFrom(vendorsData).map(vendor => [String(vendor.vendor_id), vendor.name]));
          const listingBySku = new Map(resultsFrom(listingsData).map(listing => [String(listing.sku), listing]));
          const locationById = new Map(resultsFrom(locationsData).map(location => [String(location.location_id), location]));
          // Every SKU listed at this store must appear, even zero-stock ones.
          // Otherwise the table looks like it is missing products on a fresh site.
          const productById = new Map();
          for (const [key, sku] of skuById) {
            if (!listingBySku.has(key)) continue;
            productById.set(key, {
              ...sku,
              vendors: new Set(),
              locations: new Map(),
              on_hand: 0,
              sellable_qty: 0,
              lot_count: 0,
            });
          }
          if (productById.size === 0) {
            // No listings have ever been created for this site; fall back to
            // whatever catalog data exists so the screen has something to show.
            for (const [key, sku] of skuById) {
              productById.set(key, {
                ...sku,
                vendors: new Set(),
                locations: new Map(),
                on_hand: 0,
                sellable_qty: 0,
                lot_count: 0,
              });
            }
          }
          const lotById = new Map(lotRows.map(lot => [String(lot.lot_id), lot]));
          const productFor = (skuId) => {
            const key = String(skuId || '');
            if (productById.has(key)) return productById.get(key);
            const sku = skuById.get(key);
            if (!sku) return null;
            const product = {
              ...sku,
              vendors: new Set(),
              locations: new Map(),
              on_hand: 0,
              sellable_qty: 0,
              lot_count: 0,
            };
            productById.set(key, product);
            return product;
          };

          lotRows.forEach((lot) => {
            const product = productFor(lot.sku);
            if (!product) return;
            product.lot_count += 1;
            const vendorName = vendorById.get(String(lot.source_vendor_id));
            if (vendorName) product.vendors.add(vendorName);
          });

          balances.forEach((balance) => {
            const lot = lotById.get(String(balance.lot));
            const product = productFor(balance.sku || lot?.sku);
            if (!product) return;
            const qty = Number(balance.qty || 0);
            if (!Number.isFinite(qty) || qty <= 0) return;
            product.on_hand += qty;
            if (balance.sellable) product.sellable_qty += qty;

            const location = balance.container === 'BIN'
              ? locationById.get(String(balance.container_ref))
              : null;
            const binCoordinates = location
              ? [location.aisle, location.rack, location.level, location.position].filter(Boolean).join('-')
              : '';
            const label = location?.barcode || binCoordinates || balance.container_ref || '—';
            const locationLabel = balance.container === 'BIN'
              ? label
              : [balance.container, balance.container_ref].filter(Boolean).join(': ') || '—';
            product.locations.set(
              locationLabel,
              (product.locations.get(locationLabel) || 0) + qty,
            );
          });

          setInventoryProducts([...productById.values()].map((product) => {
            const listing = listingBySku.get(String(product.sku_id));
            return {
              ...product,
              vendor_names: [...product.vendors].sort().join(', ') || '—',
              location_summary: [...product.locations.entries()]
                .map(([location, qty]) => `${location} (${qty})`)
                .join(', ') || 'No stock location',
              selling_price: listing?.price ?? '',
              listing_mrp: listing?.mrp ?? product.mrp,
              locations: undefined,
              vendors: undefined,
            };
          }).sort((a, b) => a.name.localeCompare(b.name)));
        }
      }
    } catch (err) {
      console.error(err);
      if (requestSequence === loadSequence.current) {
        setLoadError(err.message || 'Failed to load inventory records.');
      }
    } finally {
      if (requestSequence === loadSequence.current && !quiet) setLoading(false);
    }
  }, [activeTab, darkStoreMode, siteCode, siteId, pincode]);

  // Customer availability is scoped to a delivery pincode — pull the site's
  // delivery areas so the page can offer the pincode picker and default the
  // tab to the first active option.
  useEffect(() => {
    if (!darkStoreMode || activeTab !== 'customer-availability' || !siteId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/routing/delivery-areas/', { page_size: 100, site: siteId });
        const list = resultsFrom(res);
        if (cancelled) return;
        setDeliveryAreas(list);
        setPincode((current) => {
          if (current) return current;
          const first = list.find(a => a.is_active) || list[0];
          return first ? String(first.pincode || '') : '';
        });
      } catch {
        // Areas optional — the banner above tells the operator to publish one.
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, darkStoreMode, siteId]);

  useEffect(() => {
    loadData();
    return () => {
      loadSequence.current += 1;
    };
  }, [loadData]);

  useEffect(() => {
    if (!darkStoreMode || !siteId) return undefined;
    const syncInventory = () => {
      if (!document.hidden) loadData({ quiet: true });
    };
    const timer = window.setInterval(syncInventory, 30000);
    window.addEventListener('zippzo:live-event', syncInventory);
    document.addEventListener('visibilitychange', syncInventory);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('zippzo:live-event', syncInventory);
      document.removeEventListener('visibilitychange', syncInventory);
    };
  }, [darkStoreMode, loadData, siteId]);

  const handleCompleteReplenishment = async (task) => {
    setActionError('');
    try {
      await apiClient.post(`/inventory/replenishment-tasks/${task.task_id}/complete/`, {});
      await loadData();
    } catch (err) {
      console.error('Failed completing replenishment:', err);
      setActionError(err.message || 'Failed completing replenishment.');
    }
  };

  const handleDownloadCsv = () => {
    if (activeTab === 'customer-availability') {
      if (customerAvailability.length === 0) return;
      const headers = ['SKU Code', 'Product Name', 'Category', 'Customer Price', 'MRP', 'Available to Buy'];
      const rows = customerAvailability.map(item => [
        item.sku_code,
        item.name,
        item.category || '—',
        item.price,
        item.mrp,
        item.available,
      ]);
      downloadCsv(headers, rows, 'Customer_Availability');
    } else if (activeTab === 'transactions') {
      if (transactions.length === 0) return;
      const headers = ['Tx ID', 'SKU', 'Flow', 'Ref Type', 'Quantity', 'From Bin', 'To Bin', 'Created At'];
      const rows = transactions.map(t => [
        t.tx_id,
        t.sku_name || t.sku_code || '—',
        t.flow || '—',
        t.ref_type || '—',
        t.qty || 0,
        t.from_bin || '—',
        t.to_bin || '—',
        t.created_at,
      ]);
      downloadCsv(headers, rows, 'Inventory_Transactions');
    } else if (activeTab === 'droplists') {
      if (droplists.length === 0) return;
      const headers = ['Droplist Code', 'Site', 'Source Bin', 'Destination Bin', 'Totes', 'Dropped', 'Status', 'Created By', 'Completed By', 'Created At'];
      const rows = droplists.map(d => [d.code, d.site_code || '—', d.source_bin, d.dest_bin, d.tote_count || 0, d.dropped_count || 0, d.status, d.created_by_name || '—', d.completed_by_name || '—', d.created_at]);
      downloadCsv(headers, rows, 'Droplists');
    } else if (activeTab === 'cycle-counts') {
      if (cycleCounts.length === 0) return;
      const headers = ['Count Code', 'Site', 'Type', 'Scope', 'Status', 'Lines', 'Created At'];
      const rows = cycleCounts.map(c => [c.code, c.site_code || '—', c.count_type, scopeText(c.scope), c.status, c.line_count || 0, c.created_at]);
      downloadCsv(headers, rows, 'Cycle_Counts');
    } else if (activeTab === 'replenishment') {
      if (replenishments.length === 0) return;
      const headers = ['Task ID', 'Site', 'SKU', 'Lot', 'From', 'To', 'Qty', 'Trigger', 'Status', 'Assigned To', 'Created At'];
      const rows = replenishments.map(r => [
        r.task_id,
        r.site_code || '—',
        r.sku_name || r.sku_code || '—',
        r.lot_number || '—',
        r.from_location || '—',
        r.to_location || '—',
        r.qty || 0,
        r.trigger || '—',
        r.status,
        r.assigned_to_email || '—',
        r.created_at,
      ]);
      downloadCsv(headers, rows, 'Replenishment_Tasks');
    } else if (darkStoreMode && activeTab === 'inventory-lots') {
      if (inventoryProducts.length === 0) return;
      const headers = [
        'SKU ID', 'SKU Code', 'Product Name', 'Image URL', 'Vendor',
        'Location', 'Category', 'Selling Price', 'MRP', 'On Hand',
        'Sellable Quantity', 'Lot Count',
      ];
      const rows = inventoryProducts.map(item => [
        item.sku_id,
        item.sku_code,
        item.name,
        item.image_url || '',
        item.vendor_names,
        item.location_summary,
        item.category_name || item.sub_category || '—',
        item.selling_price,
        item.listing_mrp,
        item.on_hand,
        item.sellable_qty,
        item.lot_count,
      ]);
      downloadCsv(headers, rows, 'Darkstore_Product_Inventory');
    } else {
      if (lots.length === 0) return;
      const headers = ['Lot Code', 'SKU Code', 'Product Name', 'Bin', 'Qty', 'MRP', 'Bucket', 'Status', 'Expiry Date'];
      const rows = lots.map(l => [
        l.lot_code,
        l.sku_code,
        l.sku_name,
        l.bin_code,
        l.qty,
        l.mrp,
        l.bucket,
        l.status,
        l.expiry_date || '—',
      ]);
      downloadCsv(headers, rows, 'Inventory_Lots');
    }
  };

  const downloadCsv = (headers, rows, prefix) => {
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Zippzo_${prefix}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const lotColumns = [
    { label: 'Lot Code', key: 'lot_code', isCode: true },
    { label: 'SKU Code', key: 'sku_code', isCode: true },
    { label: 'Product Name', key: 'sku_name' },
    { label: 'Site', key: 'site_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Bin Coordinate', key: 'bin_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{val || '—'}</span> },
    { label: 'On Hand', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'MRP', key: 'mrp', render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>₹{parseFloat(val || 0).toFixed(2)}</span> },
    { label: 'Bucket', key: 'bucket', badge: true },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Expiry Date', key: 'expiry_date', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
  ];

  const inventoryProductColumns = [
    {
      label: 'Image',
      key: 'image_url',
      render: (value, row) => (
        <InventoryProductImage url={value} name={row.name} />
      ),
    },
    {
      label: 'Product / ID',
      key: 'name',
      render: (value, row) => (
        <div>
          <strong>{value || '—'}</strong>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {row.sku_code || '—'} · {row.sku_id}
          </div>
        </div>
      ),
    },
    { label: 'Vendor', key: 'vendor_names' },
    {
      label: 'Bin / Location',
      key: 'location_summary',
      render: (value) => (
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{value || '—'}</span>
      ),
    },
    { label: 'Category', key: 'category_name', render: (value, row) => value || row.sub_category || '—' },
    {
      label: 'Selling Price',
      key: 'selling_price',
      render: (value) => value === '' || value == null
        ? 'Not priced'
        : <strong style={{ fontFamily: 'var(--font-mono)' }}>₹{Number(value).toFixed(2)}</strong>,
    },
    {
      label: 'On Hand',
      key: 'on_hand',
      render: (value) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{value}</strong>,
    },
    {
      label: 'Sellable',
      key: 'sellable_qty',
      render: (value) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{value}</strong>,
    },
    {
      label: 'MRP',
      key: 'listing_mrp',
      render: (value) => <span style={{ fontFamily: 'var(--font-mono)' }}>₹{Number(value || 0).toFixed(2)}</span>,
    },
    { label: 'Lots', key: 'lot_count' },
  ];

  const txColumns = [
    { label: 'Tx ID', key: 'tx_id', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val || '—'}</strong> },
    { label: 'SKU', key: 'sku_name', render: (val, row) => <div><strong>{val || row.sku_code || '—'}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.sku_code}</div></div> },
    { label: 'Flow', key: 'flow', badge: true },
    { label: 'Ref Type', key: 'ref_type', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Units', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'From Location', key: 'from_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'To Location', key: 'to_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span> },
    { label: 'Logged At', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const droplistColumns = [
    { label: 'Droplist Code', key: 'code', render: (val) => <strong style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val}</strong> },
    { label: 'Site', key: 'site_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Source Bin', key: 'source_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Destination Bin', key: 'dest_bin', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span> },
    { label: 'Totes', key: 'tote_count', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'Dropped', key: 'dropped_count', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: '#48a968' }}>{val ?? 0}</span> },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Created By', key: 'created_by_name', render: (val) => <span style={{ fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Completed By', key: 'completed_by_name', render: (val) => <span style={{ fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Created At', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const cycleCountColumns = [
    { label: 'Count Code', key: 'code', render: (val) => <strong style={{ color: 'var(--c-teal)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</strong> },
    { label: 'Site', key: 'site_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Type', key: 'count_type', badge: true },
    { label: 'Scope / Bins', key: 'scope', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{scopeText(val)}</span> },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Lines', key: 'line_count', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val || 0}</strong> },
    { label: 'Created At', key: 'created_at', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val ? new Date(val).toLocaleString() : '—'}</span> },
  ];

  const replenishmentColumns = [
    { label: 'Task ID', key: 'task_id', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontSize: 11 }}>{val ? `${String(val).slice(0, 8)}…` : '—'}</strong> },
    { label: 'Site', key: 'site_code', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'Product Name', key: 'sku_name', render: (val) => <strong>{val || '—'}</strong> },
    { label: 'Lot', key: 'lot_number', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'From', key: 'from_location', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val || '—'}</span> },
    { label: 'To Forward Bin', key: 'to_location', render: (val) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)', fontWeight: 600 }}>{val || '—'}</span> },
    { label: 'Units', key: 'qty', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{val ?? 0}</strong> },
    { label: 'Trigger', key: 'trigger', badge: true },
    { label: 'Status', key: 'status', badge: true },
    { label: 'Assigned To', key: 'assigned_to_email', render: (val) => <span style={{ fontSize: 11 }}>{val || '—'}</span> },
    {
      label: 'Action',
      key: 'action',
      render: (_, row) => ['COMPLETED', 'CANCELLED'].includes(row.status) ? (
        <span style={{ fontSize: 11, color: '#48a968', fontFamily: 'var(--font-mono)' }}>Completed</span>
      ) : (
        <button
          className="btn-ui neutral"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={(e) => {
            e.stopPropagation();
            handleCompleteReplenishment(row);
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#48a968' }} />
          <span>Complete</span>
        </button>
      ),
    },
  ];

  const customerAvailabilityColumns = [
    { label: 'SKU Code', key: 'sku_code', isCode: true },
    { label: 'Product', key: 'name' },
    { label: 'Category', key: 'category', render: (val) => val || '—' },
    { label: 'Customer Price', key: 'price', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)' }}>₹{Number(val || 0).toFixed(2)}</strong> },
    { label: 'MRP', key: 'mrp', render: (val) => <span style={{ fontFamily: 'var(--font-mono)' }}>₹{Number(val || 0).toFixed(2)}</span> },
    { label: 'Available to Buy', key: 'available', render: (val) => <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-teal)' }}>{val ?? 0}</strong> },
  ];

  const filteredLots = lots.filter(l => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (l.lot_code && l.lot_code.toLowerCase().includes(q)) ||
      (l.sku_name && l.sku_name.toLowerCase().includes(q)) ||
      (l.site_code && l.site_code.toLowerCase().includes(q)) ||
      (l.bin_code && l.bin_code.toLowerCase().includes(q))
    );
  });

  const filteredInventoryProducts = inventoryProducts.filter((product) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return [
      product.sku_id,
      product.sku_code,
      product.name,
      product.vendor_names,
      product.location_summary,
      product.category_name,
      product.sub_category,
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(q));
  });

  const filteredCustomerAvailability = customerAvailability.filter(item => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return [item.sku_code, item.name, item.category]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q));
  });

  const filteredTxs = transactions.filter(t => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (t.sku_name && t.sku_name.toLowerCase().includes(q)) ||
      (t.site_code && t.site_code.toLowerCase().includes(q)) ||
      (t.flow && t.flow.toLowerCase().includes(q)) ||
      (t.ref_type && t.ref_type.toLowerCase().includes(q)) ||
      (t.from_bin && t.from_bin.toLowerCase().includes(q)) ||
      (t.to_bin && t.to_bin.toLowerCase().includes(q))
    );
  });

  const filteredDroplists = droplists.filter(d => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (d.code && d.code.toLowerCase().includes(q)) ||
      (d.site_code && d.site_code.toLowerCase().includes(q)) ||
      (d.source_bin && d.source_bin.toLowerCase().includes(q)) ||
      (d.dest_bin && d.dest_bin.toLowerCase().includes(q)) ||
      (d.status && d.status.toLowerCase().includes(q))
    );
  });

  const filteredCycleCounts = cycleCounts.filter(c => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.site_code && c.site_code.toLowerCase().includes(q)) ||
      (scopeText(c.scope).toLowerCase().includes(q)) ||
      (c.status && c.status.toLowerCase().includes(q))
    );
  });

  const filteredReplenishments = replenishments.filter(r => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      (r.task_id && r.task_id.toLowerCase().includes(q)) ||
      (r.sku_name && r.sku_name.toLowerCase().includes(q)) ||
      (r.site_code && r.site_code.toLowerCase().includes(q)) ||
      (r.from_location && r.from_location.toLowerCase().includes(q)) ||
      (r.to_location && r.to_location.toLowerCase().includes(q)) ||
      (r.status && r.status.toLowerCase().includes(q))
    );
  });

  const currentCount =
    activeTab === 'customer-availability' ? filteredCustomerAvailability.length :
    activeTab === 'transactions' ? filteredTxs.length :
    activeTab === 'droplists' ? filteredDroplists.length :
    activeTab === 'cycle-counts' ? filteredCycleCounts.length :
    activeTab === 'replenishment' ? filteredReplenishments.length :
    darkStoreMode ? filteredInventoryProducts.length : filteredLots.length;

  return (
    <div>
      {loadError && <div className="form-error-banner" role="alert">{loadError}</div>}
      {!darkStoreMode && (
        <div className="subtabs-rail" style={{ marginBottom: 12 }}>
          <div className="subtabs-list">
            <button
              className={`subtab-btn ${activeTab === 'inventory-lots' ? 'active' : ''}`}
              onClick={() => setActiveTab('inventory-lots')}
            >
              Inventory Lots ({lots.length})
            </button>
            <button
              className={`subtab-btn ${activeTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('transactions')}
            >
              Transaction Log ({transactions.length})
            </button>
            <button
              className={`subtab-btn ${activeTab === 'droplists' ? 'active' : ''}`}
              onClick={() => setActiveTab('droplists')}
            >
              Droplists ({droplists.length})
            </button>
            <button
              className={`subtab-btn ${activeTab === 'cycle-counts' ? 'active' : ''}`}
              onClick={() => setActiveTab('cycle-counts')}
            >
              Cycle Counts ({cycleCounts.length})
            </button>
            <button
              className={`subtab-btn ${activeTab === 'replenishment' ? 'active' : ''}`}
              onClick={() => setActiveTab('replenishment')}
            >
              Replenishment ({replenishments.length})
            </button>
          </div>

          <div className="screen-actions" style={{ paddingBottom: 6 }}>
            <button className="btn-ui neutral" onClick={loadData}>
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
            <button className="btn-ui neutral" onClick={handleDownloadCsv}>
              <Download size={12} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      )}
      {darkStoreMode && (
        <div className="screen-actions" style={{ marginBottom: 12, gap: 10 }}>
          <button className="btn-ui neutral" onClick={loadData} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button className="btn-ui neutral" onClick={handleDownloadCsv}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>
          {activeTab === 'customer-availability' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 12, color: 'var(--text-primary)' }}>
              <MapPin size={13} />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Area:</span>
              <select
                value={pincode}
                onChange={(event) => setPincode(event.target.value)}
                style={{ padding: '5px 8px', fontSize: 12, minHeight: 28, background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
              >
                {deliveryAreas.length === 0 && <option value="">no pincodes published</option>}
                {deliveryAreas.map((area) => (
                  <option key={area.area_id || area.pincode} value={area.pincode}>{area.pincode}{area.band ? ` · ${area.band}` : ''}{area.is_active === false ? ' · withdrawn' : ''}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Screen Header */}
      <div className="screen-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="screen-title">
            <span>
              {activeTab === 'customer-availability' ? 'PRODUCTS AVAILABLE TO DARKSTORE CUSTOMERS' :
               activeTab === 'transactions' ? 'INVENTORY AUDIT & TRANSACTION LOG' :
               activeTab === 'droplists' ? 'INTERNAL STOCK MOVEMENT & DROPLISTS' :
               activeTab === 'cycle-counts' ? 'PHYSICAL CYCLE COUNTS & RECONCILIATION' :
               activeTab === 'replenishment' ? 'FORWARD PICK REPLENISHMENT TASKS' :
               darkStoreMode ? 'DARKSTORE PRODUCTS, PRICES & STOCK' : 'INVENTORY LOTS & PHYSICAL LOCATIONS'}
            </span>
            <span className="screen-count-tag">{currentCount} Records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeTab === 'customer-availability'
              ? `Same products and available quantities returned by the shopper app for ${storefrontInfo?.site || siteCode || 'this store'}. The shopper's location selects their store; delivery eligibility is checked for their address.`
              : activeTab === 'transactions' ? 'Immutable ledger of all stock putaway, pick, sort, and transfer events.' :
             activeTab === 'droplists' ? 'Inter-bin pallet and bin replenishment droplists.' :
             activeTab === 'cycle-counts' ? 'Regular stock verification audits to ensure physical bin accuracy.' :
             activeTab === 'replenishment' ? 'Reserve-to-pickface replenishment to avoid outbound pick stockouts.' :
             'Real-time bin balances, lot serials, and expiry control.'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search records..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              padding: '5px 28px 5px 10px',
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

      {actionError && <div className="form-error-banner" style={{ marginBottom: 12 }}>{actionError}</div>}

      {/* Main Table */}
      {darkStoreMode && activeTab === 'inventory-lots' ? (
        <DataTable
          columns={inventoryProductColumns}
          data={filteredInventoryProducts}
          idField="sku_id"
          emptyMessage="No products with inventory records were found for this store."
        />
      ) : activeTab === 'customer-availability' ? (
        <DataTable
          columns={customerAvailabilityColumns}
          data={filteredCustomerAvailability}
          idField="sku_id"
          emptyMessage="No listed products currently have customer-available stock at this store."
        />
      ) : activeTab === 'transactions' ? (
        <DataTable
          columns={txColumns}
          data={filteredTxs}
          idField="tx_id"
          emptyMessage="No transaction logs recorded."
        />
      ) : activeTab === 'droplists' ? (
        <DataTable
          columns={droplistColumns}
          data={filteredDroplists}
          idField="droplist_id"
          emptyMessage="No droplists registered."
        />
      ) : activeTab === 'cycle-counts' ? (
        <DataTable
          columns={cycleCountColumns}
          data={filteredCycleCounts}
          idField="count_id"
          emptyMessage="No cycle counts in progress."
        />
      ) : activeTab === 'replenishment' ? (
        <DataTable
          columns={replenishmentColumns}
          data={filteredReplenishments}
          idField="task_id"
          emptyMessage="No replenishment tasks pending."
        />
      ) : (
        <DataTable
          columns={lotColumns}
          data={filteredLots}
          idField="lot_id"
          emptyMessage="No inventory lots found."
        />
      )}
    </div>
  );
}
