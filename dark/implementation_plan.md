# Production-Ready Blueprint V2.0 - Complete ERP & WMS (Warehouse Management System)

An enterprise-grade, buildable blueprint and implementation plan for the Zippzo ERP & WMS system. This version incorporates all audit feedback including hierarchical categories, packing verification stations, double-entry inventory ledger, outgoing webhooks for Head Office sync, internal batch numbering, explicit composite performance indexes, and strict user-to-employee onboarding gates.

---

## User Review Required

> [!IMPORTANT]
> **Validated Design Decisions (V2.0 Finalized):**
> 1. **User → Employee Onboarding Gate**: When an Admin approves a pending user via `PATCH /api/v1/admin/users/{id}/approve`, the Admin **must supply a `department` and `role`**.
>    - For Floor Staff (`department in ['picking', 'receiving', 'packing', 'shipping', 'qc']`), the system automatically provisions an `employees` record with an auto-generated sequence code (`EMP-0001`, `EMP-0002`, etc.) and sets `is_clocked_in=False`.
>    - For Management (`department in ['admin', 'management']`), `employees` record is created with `is_clocked_in=NULL` (exempt from floor clock-in/geolocation requirements).
> 2. **Double-Scan Verification in Packing Station**:
>    - A dedicated `packing_tasks` stage acts as the final quality and accuracy gate between `Picking` and `Shipping`.
>    - Mobile / Desktop workflow enforces scanning: **Location Barcode → Item Barcode → Serial/Batch Barcode**.
> 3. **Dual Batch Identifiers**:
>    - `internal_batch_id` (System-generated UUID/Alphanumeric, e.g. `BAT-2026-00918`) guarantees unique system-wide identity.
>    - `vendor_batch_code` captures external supplier lot identifiers.

---

## System Architecture Diagram

```mermaid
graph TD
    subgraph Client Applications
        WebDashboard["Admin, Manager & Packing Station Web UI (React/TS/Vite)"]
        MobilePWA["Warehouse Floor Mobile PWA (Camera & Laser Barcode Scanner)"]
    end

    subgraph API & Gateway
        Gateway["Reverse Proxy / API Gateway (Nginx)"]
        AuthMiddleware["JWT Authentication + RBAC Permissions Engine"]
    end

    subgraph Application Modules (Django / DRF)
        AuthApp["Auth & Onboarding Gate (Users & Employees)"]
        MasterApp["Warehouse, Zones, Locations & Categories"]
        CatalogApp["Products, SKUs, Batches (Internal & Vendor)"]
        InventoryApp["Inventory Engine & Immutable Double-Entry Ledger"]
        InboundApp["Procurement, GRN & QC Inspection"]
        OutboundApp["Sales Orders, Wave Routing & Pick Tasks"]
        PackingApp["Packing Stations & Item Verification Tasks"]
        ShippingApp["Shipments, Carrier APIs & Driver Manifests"]
        ReverseApp["Returns, RMA & Inspection Routing"]
        HRApp["Employee Shifts, GPS Clock-in & Performance"]
        WebhookApp["Outgoing Webhook Dispatcher (Head Office Sync)"]
        AuditApp["Append-Only JSONB Audit Trail"]
    end

    subgraph Storage & Asynchronous Processing
        PostgreSQL[("PostgreSQL 16 (Relational + JSONB + Partial Indexes)")]
        RedisLock[("Redis 7 (Distributed Locking & Celery Broker)")]
        CeleryWorker["Celery Worker (Wave Engine, PDF Labels, Webhooks)"]
        CeleryBeat["Celery Beat (Periodic Low-Stock & Expiry Sync)"]
        S3Storage["MinIO / AWS S3 (Damage Photos & Carrier PODs)"]
    end

    WebDashboard --> Gateway
    MobilePWA --> Gateway
    Gateway --> AuthMiddleware
    AuthMiddleware --> AuthApp

    AuthApp --> PostgreSQL
    MasterApp --> PostgreSQL
    CatalogApp --> PostgreSQL
    InventoryApp --> PostgreSQL
    InboundApp --> PostgreSQL
    OutboundApp --> PostgreSQL
    PackingApp --> PostgreSQL
    ShippingApp --> PostgreSQL
    ReverseApp --> PostgreSQL
    HRApp --> PostgreSQL
    WebhookApp --> PostgreSQL
    AuditApp --> PostgreSQL

    InventoryApp -.-> RedisLock
    OutboundApp -.-> RedisLock
    InboundApp -.-> CeleryWorker
    OutboundApp -.-> CeleryWorker
    WebhookApp -.-> CeleryWorker
    CeleryWorker --> PostgreSQL
    CeleryWorker --> S3Storage
    CeleryBeat --> CeleryWorker
```

