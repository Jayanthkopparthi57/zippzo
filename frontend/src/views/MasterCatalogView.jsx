import React, { useState, useEffect } from 'react';
import { Tag, Layers, Users, Shield, Truck, Plus, ArrowLeft, PackagePlus, Barcode } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import ProductBarcodeModal from '../components/ui/ProductBarcodeModal';
import { fetchApi, postApi } from '../api/client';

export default function MasterCatalogView({ initialTab = 'skus' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [skus, setSkus] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);

  // Dedicated Page State for New SKU
  const [isCreatingSku, setIsCreatingSku] = useState(false);
  const [barcodeSku, setBarcodeSku] = useState(null);

  useEffect(() => {
    setActiveSubtab(initialTab);
  }, [initialTab]);

  const loadData = () => {
    fetchApi('/catalog/skus/').then(res => { if (res) setSkus(res); });
    fetchApi('/catalog/categories/').then(res => { if (res) setCategories(res); });
    fetchApi('/supply/vendors/').then(res => { if (res) setVendors(res); });
    fetchApi('/network/vehicle-types/').then(res => { if (res) setVehicleTypes(res); });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSku = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mrp = parseFloat(fd.get('mrp')) || 100;
    const catId = fd.get('category_id');
    const skuCode = `SKU-GEN-00${skus.length + 1}`;
    const ean = fd.get('barcode') || `89010000000${skus.length + 1}`;
    
    const newSkuData = {
      sku_code: skuCode,
      name: fd.get('product_name'),
      category: catId || (categories.length > 0 ? categories[0].category_id : null),
      ean: ean,
      mrp: mrp,
      wac: mrp * 0.8,
      storage_zone: 'DRY',
      status: 'ACTIVE'
    };

    const res = await postApi('/catalog/skus/', newSkuData);
    if (res) {
      loadData();
      setIsCreatingSku(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // 1. DEDICATED PAGE: ADD NEW SKU ITEM
  // ══════════════════════════════════════════════════════════════════
  if (isCreatingSku) {
    return (
      <div className="animate-fade" style={{ padding: '24px 32px', maxWidth: 850, margin: '0 auto' }}>
        <Tag style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <button
            className="btn-secondary"
            onClick={() => setIsCreatingSku(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontWeight: 600 }}
          >
            <ArrowLeft size={16} /> Back to SKUs Master
          </button>
          <span className="badge badge-purple" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
            Master Data Registry
          </span>
        </Tag>

        <div style={{
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
          padding: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PackagePlus size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Register New SKU Product Item
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0 0' }}>
                Create master product record with EAN barcode, category taxonomy, and pricing
              </p>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

          <form onSubmit={handleCreateSku}>
            <div style={{ marginBottom: 18 }}>
              <label className="form-label" style={{ fontWeight: 600 }}>Product Title / Name</label>
              <input type="text" className="form-input" name="product_name" placeholder="e.g. Heritage Toned Milk 500ml" required />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Category Taxonomy</label>
                <select className="form-input" name="category" defaultValue="Dairy & Fresh">
                  <option value="Dairy & Fresh">Dairy & Fresh</option>
                  <option value="Staples & Oils">Staples & Oils</option>
                  <option value="Beverages">Beverages</option>
                  <option value="Snacks">Snacks</option>
                  <option value="Home & Personal Care">Home & Personal Care</option>
                </select>
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>EAN / UPC Barcode</label>
                <input type="text" className="form-input" name="barcode" placeholder="e.g. 8901234567890" required />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Maximum Retail Price (MRP ₹)</label>
                <input type="number" className="form-input" name="mrp" defaultValue={50} required />
              </div>
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Storage Requirements</label>
                <select className="form-input" defaultValue="DRY">
                  <option value="COLD">Cold Chain / Chilled (2°C - 8°C)</option>
                  <option value="DRY">Ambient / Dry Storage</option>
                  <option value="HAZMAT">Hazardous / Chemical</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setIsCreatingSku(false)} style={{ padding: '10px 20px', fontWeight: 600 }}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', fontWeight: 700, fontSize: 14 }}>
                Save SKU to Master
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. MASTER DATA TABLES VIEW (ZERO FORMS BELOW TABLE)
  // ══════════════════════════════════════════════════════════════════
  return (
    <div>
      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'skus' ? 'active' : ''}`} onClick={() => setActiveSubtab('skus')}>SKUs Catalog</button>
        <button className={`subtab-btn ${activeSubtab === 'categories' ? 'active' : ''}`} onClick={() => setActiveSubtab('categories')}>Categories</button>
        <button className={`subtab-btn ${activeSubtab === 'vendors' ? 'active' : ''}`} onClick={() => setActiveSubtab('vendors')}>Vendors</button>
        <button className={`subtab-btn ${activeSubtab === 'transporters' ? 'active' : ''}`} onClick={() => setActiveSubtab('transporters')}>Transporters</button>
        <button className={`subtab-btn ${activeSubtab === 'vehicle-types' ? 'active' : ''}`} onClick={() => setActiveSubtab('vehicle-types')}>Vehicle Types</button>
      </div>

      {activeSubtab === 'skus' && (
        <DataTable
          title="Product SKUs Master Catalog"
          subtitle="Master product listings, EAN barcodes, MRP, WAC, storage requirements"
          onAdd={() => setIsCreatingSku(true)}
          addLabel="Add New SKU"
          columns={[
            { header: 'SKU Code', key: 'sku_code', render: r => <span className="code-cell">{r.sku_code}</span> },
            { header: 'Product Name', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'Category', key: 'category_name', render: r => <span>{r.category_name || 'General'}</span> },
            { header: 'EAN Barcode', key: 'ean', render: r => <span style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{r.ean}</span> },
            { header: 'MRP', key: 'mrp', render: r => `₹${r.mrp}` },
            { header: 'WAC', key: 'wac', render: r => `₹${r.wac}` },
            { header: 'Storage Zone', key: 'storage_zone' },
            { header: 'Status', key: 'status', render: r => <span className={`badge ${r.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{r.status}</span> },
            {
              header: 'Barcode',
              render: r => (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                  onClick={e => { e.stopPropagation(); setBarcodeSku(r); }}
                >
                  <Barcode size={12} /> {r.ean ? 'Add / Print' : 'Generate'}
                </button>
              )
            },
          ]}
          data={skus}
        />
      )}

      {barcodeSku && (
        <ProductBarcodeModal
          onClose={() => setBarcodeSku(null)}
          skus={[{ ...barcodeSku, sku_id: barcodeSku.id ?? barcodeSku.sku_id }]}
          preselectedSku={String(barcodeSku.id ?? barcodeSku.sku_id ?? '')}
        />
      )}

      {activeSubtab === 'categories' && (
        <DataTable
          title="Product Categories"
          subtitle="Product taxonomy for storage zone mapping"
          columns={[
            { header: 'Category ID', key: 'category_id', render: r => <span className="code-cell">{String(r.category_id).slice(0, 8)}</span> },
            { header: 'Category Name', key: 'name', render: r => <strong>{r.name}</strong> },
          ]}
          data={categories}
        />
      )}

      {activeSubtab === 'vendors' && (
        <DataTable
          title="Vendors & Supplier Master"
          subtitle="Approved suppliers and GSTIN tax details"
          columns={[
            { header: 'Vendor Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Legal Name', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'GSTIN', key: 'gstin', render: r => <span style={{ fontFamily: 'monospace' }}>{r.gstin || '27AABCU9603R1ZM'}</span> },
            { header: 'Status', key: 'status', render: r => <span className={`badge ${r.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>{r.status}</span> },
          ]}
          data={vendors}
        />
      )}

      {activeSubtab === 'transporters' && (
        <DataTable
          title="Logistics Transporters"
          subtitle="3PL freight transport partners"
          columns={[
            { header: 'Transporter Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Company Name', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'Primary Contact', key: 'contact_person', render: r => <span>{r.contact_person || 'Logistics Desk'}</span> },
            { header: 'Phone', key: 'phone', render: r => <span>{r.phone || '040-23456789'}</span> },
          ]}
          data={transporters}
        />
      )}

      {activeSubtab === 'vehicle-types' && (
        <DataTable
          title="Vehicle Types & Specifications"
          subtitle="Transport fleet vehicle specifications"
          columns={[
            { header: 'Type Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'LPN Capacity', key: 'capacity_lpns', render: r => `${r.capacity_lpns} LPNs` },
            { header: 'Temp Controlled', key: 'temp_controlled', render: r => (
              <span className={`badge ${r.temp_controlled ? 'badge-success' : 'badge-info'}`}>{r.temp_controlled ? 'YES' : 'NO'}</span>
            )},
          ]}
          data={vehicleTypes}
        />
      )}
    </div>
  );
}
