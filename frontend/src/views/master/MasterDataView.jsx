import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Trash2, X, Save, Pencil, AlertTriangle, Database, Barcode, Printer,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { apiClient, fetchApi } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import ProductBarcodeModal from '../../components/ui/ProductBarcodeModal';

/* ───────────────────────────────────────────────────────────────────────────
 * One registry for every reference / configuration table.
 *
 * The old screen pointed at `/master/*` and `/platform/*` routes that never
 * existed, read `res.results` from a client that already unwraps pagination,
 * and passed `(value, row)` to a renderer that calls `(row, index)`. Every
 * table was therefore empty and every edit was impossible. The endpoints below
 * are the real ones, and the renderers use the real signature.
 * ─────────────────────────────────────────────────────────────────────────── */

const choice = (value, label = value) => ({ value, label });
const f = (name, label, options = {}) => ({
  name, label, type: 'text', required: false, ...options,
});

const ACTIVE_INACTIVE = [choice('ACTIVE'), choice('INACTIVE')];
const SITE_TYPE = [
  choice('MH', 'Mother Hub'), choice('DS', 'Dark Store'),
  choice('SS', 'Super Store'), choice('XDOCK', 'Cross Dock'),
];

const GROUPS = [
  { id: 'network', label: 'Network' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'catalog', label: 'Catalog & suppliers' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'transport', label: 'Transport' },
  { id: 'inventory', label: 'Inventory control' },
  { id: 'people', label: 'People & work' },
];

const REFERENCE_ENDPOINTS = {
  sites: '/network/sites/',
  zones: '/network/zones/',
  locations: '/network/locations/',
  categories: '/catalog/categories/',
  skus: '/catalog/skus/',
  users: '/iam/users/',
  organizations: '/master/organizations/',
  carriers: '/master/carriers/',
  vehicles: '/master/vehicles/',
  vehicleTypes: '/network/vehicle-types/',
  dispatchPlans: '/transport/dispatch-plans/',
  shipments: '/transport/shipments/',
  trips: '/transport/trips/',
  lpns: '/inventory/lpns/',
  cycleCounts: '/counting/cycle-counts/',
  workAssignments: '/workforce/work-assignments/',
};

const ref = (name, label, reference, options = {}) => f(name, label, {
  type: 'reference', ref: reference, ...options,
});