---

## Complete Database Schema (V2.0 Specifications)

### 1. Categories, Warehouses & Locations
```sql
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'USA',
    is_active BOOL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gap 1: Categories Master with Hierarchical Self-Reference
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    parent_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    is_active BOOL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_category_code_per_warehouse UNIQUE (warehouse_id, code)
);

CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    zone_type VARCHAR(30) NOT NULL CHECK (zone_type IN ('bulk', 'pick', 'quarantine', 'damaged', 'staging', 'packing', 'shipping')),
    is_active BOOL DEFAULT TRUE,
    CONSTRAINT unique_zone_code_per_warehouse UNIQUE (warehouse_id, code)
);

CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES zones(id) ON DELETE CASCADE,
    aisle VARCHAR(20) NOT NULL,
    rack_number VARCHAR(20) NOT NULL,
    shelf_level VARCHAR(20) NOT NULL,
    bin_code VARCHAR(50) UNIQUE NOT NULL,
    barcode_label VARCHAR(100) UNIQUE NOT NULL, -- Physical barcode sticker
    max_weight_kg DECIMAL(10,2) NOT NULL DEFAULT 1000.00,
    max_volume_cbm DECIMAL(10,4) NOT NULL DEFAULT 2.5000,
    is_occupied BOOL DEFAULT FALSE,
    is_blocked BOOL DEFAULT FALSE
);
```

### 2. Vendors, Customers, Products & Batches
```sql
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    tax_id VARCHAR(50),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    payment_terms VARCHAR(100) DEFAULT 'Net 30',
    address TEXT,
    is_active BOOL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    shipping_address TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    sku VARCHAR(64) UNIQUE NOT NULL,
    barcode VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    hsn_code VARCHAR(30),
    uom VARCHAR(20) NOT NULL DEFAULT 'PCS',
    length_cm DECIMAL(8,2) DEFAULT 0.00,
    width_cm DECIMAL(8,2) DEFAULT 0.00,
    height_cm DECIMAL(8,2) DEFAULT 0.00,
    gross_weight_kg DECIMAL(8,3) NOT NULL DEFAULT 0.100,
    reorder_point INT NOT NULL DEFAULT 10,
    reorder_quantity INT NOT NULL DEFAULT 50,
    is_active BOOL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gap 5: Internal vs Vendor Batch Code Strategy
CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    internal_batch_id VARCHAR(50) UNIQUE NOT NULL, -- System generated: e.g. BAT-2026-00123
    vendor_batch_code VARCHAR(100),                -- Vendor's external batch identifier
    mfg_date DATE,
    expiry_date DATE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pack_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pack_quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3. Inventory & Double-Entry Stock Ledger
```sql
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    quantity_on_hand INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    quantity_reserved INT NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'quarantine', 'damaged', 'reserved')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_batch_location_status UNIQUE (batch_id, location_id, status),
    CONSTRAINT check_reservation_limit CHECK (quantity_reserved <= quantity_on_hand)
);

-- Double-Entry Stock Movement Ledger (Audit-compliant)
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    source_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    dest_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'GRN_RECEIPT', 'QC_PASS', 'QC_REJECT', 'PICK_RESERVE', 
        'PICK_CONFIRM', 'PACK_VERIFY', 'SHIPMENT_DEDUCT', 
        'REPLENISHMENT_MOVE', 'CYCLE_COUNT_ADJUST', 'CUSTOMER_RETURN'
    )),
    quantity INT NOT NULL CHECK (quantity > 0),
    reference_doc_type VARCHAR(50) NOT NULL, -- e.g., 'GRN', 'PICK_TASK', 'SALES_ORDER', 'RMA'
    reference_doc_id UUID NOT NULL,
    user_id UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 4. Inbound: Purchase Orders, GRN & QC
