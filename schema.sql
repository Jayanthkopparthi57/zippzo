-- ============================================================================
-- Zippzo Quick-Commerce Platform — Database Schema (PostgreSQL 16)
-- Generated from design.md and db_design.md v3.7
-- ============================================================================
-- Migration 0001: Enums and Extensions
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Container taxonomy
CREATE TYPE container_type AS ENUM (
    'QC_PASSED_STAGING','RECEIVED_STAGING','RESERVE','PICK_FACE','SHELF',
    'PICKER_TOTE','SEALED_BAG','RIDER_BIN','RETURN_STAGING','DAMAGE',
    'EXPIRY','HOLD_AUDIT','RTV_STAGING','RTS_STAGING',
    'RIDER_CUSTODY','IN_TRANSIT','REVERSE_TRANSIT',
    'CASH_VAULT','FLOAT',
    'CONSUMED','EXTERNAL'
);

-- Movement types
CREATE TYPE movement_type AS ENUM (
    'GRN_ACCEPT','PUTAWAY','PICK','PACK','STAGE','HANDOVER','DELIVER',
    'RETURN_PICKUP','RETURN_RECEIVE','QC_RESTOCK','QC_DAMAGE','QC_EXPIRY',
    'QC_RTV','QC_RTS','WRITE_OFF','RTV_DISPATCH','RTS_DISPATCH',
    'BIN_TRANSFER','PICKFACE_REPLENISH','COUNT_ADJUST','EXPIRY_SWEEP',
    'MH_GATEOUT','DS_RECEIPT',
    'INTERRUPT_RETURN','UNSEAL_RETURN',
    'HOLD_CREATE','HOLD_RELEASE',
    'REVERSE_GATEOUT','REVERSE_RECEIPT'
);

CREATE TYPE movement_ref_type AS ENUM (
    'INBOUND','PUTAWAY_TASK','PICK_TASK','PACK_TASK','ORDER','RETURN_ORDER',
    'TRANSFER','TRIP','MANIFEST','COUNT_TASK','HOLD','MANUAL','RTV','RTS',
    'INTERRUPT','UNSEAL','REVERSE_TRIP','PO'
);

CREATE TYPE reservation_status AS ENUM ('HELD','PARTIAL','CONSUMED','RELEASED','EXPIRED');
CREATE TYPE cash_movement_type AS ENUM (
    'FLOAT_ISSUE','FLOAT_RETURN','COD_COLLECT','COD_UPI_SETTLE',
    'REMITTANCE_TO_VAULT','VAULT_TO_BANK','CUSTODY_ADJUSTMENT'
);
CREATE TYPE actor_type AS ENUM ('USER','SYSTEM','API','INTEGRATION');
CREATE TYPE owner_type AS ENUM ('ZIPZOO','SELLER');
CREATE TYPE custody_transition_type AS ENUM ('STANDARD','CUSTODY_ACCEPT_ANY_STATE','PENDING_CUSTODY_RESOLUTION','NET_ZERO_LATE_REPLAY');

-- Order status state machine
CREATE TYPE order_status AS ENUM (
    'PLACED','PAYMENT_PENDING','PAYMENT_FAILED','CONFIRMED',
    'PICKING','INTERRUPTED','PICKED','PARTIALLY_FULFILLED',
    'PACKED','PRICE_FINALIZED','STAGED','RIDER_ASSIGNED',
    'PICKED_UP','OUT_FOR_DELIVERY','ARRIVED','DELIVERED',
    'CANCELLED','CANCELLED_PENDING_RETURN','EXPIRED',
    'FAILED','CLOSED_RTO','REFUNDED'
);

CREATE TYPE refund_status AS ENUM ('REQUESTED','APPROVED','PARTIAL_APPROVED','DENIED','WAITING_QC','PROCESSED','SUCCESS','FAILED','UNKNOWN','MANUAL_OPS','CLOSED');
CREATE TYPE hold_status AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','ESCALATED');
CREATE TYPE lpn_type AS ENUM ('TOTE','CARTON','PALLET','BAG','RIDER_BIN','RETURN_TOTE');
CREATE TYPE lpn_status AS ENUM ('CREATED','IN_USE','EMPTY','PACKED','SEALED','STAGED','IN_TRANSIT','RECEIVED','CONSUMED','RETIRED');
CREATE TYPE delivery_task_status AS ENUM ('UNASSIGNED','OFFERED','ACCEPTED','AT_DS','PICKED_UP','EN_ROUTE','ARRIVED','POD_PENDING','DELIVERED','FAILED','RETURNED','WITHDRAWN','RECALLED','RECALLED_PENDING_RETURN');
CREATE TYPE pod_method AS ENUM ('OTP','UPI_QR','CASH','PHOTO','SIGNATURE','LEAVE_AT_DOOR','AGE_VERIFIED');
CREATE TYPE pod_state_outcome AS ENUM ('DELIVERED','CONFLICT','SUPPORT_REVIEW','UNKNOWN_STATE','PENDING_UPLOAD');
CREATE TYPE return_order_status AS ENUM ('RETURN_CREATED','APPROVED','PICKUP_SCHEDULED','PICKED_UP','RECEIVED_AT_DS','QC_IN_PROGRESS','REFUND_DECISION','REFUND_INITIATED','REFUNDED','RETURN_DENIED','CLOSED');
CREATE TYPE qc_disposition AS ENUM ('RESTOCKED','DAMAGED','EXPIRED','RTV','RTS','HELD');

-- Idempotency
CREATE TYPE idempotency_status AS ENUM ('PENDING','PUBLISHED','FAILED','DEAD');

COMMIT;

-- ============================================================================
-- Migration 0002: IAM
-- ============================================================================
BEGIN;