const RESOURCES = {
  /* ── Network ───────────────────────────────────────────────────────────── */
  organizations: {
    label: 'Organizations', group: 'network',
    endpoint: '/master/organizations/', idField: 'org_id',
    subtitle: 'Legal parties behind vendors, sellers, carriers and storefronts.',
    fields: [
      f('code', 'Organization Code', { required: true }),
      f('name', 'Display Name', { required: true }),
      f('legal_name', 'Legal Name'),
      f('kind', 'Kind', { type: 'select', required: true, options: [
        choice('PLATFORM'), choice('VENDOR'), choice('SELLER'),
        choice('CARRIER'), choice('THIRD_PARTY'),
      ], defaultValue: 'VENDOR' }),
      f('gstin', 'GSTIN'),
      f('pan', 'PAN'),
      f('contact_name', 'Contact Name'),
      f('contact_email', 'Contact Email', { type: 'email' }),
      f('contact_phone', 'Contact Phone'),
      f('address', 'Address', { type: 'textarea' }),
      f('status', 'Status', { type: 'select', options: ACTIVE_INACTIVE, defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'Kind', key: 'kind', badge: true },
      { label: 'GSTIN', key: 'gstin', isCode: true },
      { label: 'Contact', key: 'contact_phone', render: (row) => row.contact_phone || row.contact_email || '—' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  stores: {
    label: 'Stores', group: 'network',
    endpoint: '/master/stores/', idField: 'store_id',
    subtitle: 'Commercial storefronts, their operator and the facility that fulfils them.',
    fields: [
      f('code', 'Store Code', { required: true }),
      f('name', 'Store Name', { required: true }),
      ref('organization', 'Organization', 'organizations', { allowBlank: true }),
      ref('site', 'Fulfilling Facility', 'sites', {
        valueKey: 'site_id', labelKey: 'code', allowBlank: true,
      }),
      f('store_type', 'Store Type', { type: 'select', options: [
        choice('DARK_STORE'), choice('SUPER_STORE'),
        choice('MOTHER_HUB'), choice('CROSS_DOCK'),
      ], defaultValue: 'DARK_STORE' }),
      f('address', 'Address', { type: 'textarea' }),
      f('city', 'City'), f('state', 'State'), f('pincode', 'Pincode'),
      f('geo_lat', 'Latitude', { type: 'number', step: '0.0000001', allowBlank: true }),
      f('geo_lng', 'Longitude', { type: 'number', step: '0.0000001', allowBlank: true }),
      f('service_radius_km', 'Service Radius (km)', { type: 'number', step: '0.01', defaultValue: 5 }),
      f('daily_cutoff_time', 'Daily Cut-off (HH:MM)'),
      f('is_accepting_orders', 'Accepting Orders', { type: 'boolean', defaultValue: false }),
      f('opened_on', 'Opened On', { type: 'date', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [
        choice('ONBOARDING'), choice('ACTIVE'), choice('PAUSED'), choice('RETIRED'),
      ], defaultValue: 'ONBOARDING' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'Type', key: 'store_type', badge: true },
      { label: 'City', key: 'city' },
      { label: 'Facility', key: 'site_code', isCode: true },
      { label: 'Radius', key: 'service_radius_km', render: (row) => `${row.service_radius_km} km` },
      { label: 'Accepting', key: 'is_accepting_orders', render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', color: row.is_accepting_orders ? '#48a968' : 'var(--text-muted)' }}>
          {row.is_accepting_orders ? 'YES' : 'NO'}
        </span>
      ) },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  sites: {
    label: 'Facilities', group: 'network',
    endpoint: '/network/sites/', idField: 'site_id',
    subtitle: 'Physical facilities: mother hubs, dark stores and cross docks.',
    fields: [
      f('code', 'Facility Code', { required: true }),
      f('name', 'Facility Name', { required: true }),
      f('site_type', 'Type', { type: 'select', required: true, options: SITE_TYPE, defaultValue: 'DS' }),
      ref('parent_site', 'Parent Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('address', 'Address', { type: 'textarea' }),
      f('geo_lat', 'Latitude', { type: 'number', step: '0.0000001', allowBlank: true }),
      f('geo_lng', 'Longitude', { type: 'number', step: '0.0000001', allowBlank: true }),
      f('is_accepting_orders', 'Accepting Orders', { type: 'boolean', defaultValue: false }),
      f('dh_precedence', 'DH Precedence', { defaultValue: 'DEFAULT' }),
      f('ss_precedence', 'SS Precedence', { defaultValue: 'SS_DEFAULT' }),
      f('status', 'Status', { type: 'select', options: [
        choice('ONBOARDING'), choice('ACTIVE'), choice('SUSPENDED'), choice('RETIRED'),
      ], defaultValue: 'ONBOARDING' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'Type', key: 'site_type', badge: true },
      { label: 'Address', key: 'address', nowrap: false },
      { label: 'Accepting', key: 'is_accepting_orders', render: (row) => (row.is_accepting_orders ? 'YES' : 'NO') },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── Facilities ────────────────────────────────────────────────────────── */
  zones: {
    label: 'Zones', group: 'facilities',
    endpoint: '/network/zones/', idField: 'zone_id',
    subtitle: 'Storage taxonomy: dry, cold, hazardous and commingling rules.',
    fields: [
      f('code', 'Zone Code', { required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('category', 'Category'),
      f('zone_type', 'Zone Type', { type: 'select', options: [
        choice('GENERAL'), choice('MRP'), choice('FLEXI_FORWARD'),
      ], defaultValue: 'GENERAL' }),
      f('value_type', 'Value Type', { defaultValue: 'General' }),
      f('fragility', 'Fragility', { defaultValue: 'General' }),
      f('food_type', 'Food Type', { defaultValue: 'Food' }),
      f('product_type', 'Product Type', { defaultValue: 'Food' }),
      f('is_advance_zone', 'Advance Zone', { type: 'boolean', defaultValue: false }),
      f('commingled_allowed', 'Commingled Allowed', { type: 'boolean', defaultValue: true }),
      f('max_commingled', 'Max Commingled', { type: 'number', defaultValue: 5 }),
      f('is_hazardous_allowed', 'Hazardous Allowed', { type: 'boolean', defaultValue: false }),
      f('status', 'Status', { type: 'select', options: [
        choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED'),
      ], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Zone Code', key: 'code', isCode: true },
      { label: 'Category', key: 'category' },
      { label: 'Type', key: 'zone_type', badge: true },
      { label: 'Commingle', key: 'max_commingled', render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>{row.max_commingled}</span>
      ) },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  locations: {
    label: 'Storage bins', group: 'facilities', aliases: ['bins'],
    endpoint: '/network/locations/', idField: 'location_id',
    subtitle: 'Every physical bin, dock and staging point, with its scanned barcode.',
    fields: [
      f('location_id', 'Location ID', { required: true, createOnly: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('location_type', 'Location Type', { type: 'select', options: [
        choice('BIN'), choice('ZONE'), choice('DOCK'), choice('STAGING'),
      ], defaultValue: 'BIN' }),
      ref('zone', 'Zone', 'zones', { valueKey: 'zone_id', labelKey: 'code', allowBlank: true }),
      f('container', 'Container', { defaultValue: 'PICK_FACE' }),
      f('aisle', 'Aisle'), f('rack', 'Rack'), f('level', 'Level'), f('position', 'Position'),
      f('barcode', 'Barcode', { required: true }),
      f('qr_payload', 'QR Payload'),
      f('capacity_qty', 'Capacity Qty', { type: 'number', allowBlank: true }),
      f('capacity_weight_g', 'Capacity Weight (g)', { type: 'number', allowBlank: true }),
      f('capacity_volume_ml', 'Capacity Volume (ml)', { type: 'number', allowBlank: true }),
      f('is_sellable_bin', 'Sellable Bin', { type: 'boolean', defaultValue: false }),
      f('is_active', 'Active', { type: 'boolean', defaultValue: true }),
    ],
    columns: [
      { label: 'Barcode', key: 'barcode', isCode: true },
      { label: 'Type', key: 'location_type', badge: true },
      { label: 'Aisle', key: 'aisle' }, { label: 'Rack', key: 'rack' },
      { label: 'Level', key: 'level' },
      { label: 'Container', key: 'container' },
      { label: 'Sellable', key: 'is_sellable_bin', render: (row) => (row.is_sellable_bin ? 'YES' : 'NO') },
      { label: 'Active', key: 'is_active', render: (row) => (row.is_active ? 'YES' : 'NO') },
      {
        label: 'Label', key: '__label', render: (row) => (
          <button
            type="button"
            className="btn-ui neutral"
            style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
            onClick={() => window.dispatchEvent(new CustomEvent('zippzo:print-bin', { detail: row }))}
          >
            <Printer size={11} /> Label
          </button>
        ),
      },
    ],
  },

  'dock-doors': {
    label: 'Dock doors', group: 'facilities',
    endpoint: '/network/dock-doors/', idField: 'door_id',
    subtitle: 'Inbound and outbound doors at each facility.',
    fields: [
      f('code', 'Door Code', { required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('capability', 'Capability', { type: 'select', options: [
        choice('LOAD'), choice('UNLOAD'), choice('BOTH'),
      ], defaultValue: 'BOTH' }),
      f('status', 'Status', { type: 'select', options: [
        choice('OPEN'), choice('BUSY'), choice('CLOSED'),
      ], defaultValue: 'OPEN' }),
    ],
    columns: [
      { label: 'Door Code', key: 'code', isCode: true },
      { label: 'Capability', key: 'capability', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  equipment: {
    label: 'Equipment', group: 'facilities',
    endpoint: '/master/equipment/', idField: 'equipment_id',
    subtitle: 'Scanners, printers, totes, pallets and other site assets.',
    fields: [
      f('code', 'Equipment Code', { required: true }),
      f('name', 'Name'),
      f('equipment_type', 'Type', { type: 'select', options: [
        choice('SCANNER'), choice('PRINTER'), choice('TOTE'), choice('PALLET'),
        choice('FORKLIFT'), choice('CART'), choice('CHILLER'), choice('OTHER'),
      ], defaultValue: 'SCANNER' }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('serial_no', 'Serial No'),
      ref('assigned_to', 'Assigned To', 'users', { valueKey: 'user_id', labelKey: 'email', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [
        choice('AVAILABLE'), choice('IN_USE'), choice('MAINTENANCE'), choice('RETIRED'),
      ], defaultValue: 'AVAILABLE' }),
      f('last_service_on', 'Last Service', { type: 'date', allowBlank: true }),
      f('next_service_on', 'Next Service', { type: 'date', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name' },
      { label: 'Type', key: 'equipment_type', badge: true },
      { label: 'Facility', key: 'site_code', isCode: true },
      { label: 'Assigned To', key: 'assigned_to_email' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── Catalog & suppliers ───────────────────────────────────────────────── */
  skus: {
    label: 'Product catalog', group: 'catalog',
    title: 'Product SKUs Master Catalog',
    endpoint: '/catalog/skus/', idField: 'sku_id',
    subtitle: 'The SKU master used by inbound, picking and the storefront.',
    fields: [
      f('sku_code', 'SKU Code', { required: true }),
      f('name', 'Product Name', { required: true }),
      f('ean', 'EAN Barcode'),
      ref('category', 'Category', 'categories', { valueKey: 'category_id', labelKey: 'name', allowBlank: true }),
      f('sub_category', 'Sub-category'),
      f('brand', 'Brand'),
      f('pack_size', 'Pack Size'),
      f('base_uom', 'Base UOM', { defaultValue: 'EACH' }),
      f('storage_zone', 'Storage Zone', { type: 'select', options: [
        choice('DRY'), choice('COLD'), choice('FROZEN'),
      ], defaultValue: 'DRY' }),
      f('shelf_life_days', 'Shelf Life (days)', { type: 'number', allowBlank: true }),
      f('is_food', 'Food Item', { type: 'boolean', defaultValue: false }),
      f('is_hazardous', 'Hazardous', { type: 'boolean', defaultValue: false }),
      f('is_catch_weight', 'Catch Weight', { type: 'boolean', defaultValue: false }),
      f('is_serialized', 'Serialized', { type: 'boolean', defaultValue: false }),
      f('is_age_restricted', 'Age Restricted', { type: 'boolean', defaultValue: false }),
      f('min_age_years', 'Minimum Age', { type: 'number', allowBlank: true }),
      f('mrp', 'MRP', { type: 'number', step: '0.01', defaultValue: 0 }),
      f('hsn_code', 'HSN Code'),
      f('weight_g', 'Weight (g)', { type: 'number', allowBlank: true }),
      f('image_url', 'Image URL'),
      f('status', 'Status', { type: 'select', options: [
        choice('DRAFT'), choice('SAMPLE_QC'), choice('APPROVED'), choice('ACTIVE'),
        choice('DELISTED'), choice('DISCONTINUED'),
      ], defaultValue: 'DRAFT' }),
    ],
    columns: [
      { label: 'SKU Code', key: 'sku_code', isCode: true },
      { label: 'Product', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'EAN', key: 'ean', isCode: true },
      { label: 'Category', key: 'category_name' },
      { label: 'MRP', key: 'mrp', render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          ₹{parseFloat(row.mrp || 0).toFixed(2)}
        </span>
      ) },
      { label: 'Zone', key: 'storage_zone', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  vendors: {
    label: 'Suppliers', group: 'catalog',
    endpoint: '/supply/vendors/', idField: 'vendor_id',
    subtitle: 'Purchase-side suppliers and the licences they trade under.',
    fields: [
      f('code', 'Vendor Code', { required: true }),
      f('name', 'Vendor Name', { required: true }),
      f('org_entity', 'Legal Entity'),
      f('gstin', 'GSTIN'), f('pan', 'PAN'),
      f('contact_name', 'Contact Name'),
      f('contact_phone', 'Contact Phone'),
      f('email', 'Email', { type: 'email' }),
      f('address', 'Address', { type: 'textarea' }),
      f('over_delivery_pct', 'Over-delivery %', { type: 'number', step: '0.01', defaultValue: 5 }),
      f('under_delivery_pct', 'Under-delivery %', { type: 'number', step: '0.01', defaultValue: 5 }),
      f('status', 'Status', { type: 'select', options: [
        choice('ACTIVE'), choice('BLOCKED'), choice('BLACKLISTED'),
      ], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'GSTIN', key: 'gstin', isCode: true },
      { label: 'Contact', key: 'contact_phone' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  sellers: {
    label: 'Sellers', group: 'catalog',
    endpoint: '/supply/sellers/', idField: 'seller_id',
    subtitle: 'Marketplace sellers onboarded to the platform.',
    fields: [
      f('code', 'Seller Code', { required: true }),
      f('legal_name', 'Legal Name', { required: true }),
      f('brand_name', 'Brand Name'),
      f('seller_type', 'Seller Type', { type: 'select', options: [
        choice('INDIVIDUAL'), choice('PROPRIETORSHIP'), choice('LLP'), choice('PVT_LTD'),
      ], defaultValue: 'INDIVIDUAL' }),
      f('gstin', 'GSTIN'),
      f('fulfilment_mode', 'Fulfilment Mode', { type: 'select', options: [
        choice('CONSIGNMENT_MH'), choice('CONSIGNMENT_DS'), choice('OUTRIGHT'),
      ], defaultValue: 'CONSIGNMENT_MH' }),
      f('commission_default_pct', 'Commission %', { type: 'number', step: '0.01', defaultValue: 0 }),
      f('status', 'Status', { type: 'select', options: [
        choice('DRAFT'), choice('SUBMITTED'), choice('KYC_PENDING'), choice('KYC_VERIFIED'),
        choice('CATALOG_REVIEW'), choice('PARTIALLY_APPROVED'), choice('ACTIVE'),
        choice('SUSPENDED'), choice('BLACKLISTED'), choice('OFFBOARDED'),
      ], defaultValue: 'DRAFT' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Legal Name', key: 'legal_name', render: (row) => <strong>{row.legal_name}</strong> },
      { label: 'Brand', key: 'brand_name' },
      { label: 'Type', key: 'seller_type', badge: true },
      { label: 'Fulfilment', key: 'fulfilment_mode', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── Fleet ─────────────────────────────────────────────────────────────── */
  carriers: {
    label: 'Carriers', group: 'fleet', aliases: ['transporters'],
    endpoint: '/master/carriers/', idField: 'carrier_id',
    subtitle: 'Transport partners. A vehicle is a unit; a carrier is the company.',
    fields: [
      f('code', 'Carrier Code', { required: true }),
      f('name', 'Carrier Name', { required: true }),
      ref('organization', 'Organization', 'organizations', { allowBlank: true }),
      f('mode', 'Mode', { type: 'select', options: [
        choice('ROAD'), choice('AIR'), choice('RAIL'), choice('COURIER'), choice('MULTIMODAL'),
      ], defaultValue: 'ROAD' }),
      f('contact_name', 'Contact Name'),
      f('contact_email', 'Contact Email', { type: 'email' }),
      f('contact_phone', 'Contact Phone'),
      f('tracking_url', 'Tracking URL'),
      f('gstin', 'GSTIN'),
      f('service_level', 'Service Level'),
      f('status', 'Status', { type: 'select', options: [
        choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED'),
      ], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: (row) => <strong>{row.name}</strong> },
      { label: 'Mode', key: 'mode', badge: true },
      { label: 'Contact', key: 'contact_phone' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  vehicles: {
    label: 'Vehicles', group: 'fleet',
    endpoint: '/master/vehicles/', idField: 'vehicle_id',
    subtitle: 'Registration-level vehicle instances with insurance and fitness dates.',
    fields: [
      f('registration_no', 'Registration No', { required: true }),
      ref('vehicle_type', 'Vehicle Type', 'vehicleTypes', { valueKey: 'vt_id', labelKey: 'code', allowBlank: true }),
      ref('carrier', 'Carrier', 'carriers', { allowBlank: true }),
      ref('home_site', 'Home Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('make', 'Make'), f('model_name', 'Model'),
      f('ownership', 'Ownership', { type: 'select', options: [
        choice('OWNED'), choice('LEASED'), choice('CONTRACTED'),
      ], defaultValue: 'OWNED' }),
      f('capacity_kg', 'Capacity (kg)', { type: 'number', allowBlank: true }),
      f('capacity_volume_l', 'Capacity (L)', { type: 'number', allowBlank: true }),
      f('insurance_expiry', 'Insurance Expiry', { type: 'date', allowBlank: true }),
      f('fitness_expiry', 'Fitness Expiry', { type: 'date', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [
        choice('AVAILABLE'), choice('ASSIGNED'), choice('IN_TRANSIT'),
        choice('MAINTENANCE'), choice('RETIRED'),
      ], defaultValue: 'AVAILABLE' }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Registration', key: 'registration_no', isCode: true },
      { label: 'Type', key: 'vehicle_type_code' },
      { label: 'Carrier', key: 'carrier_name' },
      { label: 'Home', key: 'home_site_code' },
      { label: 'Insurance', key: 'insurance_expiry' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  'vehicle-types': {
    label: 'Vehicle types', group: 'fleet',
    endpoint: '/network/vehicle-types/', idField: 'vt_id',
    subtitle: 'Capacity classes used when planning a dispatch.',
    fields: [
      f('code', 'Type Code', { required: true }),
      f('capacity_lpns', 'Capacity (LPNs)', { type: 'number', defaultValue: 0 }),
      f('temp_controlled', 'Temperature Controlled', { type: 'boolean', defaultValue: false }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Capacity LPNs', key: 'capacity_lpns' },
      { label: 'Temp Controlled', key: 'temp_controlled', render: (row) => (row.temp_controlled ? 'YES' : 'NO') },
    ],
  },

  'vehicle-checkins': {
    label: 'Vehicle check-ins', group: 'fleet',
    endpoint: '/master/vehicle-checkins/', idField: 'checkin_id',
    subtitle: 'Gate log for every vehicle entering or leaving a facility.',
    fields: [
      ref('vehicle', 'Vehicle', 'vehicles', { valueKey: 'vehicle_id', labelKey: 'registration_no', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('direction', 'Direction', { type: 'select', options: [choice('IN'), choice('OUT')], defaultValue: 'IN' }),
      f('purpose', 'Purpose', { type: 'select', options: [
        choice('PICKUP'), choice('DELIVERY'), choice('TRANSFER'),
        choice('MAINTENANCE'), choice('OTHER'),
      ], defaultValue: 'PICKUP' }),
      f('driver_name', 'Driver Name'),
      f('driver_phone', 'Driver Phone'),
      f('driver_license', 'Driver Licence'),
      f('seal_no', 'Seal No'),
      f('odometer_km', 'Odometer (km)', { type: 'number', allowBlank: true }),
      f('gate', 'Gate'),
      f('checked_out_at', 'Checked Out At', { type: 'datetime-local', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [choice('OPEN'), choice('CLOSED')], defaultValue: 'OPEN' }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Vehicle', key: 'vehicle_registration', isCode: true },
      { label: 'Facility', key: 'site_code' },
      { label: 'Direction', key: 'direction', badge: true },
      { label: 'Purpose', key: 'purpose', badge: true },
      { label: 'Driver', key: 'driver_name' },
      { label: 'In', key: 'checked_in_at', render: (row) => fmtDate(row.checked_in_at) },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── Transport ─────────────────────────────────────────────────────────── */
  'dispatch-plans': {
    label: 'Dispatch plans', group: 'transport',
    endpoint: '/transport/dispatch-plans/', idField: 'plan_id',
    subtitle: 'A dated wave of outbound work, with the vehicle assigned to it.',
    fields: [
      f('code', 'Plan Code', { required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('plan_date', 'Plan Date', { type: 'date', required: true }),
      f('wave_code', 'Wave Code'),
      f('cutoff_at', 'Cut-off At', { type: 'datetime-local', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [
        choice('DRAFT'), choice('OPEN'), choice('LOCKED'), choice('DISPATCHED'), choice('CANCELLED'),
      ], defaultValue: 'DRAFT' }),
      ref('carrier', 'Carrier', 'carriers', { allowBlank: true }),
      ref('vehicle', 'Vehicle', 'vehicles', { valueKey: 'vehicle_id', labelKey: 'registration_no', allowBlank: true }),
      f('planned_orders', 'Planned Orders', { type: 'number', defaultValue: 0 }),
      f('target_lpns', 'Target LPNs', { type: 'number', defaultValue: 0 }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Plan', key: 'code', isCode: true },
      { label: 'Facility', key: 'site_code' },
      { label: 'Date', key: 'plan_date' },
      { label: 'Wave', key: 'wave_code' },
      { label: 'Carrier', key: 'carrier_name' },
      { label: 'Vehicle', key: 'vehicle_registration', isCode: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  shipments: {
    label: 'Shipments', group: 'transport',
    endpoint: '/transport/shipments/', idField: 'shipment_id',
    subtitle: 'Consignments moving between facilities, with seal and timings.',
    fields: [
      f('code', 'Shipment Code', { required: true }),
      ref('dispatch_plan', 'Dispatch Plan', 'dispatchPlans', { valueKey: 'plan_id', labelKey: 'code', allowBlank: true }),
      ref('carrier', 'Carrier', 'carriers', { allowBlank: true }),
      ref('vehicle', 'Vehicle', 'vehicles', { valueKey: 'vehicle_id', labelKey: 'registration_no', allowBlank: true }),
      ref('origin_site', 'Origin', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('destination_site', 'Destination', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('mode', 'Mode', { type: 'select', options: [
        choice('ROAD'), choice('AIR'), choice('RAIL'), choice('COURIER'),
      ], defaultValue: 'ROAD' }),
      f('status', 'Status', { type: 'select', options: [
        choice('PLANNED'), choice('READY'), choice('DISPATCHED'), choice('IN_TRANSIT'),
        choice('DELIVERED'), choice('EXCEPTION'), choice('CANCELLED'),
      ], defaultValue: 'PLANNED' }),
      f('seal_no', 'Seal No'),
      f('total_lpns', 'Total LPNs', { type: 'number', defaultValue: 0 }),
      f('total_units', 'Total Units', { type: 'number', defaultValue: 0 }),
      f('planned_dispatch_at', 'Planned Dispatch', { type: 'datetime-local', allowBlank: true }),
      f('planned_arrival_at', 'Planned Arrival', { type: 'datetime-local', allowBlank: true }),
      f('actual_dispatch_at', 'Actual Dispatch', { type: 'datetime-local', allowBlank: true }),
      f('actual_arrival_at', 'Actual Arrival', { type: 'datetime-local', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Shipment', key: 'code', isCode: true },
      { label: 'Origin', key: 'origin_site_code' },
      { label: 'Destination', key: 'destination_site_code' },
      { label: 'Carrier', key: 'carrier_name' },
      { label: 'LPNs', key: 'total_lpns' },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Planned', key: 'planned_dispatch_at', render: (row) => fmtDate(row.planned_dispatch_at) },
    ],
  },

  trips: {
    label: 'Linehaul trips', group: 'transport',
    endpoint: '/transport/trips/', idField: 'trip_id',
    subtitle: 'Vehicle movements and their stop sequence.',
    fields: [
      f('code', 'Trip Code', { required: true }),
      ref('shipment', 'Shipment', 'shipments', { valueKey: 'shipment_id', labelKey: 'code', allowBlank: true }),
      ref('vehicle', 'Vehicle', 'vehicles', { valueKey: 'vehicle_id', labelKey: 'registration_no', allowBlank: true }),
      ref('carrier', 'Carrier', 'carriers', { allowBlank: true }),
      ref('origin_site', 'Origin', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('destination_site', 'Destination', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('driver_name', 'Driver Name'),
      f('driver_phone', 'Driver Phone'),
      f('status', 'Status', { type: 'select', options: [
        choice('PLANNED'), choice('IN_TRANSIT'), choice('COMPLETED'),
        choice('DELAYED'), choice('CANCELLED'),
      ], defaultValue: 'PLANNED' }),
      f('distance_km', 'Distance (km)', { type: 'number', step: '0.01', allowBlank: true }),
      f('planned_departure_at', 'Planned Departure', { type: 'datetime-local', allowBlank: true }),
      f('planned_arrival_at', 'Planned Arrival', { type: 'datetime-local', allowBlank: true }),
      f('actual_departure_at', 'Actual Departure', { type: 'datetime-local', allowBlank: true }),
      f('actual_arrival_at', 'Actual Arrival', { type: 'datetime-local', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Trip', key: 'code', isCode: true },
      { label: 'Origin', key: 'origin_site_code' },
      { label: 'Destination', key: 'destination_site_code' },
      { label: 'Vehicle', key: 'vehicle_registration', isCode: true },
      { label: 'Driver', key: 'driver_name' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  'trip-stops': {
    label: 'Trip stops', group: 'transport',
    endpoint: '/transport/trip-stops/', idField: 'stop_id',
    subtitle: 'Ordered stops within a linehaul trip.',
    fields: [
      ref('trip', 'Trip', 'trips', { valueKey: 'trip_id', labelKey: 'code', required: true }),
      f('sequence', 'Sequence', { type: 'number', required: true, defaultValue: 1 }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('stop_type', 'Stop Type', { type: 'select', options: [
        choice('PICKUP'), choice('DELIVERY'), choice('CROSS_DOCK'), choice('CHECKPOINT'),
      ], defaultValue: 'CHECKPOINT' }),
      f('status', 'Status', { type: 'select', options: [
        choice('PENDING'), choice('ARRIVED'), choice('COMPLETED'), choice('SKIPPED'),
      ], defaultValue: 'PENDING' }),
      f('planned_at', 'Planned At', { type: 'datetime-local', allowBlank: true }),
      f('actual_at', 'Actual At', { type: 'datetime-local', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Trip', key: 'trip_code', isCode: true },
      { label: 'Seq', key: 'sequence' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Type', key: 'stop_type', badge: true },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Actual', key: 'actual_at', render: (row) => fmtDate(row.actual_at) },
    ],
  },

  'shipping-scans': {
    label: 'Shipping scans', group: 'transport',
    endpoint: '/transport/shipping-scans/', idField: 'scan_id',
    subtitle: 'Append-only load, dispatch and receive scans. Correct a bad scan with a new one.',
    fields: [
      ref('shipment', 'Shipment', 'shipments', { valueKey: 'shipment_id', labelKey: 'code', allowBlank: true }),
      ref('trip', 'Trip', 'trips', { valueKey: 'trip_id', labelKey: 'code', allowBlank: true }),
      ref('lpn', 'LPN', 'lpns', { valueKey: 'lpn_id', labelKey: 'lpn_id', allowBlank: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('scan_type', 'Scan Type', { type: 'select', options: [
        choice('LOAD'), choice('UNLOAD'), choice('DISPATCH'),
        choice('RECEIVE'), choice('CHECK'), choice('REJECT'),
      ], defaultValue: 'CHECK' }),
      f('code', 'Scanned Code', { required: true }),
      f('result', 'Result', { type: 'select', options: [
        choice('OK'), choice('DUPLICATE'), choice('UNKNOWN'), choice('REJECTED'),
      ], defaultValue: 'OK' }),
    ],
    appendOnly: true,
    columns: [
      { label: 'Scanned', key: 'scanned_at', render: (row) => fmtDate(row.scanned_at) },
      { label: 'Type', key: 'scan_type', badge: true },
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Shipment', key: 'shipment_code' },
      { label: 'LPN', key: 'lpn_code' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Result', key: 'result', badge: true },
    ],
  },

  'cross-dock': {
    label: 'Cross-dock moves', group: 'transport',
    endpoint: '/transport/cross-dock/', idField: 'move_id',
    subtitle: 'Stock that changes site without a putaway step.',
    fields: [
      f('code', 'Move Code', { required: true }),
      ref('source_site', 'Source', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('destination_site', 'Destination', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('shipment', 'Shipment', 'shipments', { valueKey: 'shipment_id', labelKey: 'code', allowBlank: true }),
      ref('lpn', 'LPN', 'lpns', { valueKey: 'lpn_id', labelKey: 'lpn_id', allowBlank: true }),
      ref('sku', 'SKU', 'skus', { valueKey: 'sku_id', labelKey: 'sku_code', allowBlank: true }),
      f('qty', 'Quantity', { type: 'number', required: true, defaultValue: 1 }),
      f('status', 'Status', { type: 'select', options: [
        choice('PENDING'), choice('IN_TRANSIT'), choice('COMPLETED'), choice('CANCELLED'),
      ], defaultValue: 'PENDING' }),
      f('expected_at', 'Expected At', { type: 'datetime-local', allowBlank: true }),
      f('completed_at', 'Completed At', { type: 'datetime-local', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Move', key: 'code', isCode: true },
      { label: 'Source', key: 'source_site_code' },
      { label: 'Destination', key: 'destination_site_code' },
      { label: 'SKU', key: 'sku_code' },
      { label: 'Qty', key: 'qty' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── Inventory control ─────────────────────────────────────────────────── */
  'cycle-counts': {
    label: 'Cycle counts', group: 'inventory',
    endpoint: '/counting/cycle-counts/', idField: 'count_id',
    subtitle: 'Scheduled physical counts. Closing one freezes its lines.',
    fields: [
      f('code', 'Count Code', { required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('count_type', 'Count Type', { type: 'select', options: [
        choice('FULL'), choice('ZONE'), choice('BIN'), choice('SKU'), choice('SPOT'),
      ], defaultValue: 'SPOT' }),
      f('status', 'Status', { type: 'select', options: [
        choice('DRAFT'), choice('SCHEDULED'), choice('IN_PROGRESS'),
        choice('REVIEW'), choice('CLOSED'), choice('CANCELLED'),
      ], defaultValue: 'DRAFT' }),
      f('scheduled_for', 'Scheduled For', { type: 'date', allowBlank: true }),
      ref('assigned_to', 'Assigned To', 'users', { valueKey: 'user_id', labelKey: 'email', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Count', key: 'code', isCode: true },
      { label: 'Facility', key: 'site_code' },
      { label: 'Type', key: 'count_type', badge: true },
      { label: 'Scheduled', key: 'scheduled_for' },
      { label: 'Lines', key: 'line_count' },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  'cycle-count-lines': {
    label: 'Count lines', group: 'inventory',
    endpoint: '/counting/cycle-count-lines/', idField: 'line_id',
    subtitle: 'System vs counted quantity. The variance and status are computed by the server.',
    fields: [
      ref('count', 'Cycle Count', 'cycleCounts', { valueKey: 'count_id', labelKey: 'code', required: true }),
      ref('location', 'Bin', 'locations', { valueKey: 'location_id', labelKey: 'barcode', allowBlank: true }),
      ref('sku', 'SKU', 'skus', { valueKey: 'sku_id', labelKey: 'sku_code', required: true }),
      ref('lpn', 'LPN', 'lpns', { valueKey: 'lpn_id', labelKey: 'lpn_id', allowBlank: true }),
      f('system_qty', 'System Qty', { type: 'number', defaultValue: 0 }),
      f('counted_qty', 'Counted Qty', { type: 'number', allowBlank: true }),
      f('status', 'Status', { type: 'select', options: [
        choice('PENDING'), choice('COUNTED'), choice('VARIANCE'),
        choice('RECOUNT'), choice('APPROVED'),
      ], defaultValue: 'PENDING' }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Count', key: 'count_code', isCode: true },
      { label: 'Bin', key: 'location_barcode' },
      { label: 'SKU', key: 'sku_code' },
      { label: 'System', key: 'system_qty' },
      { label: 'Counted', key: 'counted_qty', render: (row) => (row.counted_qty == null ? '—' : row.counted_qty) },
      { label: 'Variance', key: 'variance', render: (row) => (
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: row.variance ? '#c2410c' : 'var(--text-muted)',
        }}>
          {row.variance > 0 ? `+${row.variance}` : row.variance}
        </span>
      ) },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  /* ── People & work ─────────────────────────────────────────────────────── */
  users: {
    label: 'Users & roles', group: 'people',
    endpoint: '/iam/users/', idField: 'user_id',
    subtitle: 'Staff accounts. Creating one can also assign it to a facility.',
    fields: [
      f('email', 'Email', { type: 'email', required: true }),
      f('full_name', 'Full Name'),
      f('phone', 'Phone'),
      f('role', 'Role', { type: 'select', required: true, options: [
        choice('SUPER_ADMIN'), choice('OPS_MANAGER'), choice('WAREHOUSE_STAFF'),
        choice('RIDER'), choice('CUSTOMER'), choice('SENDER'),
      ], defaultValue: 'WAREHOUSE_STAFF' }),
      f('status', 'Status', { type: 'select', options: [
        choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED'), choice('PENDING'),
      ], defaultValue: 'ACTIVE' }),
      f('password', 'Password', { type: 'password', required: true, createOnly: true }),
      ref('site_id', 'Assign to Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true, createOnly: true }),
      f('role_at_site', 'Role at Facility', { createOnly: true }),
    ],
    columns: [
      { label: 'Email', key: 'email', isCode: true },
      { label: 'Name', key: 'full_name', render: (row) => <strong>{row.full_name || '—'}</strong> },
      { label: 'Phone', key: 'phone' },
      { label: 'Role', key: 'role', badge: true },
      { label: 'Status', key: 'status', badge: true },
      { label: 'Last Login', key: 'last_login_at', render: (row) => fmtDate(row.last_login_at) },
    ],
  },

  'picker-zones': {
    label: 'Picker–zone mapping', group: 'people',
    endpoint: '/workforce/picker-zones/', idField: 'mapping_id',
    subtitle: 'Which zone each picker works, in priority order.',
    fields: [
      ref('user', 'Picker', 'users', { valueKey: 'user_id', labelKey: 'email', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('zone', 'Zone', 'zones', { valueKey: 'zone_id', labelKey: 'code', required: true }),
      f('priority', 'Priority', { type: 'number', defaultValue: 1 }),
      f('is_active', 'Active', { type: 'boolean', defaultValue: true }),
    ],
    columns: [
      { label: 'Picker', key: 'user_email' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Zone', key: 'zone_code', isCode: true },
      { label: 'Priority', key: 'priority' },
      { label: 'Active', key: 'is_active', render: (row) => (row.is_active ? 'YES' : 'NO') },
    ],
  },

  'work-assignments': {
    label: 'Work assignments', group: 'people',
    endpoint: '/workforce/work-assignments/', idField: 'assignment_id',
    subtitle: 'The assignment record every task previously lacked.',
    fields: [
      ref('user', 'Operator', 'users', { valueKey: 'user_id', labelKey: 'email', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('task_type', 'Task Type', { type: 'select', options: [
        choice('PICK'), choice('PACK'), choice('PUTAWAY'), choice('GRN'),
        choice('SORT'), choice('CYCLE_COUNT'), choice('DISPATCH'),
        choice('CHECKIN'), choice('OTHER'),
      ], defaultValue: 'OTHER' }),
      f('ref_type', 'Reference Type'),
      f('ref_id', 'Reference ID'),
      f('status', 'Status', { type: 'select', options: [
        choice('ASSIGNED'), choice('ACCEPTED'), choice('IN_PROGRESS'),
        choice('COMPLETED'), choice('CANCELLED'),
      ], defaultValue: 'ASSIGNED' }),
      f('priority', 'Priority', { type: 'number', defaultValue: 5 }),
      f('accepted_at', 'Accepted At', { type: 'datetime-local', allowBlank: true }),
      f('started_at', 'Started At', { type: 'datetime-local', allowBlank: true }),
      f('completed_at', 'Completed At', { type: 'datetime-local', allowBlank: true }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Operator', key: 'user_email' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Task', key: 'task_type', badge: true },
      { label: 'Reference', key: 'ref_id', render: (row) => row.ref_id || '—' },
      { label: 'Assigned', key: 'assigned_at', render: (row) => fmtDate(row.assigned_at) },
      { label: 'Status', key: 'status', badge: true },
    ],
  },

  'time-logs': {
    label: 'Time logs', group: 'people',
    endpoint: '/workforce/time-logs/', idField: 'log_id',
    subtitle: 'Measured work intervals. Minutes are computed from the interval.',
    fields: [
      ref('user', 'Operator', 'users', { valueKey: 'user_id', labelKey: 'email', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      ref('assignment', 'Assignment', 'workAssignments', {
        valueKey: 'assignment_id', allowBlank: true,
        labelFn: (option) => `${option.task_type || 'TASK'} ${option.ref_id || option.assignment_id}`,
      }),
      f('activity', 'Activity', { type: 'select', options: [
        choice('PICK'), choice('PACK'), choice('PUTAWAY'), choice('GRN'),
        choice('SORT'), choice('CYCLE_COUNT'), choice('DISPATCH'),
        choice('IDLE'), choice('BREAK'), choice('MEETING'), choice('OTHER'),
      ], defaultValue: 'OTHER' }),
      f('started_at', 'Started At', { type: 'datetime-local', required: true }),
      f('ended_at', 'Ended At', { type: 'datetime-local', allowBlank: true }),
      f('minutes', 'Minutes', { type: 'number', defaultValue: 0 }),
      f('source', 'Source', { type: 'select', options: [choice('AUTO'), choice('MANUAL')], defaultValue: 'MANUAL' }),
      f('notes', 'Notes', { type: 'textarea' }),
    ],
    columns: [
      { label: 'Operator', key: 'user_email' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Activity', key: 'activity', badge: true },
      { label: 'Started', key: 'started_at', render: (row) => fmtDate(row.started_at) },
      { label: 'Minutes', key: 'minutes' },
      { label: 'Source', key: 'source' },
    ],
  },

  'activity-events': {
    label: 'Activity events', group: 'people',
    endpoint: '/workforce/activity-events/', idField: 'event_id',
    subtitle: 'Append-only activity stream. Events are never edited or deleted.',
    fields: [
      ref('user', 'Operator', 'users', { valueKey: 'user_id', labelKey: 'email', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      f('event_type', 'Event Type', { type: 'select', required: true, options: [
        choice('LOGIN'), choice('LOGOUT'), choice('SCAN'), choice('PICK'), choice('PACK'),
        choice('PUTAWAY'), choice('SHORT_PICK'), choice('CYCLE_COUNT'),
        choice('DISPATCH'), choice('IDLE'), choice('BREAK'), choice('ERROR'),
      ], defaultValue: 'SCAN' }),
      f('ref_type', 'Reference Type'),
      f('ref_id', 'Reference ID'),
    ],
    appendOnly: true,
    columns: [
      { label: 'Occurred', key: 'occurred_at', render: (row) => fmtDate(row.occurred_at) },
      { label: 'Operator', key: 'user_email' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Event', key: 'event_type', badge: true },
      { label: 'Reference', key: 'ref_id' },
    ],
  },

  productivity: {
    label: 'Productivity', group: 'people',
    endpoint: '/workforce/productivity/', idField: 'rollup_id',
    subtitle: 'Daily totals. This table replaces the fabricated Man Power numbers.',
    fields: [
      ref('user', 'Operator', 'users', { valueKey: 'user_id', labelKey: 'email', required: true }),
      ref('site', 'Facility', 'sites', { valueKey: 'site_id', labelKey: 'code', required: true }),
      f('work_date', 'Work Date', { type: 'date', required: true }),
      f('tasks_completed', 'Tasks Completed', { type: 'number', defaultValue: 0 }),
      f('units_processed', 'Units Processed', { type: 'number', defaultValue: 0 }),
      f('minutes_worked', 'Minutes Worked', { type: 'number', defaultValue: 0 }),
      f('idle_minutes', 'Idle Minutes', { type: 'number', defaultValue: 0 }),
      f('units_per_hour', 'Units / Hour', { type: 'number', step: '0.01', allowBlank: true }),
      f('source', 'Source', { type: 'select', options: [choice('ROLLUP'), choice('MANUAL')], defaultValue: 'MANUAL' }),
    ],
    columns: [
      { label: 'Operator', key: 'user_email' },
      { label: 'Facility', key: 'site_code' },
      { label: 'Date', key: 'work_date' },
      { label: 'Tasks', key: 'tasks_completed' },
      { label: 'Units', key: 'units_processed' },
      { label: 'Minutes', key: 'minutes_worked' },
      { label: 'Units / Hour', key: 'units_per_hour', render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{row.units_per_hour}</span>
      ) },
    ],
  },
};

const RESOURCE_ALIASES = Object.entries(RESOURCES).reduce((acc, [key, cfg]) => {
  (cfg.aliases || []).forEach((alias) => { acc[alias] = key; });
  return acc;
}, {});

const resolveKey = (key) => (RESOURCES[key] ? key : RESOURCE_ALIASES[key] || 'organizations');

const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const pad = (n) => String(n).padStart(2, '0');

const toDateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toDateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function buildInitialForm(fields, record) {
  return fields.reduce((acc, field) => {
    if (record) {
      const raw = record[field.name];
      if (field.type === 'datetime-local') acc[field.name] = toDateTimeInput(raw);
      else if (field.type === 'date') acc[field.name] = toDateInput(raw);
      else if (field.type === 'boolean') acc[field.name] = Boolean(raw);
      else if (field.type === 'password') acc[field.name] = '';
      else acc[field.name] = raw ?? '';
    } else if (field.defaultValue !== undefined) {
      acc[field.name] = field.defaultValue;
    } else if (field.type === 'boolean') {
      acc[field.name] = false;
    } else {
      acc[field.name] = '';
    }
    return acc;
  }, {});
}

function buildPayload(fields, form, editing) {
  const payload = {};
  fields.forEach((field) => {
    if (field.createOnly && editing) return;
    const value = form[field.name];

    if (field.type === 'boolean') { payload[field.name] = Boolean(value); return; }
    if (field.type === 'number') {
      if (value === '' || value === null || value === undefined) {
        payload[field.name] = field.allowBlank ? null : 0;
      } else {
        payload[field.name] = Number(value);
      }
      return;
    }
    if (field.type === 'reference' || field.allowBlank) {
      payload[field.name] = value === '' || value === null || value === undefined ? null : value;
      return;
    }
    if (field.type === 'datetime-local') {
      payload[field.name] = value ? new Date(value).toISOString() : null;
      return;
    }
    if (field.type === 'date') {
      payload[field.name] = value || null;
      return;
    }
    payload[field.name] = value;
  });
  return payload;
}

function formatApiError(error) {
  const body = error?.body;
  if (body && typeof body === 'object') {
    const parts = Object.entries(body).map(([key, value]) => (
      `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`
    ));
    if (parts.length) return parts.join(' · ');
  }
  return error?.message || 'The record could not be saved.';
}

export default function MasterDataView({ initialTab = 'organizations' }) {
  const startKey = resolveKey(initialTab);
  const [tab, setTab] = useState(startKey);
  const [group, setGroup] = useState(RESOURCES[startKey].group);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [references, setReferences] = useState({});
  const [refLoading, setRefLoading] = useState(false);
  const [modalMode, setModalMode] = useState(null);
  const [editing, setEditing] = useState(null);
  const [barcodeSku, setBarcodeSku] = useState(null);
  const [binLabel, setBinLabel] = useState(null);
  const [binContents, setBinContents] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const config = RESOURCES[tab];

  /* Bin label window: printable QR + live contents, opened from the bins table. */
  useEffect(() => {
    const handler = (event) => {
      setBinLabel(event.detail || null);
      setBinContents(null);
    };
    window.addEventListener('zippzo:print-bin', handler);
    return () => window.removeEventListener('zippzo:print-bin', handler);
  }, []);

  useEffect(() => {
    if (!binLabel) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetchApi(`/inventory/positions?location_id=${encodeURIComponent(binLabel.location_id)}&container=BIN`);
        if (alive) setBinContents(Array.isArray(res) ? res : res?.results || []);
      } catch {
        if (alive) setBinContents([]);
      }
    })();
    return () => { alive = false; };
  }, [binLabel]);

  /* Keep the active tab in sync when the sidebar opens another registry item. */
  useEffect(() => {
    const key = resolveKey(initialTab);
    setTab(key);
    setGroup(RESOURCES[key].group);
  }, [initialTab]);

  const loadData = async (key = tab) => {
    const cfg = RESOURCES[key];
    if (!cfg) return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await apiClient.get(`${cfg.endpoint}?page_size=500`);
      const rows = Array.isArray(response)
        ? response
        : (response?.results || []);
      setData(rows);
    } catch (error) {
      setData([]);
      setLoadError(formatApiError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(tab); }, [tab]);

  const loadReferences = async (fields) => {
    const needed = [...new Set(fields
      .filter((field) => field.type === 'reference' && field.ref)
      .map((field) => field.ref))];
    const missing = needed.filter((key) => !references[key]);
    if (!missing.length) return;
    setRefLoading(true);
    const results = await Promise.all(missing.map(async (key) => {
      const endpoint = REFERENCE_ENDPOINTS[key];
      if (!endpoint) return [key, []];
      try {
        const response = await apiClient.get(`${endpoint}?page_size=500`);
        const rows = Array.isArray(response) ? response : (response?.results || []);
        return [key, rows];
      } catch {
        return [key, []];
      }
    }));
    setReferences((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    setRefLoading(false);
  };

  const openCreate = () => {
    setFormError('');
    setEditing(null);
    setForm(buildInitialForm(config.fields));
    setModalMode('create');
    loadReferences(config.fields);
  };

  const openEdit = (record) => {
    if (config.appendOnly) return;
    setFormError('');
    setEditing(record);
    setForm(buildInitialForm(config.fields, record));
    setModalMode('edit');
    loadReferences(config.fields);
  };

  const closeModal = () => {
    if (saving) return;
    setModalMode(null);
    setEditing(null);
    setForm({});
    setFormError('');
  };

  const updateField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = buildPayload(config.fields, form, modalMode === 'edit');
      if (modalMode === 'edit' && editing) {
        await apiClient.patch(`${config.endpoint}${editing[config.idField]}/`, payload);
      } else {
        await apiClient.post(config.endpoint, payload);
      }
      closeModal();
      await loadData(tab);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!window.confirm(`Delete this ${config.label.toLowerCase()} record? This cannot be undone.`)) return;
    setSaving(true);
    setFormError('');
    try {
      await apiClient.delete(`${config.endpoint}${editing[config.idField]}/`);
      closeModal();
      await loadData(tab);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  const openGroup = (groupId) => {
    setGroup(groupId);
    const first = Object.entries(RESOURCES)
      .find(([, cfg]) => cfg.group === groupId);
    if (first && RESOURCES[first[0]].group !== config.group) {
      setTab(first[0]);
    }
  };

  const columns = useMemo(() => {
    if (config.appendOnly) return config.columns;
    return [
      ...config.columns,
      {
        label: '',
        key: '__actions',
        render: (row) => (
          <button
            type="button"
            className="btn-ui neutral"
            onClick={(event) => { event.stopPropagation(); openEdit(row); }}
            title="Edit this record"
            data-testid={`md-edit-${row[config.idField]}`}
          >
            <Pencil size={12} /> Edit
          </button>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const groupResources = Object.entries(RESOURCES)
    .filter(([, cfg]) => cfg.group === group);

  return (
    <div data-testid="master-data-root">
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>{config.label.toUpperCase()}</span>
            <span className="screen-count-tag">{data.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {config.subtitle}
          </div>
        </div>
        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => loadData(tab)} disabled={loading} data-testid="md-refresh">
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          <button className="btn-ui primary" onClick={openCreate} data-testid="md-add">
            <Plus size={13} />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Domain rail */}
      <div className="subtabs-rail">
        <div className="subtabs-list">
          {GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`subtab-btn ${group === item.id ? 'active' : ''}`}
              onClick={() => openGroup(item.id)}
              data-testid={`md-group-${item.id}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entity rail for the active domain */}
      <div className="subtabs-rail" style={{ marginTop: -1 }}>
        <div className="subtabs-list">
          {groupResources.map(([key, cfg]) => (
            <button
              key={key}
              type="button"
              className={`subtab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
              data-testid={`md-tab-${key}`}
            >
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="scan-feedback scan-feedback--error" style={{ marginBottom: 10 }} data-testid="md-error">
          <AlertTriangle size={14} />
          <span>{loadError}</span>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        idField={config.idField}
        onRowClick={config.appendOnly ? undefined : openEdit}
        searchPlaceholder={`Filter ${config.label.toLowerCase()}…`}
        data-testid={`md-table-${tab}`}
      />

      {modalMode && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 820 }}>
            <div className="modal-header">
              <div className="modal-title">
                {modalMode === 'edit' ? `Edit ${config.label}` : `Add ${config.label}`}
              </div>
              <button type="button" className="btn-ui neutral" onClick={closeModal} disabled={saving}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={submit} data-testid="md-form">
              <div className="modal-body">
                {formError && <div className="form-error-banner" data-testid="md-form-error">{formError}</div>}
                {refLoading && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Loading reference data…
                  </div>
                )}
                <div className="crud-form-grid">
                  {config.fields.map((field) => {
                    const isWide = field.type === 'textarea';
                    const choices = field.options || [];
                    const options = references[field.ref] || [];
                    return (
                      <div key={field.name} className={isWide ? 'crud-form-field wide' : 'crud-form-field'}>
                        <label htmlFor={`md-field-${field.name}`}>
                          {field.label}{field.required ? ' *' : ''}
                        </label>
                        {field.type === 'select' ? (
                          <select
                            id={`md-field-${field.name}`}
                            value={form[field.name] ?? ''}
                            onChange={(event) => updateField(field.name, event.target.value)}
                            required={field.required}
                          >
                            {!field.required && <option value="">None</option>}
                            {choices.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : field.type === 'reference' ? (
                          <select
                            id={`md-field-${field.name}`}
                            value={form[field.name] ?? ''}
                            onChange={(event) => updateField(field.name, event.target.value)}
                            required={field.required}
                          >
                            <option value="">None</option>
                            {options.map((option) => {
                              const value = option[field.valueKey || 'code'];
                              const label = field.labelFn
                                ? field.labelFn(option)
                                : `${option[field.labelKey || 'code'] || value}`
                                  + (option.name && option.name !== option[field.labelKey] ? ` — ${option.name}` : '');
                              return <option key={value} value={value}>{label}</option>;
                            })}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            id={`md-field-${field.name}`}
                            value={form[field.name] ?? ''}
                            onChange={(event) => updateField(field.name, event.target.value)}
                            required={field.required}
                            rows={3}
                          />
                        ) : field.type === 'boolean' ? (
                          <label className="crud-checkbox">
                            <input
                              type="checkbox"
                              checked={form[field.name] === true}
                              onChange={(event) => updateField(field.name, event.target.checked)}
                            />
                            <span>{Boolean(form[field.name]) ? 'Enabled' : 'Disabled'}</span>
                          </label>
                        ) : (
                          <input
                            id={`md-field-${field.name}`}
                            type={field.type}
                            step={field.step}
                            value={form[field.name] ?? ''}
                            onChange={(event) => updateField(field.name, event.target.value)}
                            required={field.required}
                            autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-footer">
                {modalMode === 'edit' && (
                  <button type="button" className="btn-ui danger" onClick={remove} disabled={saving} data-testid="md-delete">
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                )}
                <button type="button" className="btn-ui neutral" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary" disabled={saving} data-testid="md-save">
                  {modalMode === 'edit' ? <Save size={13} /> : <Plus size={13} />}
                  <span>{saving ? 'Saving…' : modalMode === 'edit' ? 'Save changes' : 'Create record'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {!config.appendOnly && data.length === 0 && !loading && !loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
          <Database size={14} /> No {config.label.toLowerCase()} yet — use Add to create the first record.
        </div>
      )}

      {/* Bin label window — printable QR with complete bin details and live stock */}
      {binLabel && (
        <div className="modal-backdrop" onClick={() => setBinLabel(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-title">
                <Barcode size={16} /> Bin Label · {binLabel.barcode}
              </div>
              <button type="button" className="btn-ui neutral" onClick={() => setBinLabel(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <div id="bin-print-area" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, background: '#fff', padding: 18, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.5, color: '#0f172a' }}>ZIPPZO · BIN</div>
                <QRCodeSVG value={binLabel.barcode} size={150} />
                <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20, color: '#0f172a' }}>{binLabel.barcode}</div>
                <table style={{ fontSize: 11, fontFamily: 'monospace', color: '#0f172a', borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Location ID</td><td>{binLabel.location_id}</td></tr>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Type</td><td>{binLabel.location_type}</td></tr>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Container</td><td>{binLabel.container}</td></tr>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Aisle · Rack · Level</td><td>{binLabel.aisle || '—'} · {binLabel.rack || '—'} · {binLabel.level || '—'} · {binLabel.position || '—'}</td></tr>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Capacity</td><td>{binLabel.capacity_qty ?? 'Unlimited'}</td></tr>
                    <tr><td style={{ color: '#64748b', padding: '2px 8px 2px 0' }}>Sellable</td><td>{binLabel.is_sellable_bin ? 'YES' : 'NO'}</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 0.6 }}>PRODUCTS IN THIS BIN</div>
                {binContents === null ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 10 }}>Loading stock…</div>
                ) : binContents.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 10 }}>Bin empty — nothing stored here yet.</div>
                ) : (
                  <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {binContents.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{item.sku_name || item.sku_code}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{item.sku_code}{item.batch_number ? ` · batch ${item.batch_number}` : ''}{item.expiry_date ? ` · exp ${item.expiry_date}` : ''}</div>
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          <div style={{ fontWeight: 800, fontSize: 15 }}>{item.qty}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>units</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="btn-ui primary" onClick={() => window.print()}><Printer size={13} /> Print label</button>
            </div>
          </div>
        </div>
      )}
      {/* The console-wide print rule hides everything except .bundle-label-print-area.
          This bin label has its own target, so restore it here as well. */}
      <style>{`@media print {
        #bin-print-area, #bin-print-area * { visibility: visible !important; }
        #bin-print-area {
          position: fixed !important;
          inset: 0 auto auto 0 !important;
          width: 100% !important;
          padding: 0 !important;
          background: #fff !important;
        }
        #bin-print-area svg { width: 42mm !important; height: 42mm !important; }
        @page { size: 100mm 150mm; margin: 8mm; }
      }`}</style>
    </div>
  );
}