```sql
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    total_amount DECIMAL(14,2) DEFAULT 0.00,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    ordered_qty INT NOT NULL CHECK (ordered_qty > 0),
    received_qty INT NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00
);

CREATE TABLE goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    po_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    received_by_id UUID,
    receipt_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    vehicle_number VARCHAR(50),
    driver_phone VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'pending_qc' CHECK (status IN ('pending_qc', 'qc_in_progress', 'completed', 'rejected'))
);

CREATE TABLE grn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES batches(id) ON DELETE RESTRICT,
    received_qty INT NOT NULL CHECK (received_qty >= 0),
    passed_qty INT NOT NULL DEFAULT 0 CHECK (passed_qty >= 0),
    rejected_qty INT NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
    quarantine_location_id UUID REFERENCES locations(id) ON DELETE RESTRICT,
    putaway_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    damaged_photos_url JSONB DEFAULT '[]'::jsonb,
    qc_notes TEXT
);
```

### 5. Outbound: Sales Orders, Waves & Picking
```sql
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    shipping_address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivery_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'standard' CHECK (priority IN ('standard', 'express', 'same_day')),
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft', 'confirmed', 'allocated', 'partially_allocated', 'picking', 'packed', 'shipped', 'cancelled', 'returned'))
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    requested_qty INT NOT NULL CHECK (requested_qty > 0),
    allocated_qty INT NOT NULL DEFAULT 0 CHECK (allocated_qty >= 0),
    picked_qty INT NOT NULL DEFAULT 0 CHECK (picked_qty >= 0),
    shipped_qty INT NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0),
    -- Flawless Mathematical Generated Column
    remaining_qty INT GENERATED ALWAYS AS (requested_qty - (picked_qty + shipped_qty)) STORED,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00
);

CREATE TABLE pick_waves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wave_number VARCHAR(50) UNIQUE NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
    strategy VARCHAR(30) NOT NULL DEFAULT 'batch_pick' CHECK (strategy IN ('zone_pick', 'batch_pick', 'single_order_pick')),
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE pick_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wave_id UUID REFERENCES pick_waves(id) ON DELETE SET NULL,
    order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE RESTRICT,
    source_location_id UUID REFERENCES locations(id) ON DELETE RESTRICT,
    target_staging_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    assigned_employee_id UUID,
    quantity_to_pick INT NOT NULL CHECK (quantity_to_pick > 0),
    quantity_picked INT NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
    sequence_route_order INT NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'exception')),
    exception_reason VARCHAR(50) CHECK (exception_reason IN ('damaged_stock', 'bin_empty', 'wrong_barcode', 'expired_stock', NULL))
);
```

### 6. Gap 3: Packing Station Tasks & Verification Gate
```sql
CREATE TABLE packing_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_task_id UUID REFERENCES pick_tasks(id) ON DELETE RESTRICT UNIQUE,
    order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    packed_by_employee_id UUID,
    scan_verified_qty INT NOT NULL DEFAULT 0 CHECK (scan_verified_qty >= 0),
    packaging_type VARCHAR(50) DEFAULT 'Standard Box', -- e.g., 'Box S', 'Box M', 'Box L', 'Pallet'
    actual_weight_kg DECIMAL(8,3),
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'verified', 'packed', 'mismatch_hold')),
    error_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);
```

