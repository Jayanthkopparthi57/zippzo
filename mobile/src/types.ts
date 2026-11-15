export type SiteType = 'MH' | 'DS' | 'SS' | 'XDOCK';

export interface Facility {
  site_id: string;
  code: string;
  name: string;
  site_type: SiteType;
  address?: string;
  status: string;
}

export interface User {
  user_id: string;
  email: string;
  phone?: string;
  full_name: string;
  role: string;
  status: string;
}

export interface AuthResponse {
  status: string;
  token: string;
  refresh_token: string;
  user: User;
  facility: Facility | null;
  target_app: string;
  allowed_apps: string[];
  surface: string;
  department?: string;
  role_at_site?: string | null;
  capabilities: {
    can_execute_physical: boolean;
    can_pick?: boolean;
    can_receive?: boolean;
    can_putaway?: boolean;
    can_count?: boolean;
    can_deliver?: boolean;
    department?: string;
    workspace?: string;
  };
  tasks?: Task[];
  challenge_id?: string;
  challenge_token?: string;
  facilities?: Facility[];
  dev_otp?: string;
  otp_required?: boolean;
  facility_required?: boolean;
}

export type TaskKind =
  | 'PUTAWAY'
  | 'PICK'
  | 'PACK'
  | 'RECEIVE'
  | 'QC'
  | 'INBOUND'
  | 'TRANSFER'
  | 'REPLENISH'
  | string;

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  subtitle: string;
  status: string;
  site: string;
  qty: number;
  remaining_qty: number;
  created_at: string;
  endpoint: string;
  lpn?: string | null;
  staging_bin?: string | null;
  assigned_to?: string | null;
}

export interface Sku {
  sku_id: string;
  sku_code: string;
  name: string;
  ean?: string | null;
  category?: string | number | null;
  category_name?: string | null;
  storage_zone?: string;
  brand?: string;
  status?: string;
}

export interface LocationBin {
  location_id: string;
  barcode: string;
  label?: string;
  site?: string;
  site_id?: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  level?: string;
  position?: string;
  capacity_qty?: number | null;
  occupied_qty?: number;
  free_qty?: number | null;
  product_count?: number;
  contents?: Array<{
    sku_code: string;
    sku_name: string;
    lot?: string;
    batch_number?: string;
    qty: number;
  }>;
  is_sellable_bin?: boolean;
}

export interface Asn {
  asn_id: string;
  asn_no: string;
  type: string;
  dest_site?: string;
  dest_site_code?: string;
  status: string;
  po_ref?: string;
  package_type?: string;
  total_qty?: number;
  total_skus?: number;
  lines?: any[];
  created_at?: string;
}

export interface Grn {
  grn_id: string;
  grn_no: string;
  asn?: string;
  asn_no?: string;
  dest_site_code?: string;
  status: string;
  mode?: string;
  batch_code?: string;
  has_discrepancy?: boolean;
  created_at?: string;
}

export interface GrnLine {
  line_id: string;
  grn: string;
  grn_no?: string;
  sku: string;
  sku_code?: string;
  sku_name?: string;
  ordered_qty: number;
  received_qty: number;
  accepted_qty: number;
  damaged_qty: number;
  expired_qty: number;
  excess_qty: number;
  expiry_date?: string | null;
  lot?: string | null;
}

export interface QcInspection {
  qc_id: string;
  grn_line: string;
  grn_no?: string;
  asn_no?: string;
  sku_code?: string;
  sku_name?: string;
  sample_size: number;
  pass_count: number;
  fail_count: number;
  status: string;
  remarks?: string;
  tested_at?: string | null;
}

export interface PutawayTaskDetail {
  task_id: string;
  grn_line?: string;
  grn_no?: string;
  asn_no?: string;
  sku: string;
  sku_code: string;
  sku_name: string;
  lot_number?: string;
  qty: number;
  placed_qty: number;
  remaining_qty: number;
  suggested_bin?: string | null;
  confirmed_bin?: string | null;
  to_bin_code?: string;
  status: string;
  site_code?: string;
  assigned_to?: string | null;
  created_at?: string;
  category_name?: string | null;
  storage_zone?: string | null;
}

export interface StockBalance {
  site?: string;
  site_id?: string;
  container?: string;
  container_ref?: string;
  sku?: string;
  sku_code?: string;
  sku_name?: string;
  lot?: string;
  lot_number?: string;
  batch_number?: string;
  qty: number;
  sellable?: boolean;
  expiry_date?: string | null;
}

export interface LocationRow {
  location_id: string;
  barcode: string;
  site?: string;
  site_code?: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  level?: string;
  position?: string;
  capacity_qty?: number | null;
  is_active?: boolean;
}

export interface PickTaskRow {
  id?: string;
  picklist_id?: string;
  order_no?: string;
  order?: string;
  order_id?: string;
  sku?: string;
  sku_code?: string;
  sku_name?: string;
  bin?: string;
  qty: number;
  picked_qty: number;
  remaining_qty?: number;
  status: string;
  created_at?: string;
  assigned_to?: string | null;
}

export interface PackTaskRow {
  id?: string;
  packlist_id?: string;
  order_no?: string;
  order?: string;
  order_id?: string;
  sku?: string;
  sku_code?: string;
  sku_name?: string;
  qty: number;
  packed_qty: number;
  remaining_qty?: number;
  lpn?: string | null;
  staging_bin?: string | null;
  status: string;
  created_at?: string;
  assigned_to?: string | null;
}

export interface TransferOrderRow {
  transfer_id: string;
  source_site?: string;
  dest_site?: string;
  source_site_code?: string;
  dest_site_code?: string;
  status: string;
  total_qty?: number;
  created_at?: string;
}

export interface Paged<T> {
  count: number;
  results: T[];
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
}