CREATE TABLE users (
    user_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type     text NOT NULL CHECK (user_type IN ('CUSTOMER','RIDER','STAFF','ADMIN','SUPPORT')),
    phone         varchar(15) UNIQUE,
    email         varchar(120) UNIQUE,
    password_hash varchar(255),
    employee_id   text,
    status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX ix_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX ix_users_email ON users (email) WHERE email IS NOT NULL;

CREATE TABLE sessions (
    session_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users,
    refresh_hash  varchar(255) NOT NULL,
    device_id     text,
    ip            inet,
    user_agent    text,
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE scan_devices (
    device_id       text PRIMARY KEY,
    device_type     text NOT NULL CHECK (device_type IN ('HANDHELD','TABLET','FIXED','PHONE')),
    model           text,
    site_id         text NOT NULL,
    assigned_to     text,
    status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOST','RETIRED','BLOCKED')),
    last_seen_at    timestamptz,
    last_ip         inet,
    app_version     text,
    cert_thumbprint text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_scan_devices_site ON scan_devices (site_id) WHERE status = 'ACTIVE';

CREATE TABLE ds_qr_codes (
    qr_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     text NOT NULL,
    purpose     text NOT NULL CHECK (purpose IN ('RIDER_SHIFT_IN','RIDER_SHIFT_OUT','STAFF_SHIFT_IN','RIDER_STANDBY')),
    token       varchar(64) UNIQUE NOT NULL,
    valid_from  timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz NOT NULL,
    is_active   boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_ds_qr_site_active ON ds_qr_codes (site_id, purpose) WHERE is_active = true;

CREATE TABLE idempotency_keys (
    key           varchar(80) PRIMARY KEY,
    user_id       uuid,
    endpoint      varchar(120) NOT NULL,
    request_hash  varchar(64) NOT NULL,
    response_json jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);
CREATE INDEX ix_idem_expires ON idempotency_keys (expires_at);

COMMIT;

-- ============================================================================
-- Migration 0003: Network — Sites, Zones, Bins, Locations
-- ============================================================================
BEGIN;

CREATE TABLE sites (
    site_id       text PRIMARY KEY,
    site_type     text NOT NULL CHECK (site_type IN ('MH','DS','SS','XDOCK')),
    code          varchar(20) UNIQUE NOT NULL,
    name          varchar(80) NOT NULL,
    address       text,
    geo_lat       numeric(10,7),
    geo_lng       numeric(10,7),
    parent_site   text REFERENCES sites,
    operating_hours jsonb,
    is_accepting_orders boolean NOT NULL DEFAULT false,
    dh_precedence varchar(50) DEFAULT 'DEFAULT',
    ss_precedence varchar(50) DEFAULT 'SS_DEFAULT',
    status        text NOT NULL DEFAULT 'ONBOARDING' CHECK (status IN ('ONBOARDING','ACTIVE','SUSPENDED','RETIRED')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sites_type ON sites (site_type) WHERE status = 'ACTIVE';

CREATE TABLE city_delivery_config (
    city_id              text PRIMARY KEY,
    hard_cap_km          numeric(5,2) NOT NULL DEFAULT 5.0 CHECK (hard_cap_km BETWEEN 3.0 AND 10.0),
    active_bands         text[] NOT NULL DEFAULT ARRAY['Core','Standard','Extended'],
    extended_plus_enabled boolean NOT NULL DEFAULT false,
    extended_plus_span_km numeric(4,2) NOT NULL DEFAULT 2.5,
    extended_plus_max_stops smallint NOT NULL DEFAULT 3,
    extended_plus_solo_fee numeric(10,2) DEFAULT 40.00,
    ceiling_amount       numeric(10,2) NOT NULL DEFAULT 10000.00,
    batch_allowance      numeric(10,2) NOT NULL DEFAULT 2000.00,
    last_changed_by      text,
    last_changed_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ceiling_covers_caps CHECK (ceiling_amount >= 5000.00 + batch_allowance)
);

CREATE TABLE locations (
    location_id     text PRIMARY KEY,
    site_id         text NOT NULL REFERENCES sites,
    location_type   text NOT NULL CHECK (location_type IN ('BIN','ZONE','DOCK','STAGING')),
    zone_id         text REFERENCES locations,
    container       container_type NOT NULL DEFAULT 'PICK_FACE',
    aisle text, rack text, level text, position text,
    barcode         text UNIQUE NOT NULL,
    qr_payload      text,
    capacity_qty    integer,
    capacity_weight_g bigint,
    capacity_volume_ml bigint,
    is_sellable_bin boolean NOT NULL DEFAULT false,
    is_active       boolean NOT NULL DEFAULT true,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, barcode)
);
CREATE INDEX ix_locations_site ON locations (site_id) WHERE is_active = true;

CREATE TABLE employee_site_assignments (
    employee_id   text NOT NULL,
    site_id       text NOT NULL REFERENCES sites,
    mode          text NOT NULL CHECK (mode IN ('WAREHOUSE','DARKHOUSE')),
    role_at_site  varchar(30) NOT NULL,
    is_primary    boolean NOT NULL DEFAULT false,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, site_id, mode)
);

CREATE TABLE role_bindings (
    binding_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users,
    role_code   varchar(40) NOT NULL,
    scope_type  text NOT NULL CHECK (scope_type IN ('GLOBAL','SITE','ZONE','SELLER','SELF')),
    scope_ids   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    valid_from  timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    granted_by  uuid REFERENCES users,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_role_bindings_user ON role_bindings (user_id);

CREATE TABLE dock_doors (
    door_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     text NOT NULL REFERENCES sites,
    code        varchar(50),
    capability  varchar(10) CHECK (capability IN ('LOAD','UNLOAD','BOTH')) DEFAULT 'BOTH',
    status      varchar(20) DEFAULT 'OPEN',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dock_doors_site ON dock_doors (site_id);

CREATE TABLE vehicle_types (
    vt_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(50) UNIQUE NOT NULL,
    capacity_lpns   integer DEFAULT 0,
    temp_controlled boolean DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0004: Catalog — SKUs, Barcodes, Listings, Inventory Lots
-- ============================================================================
BEGIN;

CREATE TABLE sku_categories (
    category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(100) NOT NULL,
    parent      uuid REFERENCES sku_categories,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skus (
    sku_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_code        varchar(50) UNIQUE NOT NULL,
    name            varchar(200) NOT NULL,
    ean             varchar(50) UNIQUE,
    category_id     uuid REFERENCES sku_categories,
    sub_category    varchar(100),
    brand           varchar(60),
    pack_size       varchar(30),
    base_uom        varchar(10) DEFAULT 'EACH',
    storage_zone    varchar(10) DEFAULT 'DRY' CHECK (storage_zone IN ('DRY','COLD','FROZEN')),
    shelf_life_days integer,
    is_food         boolean DEFAULT false,
    is_hazardous    boolean DEFAULT false,
    is_catch_weight boolean DEFAULT false,
    is_serialized   boolean DEFAULT false,
    is_age_restricted boolean DEFAULT false,
    min_age_years   smallint,
    mrp             numeric(10,2),
    hsn_code        varchar(10),
    weight_g        integer,
    status          varchar(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SAMPLE_QC','APPROVED','ACTIVE','DELISTED','DISCONTINUED')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT is_age_restricted OR min_age_years IS NOT NULL)
);
CREATE INDEX ix_skus_code ON skus (sku_code);
CREATE INDEX ix_skus_category ON skus (category_id);

CREATE TABLE sku_barcodes (
    barcode    varchar(30) PRIMARY KEY,
    symbology  varchar(20) NOT NULL CHECK (symbology IN ('EAN','UPC','CODE128','GS1_128','INTERNAL','QR')),
    sku_id     uuid NOT NULL REFERENCES skus,
    pack_level varchar(10) NOT NULL CHECK (pack_level IN ('EACH','INNER','CASE','PALLET')),
    qty_in_base integer NOT NULL DEFAULT 1 CHECK (qty_in_base > 0),
    is_primary boolean NOT NULL DEFAULT false,
    is_active  boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_sku_barcodes_sku ON sku_barcodes (sku_id) WHERE is_active = true;

CREATE TABLE listings (
    listing_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id      uuid NOT NULL REFERENCES skus,
    site_id     text NOT NULL REFERENCES sites,
    price       numeric(10,2) NOT NULL,
    mrp         numeric(10,2) NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0,
    is_listed   boolean NOT NULL DEFAULT false,
    is_available boolean NOT NULL DEFAULT false,
    low_stock_threshold integer,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sku_id, site_id)
);
CREATE INDEX ix_listings_site_available ON listings (site_id) WHERE is_listed = true;

CREATE TABLE inventory_lots (
    lot_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_id          uuid NOT NULL REFERENCES skus,
    site_id         text NOT NULL REFERENCES sites,
    batch_number    varchar(30) NOT NULL,
    mfg_date        date,
    expiry_date     date,
    mrp             numeric(10,2),
    box_size        integer DEFAULT 1,
    inbound_type    varchar(10),
    inbound_ref     varchar(100),
    source_site_id  text REFERENCES sites,
    source_vendor_id uuid,
    bucket          varchar(15) DEFAULT 'Good',
    status          varchar(20) DEFAULT 'AVAILABLE',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_inventory_lots_sku_expiry ON inventory_lots (sku_id, expiry_date);
CREATE INDEX ix_inventory_lots_site ON inventory_lots (site_id);

COMMIT;

-- ============================================================================
-- Migration 0005: Vendors & Sellers
-- ============================================================================
BEGIN;

CREATE TABLE vendors (
    vendor_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(20) UNIQUE NOT NULL,
    name            varchar(120) NOT NULL,
    org_entity      varchar(80),
    gstin           varchar(15),
    pan             varchar(10),
    contact_name    varchar(80),
    contact_phone   varchar(15),
    email           varchar(120),
    address         text,
    over_delivery_pct numeric(5,2) DEFAULT 5.00,
    under_delivery_pct numeric(5,2) DEFAULT 5.00,
    status          varchar(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','BLACKLISTED')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendor_licenses (
    license_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id     uuid NOT NULL REFERENCES vendors,
    license_type  varchar(20) NOT NULL CHECK (license_type IN ('FSSAI','DRUG','GSTIN','MSME','OTHER')),
    license_number varchar(40) NOT NULL,
    issued_at     date,
    expires_at    date,
    verified_at   timestamptz,
    verified_by   uuid,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vendor_licenses_expiry ON vendor_licenses (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE sellers (
    seller_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(20) UNIQUE NOT NULL,
    legal_name      varchar(120) NOT NULL,
    brand_name      varchar(80),
    seller_type     varchar(20) CHECK (seller_type IN ('INDIVIDUAL','PROPRIETORSHIP','LLP','PVT_LTD')),
    gstin           varchar(15),
    pan             varchar(10),
    gst_registered  boolean DEFAULT true,
    fulfilment_mode varchar(20) DEFAULT 'CONSIGNMENT_MH' CHECK (fulfilment_mode IN ('CONSIGNMENT_MH','CONSIGNMENT_DS','OUTRIGHT')),
    status          varchar(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','KYC_PENDING','KYC_VERIFIED','CATALOG_REVIEW','PARTIALLY_APPROVED','ACTIVE','SUSPENDED','BLACKLISTED','OFFBOARDED')),
    commission_default_pct numeric(5,2),
    payment_terms   text,
    activated_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seller_category_approvals (
    approval_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id     uuid NOT NULL REFERENCES sellers,
    category_id   uuid NOT NULL REFERENCES sku_categories,
    status        varchar(20) NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED','EXPIRED')),
    commission_pct numeric(5,2),
    valid_from    timestamptz NOT NULL DEFAULT now(),
    valid_until   timestamptz,
    approved_by   uuid,
    approved_at   timestamptz,
    rejection_reason text,
    UNIQUE (seller_id, category_id)
);
CREATE INDEX ix_seller_cat_approved ON seller_category_approvals (seller_id, category_id) WHERE status = 'APPROVED';

COMMIT;

-- ============================================================================
-- Migration 0006: LPN Master
-- ============================================================================
BEGIN;

CREATE TABLE lpn_master (
    lpn_id          varchar(50) PRIMARY KEY,
    barcode         varchar(100) UNIQUE NOT NULL,
    lpn_type        lpn_type NOT NULL DEFAULT 'TOTE',
    current_site_id text REFERENCES sites,
    current_container container_type,
    current_ref_id  varchar(50),
    status          lpn_status NOT NULL DEFAULT 'CREATED',
    is_insulated    boolean DEFAULT false,
    temp_rating     varchar(20),
    capacity_weight_g bigint,
    capacity_volume_ml bigint,
    created_by      varchar(20),
    created_at      timestamptz NOT NULL DEFAULT now(),
    sealed_at       timestamptz,
    consumed_at     timestamptz
);
CREATE INDEX ix_lpn_site ON lpn_master (current_site_id, status) WHERE status NOT IN ('CONSUMED','RETIRED');

CREATE TABLE lpn_contents (
    lpn_id      varchar(50) NOT NULL REFERENCES lpn_master,
    sku_id      uuid NOT NULL REFERENCES skus,
    lot_id      uuid NOT NULL REFERENCES inventory_lots,
    qty         integer NOT NULL CHECK (qty > 0),
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lpn_id, sku_id, lot_id)
);

COMMIT;

-- ============================================================================
-- Migration 0007: Stock Movements & Hash Chain
-- ============================================================================
BEGIN;

CREATE TABLE stock_movements (
    entry_id            bigserial PRIMARY KEY,
    movement_ref        movement_ref_type NOT NULL,
    ref_id              varchar(50) NOT NULL,
    movement_type       movement_type NOT NULL,
    sku_id              uuid NOT NULL REFERENCES skus,
    lot_id              uuid NOT NULL REFERENCES inventory_lots,
    qty                 integer NOT NULL CHECK (qty > 0),
    site_id             text NOT NULL REFERENCES sites,
    from_container      container_type NOT NULL,
    from_ref_id         varchar(50),
    to_container        container_type NOT NULL,
    to_ref_id           varchar(50),
    owner_type          owner_type NOT NULL DEFAULT 'ZIPZOO',
    owner_id            varchar(50),
    actor_id            varchar(20),
    actor_type          actor_type NOT NULL DEFAULT 'SYSTEM',
    device_id           varchar(50),
    idempotency_key     varchar(80),
    sellable_delta      smallint NOT NULL DEFAULT 0 CHECK (sellable_delta IN (-1,0,1)),
    site_custody_delta  smallint NOT NULL DEFAULT 0 CHECK (site_custody_delta IN (-1,0,1)),
    created_at          timestamptz NOT NULL DEFAULT now(),
    site_seq            bigint NOT NULL DEFAULT 0,
    prev_hash           bytea,
    row_hash            bytea CHECK (length(row_hash) = 32)
);
CREATE UNIQUE INDEX ux_mvmt_idempotency ON stock_movements (movement_ref, ref_id, movement_type, site_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_mvmt_sku_lot ON stock_movements (sku_id, lot_id);
CREATE INDEX ix_mvmt_site_time ON stock_movements (site_id, created_at DESC);
CREATE INDEX ix_mvmt_ref ON stock_movements (movement_ref, ref_id);
CREATE INDEX ix_mvmt_to ON stock_movements (to_container, to_ref_id);

CREATE TABLE stock_movements_chain (
    site_id     text PRIMARY KEY REFERENCES sites,
    head_seq    bigint NOT NULL DEFAULT 0,
    head_hash   bytea CHECK (length(head_hash) = 32),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0007b: Stock Balances
-- ============================================================================
BEGIN;

CREATE TABLE stock_balances (
    site_id             text NOT NULL REFERENCES sites,
    container           container_type NOT NULL,
    container_ref       varchar(50) NOT NULL DEFAULT '',
    container_ref_type  varchar(20) NOT NULL DEFAULT 'NONE' CHECK (container_ref_type IN ('NONE','LOCATION','LPN','TRANSFER','RIDER','ORDER')),
    sku_id              uuid NOT NULL REFERENCES skus,
    lot_id              uuid NOT NULL REFERENCES inventory_lots,
    owner_type          owner_type NOT NULL,
    owner_id            varchar(50) NOT NULL DEFAULT '',
    qty                 integer NOT NULL CHECK (qty >= 0),
    sellable            boolean NOT NULL,
    counts_toward_site_custody boolean NOT NULL,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, container, container_ref, sku_id, lot_id, owner_type, owner_id)
);
CREATE INDEX ix_balance_atp ON stock_balances (site_id, sku_id, container) WHERE sellable = true AND qty > 0;

COMMIT;

-- ============================================================================
-- Migration 0008: Movement Preconditions
-- ============================================================================
BEGIN;

CREATE TABLE movement_preconditions (
    movement_type            movement_type NOT NULL,
    from_container           container_type NOT NULL,
    to_container             container_type NOT NULL,
    transition_type          custody_transition_type NOT NULL DEFAULT 'STANDARD',
    requires_source_qty      boolean NOT NULL DEFAULT true,
    requires_task_state      varchar(20),
    sellable_delta_allowed   smallint[] NOT NULL DEFAULT ARRAY[0],
    site_custody_delta_allowed smallint[] NOT NULL DEFAULT ARRAY[0],
    PRIMARY KEY (movement_type, from_container, to_container)
);

CREATE TABLE matrix_expected (
    id                  smallint NOT NULL,
    movement_type       movement_type NOT NULL,
    from_container      container_type NOT NULL,
    to_container        container_type NOT NULL,
    sellable_delta      smallint NOT NULL CHECK (sellable_delta IN (-1,0,1)),
    site_custody_delta  smallint NOT NULL CHECK (site_custody_delta IN (-1,0,1)),
    PRIMARY KEY (movement_type, from_container, to_container)
);

COMMIT;

-- ============================================================================
-- Migration 0009: Reservations
-- ============================================================================
BEGIN;

CREATE TABLE stock_reservations (
    reservation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL,
    order_line_id   uuid,
    qty_reserved    integer NOT NULL,
    qty_consumed    integer NOT NULL DEFAULT 0,
    qty_released    integer NOT NULL DEFAULT 0,
    status          reservation_status NOT NULL DEFAULT 'HELD',
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0010: Inbound — ASN, GRN, QC, Putaway
-- ============================================================================
BEGIN;

CREATE TABLE asns (
    asn_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asn_no          varchar(30) UNIQUE NOT NULL,
    type            varchar(20) NOT NULL CHECK (type IN ('VENDOR_PO','MH_TRANSFER','STORE_RETURN','RTV_IN')),
    source_vendor_id uuid REFERENCES vendors,
    source_site_id  text REFERENCES sites,
    dest_site_id    text NOT NULL REFERENCES sites,
    po_ref          varchar(40),
    door_id         text REFERENCES dock_doors,
    slot_start      timestamptz,
    slot_end        timestamptz,
    expected_vehicle varchar(15),
    total_lpns      integer DEFAULT 0,
    total_skus      integer DEFAULT 0,
    total_qty       integer DEFAULT 0,
    status          varchar(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','ARRIVED','GRN_IN_PROGRESS','CLOSED','CANCELLED')),
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asn_lines (
    line_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asn_id        uuid NOT NULL REFERENCES asns,
    line_no       smallint NOT NULL,
    sku_id        uuid NOT NULL REFERENCES skus,
    ean           varchar(30),
    ordered_qty   integer NOT NULL CHECK (ordered_qty > 0),
    expected_expiry date,
    line_status   varchar(10) DEFAULT 'OPEN' CHECK (line_status IN ('OPEN','PARTIAL','RECEIVED','SHORT')),
    UNIQUE (asn_id, line_no)
);

CREATE TABLE grns (
    grn_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_no          varchar(30) UNIQUE NOT NULL,
    asn_id          uuid NOT NULL REFERENCES asns,
    mode            varchar(10) NOT NULL CHECK (mode IN ('LPN_SCAN','CASE_SCAN','PIECE','FILE')),
    status          varchar(15) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_PROGRESS','COMPLETED')),
    has_discrepancy boolean DEFAULT false,
    received_by     uuid,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grn_lines (
    line_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id        uuid NOT NULL REFERENCES grns,
    asn_line_id   uuid REFERENCES asn_lines,
    sku_id        uuid NOT NULL REFERENCES skus,
    ordered_qty   integer DEFAULT 0,
    received_qty  integer DEFAULT 0,
    accepted_qty  integer DEFAULT 0,
    damaged_qty   integer DEFAULT 0,
    expired_qty   integer DEFAULT 0,
    excess_qty    integer DEFAULT 0,
    expiry_date   date,
    mrp           numeric(10,2),
    lot_id        uuid REFERENCES inventory_lots,
    CONSTRAINT chk_grn_line_math CHECK (received_qty >= accepted_qty + damaged_qty + expired_qty)
);

CREATE TABLE qc_inspections (
    qc_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_line_id uuid NOT NULL REFERENCES grn_lines,
    sample_size integer DEFAULT 0,
    pass_count  integer DEFAULT 0,
    fail_count  integer DEFAULT 0,
    status      varchar(20) NOT NULL CHECK (status IN ('PENDING','PASSED','FAILED','PARTIAL')),
    remarks     text,
    tested_by   uuid,
    tested_at   timestamptz
);

CREATE TABLE putaway_tasks (
    task_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_line_id     uuid NOT NULL REFERENCES grn_lines,
    lpn_id          varchar(50) REFERENCES lpn_master,
    from_container  container_type NOT NULL DEFAULT 'QC_PASSED_STAGING',
    to_container    container_type NOT NULL,
    sku_id          uuid NOT NULL REFERENCES skus,
    lot_id          uuid NOT NULL REFERENCES inventory_lots,
    qty             integer NOT NULL CHECK (qty > 0),
    suggested_bin_id text REFERENCES locations,
    confirmed_bin_id text REFERENCES locations,
    status          varchar(20) DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','ACCEPTED','IN_PROGRESS','CONFIRMED','EXCEPTION','HOLD_AUDIT')),
    assigned_to     uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    completed_at    timestamptz,
    exception_reason text
);

COMMIT;

-- ============================================================================
-- Migration 0011: Orders — Customer, Cart, Order Lines
-- ============================================================================
BEGIN;

CREATE TABLE customers (
    customer_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL UNIQUE REFERENCES users,
    name          varchar(80),
    trust_tier    varchar(20) DEFAULT 'T0' CHECK (trust_tier IN ('T0','T1','T2','T3','T_FLAGGED')),
    default_address_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_addresses (
    address_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customers,
    label         varchar(20),
    line1         varchar(200) NOT NULL,
    line2         varchar(200),
    landmark      varchar(100),
    pincode       varchar(6) NOT NULL,
    city          varchar(40),
    geo_lat       numeric(10,7),
    geo_lng       numeric(10,7),
    geocode_confidence varchar(10),
    is_default    boolean DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carts (
    cart_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers,
    site_id     text REFERENCES sites,
    status      varchar(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONVERTED','ABANDONED')),
    subtotal    numeric(10,2) DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_lines (
    cart_id   uuid NOT NULL REFERENCES carts,
    line_no   smallint NOT NULL,
    sku_id    uuid NOT NULL REFERENCES skus,
    qty       integer NOT NULL CHECK (qty > 0),
    unit_price numeric(10,2) NOT NULL,
    PRIMARY KEY (cart_id, line_no)
);

CREATE TABLE customer_orders (
    order_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no          varchar(20) UNIQUE NOT NULL,
    customer_id       uuid NOT NULL REFERENCES customers,
    site_id           text NOT NULL REFERENCES sites,
    address_id        uuid NOT NULL REFERENCES customer_addresses,
    status            order_status NOT NULL DEFAULT 'PLACED',
    payment_method    varchar(20) NOT NULL CHECK (payment_method IN ('PREPAID','COD')),
    payment_status    varchar(20) CHECK (payment_status IN ('PENDING','CAPTURED','FAILED','REFUNDED','COD_PENDING','COD_COLLECTED')),
    subtotal          numeric(10,2) NOT NULL,
    delivery_fee      numeric(10,2) DEFAULT 0,
    discount          numeric(10,2) DEFAULT 0,
    tax_amount        numeric(10,2) DEFAULT 0,
    grand_total       numeric(10,2) NOT NULL,
    short_amount      numeric(10,2) DEFAULT 0,
    cancel_reason     text,
    cancel_actor      varchar(20),
    cancelled_at      timestamptz,
    picked_up_at      timestamptz,
    returned_at       timestamptz,
    delivered_at      timestamptz,
    placed_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_cancel_reason CHECK (status NOT IN ('CANCELLED','CANCELLED_PENDING_RETURN') OR cancel_reason IS NOT NULL)
);
CREATE INDEX ix_orders_status ON customer_orders (status);
CREATE INDEX ix_orders_customer ON customer_orders (customer_id, placed_at DESC);

CREATE TABLE customer_order_lines (
    order_id    uuid NOT NULL REFERENCES customer_orders,
    line_no     smallint NOT NULL,
    sku_id      uuid NOT NULL REFERENCES skus,
    lot_id      uuid REFERENCES inventory_lots,
    qty         integer NOT NULL CHECK (qty > 0),
    picked_qty  integer DEFAULT 0,
    packed_qty  integer DEFAULT 0,
    shipped_qty integer DEFAULT 0,
    unit_price  numeric(10,2) NOT NULL,
    line_total  numeric(10,2) NOT NULL,
    status      varchar(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','PICKED','SHORT','CANCELLED')),
    PRIMARY KEY (order_id, line_no)
);

CREATE TABLE order_status_history (
    history_id bigserial PRIMARY KEY,
    order_id   uuid NOT NULL REFERENCES customer_orders,
    from_status order_status,
    to_status  order_status NOT NULL,
    actor_type varchar(20),
    actor_id   uuid,
    remark     text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Order status transitions whitelist
CREATE TABLE order_status_transitions (
    from_status order_status NOT NULL,
    to_status   order_status NOT NULL,
    allowed     boolean NOT NULL DEFAULT true,
    PRIMARY KEY (from_status, to_status)
);

COMMIT;

-- ============================================================================
-- Migration 0012: Payments & Refunds
-- ============================================================================
BEGIN;

CREATE TABLE payments (
    payment_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL REFERENCES customer_orders,
    customer_id     uuid NOT NULL REFERENCES customers,
    method          varchar(20) NOT NULL CHECK (method IN ('UPI','CARD','NETBANKING','WALLET','COD_UPI','COD_CASH')),
    gateway         varchar(50),
    gateway_order_id varchar(80),
    gateway_payment_id varchar(80),
    amount          numeric(12,2) NOT NULL CHECK (amount > 0),
    status          varchar(20) DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','PROCESSING','CAPTURED','FAILED','VOIDED','REFUNDED')),
    captured_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cancel_intents (
    intent_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL REFERENCES customer_orders,
    idempotency_key varchar(80) UNIQUE NOT NULL,
    reason_code     varchar(50) NOT NULL,
    actor_type      actor_type NOT NULL,
    actor_id        varchar(20),
    status          varchar(20) DEFAULT 'WAITING_PAYMENT' CHECK (status IN ('WAITING_PAYMENT','RESUMED','CANCELLED','SUPERSEDED')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    resolved_at     timestamptz
);

CREATE TABLE refunds (
    refund_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid NOT NULL REFERENCES customer_orders,
    payment_id      uuid NOT NULL REFERENCES payments,
    amount          numeric(12,2) NOT NULL CHECK (amount > 0),
    refund_method   varchar(20) NOT NULL,
    status          refund_status DEFAULT 'REQUESTED',
    gateway_refund_id varchar(80),
    utr             varchar(40),
    initiated_at    timestamptz,
    completed_at    timestamptz,
    retry_count     smallint DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_decisions (
    decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_id   uuid REFERENCES refunds,
    return_id   uuid,
    decision    varchar(20) NOT NULL CHECK (decision IN ('APPROVE','PARTIAL','DENY','WAIT')),
    amount      numeric(12,2),
    reason_code varchar(50),
    decided_by  varchar(20),
    decided_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0013: COD Custody
-- ============================================================================
BEGIN;

CREATE TABLE cash_movements (
    entry_id        bigserial PRIMARY KEY,
    movement_type   cash_movement_type NOT NULL,
    amount          numeric(12,2) NOT NULL CHECK (amount > 0),
    site_id         varchar(50) NOT NULL REFERENCES sites,
    from_container  container_type,
    from_ref_id     varchar(50),
    to_container    container_type,
    to_ref_id       varchar(50),
    ref_type        movement_ref_type,
    ref_id          varchar(50),
    actor_id        varchar(20),
    actor_type      actor_type NOT NULL DEFAULT 'SYSTEM',
    idempotency_key varchar(80),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rider_custody_state (
    rider_id        uuid PRIMARY KEY,
    site_id         varchar(50) NOT NULL REFERENCES sites,
    current_cash    numeric(12,2) DEFAULT 0 CHECK (current_cash >= 0),
    current_float   numeric(12,2) DEFAULT 0 CHECK (current_float >= 0),
    bags_in_custody smallint DEFAULT 0 CHECK (bags_in_custody >= 0),
    ceiling_amount  numeric(12,2) NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_custody_within_ceiling CHECK (current_cash <= ceiling_amount)
);

COMMIT;

-- ============================================================================
-- Migration 0014: POD Evidence
-- ============================================================================
BEGIN;

CREATE TABLE pod_evidence (
    pod_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           uuid NOT NULL,
    order_id          uuid NOT NULL REFERENCES customer_orders,
    method            pod_method NOT NULL,
    otp_verified      boolean,
    upi_gateway_ref   varchar(100),
    cash_amount       numeric(10,2),
    photo_url         text,
    signature_url     text,
    captured_lat      numeric(10,7),
    captured_lng      numeric(10,7),
    captured_at       timestamptz NOT NULL,
    state_outcome     pod_state_outcome NOT NULL,
    idempotency_key   varchar(120) UNIQUE NOT NULL,
    actor_id          varchar(20) NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_pod_method CHECK (
        (method = 'OTP' AND otp_verified IS NOT NULL) OR
        (method IN ('PHOTO','LEAVE_AT_DOOR') AND photo_url IS NOT NULL) OR
        (method = 'SIGNATURE' AND signature_url IS NOT NULL) OR
        (method = 'CASH' AND cash_amount IS NOT NULL) OR
        (method = 'UPI_QR' AND upi_gateway_ref IS NOT NULL) OR
        method = 'AGE_VERIFIED'
    )
);

COMMIT;

-- ============================================================================
-- Migration 0015: Delivery — Riders, Shifts, Tasks, Routes
-- ============================================================================
BEGIN;

CREATE TABLE rider_profiles (
    rider_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL UNIQUE REFERENCES users,
    name            varchar(80) NOT NULL,
    phone           varchar(15) NOT NULL,
    vehicle_type    varchar(20) CHECK (vehicle_type IN ('BIKE','SCOOTER','CYCLE','MINI_VAN')),
    vehicle_number  varchar(15),
    vehicle_capacity_kg numeric(8,2),
    vehicle_capacity_cbm numeric(8,3),
    can_carry_cold  boolean DEFAULT false,
    kyc_status      varchar(20) DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED')),
    is_online       boolean DEFAULT false,
    current_site_id text REFERENCES sites,
    rating          numeric(3,2),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rider_shifts (
    shift_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id        uuid NOT NULL REFERENCES rider_profiles,
    site_id         text NOT NULL REFERENCES sites,
    qr_in_id        uuid REFERENCES ds_qr_codes,
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    end_reason      varchar(20) CHECK (end_reason IN ('MANUAL','AUTO_IDLE','TIMEOUT','FORCED')),
    orders_delivered integer DEFAULT 0,
    distance_km     numeric(8,2) DEFAULT 0,
    status          varchar(10) DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED'))
);

CREATE TABLE delivery_tasks (
    task_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            uuid NOT NULL REFERENCES customer_orders,
    site_id             text NOT NULL REFERENCES sites,
    rider_id            uuid REFERENCES rider_profiles,
    bin                 varchar(50),
    status              delivery_task_status DEFAULT 'UNASSIGNED',
    offer_count         smallint DEFAULT 0,
    offer_surge         numeric(6,2) DEFAULT 0,
    order_weight_kg     numeric(8,2),
    order_volume_cbm    numeric(8,3),
    requires_cold_chain boolean DEFAULT false,
    offered_at          timestamptz,
    accepted_at         timestamptz,
    pickup_at           timestamptz,
    delivered_at        timestamptz,
    distance_m          integer,
    eta_at              timestamptz,
    attempt_no          smallint DEFAULT 1,
    route_plan_id       uuid,
    route_seq           smallint,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_plans (
    route_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id          uuid NOT NULL REFERENCES rider_profiles,
    shift_id          uuid REFERENCES rider_shifts,
    site_id           text NOT NULL REFERENCES sites,
    status            varchar(20) DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','ABORTED')),
    stop_count        smallint DEFAULT 0,
    total_distance_m  integer,
    estimated_min     integer,
    started_at        timestamptz,
    completed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_stops (
    stop_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id          uuid NOT NULL REFERENCES route_plans,
    task_id           uuid NOT NULL REFERENCES delivery_tasks,
    seq               smallint NOT NULL,
    planned_eta       timestamptz,
    actual_arrival    timestamptz,
    status            varchar(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','ARRIVED','DELIVERED','FAILED')),
    UNIQUE (route_id, seq)
);

COMMIT;

-- ============================================================================
-- Migration 0016: Holds & Audit
-- ============================================================================
BEGIN;

CREATE TABLE holds (
    hold_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         varchar(50) NOT NULL REFERENCES sites,
    sku_id          uuid NOT NULL REFERENCES skus,
    lot_id          uuid NOT NULL REFERENCES inventory_lots,
    container_from  container_type NOT NULL,
    container_ref   varchar(50),
    qty             integer NOT NULL CHECK (qty > 0),
    trigger_reason  varchar(200) NOT NULL,
    ref_type        movement_ref_type,
    ref_id          varchar(50),
    status          hold_status DEFAULT 'OPEN',
    created_by      varchar(20) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    assigned_to     varchar(20),
    resolved_by     varchar(20),
    resolved_at     timestamptz,
    resolution_note text,
    escalated_at    timestamptz,
    CONSTRAINT chk_hold_sep_duties CHECK (resolved_by IS NULL OR resolved_by <> created_by),
    CONSTRAINT chk_hold_resolution_requires_note CHECK (resolved_by IS NULL OR resolution_note IS NOT NULL)
);

CREATE TABLE audit_log (
    audit_id      bigserial PRIMARY KEY,
    actor_type    actor_type NOT NULL,
    actor_id      varchar(50),
    action        varchar(60) NOT NULL,
    entity_type   varchar(40),
    entity_id     uuid,
    before_json   jsonb,
    after_json    jsonb,
    ip            inet,
    request_id    uuid,
    result        varchar(20) NOT NULL CHECK (result IN ('SUCCESS','DENIED','ERROR')),
    denial_reason text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0017: Outbox & Notifications
-- ============================================================================
BEGIN;

CREATE TABLE outbox_events (
    event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type  varchar(40) NOT NULL,
    aggregate_id    uuid NOT NULL,
    event_type      varchar(60) NOT NULL,
    payload_json    jsonb NOT NULL,
    status          varchar(10) DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED','DEAD')),
    attempts        smallint DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    correlation_id  uuid
);
CREATE INDEX ix_outbox_pending ON outbox_events (created_at) WHERE status = 'PENDING';
CREATE INDEX ix_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id);

CREATE TABLE notifications (
    notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid,
    type            varchar(40) NOT NULL,
    channel         varchar(15) NOT NULL CHECK (channel IN ('PUSH','SMS','WS','EMAIL','WHATSAPP')),
    idempotency_key varchar(120) UNIQUE NOT NULL,
    payload_json    jsonb,
    sent_at         timestamptz,
    delivered_at    timestamptz,
    failed_at       timestamptz,
    retry_count     smallint DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0018: Fulfilment — Batches
-- ============================================================================
BEGIN;

CREATE TABLE batches (
    batch_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_no          varchar(50) UNIQUE NOT NULL,
    site_id           text NOT NULL REFERENCES sites,
    type              varchar(10) CHECK (type IN ('MANUAL','AUTO')),
    status            varchar(15) DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','ALLOCATING','ALLOCATED','IN_PROGRESS','CLOSED','CANCELLED')),
    order_type        varchar(30),
    processing_type   varchar(20) DEFAULT 'LPN_BASED',
    picking_type      varchar(30),
    cluster_zone      varchar(50),
    sorting_eligible  boolean DEFAULT true,
    dispatch_plan     uuid,
    destinations      text,
    totes             integer DEFAULT 0,
    ordered_qty       integer DEFAULT 0,
    ordered_skus      integer DEFAULT 0,
    picked_qty        integer DEFAULT 0,
    sorted_qty        integer DEFAULT 0,
    short_qty         integer DEFAULT 0,
    cutoff            timestamptz,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_allocations (
    alloc_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_line  uuid NOT NULL,
    lot_id      uuid REFERENCES inventory_lots,
    bin         varchar(50),
    lpn         varchar(50),
    qty         integer DEFAULT 0,
    batch       uuid,
    status      varchar(20) DEFAULT 'PENDING',
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0019: Reverse Logistics — Returns, RTV, RTS
-- ============================================================================
BEGIN;

CREATE TABLE return_orders (
    return_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES customer_orders,
    reason        text,
    fault         varchar(20) DEFAULT 'NONE' CHECK (fault IN ('CUSTOMER','TRANSIT','UNKNOWN','NONE')),
    status        return_order_status DEFAULT 'RETURN_CREATED',
    pickup_scheduled_at timestamptz,
    picked_up_at  timestamptz,
    received_at_ds timestamptz,
    qc_disposition varchar(20) CHECK (qc_disposition IN ('RESTOCKED','DAMAGED','EXPIRED','RTV','RTS','HELD')),
    refund_amount numeric(12,2),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rtv_orders (
    rtv_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES customer_orders,
    status        varchar(20) DEFAULT 'PENDING',
    destination_site varchar(50),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rts_orders (
    rts_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES customer_orders,
    status        varchar(20) DEFAULT 'PENDING',
    destination_site varchar(50),
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- ============================================================================
-- Migration 0020: Views — Read Models
-- ============================================================================
BEGIN;

CREATE VIEW vw_stock_by_location AS
SELECT b.site_id, b.sku_id, b.lot_id, b.container,
       b.container_ref AS location_or_bin,
       l.barcode AS location_barcode,
       b.owner_type, b.owner_id, b.qty, b.sellable,
       i.expiry_date,
       (i.expiry_date - CURRENT_DATE) AS days_to_expiry
FROM stock_balances b
LEFT JOIN locations l ON l.site_id = b.site_id AND b.container_ref_type = 'LOCATION' AND l.location_id = b.container_ref
LEFT JOIN inventory_lots i ON i.lot_id = b.lot_id
WHERE b.qty > 0;

CREATE VIEW vw_invariant_1_check AS
WITH ledger AS (
    SELECT site_id, sku_id, lot_id, owner_type, owner_id,
           SUM(qty * sellable_delta) AS sellable_ledger
    FROM stock_movements GROUP BY site_id, sku_id, lot_id, owner_type, owner_id
), balances AS (
    SELECT site_id, sku_id, lot_id, owner_type, owner_id,
           SUM(qty) FILTER (WHERE sellable) AS sellable_qty
    FROM stock_balances GROUP BY site_id, sku_id, lot_id, owner_type, owner_id
)
SELECT COALESCE(l.site_id, b.site_id) AS site_id,
       COALESCE(l.sku_id, b.sku_id) AS sku_id,
       COALESCE(l.lot_id, b.lot_id) AS lot_id,
       COALESCE(l.owner_type, b.owner_type) AS owner_type,
       COALESCE(l.owner_id, b.owner_id) AS owner_id,
       COALESCE(l.sellable_ledger, 0) AS ledger_sum,
       COALESCE(b.sellable_qty, 0) AS balance_sum
FROM ledger l FULL OUTER JOIN balances b USING (site_id, sku_id, lot_id, owner_type, owner_id)
WHERE COALESCE(l.sellable_ledger, 0) <> COALESCE(b.sellable_qty, 0);

COMMIT;

-- ============================================================================
-- Seed Data
-- ============================================================================
BEGIN;

INSERT INTO users (user_id, user_type, phone, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'ADMIN', '+910000000000', 'ACTIVE');

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run these queries to verify:
-- SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT count(*) FROM information_schema.types WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
-- SELECT * FROM vw_invariant_1_check;  -- Should be empty