### 7. Shipping, Carriers & Manifests
```sql
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
    shipment_number VARCHAR(50) UNIQUE NOT NULL,
    package_weight_kg DECIMAL(8,3) NOT NULL,
    package_dimensions JSONB NOT NULL DEFAULT '{"length": 0, "width": 0, "height": 0}'::jsonb,
    logistics_partner VARCHAR(50) NOT NULL CHECK (logistics_partner IN ('FedEx', 'DHL', 'BlueDart', 'Delhivery', 'Self_Fleet')),
    tracking_number VARCHAR(100) UNIQUE NOT NULL,
    shipping_label_url TEXT,
    delivery_eta TIMESTAMP WITH TIME ZONE,
    status VARCHAR(30) NOT NULL DEFAULT 'labeled' CHECK (status IN ('labeled', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'rto')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE shipment_manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manifest_number VARCHAR(50) UNIQUE NOT NULL,
    logistics_partner VARCHAR(50) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    vehicle_number VARCHAR(50) NOT NULL,
    driver_phone VARCHAR(30),
    total_packages INT NOT NULL DEFAULT 0,
    departure_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID
);

CREATE TABLE manifest_shipments_link (
    manifest_id UUID REFERENCES shipment_manifests(id) ON DELETE CASCADE,
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    PRIMARY KEY (manifest_id, shipment_id)
);
```

### 8. Reverse Logistics (RMA & Returns)
```sql
CREATE TABLE return_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rma_number VARCHAR(50) UNIQUE NOT NULL,
    order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('damaged', 'defective', 'wrong_item', 'customer_remorse')),
    status VARCHAR(30) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'item_received', 'inspected', 'refund_approved', 'rejected')),
    tracking_number VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rma_id UUID REFERENCES return_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES batches(id) ON DELETE RESTRICT,
    returned_qty INT NOT NULL CHECK (returned_qty > 0),
    inspection_result VARCHAR(50) CHECK (inspection_result IN ('restockable', 'damaged_scrap', 'refurbish')),
    target_location_id UUID REFERENCES locations(id) ON DELETE RESTRICT,
    refund_amount DECIMAL(12,2) DEFAULT 0.00
);
```

### 9. Gap 2: Users, RBAC & Employee Onboarding
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOL DEFAULT FALSE,
    is_approved_by_admin BOOL DEFAULT FALSE,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'manager', 'supervisor', 'picker', 'packer', 'receiver', 'shipper', 'qc_inspector')),
    CONSTRAINT unique_user_role UNIQUE (user_id, role)
);

CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    employee_code VARCHAR(30) UNIQUE NOT NULL, -- e.g., EMP-0001
    department VARCHAR(30) NOT NULL CHECK (department IN ('admin', 'management', 'receiving', 'picking', 'packing', 'shipping', 'qc', 'inventory_control')),
    shift_start TIME DEFAULT '08:00:00',
    shift_end TIME DEFAULT '17:00:00',
    is_clocked_in BOOL DEFAULT FALSE, -- NULL for admin/management
    current_gps_lat DECIMAL(10,7),
    current_gps_lng DECIMAL(10,7),
    forklift_certified BOOL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE employee_clock_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    clock_in_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    clock_out_time TIMESTAMP WITH TIME ZONE,
    clock_in_lat DECIMAL(10,7),
    clock_in_lng DECIMAL(10,7),
    total_hours_worked DECIMAL(5,2)
);

CREATE TABLE employee_daily_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    task_type VARCHAR(30) NOT NULL CHECK (task_type IN ('pick', 'grn_qc', 'putaway', 'pack', 'cycle_count')),
    reference_id UUID NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    items_handled_count INT NOT NULL DEFAULT 0, -- Atomically incremented upon completion
    error_count INT NOT NULL DEFAULT 0
);
```

### 10. Gap 4: Outgoing Webhooks & Head Office Sync
```sql
CREATE TABLE outgoing_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'inventory.low_stock', 
        'grn.received', 
        'order.shipped', 
        'batch.expiring_soon',
        'backorder.triggered'
    )),
    target_url VARCHAR(255) NOT NULL,
    secret_token VARCHAR(255) NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    last_response_code INT,
    last_error_message TEXT,
    is_active BOOL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 11. Audit Logs (Append-Only JSONB Ledger)
```sql
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Gap 6: Explicit High-Performance Composite Indexes

```sql
-- 1. FEFO Allocation Engine (Critical for high throughput row locking)
CREATE INDEX idx_inventory_fefo_lookup 
ON inventory (batch_id, location_id, status, quantity_on_hand) 
WHERE status = 'available';

-- 2. Pick Route Optimization (Zone + Aisle + Rack + Shelf S-Shape sorting)
CREATE INDEX idx_locations_zone_aisle 
ON locations (zone_id, aisle, rack_number, shelf_level);

-- 3. Expired Batch Monitoring (Celery Beat Daily Sweep)
CREATE INDEX idx_batches_expiry 
ON batches (expiry_date) 
WHERE expiry_date IS NOT NULL;

-- 4. Backorder & Unfulfilled Order Items Detection
CREATE INDEX idx_order_items_remaining 
ON order_items (product_id, order_id) 
WHERE (requested_qty - (picked_qty + shipped_qty)) > 0;

-- 5. Active Employee Task Dispatching
CREATE INDEX idx_employee_tasks_active 
ON employee_daily_tasks (employee_id, status) 
WHERE status IN ('pending', 'in_progress');

-- 6. Audit Trail Search by Entity & Timestamp
CREATE INDEX idx_audit_logs_entity 
ON audit_logs (entity_type, entity_id, timestamp DESC);
```

---

## Core Business Workflows & Concurrency Patterns

### 1. User Approval & Employee Auto-Provisioning (Gap 2 Resolution)
```python
@transaction.atomic
def approve_user_and_provision_employee(admin_user, user_id, department, roles):
    user = User.objects.select_for_update().get(id=user_id)
    user.is_active = True
    user.is_approved_by_admin = True
    user.approval_status = 'approved'
    user.save()

    # Assign Roles
    for role in roles:
        UserRole.objects.get_or_create(user=user, role=role)

    # Provision Employee Record
    is_floor_staff = department not in ['admin', 'management']
    employee_code = None
    if is_floor_staff:
        # Atomic sequence generation: EMP-0001
        last_emp = Employee.objects.filter(employee_code__startswith='EMP-').order_by('-employee_code').first()
        next_seq = 1 if not last_emp else int(last_emp.employee_code.split('-')[1]) + 1
        employee_code = f"EMP-{next_seq:04d}"
    else:
        employee_code = f"MGT-{user.id.hex[:6].upper()}"

    Employee.objects.create(
        user=user,
        employee_code=employee_code,
        department=department,
        is_clocked_in=False if is_floor_staff else None
    )

    # Log to Audit Trail
    AuditLog.log(admin_user, 'USER_APPROVED', 'User', user.id, {'status': 'pending'}, {'status': 'approved', 'emp_code': employee_code})
```

### 2. Packing Station Scan Verification Gate (Gap 3 Resolution)
```python
@transaction.atomic
def verify_packed_item(packer_employee, packing_task_id, scanned_item_barcode, scanned_batch_code):
    packing_task = PackingTask.objects.select_for_update().get(id=packing_task_id)
    order_item = packing_task.pick_task.order_item

    # Verify Barcode Matches Expected SKU
    if order_item.product.barcode != scanned_item_barcode:
        packing_task.status = 'mismatch_hold'
        packing_task.error_notes = f"Wrong item barcode: Scanned {scanned_item_barcode} != Expected {order_item.product.barcode}"
        packing_task.save()
        raise ValidationError("Scan Mismatch: Wrong item scanned!")

    packing_task.scan_verified_qty += 1
    if packing_task.scan_verified_qty == packing_task.pick_task.quantity_picked:
        packing_task.status = 'verified'
        packing_task.completed_at = timezone.now()
        
        # Atomically increment packer's handled count
        EmployeeDailyTask.objects.filter(
            employee=packer_employee, reference_id=packing_task.id
        ).update(items_handled_count=F('items_handled_count') + packing_task.scan_verified_qty, status='completed')

    packing_task.save()
```

### 3. Outgoing Webhooks with Celery & Backoff (Gap 4 Resolution)
```python
@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def dispatch_outgoing_webhook(self, event_type, payload):
    webhooks = OutgoingWebhook.objects.filter(event_type=event_type, is_active=True)
    for hook in webhooks:
        try:
            signature = hmac.new(hook.secret_token.encode(), json.dumps(payload).encode(), hashlib.sha256).hexdigest()
            response = requests.post(
                hook.target_url,
                json=payload,
                headers={'X-Zippzo-Signature': signature, 'Content-Type': 'application/json'},
                timeout=10
            )
            hook.last_triggered_at = timezone.now()
            hook.last_response_code = response.status_code
            hook.save()
            response.raise_for_status()
        except Exception as exc:
            hook.retry_count += 1
            hook.last_error_message = str(exc)
            hook.save()
            raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
```

---

## Complete Project Directory Layout

```
zippzo/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── zippzo_core/
│   │   ├── __init__.py
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── celery.py
│   ├── apps/
│   │   ├── authentication/     # User login, JWT, Admin Approval, RBAC
│   │   ├── master_data/        # Warehouses, Zones, Locations, Categories
│   │   ├── catalog/            # Products, SKUs, Dual Batches (Internal & Vendor)
│   │   ├── inventory/          # Master Inventory, Locking & Double-Entry Stock Ledger
│   │   ├── receiving/          # Purchase Orders, GRN, QC Inspection & Putaway
│   │   ├── fulfillment/        # Sales Orders, Wave Routing & FEFO Pick Tasks
│   │   ├── packing/            # Packing Station, Scan Verification & Item Box Sizing
│   │   ├── shipping/           # Shipments, Courier APIs, Manifests & PDF Labels
│   │   ├── reverse_logistics/  # RMA, Returns Quality Inspection & Ledger Restock
│   │   ├── hr_tracking/        # Employee Shifts, GPS Clock-in & Performance Leaderboards
│   │   ├── webhooks/           # Outgoing Webhook Engine (Head Office Sync & Retries)
│   │   └── audit_trail/        # Append-only JSONB Audit Trail Signals
│   └── tests/
│       ├── test_fefo_allocation.py
│       ├── test_concurrency_locking.py
│       ├── test_packing_verification.py
│       └── test_webhook_dispatch.py
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── api/                # Axios instance with JWT auth & refresh token interceptors
│   │   ├── components/         # Barcode Camera Scanner (Quagga2/Html5-QRCode), Heatmaps, Modals
│   │   ├── layouts/            # Desktop Dashboard Layout & Mobile Floor Layout
│   │   ├── pages/
│   │   │   ├── auth/           # Login, Register, Pending Approval Gate
│   │   │   ├── admin/          # User Approval Portal, Webhook Config, Audit Logs
│   │   │   ├── manager/        # Warehouse Heatmap, Waves, Dead Stock, Leaderboards
│   │   │   ├── warehouse/      # Mobile Picking Screen, GRN Inward Scanner, Putaway
│   │   │   ├── packing/        # Packing Station Double-Scan Verification Screen
│   │   │   └── shipping/       # Courier Label Generation & Driver Manifest Dispatch
│   │   ├── hooks/
│   │   └── index.css           # Modern Glassmorphic Dark/Light Design System
└── docker-compose.yml          # PostgreSQL 16, Redis 7, Celery Worker/Beat, Backend & Frontend
```

---

## Step-by-Step Implementation Roadmap

| Sprint | Focus Area | Deliverables |
| :--- | :--- | :--- |
| **Sprint 1** | **Foundation & Auth Gate** | PostgreSQL 16 schema, Docker setup, User registration with Admin Approval gate, Employee auto-code provisioning, Category hierarchy, Warehouse Zones & Location bin master with barcode labels. |
| **Sprint 2** | **Catalog, Inventory & Inbound** | Products & dual-batch master (`internal_batch_id`), Master Inventory table with `select_for_update` row locking, Double-Entry Stock Ledger, Vendor POs, GRN receiving scanner & QC inspection workflow. |
| **Sprint 3** | **Fulfillment & Packing Gate** | Sales orders, FEFO allocation engine, S-Shape pick wave generator, Mobile camera scanner for pick tasks, Packing station double-scan verification (`packing_tasks`), Backorder calculation. |
| **Sprint 4** | **Shipping, HR & Webhooks** | Shipment label generation, Carrier driver manifests, Employee GPS clock-in/out, Real-time employee performance leaderboards, Outgoing webhooks with Celery exponential backoff. |
