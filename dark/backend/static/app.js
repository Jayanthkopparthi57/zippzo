/* ==========================================================================
   ZIPPZO WMS - ULTRA-ROBUST DARK STORE INVENTORY & FULFILLMENT ENGINE
   Dark Store: RJY-DS-001 (Rajahmundry Rapid Hub)
   Color Palette: #E8DDC5 (Canvas), #285A73 (Header/Primary), #B83A32 (Rust/Alert),
                  #292622 (Espresso Text/Borders), #C49A45 (Ochre/Excel/Warning)
   Typography: Sans-Serif (Plus Jakarta Sans / Inter)
   ========================================================================== */

const state = {
  activeView: 'orders-pipeline',
  searchTerm: '',
  selectedInboundNo: null,

  // Dark Store Staff for Dropdowns & Task Allocations
  employees: [
    'Arjun (Shift Lead & Supervisor)',
    'Ravi (Inbound & Picking Specialist)',
    'Priya (QC & Inventory Associate)',
    'Kiran (Packing & Dispatch Lead)',
    'Suresh (Dock Worker & Loader)',
    'Deepak (Fulfillment Operations)'
  ],

  // Delivery Fleet Partners
  partners: [
    'Shadowfax Quick Fleet',
    'Zomato / Blinkit Fleet',
    'Swiggy Instamart Fleet',
    'Dunzo Merchant Fleet',
    'Internal DarkStore Rapid Fleet'
  ],

  // Storage Zones & Temperature Classes
  zones: [
    'FMCG Pick Face (Zone A)',
    'Chilled Cold Chain (Zone B - 2°C to 4°C)',
    'Bulk Pallet Stacking (Zone C)',
    'High-Value Secure Cage (Zone D)',
    'Quarantine / Return Bay (Zone Q)'
  ],

  // 1. INBOUND CONSIGNMENTS & QC INTAKE
  inbounds: [
    {
      inboundNo: 'INB-00124',
      supplier: 'ABC Foods Ltd',
      warehouse: 'RJY-DS-001',
      itemsCount: 25,
      received: 1480,
      accepted: 1475,
      damaged: 5,
      batch: 'BTH-2408',
      mfgDate: '2026-01-15',
      expiry: '2027-08-31',
      receiver: 'Arjun (Shift Lead & Supervisor)',
      qc: 'Passed',
      putaway: 'A1-R1-S1',
      status: 'Receiving',
      items: [
        { sku: 'SNK-CHIP-01', name: 'Lays Classic Salted Chips 50g', received: 500, accepted: 498, damaged: 2, batch: 'BTH-2408-A', mfgDate: '2026-01-15', expiry: '2027-08-31', bin: 'A1-R1-S1' },
        { sku: 'BIS-OR-02', name: 'Oreo Vanilla Creme Biscuits 120g', received: 490, accepted: 488, damaged: 2, batch: 'BTH-2408-B', mfgDate: '2026-01-15', expiry: '2027-08-31', bin: 'A1-R1-S2' },
        { sku: 'BEV-JUC-03', name: 'Real Mixed Fruit Juice 1L', received: 490, accepted: 489, damaged: 1, batch: 'BTH-2408-C', mfgDate: '2026-01-15', expiry: '2027-08-31', bin: 'A1-R2-S1' }
      ]
    },
    {
      inboundNo: 'INB-00125',
      supplier: 'Fresh Dairy Co',
      warehouse: 'RJY-DS-001',
      itemsCount: 8,
      received: 500,
      accepted: 498,
      damaged: 2,
      batch: 'MILK-0905',
      mfgDate: '2026-09-01',
      expiry: '2026-09-08',
      receiver: 'Ravi (Inbound & Picking Specialist)',
      qc: 'Passed',
      putaway: 'CHILL-R1-A',
      status: 'Completed',
      items: [
        { sku: 'DAI-MILK-TON', name: 'Amul Taaza Toned Milk 500ml', received: 300, accepted: 299, damaged: 1, batch: 'MILK-0905', mfgDate: '2026-09-01', expiry: '2026-09-08', bin: 'CHILL-R1-A' },
        { sku: 'DAI-CURD-400', name: 'Amul Masti Dahi 400g Pouch', received: 200, accepted: 199, damaged: 1, batch: 'CURD-0905', mfgDate: '2026-09-01', expiry: '2026-09-10', bin: 'CHILL-R1-B' }
      ]
    },
    {
      inboundNo: 'INB-00126',
      supplier: 'Mother Hub Central Distribution',
      warehouse: 'RJY-DS-001',
      itemsCount: 12,
      received: 800,
      accepted: 800,
      damaged: 0,
      batch: 'BAT-RIC-26',
      mfgDate: '2025-12-01',
      expiry: '2027-12-31',
      receiver: 'Priya (QC & Inventory Associate)',
      qc: 'Passed',
      putaway: 'BULK-A1-P1',
      status: 'Completed',
      items: [
        { sku: 'GRC-RIC-01', name: 'India Gate Basmati Rice 1kg', received: 400, accepted: 400, damaged: 0, batch: 'BAT-RIC-26', mfgDate: '2025-12-01', expiry: '2027-12-31', bin: 'BULK-A1-P1' },
        { sku: 'GRC-OIL-02', name: 'Fortune Sunflower Oil 1L', received: 400, accepted: 400, damaged: 0, batch: 'BAT-OIL-26', mfgDate: '2026-01-10', expiry: '2028-01-15', bin: 'BULK-A1-P2' }
      ]
    },
    {
      inboundNo: 'INB-00127',
      supplier: 'Apex Beverages Ltd',
      warehouse: 'RJY-DS-001',
      itemsCount: 18,
      received: 1200,
      accepted: 1200,
      damaged: 0,
      batch: 'BTH-BEV-99',
      mfgDate: '2026-02-10',
      expiry: '2027-06-30',
      receiver: 'Arjun (Shift Lead & Supervisor)',
      qc: 'Passed',
      putaway: 'A1-R2-S1',
      status: 'Completed',
      items: [
        { sku: 'BEV-COL-01', name: 'Coca Cola Can 330ml Pack of 6', received: 600, accepted: 600, damaged: 0, batch: 'BTH-BEV-99', mfgDate: '2026-02-10', expiry: '2027-06-30', bin: 'A1-R2-S1' },
        { sku: 'BEV-WAT-02', name: 'Kinley Mineral Water 1L', received: 600, accepted: 600, damaged: 0, batch: 'BTH-BEV-99', mfgDate: '2026-02-10', expiry: '2027-06-30', bin: 'A1-R2-S1' }
      ]
    }
  ],

  // 2. LIVE PHYSICAL INVENTORY & FEFO EXPIRY TRACKING
  inventory: [
    { bin: 'CHILL-R1-A', zone: 'Chilled Cold Chain (Zone B)', sku: 'DAI-MILK-TON', name: 'Amul Taaza Toned Milk 500ml', batch: 'MILK-0905', mfgDate: '2026-09-01', onHand: 299, reserved: 45, avail: 254, expiry: '2026-09-08', daysLeft: 2, status: 'Expiring Urgent (<7d)' },
    { bin: 'CHILL-R1-B', zone: 'Chilled Cold Chain (Zone B)', sku: 'DAI-CURD-400', name: 'Amul Masti Dahi 400g Pouch', batch: 'CURD-0905', mfgDate: '2026-09-01', onHand: 199, reserved: 10, avail: 189, expiry: '2026-09-10', daysLeft: 4, status: 'Expiring Urgent (<7d)' },
    { bin: 'A1-R1-S1', zone: 'FMCG Pick Face (Zone A)', sku: 'SNK-CHIP-01', name: 'Lays Classic Salted Chips 50g', batch: 'BTH-2408-A', mfgDate: '2026-01-15', onHand: 498, reserved: 20, avail: 478, expiry: '2027-08-31', daysLeft: 359, status: 'Safe (>90d)' },
    { bin: 'A1-R1-S2', zone: 'FMCG Pick Face (Zone A)', sku: 'BIS-OR-02', name: 'Oreo Vanilla Biscuits 120g', batch: 'BTH-2408-B', mfgDate: '2026-01-15', onHand: 488, reserved: 15, avail: 473, expiry: '2027-08-31', daysLeft: 359, status: 'Safe (>90d)' },
    { bin: 'A1-R2-S1', zone: 'FMCG Pick Face (Zone A)', sku: 'BEV-JUC-03', name: 'Real Mixed Fruit Juice 1L', batch: 'BTH-2408-C', mfgDate: '2026-01-15', onHand: 489, reserved: 10, avail: 479, expiry: '2027-08-31', daysLeft: 359, status: 'Safe (>90d)' },
    { bin: 'BULK-A1-P1', zone: 'Bulk Pallet Stacking (Zone C)', sku: 'GRC-RIC-01', name: 'India Gate Basmati Rice 1kg', batch: 'BAT-RIC-26', mfgDate: '2025-12-01', onHand: 400, reserved: 0, avail: 400, expiry: '2027-12-31', daysLeft: 481, status: 'Safe (>90d)' },
    { bin: 'BULK-A1-P2', zone: 'Bulk Pallet Stacking (Zone C)', sku: 'GRC-OIL-02', name: 'Fortune Sunflower Oil 1L', batch: 'BAT-OIL-26', mfgDate: '2026-01-10', onHand: 400, reserved: 0, avail: 400, expiry: '2028-01-15', daysLeft: 496, status: 'Safe (>90d)' }
  ],

  // 3. MASTER PRODUCT CATALOG & REAL-TIME DEMAND
  products: [
    {
      sku: 'DAI-MILK-TON',
      barcode: '890126201001',
      name: 'Amul Taaza Toned Milk 500ml',
      category: 'Dairy & Cold Chain',
      uom: 'Pouch',
      bin: 'CHILL-R1-A',
      buyCost: 27.00,
      sellPrice: 29.00,
      onHand: 299,
      reserved: 45,
      available: 254,
      nearExpiryQty: 299,
      nearExpiryBatch: 'MILK-0905 (Exp: 2026-09-08 • 2d left)',
      isNearExpiry: true,
      shippedToday: 120,
      pendingDemand: 9
    },
    {
      sku: 'DAI-CURD-400',
      barcode: '890126202002',
      name: 'Amul Masti Dahi 400g Pouch',
      category: 'Dairy & Cold Chain',
      uom: 'Pouch',
      bin: 'CHILL-R1-B',
      buyCost: 35.00,
      sellPrice: 38.00,
      onHand: 199,
      reserved: 10,
      available: 189,
      nearExpiryQty: 199,
      nearExpiryBatch: 'CURD-0905 (Exp: 2026-09-10 • 4d left)',
      isNearExpiry: true,
      shippedToday: 60,
      pendingDemand: 3
    },
    {
      sku: 'SNK-CHIP-01',
      barcode: '890149901234',
      name: 'Lays Classic Salted Potato Chips 50g',
      category: 'Snacks & Munchies',
      uom: 'Packet',
      bin: 'A1-R1-S1',
      buyCost: 15.00,
      sellPrice: 20.00,
      onHand: 498,
      reserved: 20,
      available: 478,
      nearExpiryQty: 0,
      nearExpiryBatch: 'BTH-2408-A (Exp: 2027-08-31 • Safe)',
      isNearExpiry: false,
      shippedToday: 85,
      pendingDemand: 6
    },
    {
      sku: 'BIS-OR-02',
      barcode: '890149901235',
      name: 'Oreo Vanilla Creme Biscuits 120g',
      category: 'Bakery & Biscuits',
      uom: 'Pack',
      bin: 'A1-R1-S2',
      buyCost: 28.00,
      sellPrice: 35.00,
      onHand: 488,
      reserved: 15,
      available: 473,
      nearExpiryQty: 0,
      nearExpiryBatch: 'BTH-2408-B (Exp: 2027-08-31 • Safe)',
      isNearExpiry: false,
      shippedToday: 40,
      pendingDemand: 3
    },
    {
      sku: 'BEV-JUC-03',
      barcode: '890149901236',
      name: 'Real Mixed Fruit Juice 1L',
      category: 'Beverages',
      uom: 'Tetra',
      bin: 'A1-R2-S1',
      buyCost: 85.00,
      sellPrice: 110.00,
      onHand: 489,
      reserved: 10,
      available: 479,
      nearExpiryQty: 0,
      nearExpiryBatch: 'BTH-2408-C (Exp: 2027-08-31 • Safe)',
      isNearExpiry: false,
      shippedToday: 30,
      pendingDemand: 3
    },
    {
      sku: 'GRC-RIC-01',
      barcode: '890149905501',
      name: 'India Gate Basmati Rice 1kg',
      category: 'Staples & Grains',
      uom: 'Bag',
      bin: 'BULK-A1-P1',
      buyCost: 110.00,
      sellPrice: 145.00,
      onHand: 400,
      reserved: 0,
      available: 400,
      nearExpiryQty: 0,
      nearExpiryBatch: 'BAT-RIC-26 (Exp: 2027-12-31 • Safe)',
      isNearExpiry: false,
      shippedToday: 15,
      pendingDemand: 2
    },
    {
      sku: 'GRC-OIL-02',
      barcode: '890149905502',
      name: 'Fortune Sunflower Oil 1L',
      category: 'Staples & Oils',
      uom: 'Pouch',
      bin: 'BULK-A1-P2',
      buyCost: 135.00,
      sellPrice: 165.00,
      onHand: 400,
      reserved: 0,
      available: 400,
      nearExpiryQty: 0,
      nearExpiryBatch: 'BAT-OIL-26 (Exp: 2028-01-15 • Safe)',
      isNearExpiry: false,
      shippedToday: 10,
      pendingDemand: 2
    }
  ],

  // 4. LIVE ORDERS PIPELINE (Central Dark Store Fulfillment Command)
  orders: [
    {
      orderId: 'SO-202609-001',
      orderRef: 'ORD-ZEP-001',
      channel: 'Zepto DarkStore Hub',
      itemsSummary: 'Amul Milk 500ml (3), Lays 50g (2), Oreo 120g (1)',
      totalUnits: 6,
      totalValue: 215.00,
      fefoStockStatus: 'MILK-0905 (Exp: 2d left) • Priority Pick',
      hasNearExpiry: true,
      assignedPicker: 'Arjun (Shift Lead & Supervisor)',
      pickingStatus: 'Picked & Staged',
      assignedPacker: 'Kiran (Packing & Dispatch Lead)',
      deliveryPartner: 'Shadowfax Quick Fleet',
      riderName: 'Ramesh Kumar',
      riderPhone: '+91 98480 12345',
      vehicleNo: 'AP-05-AB-8891',
      deliveryStatus: 'Ready for Rider',
      priority: 'Express (10 Min SLA)',
      slaRemaining: '5 mins remaining',
      orderTime: '2026-09-06 00:10',
      items: [
        { sku: 'DAI-MILK-TON', name: 'Amul Taaza Toned Milk 500ml', qty: 3, batch: 'MILK-0905', expiry: '2026-09-08' },
        { sku: 'SNK-CHIP-01', name: 'Lays Classic Salted Chips 50g', qty: 2, batch: 'BTH-2408-A', expiry: '2027-08-31' },
        { sku: 'BIS-OR-02', name: 'Oreo Vanilla Creme Biscuits 120g', qty: 1, batch: 'BTH-2408-B', expiry: '2027-08-31' }
      ]
    },
    {
      orderId: 'SO-202609-002',
      orderRef: 'ORD-BLK-002',
      channel: 'Blinkit Instant Commerce',
      itemsSummary: 'Amul Milk 500ml (2), Amul Dahi 400g (3)',
      totalUnits: 5,
      totalValue: 172.00,
      fefoStockStatus: 'MILK-0905 (2d), CURD-0905 (4d)',
      hasNearExpiry: true,
      assignedPicker: 'Ravi (Inbound & Picking Specialist)',
      pickingStatus: 'Picked & Staged',
      assignedPacker: 'Deepak (Fulfillment Operations)',
      deliveryPartner: 'Zomato / Blinkit Fleet',
      riderName: 'Karthik Rao',
      riderPhone: '+91 99887 76655',
      vehicleNo: 'AP-05-BK-3342',
      deliveryStatus: 'Delivered',
      priority: 'Express (10 Min SLA)',
      slaRemaining: 'Delivered in 7m',
      orderTime: '2026-09-06 00:05',
      deliveryTime: '2026-09-06 00:18',
      items: [
        { sku: 'DAI-MILK-TON', name: 'Amul Taaza Toned Milk 500ml', qty: 2, batch: 'MILK-0905', expiry: '2026-09-08' },
        { sku: 'DAI-CURD-400', name: 'Amul Masti Dahi 400g Pouch', qty: 3, batch: 'CURD-0905', expiry: '2026-09-10' }
      ]
    },
    {
      orderId: 'SO-202609-003',
      orderRef: 'ORD-INS-003',
      channel: 'Swiggy Instamart Pod',
      itemsSummary: 'Real Fruit Juice 1L (2), Lays 50g (3)',
      totalUnits: 5,
      totalValue: 280.00,
      fefoStockStatus: 'BTH-2408-C, BTH-2408-A (Safe)',
      hasNearExpiry: false,
      assignedPicker: 'Ravi (Inbound & Picking Specialist)',
      pickingStatus: 'Picking In-Progress',
      assignedPacker: 'Kiran (Packing & Dispatch Lead)',
      deliveryPartner: 'Swiggy Instamart Fleet',
      riderName: 'Mohan Varma',
      riderPhone: '+91 97001 22334',
      vehicleNo: 'AP-05-SW-1109',
      deliveryStatus: 'Packing In-Progress',
      priority: 'Standard (15 Min SLA)',
      slaRemaining: '11 mins remaining',
      orderTime: '2026-09-06 00:25',
      items: [
        { sku: 'BEV-JUC-03', name: 'Real Mixed Fruit Juice 1L', qty: 2, batch: 'BTH-2408-C', expiry: '2027-08-31' },
        { sku: 'SNK-CHIP-01', name: 'Lays Classic Salted Chips 50g', qty: 3, batch: 'BTH-2408-A', expiry: '2027-08-31' }
      ]
    },
    {
      orderId: 'SO-202609-004',
      orderRef: 'ORD-DNZ-004',
      channel: 'Dunzo Merchant Fleet',
      itemsSummary: 'India Gate Rice 1kg (1), Fortune Oil 1L (1)',
      totalUnits: 2,
      totalValue: 310.00,
      fefoStockStatus: 'BAT-RIC-26, BAT-OIL-26 (Safe)',
      hasNearExpiry: false,
      assignedPicker: 'Priya (QC & Inventory Associate)',
      pickingStatus: 'Queued',
      assignedPacker: 'Suresh (Dock Worker & Loader)',
      deliveryPartner: 'Dunzo Merchant Fleet',
      riderName: 'Assigning Rider...',
      riderPhone: '—',
      vehicleNo: '—',
      deliveryStatus: 'Pending Pick',
      priority: 'Standard (15 Min SLA)',
      slaRemaining: '14 mins remaining',
      orderTime: '2026-09-06 00:32',
      items: [
        { sku: 'GRC-RIC-01', name: 'India Gate Basmati Rice 1kg', qty: 1, batch: 'BAT-RIC-26', expiry: '2027-12-31' },
        { sku: 'GRC-OIL-02', name: 'Fortune Sunflower Oil 1L', qty: 1, batch: 'BAT-OIL-26', expiry: '2028-01-15' }
      ]
    },
    {
      orderId: 'SO-202609-005',
      orderRef: 'ORD-DIR-005',
      channel: 'Direct Consumer Quick App',
      itemsSummary: 'Amul Milk 500ml (4), Real Fruit Juice 1L (1)',
      totalUnits: 5,
      totalValue: 226.00,
      fefoStockStatus: 'MILK-0905 (Exp: 2d left) • Priority Pick',
      hasNearExpiry: true,
      assignedPicker: 'Arjun (Shift Lead & Supervisor)',
      pickingStatus: 'Queued',
      assignedPacker: 'Deepak (Fulfillment Operations)',
      deliveryPartner: 'Internal DarkStore Rapid Fleet',
      riderName: 'Naveen Reddy',
      riderPhone: '+91 94401 55667',
      vehicleNo: 'AP-05-EV-0012',
      deliveryStatus: 'Pending Pick',
      priority: 'Express (10 Min SLA)',
      slaRemaining: '9 mins remaining',
      orderTime: '2026-09-06 00:38',
      items: [
        { sku: 'DAI-MILK-TON', name: 'Amul Taaza Toned Milk 500ml', qty: 4, batch: 'MILK-0905', expiry: '2026-09-08' },
        { sku: 'BEV-JUC-03', name: 'Real Mixed Fruit Juice 1L', qty: 1, batch: 'BTH-2408-C', expiry: '2027-08-31' }
      ]
    }
  ],

  // 5. PICK WAVES & S-SHAPE ROUTING DATASET
  pickWaves: [
    {
      waveId: 'WAV-0906-01',
      ordersCount: 2,
      orderIds: ['SO-202609-001', 'SO-202609-002'],
      skusCount: 4,
      totalUnits: 11,
      assignedPicker: 'Arjun (Shift Lead & Supervisor)',
      status: 'Completed',
      estTime: '4 mins',
      pickPath: 'CHILL-R1-A -> CHILL-R1-B -> A1-R1-S1 -> A1-R1-S2'
    },
    {
      waveId: 'WAV-0906-02',
      ordersCount: 1,
      orderIds: ['SO-202609-003'],
      skusCount: 2,
      totalUnits: 5,
      assignedPicker: 'Ravi (Inbound & Picking Specialist)',
      status: 'In-Progress',
      estTime: '3 mins',
      pickPath: 'A1-R1-S1 -> A1-R2-S1'
    },
    {
      waveId: 'WAV-0906-03',
      ordersCount: 2,
      orderIds: ['SO-202609-004', 'SO-202609-005'],
      skusCount: 3,
      totalUnits: 7,
      assignedPicker: 'Priya (QC & Inventory Associate)',
      status: 'Pending',
      estTime: '5 mins',
      pickPath: 'CHILL-R1-A -> BULK-A1-P1 -> BULK-A1-P2'
    }
  ],

  // 6. PACKING & DISPATCH PACKAGES DATASET
  dispatches: [
    {
      dispatchId: 'DSP-202609-001',
      orderId: 'SO-202609-001',
      destination: 'Danavaipeta Sector 4',
      assignedPacker: 'Kiran (Packing & Dispatch Lead)',
      packageType: 'Thermal Cold Chain Bag',
      packWeightKg: '2.1 kg',
      sealBarcode: 'SEAL-889102',
      partner: 'Shadowfax Quick Fleet',
      riderName: 'Ramesh Kumar',
      riderPhone: '+91 98480 12345',
      vehicleNo: 'AP-05-AB-8891',
      status: 'Ready for Rider',
      time: '00:22 AM'
    },
    {
      dispatchId: 'DSP-202609-002',
      orderId: 'SO-202609-002',
      destination: 'Kotipalli Bus Stand Road',
      assignedPacker: 'Deepak (Fulfillment Operations)',
      packageType: 'Thermal Cold Chain Bag',
      packWeightKg: '1.8 kg',
      sealBarcode: 'SEAL-334291',
      partner: 'Zomato / Blinkit Fleet',
      riderName: 'Karthik Rao',
      riderPhone: '+91 99887 76655',
      vehicleNo: 'AP-05-BK-3342',
      status: 'Delivered',
      time: '00:18 AM'
    },
    {
      dispatchId: 'DSP-202609-003',
      orderId: 'SO-202609-003',
      destination: 'T Nagar Main Road',
      assignedPacker: 'Kiran (Packing & Dispatch Lead)',
      packageType: 'Standard Heavy Corrugated Box',
      packWeightKg: '3.4 kg',
      sealBarcode: 'SEAL-110945',
      partner: 'Swiggy Instamart Fleet',
      riderName: 'Mohan Varma',
      riderPhone: '+91 97001 22334',
      vehicleNo: 'AP-05-SW-1109',
      status: 'Packing In-Progress',
      time: '00:28 AM'
    }
  ],

  // 7. STORAGE ZONES & BINS (Practical dark store layout metrics)
  locations: [
    { bin: 'CHILL-R1-A', zone: 'Chilled Cold Chain (Zone B)', aisle: 'Cold-01', rack: 'R1', shelf: 'A', binType: 'Chilled Shelving (2°C-4°C)', capacity: 400, stored: 299, freeSpace: 101, storedItems: 'Amul Taaza Milk 500ml', tempClass: 'Chilled' },
    { bin: 'CHILL-R1-B', zone: 'Chilled Cold Chain (Zone B)', aisle: 'Cold-01', rack: 'R1', shelf: 'B', binType: 'Chilled Shelving (2°C-4°C)', capacity: 300, stored: 199, freeSpace: 101, storedItems: 'Amul Masti Dahi 400g', tempClass: 'Chilled' },
    { bin: 'A1-R1-S1', zone: 'FMCG Pick Face (Zone A)', aisle: 'Aisle-A', rack: 'R1', shelf: 'S1', binType: 'High-Density Gravity Flow Bin', capacity: 600, stored: 498, freeSpace: 102, storedItems: 'Lays Chips 50g', tempClass: 'Ambient' },
    { bin: 'A1-R1-S2', zone: 'FMCG Pick Face (Zone A)', aisle: 'Aisle-A', rack: 'R1', shelf: 'S2', binType: 'High-Density Gravity Flow Bin', capacity: 600, stored: 488, freeSpace: 112, storedItems: 'Oreo Biscuits 120g', tempClass: 'Ambient' },
    { bin: 'A1-R2-S1', zone: 'FMCG Pick Face (Zone A)', aisle: 'Aisle-A', rack: 'R2', shelf: 'S1', binType: 'High-Density Gravity Flow Bin', capacity: 600, stored: 489, freeSpace: 111, storedItems: 'Real Fruit Juice 1L, Coke 330ml', tempClass: 'Ambient' },
    { bin: 'BULK-A1-P1', zone: 'Bulk Pallet Stacking (Zone C)', aisle: 'Pallet-01', rack: 'P1', shelf: 'Floor', binType: 'Heavy Duty Pallet Bay', capacity: 1000, stored: 400, freeSpace: 600, storedItems: 'India Gate Basmati Rice 1kg', tempClass: 'Ambient' },
    { bin: 'BULK-A1-P2', zone: 'Bulk Pallet Stacking (Zone C)', aisle: 'Pallet-01', rack: 'P2', shelf: 'Floor', binType: 'Heavy Duty Pallet Bay', capacity: 1000, stored: 400, freeSpace: 600, storedItems: 'Fortune Sunflower Oil 1L', tempClass: 'Ambient' }
  ],

  // 8. STOCK MOVEMENT HISTORY (Clean operational log)
  ledger: [
    { id: 'MOV-0906-001', time: '2026-09-06 00:02', type: 'INWARD_RECEIPT', sku: 'DAI-MILK-TON', batch: 'MILK-0905', fromBin: 'DOCK-INBOUND', toBin: 'CHILL-R1-A', qty: '+300', employee: 'Ravi', ref: 'INB-00125' },
    { id: 'MOV-0906-002', time: '2026-09-06 00:03', type: 'INWARD_RECEIPT', sku: 'DAI-CURD-400', batch: 'CURD-0905', fromBin: 'DOCK-INBOUND', toBin: 'CHILL-R1-B', qty: '+200', employee: 'Ravi', ref: 'INB-00125' },
    { id: 'MOV-0906-003', time: '2026-09-06 00:08', type: 'ORDER_RESERVE', sku: 'DAI-MILK-TON', batch: 'MILK-0905', fromBin: 'CHILL-R1-A', toBin: 'RESERVED_OPEN', qty: '3', employee: 'Auto-FEFO', ref: 'SO-202609-001' },
    { id: 'MOV-0906-004', time: '2026-09-06 00:12', type: 'PICK_DISPATCH', sku: 'DAI-MILK-TON', batch: 'MILK-0905', fromBin: 'CHILL-R1-A', toBin: 'PACK_STATION_1', qty: '3', employee: 'Arjun', ref: 'WAV-0906-01' },
    { id: 'MOV-0906-005', time: '2026-09-06 00:18', type: 'DISPATCH_DELIVERED', sku: 'DAI-CURD-400', batch: 'CURD-0905', fromBin: 'PACK_STATION_1', toBin: 'CUSTOMER_DELIVERED', qty: '-3', employee: 'Karthik Rao (Rider)', ref: 'SO-202609-002' }
  ],

  // 9. WORKER FLOOR SHIFTS & ASSIGNMENTS
  shifts: [
    { empId: 'EMP-0101', name: 'Arjun', role: 'Shift Lead & Supervisor', station: 'FMCG Zone A / Wave Dispatch', activeTask: 'Picking Wave WAV-0906-01', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 42, accuracy: '99.8%' },
    { empId: 'EMP-0102', name: 'Ravi', role: 'Inbound & Picking Specialist', station: 'Zone B Chilled Cold Chain', activeTask: 'Picking Wave WAV-0906-02', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 38, accuracy: '100%' },
    { empId: 'EMP-0103', name: 'Priya', role: 'QC & Putaway Associate', station: 'Inbound Dock 1', activeTask: 'QC Verification INB-00127', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 19, accuracy: '100%' },
    { empId: 'EMP-0104', name: 'Kiran', role: 'Packing & Dispatch Lead', station: 'Packing Station 1', activeTask: 'Packing Order SO-202609-003', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 56, accuracy: '100%' },
    { empId: 'EMP-0105', name: 'Deepak', role: 'Fulfillment Operations', station: 'Packing Station 2', activeTask: 'Handing Over DSP-202609-001', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 51, accuracy: '99.5%' },
    { empId: 'EMP-0106', name: 'Suresh', role: 'Dock Worker & Loader', station: 'Quarantine & Pallet Bay', activeTask: 'Putaway Inbound Consignments', shift: 'Morning Shift (06:00 - 14:00)', completedPicks: 24, accuracy: '100%' }
  ]
};

// ==========================================================================
// BOOTSTRAP & ROUTING
// ==========================================================================
function initApp() {
  const hash = window.location.hash ? window.location.hash.slice(1) : '';
  const validViews = [
    'orders-pipeline',
    'pick-waves',
    'packing-station',
    'inbound',
    'current-stock',
    'warehouse-locations',
    'product-master',
    'stock-ledger',
    'floor-shifts'
  ];

  if (validViews.includes(hash)) {
    state.activeView = hash;
  } else {
    state.activeView = 'inbound';
  }

  renderSidebar();
  renderActiveView();
}

document.addEventListener('DOMContentLoaded', initApp);
window.addEventListener('hashchange', initApp);
window.addEventListener('popstate', initApp);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initApp();
}

function navigateTo(viewName, e) {
  if (e) {
    e.preventDefault();
  }
  state.activeView = viewName;
  state.searchTerm = '';
  if (window.location.hash !== '#' + viewName) {
    history.pushState(null, null, '#' + viewName);
  }
  renderSidebar();
  renderActiveView();
}

function renderSidebar() {
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const view = link.getAttribute('data-view');
    if (view === state.activeView) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

function renderActiveView() {
  const contentArea = document.getElementById('content-area');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');
  const topbarBtn = document.getElementById('topbar-add-btn');

  // Dynamic Topbar Add Action
  if (topbarBtn) {
    if (state.activeView === 'orders-pipeline') {
      topbarBtn.innerHTML = '<span>+ New Sales Order</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'inbound') {
      topbarBtn.innerHTML = '<span>+ Add Inbound</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'current-stock') {
      topbarBtn.innerHTML = '<span>+ Transfer Stock</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'warehouse-locations') {
      topbarBtn.innerHTML = '<span>+ Add Storage Bin</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'product-master') {
      topbarBtn.innerHTML = '<span>+ Add New Product</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'pick-waves') {
      topbarBtn.innerHTML = '<span>+ Create Pick Wave</span>';
      topbarBtn.style.display = 'inline-flex';
    } else if (state.activeView === 'packing-station') {
      topbarBtn.innerHTML = '<span>+ Create Dispatch</span>';
      topbarBtn.style.display = 'inline-flex';
    } else {
      topbarBtn.style.display = 'none';
    }
  }

  switch (state.activeView) {
    case 'orders-pipeline':
      pageTitle.innerText = 'Live Orders & Fulfillment Pipeline';
      pageSubtitle.innerText = 'Real-time order intake, FEFO batch allocations, assigned pickers/shippers, and delivery tracking';
      contentArea.innerHTML = renderOrdersPipelineView();
      break;

    case 'pick-waves':
      pageTitle.innerText = 'Pick Waves & S-Shape Routing';
      pageSubtitle.innerText = 'Batch picking waves, shortest walking path through dark store bins, and assigned pickers';
      contentArea.innerHTML = renderPickWavesView();
      break;

    case 'packing-station':
      pageTitle.innerText = 'Packing Station & Dispatch Fleet';
      pageSubtitle.innerText = 'Carton bagging, QC seal validation, rider handover, and live delivery status';
      contentArea.innerHTML = renderPackingDispatchView();
      break;

    case 'inbound':
      pageTitle.innerText = 'Inbound Consignments & Receiving';
      pageSubtitle.innerText = 'Supplier consignments, QC inspections, accepted vs damaged counts, and putaway bin allocations';
      contentArea.innerHTML = renderInboundTableView();
      break;

    case 'current-stock':
      pageTitle.innerText = 'Bin Stock & FEFO Expiry Intelligence (RJY-DS-001)';
      pageSubtitle.innerText = 'Live bin inventory with First-Expiry-First-Out (FEFO) near-expiry alerts and stock movements';
      contentArea.innerHTML = renderStockView();
      break;

    case 'warehouse-locations':
      pageTitle.innerText = 'Storage Zones & Bins Layout';
      pageSubtitle.innerText = 'Dark store storage zones, temperature classifications, stored units, and free bin space';
      contentArea.innerHTML = renderWarehouseLocationsView();
      break;

    case 'product-master':
      pageTitle.innerText = 'Master Product Catalog & Demand';
      pageSubtitle.innerText = 'Physical stock on hand, reserved in open orders, net available to sell, near-expiry alerts, and shipped counts';
      contentArea.innerHTML = renderProductsView();
      break;

    case 'stock-ledger':
      pageTitle.innerText = 'Stock Movement History';
      pageSubtitle.innerText = 'Complete operational log of inward receipts, order reservations, picks, dispatches, and transfers';
      contentArea.innerHTML = renderStockLedgerView();
      break;

    case 'floor-shifts':
      pageTitle.innerText = 'Worker Floor Shifts & Task Assignments';
      pageSubtitle.innerText = 'Active dark store workforce, designated zones, active picking/packing tasks, and shift performance';
      contentArea.innerHTML = renderFloorShiftsView();
      break;

    default:
      navigateTo('orders-pipeline');
  }
}

function handleTopBarAction() {
  if (state.activeView === 'orders-pipeline') {
    openAddOrderModal();
  } else if (state.activeView === 'inbound') {
    openAddInboundModal();
  } else if (state.activeView === 'current-stock') {
    openTransferStockModal();
  } else if (state.activeView === 'warehouse-locations') {
    openAddLocationModal();
  } else if (state.activeView === 'product-master') {
    openAddProductModal();
  } else if (state.activeView === 'pick-waves') {
    openCreatePickWaveModal();
  } else if (state.activeView === 'packing-station') {
    openCreateDispatchModal();
  }
}

// ==========================================================================
// 1. LIVE ORDERS PIPELINE VIEW
// ==========================================================================
function renderOrdersPipelineView() {
  const totalOrders = state.orders.length;
  const shippedInTransit = state.orders.filter(o => o.deliveryStatus === 'Ready for Rider' || o.deliveryStatus === 'Out for Delivery' || o.deliveryStatus === 'In-Transit').length;
  const leftToPack = state.orders.filter(o => o.deliveryStatus === 'Pending Pick' || o.deliveryStatus === 'Packing In-Progress' || o.deliveryStatus === 'Queued' || o.deliveryStatus === 'Ready for Packing').length;
  const delivered = state.orders.filter(o => o.deliveryStatus === 'Delivered').length;

  return `
    <div class="table-view-container">
      <!-- 4-Card Executive Operational Strip -->
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Total Orders Received</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${totalOrders}</div>
          <div class="stat-box-sub">Active DarkStore Pipeline</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Shipped / In-Transit</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">${shippedInTransit}</div>
          <div class="stat-box-sub">Handed over to delivery fleet</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Left to Pack & Ship</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${leftToPack}</div>
          <div class="stat-box-sub">Pending picker & packer action</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Delivered to Customer</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${delivered}</div>
          <div class="stat-box-sub">Completed fulfillment</div>
        </div>
      </div>

      <!-- Action & Search Strip -->
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Live Orders Fulfillment Queue</span>
          <span class="badge-count" id="orders-count">${state.orders.length} orders</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="orders-search" placeholder="Search order ID, channel, item, picker, shipper..." oninput="handleOrdersSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openAddOrderModal()">+ New Sales Order</button>
        </div>
      </div>

      <!-- 13-Column Operational Table -->
      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Channel / App</th>
              <th>Items & Qty</th>
              <th>FEFO Stock Allocation</th>
              <th style="text-align:right;">Value</th>
              <th>Assigned Picker</th>
              <th>Picking Status</th>
              <th>Assigned Shipper</th>
              <th>Courier / Rider</th>
              <th>Delivery Status</th>
              <th>SLA Timer</th>
              <th style="text-align:center;">Action Workflow</th>
            </tr>
          </thead>
          <tbody id="orders-tbody">
            ${renderOrdersRows(state.orders)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderOrdersRows(ordersList) {
  if (!ordersList.length) {
    return `<tr><td colspan="12" style="text-align:center; padding: 24px; color: var(--text-muted);">No orders match search query.</td></tr>`;
  }

  return ordersList.map(o => {
    let pickPillClass = 'tag-queued';
    if (o.pickingStatus === 'Picking In-Progress') pickPillClass = 'tag-picking';
    if (o.pickingStatus === 'Picked & Staged') pickPillClass = 'tag-safe';

    let delPillClass = 'tag-queued';
    if (o.deliveryStatus === 'Packing In-Progress') delPillClass = 'tag-packing';
    if (o.deliveryStatus === 'Ready for Rider' || o.deliveryStatus === 'Ready to Ship') delPillClass = 'tag-shipped';
    if (o.deliveryStatus === 'Out for Delivery' || o.deliveryStatus === 'In-Transit') delPillClass = 'tag-expiring';
    if (o.deliveryStatus === 'Delivered') delPillClass = 'tag-delivered';

    let actionButton = '';
    if (o.pickingStatus === 'Queued') {
      actionButton = `<button class="btn-row-action" onclick="advanceOrderStage('${o.orderId}', 'START_PICK')">Start Pick</button>`;
    } else if (o.pickingStatus === 'Picking In-Progress') {
      actionButton = `<button class="btn-row-action" onclick="advanceOrderStage('${o.orderId}', 'FINISH_PICK')">Finish Pick</button>`;
    } else if (o.deliveryStatus === 'Ready for Packing' || o.deliveryStatus === 'Packing In-Progress') {
      actionButton = `<button class="btn-row-action" onclick="advanceOrderStage('${o.orderId}', 'PACK_ORDER')">Pack Order</button>`;
    } else if (o.deliveryStatus === 'Ready for Rider' || o.deliveryStatus === 'Ready to Ship') {
      actionButton = `<button class="btn-row-action" onclick="advanceOrderStage('${o.orderId}', 'HANDOVER_RIDER')">Handover</button>`;
    } else if (o.deliveryStatus === 'Out for Delivery' || o.deliveryStatus === 'In-Transit') {
      actionButton = `<button class="btn-row-action" style="background: #2b7a4b; color: #fff;" onclick="advanceOrderStage('${o.orderId}', 'MARK_DELIVERED')">Deliver</button>`;
    } else {
      actionButton = `<span style="font-size:11px; font-weight:700; color: #2b7a4b;">✓ Completed</span>`;
    }

    return `
      <tr>
        <td><strong>${o.orderId}</strong><br><span style="font-size:10.5px; color:var(--text-muted);">${o.orderRef}</span></td>
        <td><strong>${o.channel}</strong><br><span style="font-size:10.5px; color:var(--text-muted);">${o.orderTime}</span></td>
        <td>
          <div style="font-weight:600;">${o.itemsSummary}</div>
          <span style="font-size:11px; color:var(--color-steel-blue); font-weight:700;">Total: ${o.totalUnits} units</span>
        </td>
        <td>
          <span class="status-tag ${o.hasNearExpiry ? 'tag-urgent' : 'tag-safe'}">
            ${o.hasNearExpiry ? '⚡ FEFO: ' : '✓ '}${o.fefoStockStatus}
          </span>
        </td>
        <td style="text-align:right; font-weight:800; color:var(--color-espresso);">₹${(o.totalValue || 0).toFixed(2)}</td>
        <td>
          <strong>${o.assignedPicker.split(' ')[0]}</strong><br>
          <span style="font-size:10px; color:var(--text-muted);">${o.assignedPicker.includes('Lead') ? 'Lead' : 'Associate'}</span>
        </td>
        <td><span class="status-tag ${pickPillClass}">${o.pickingStatus}</span></td>
        <td>
          <strong>${o.assignedPacker ? o.assignedPacker.split(' ')[0] : 'Unassigned'}</strong><br>
          <span style="font-size:10px; color:var(--text-muted);">Station 1</span>
        </td>
        <td>
          <strong>${o.deliveryPartner.split(' ')[0]}</strong><br>
          <span style="font-size:10.5px; color:var(--text-muted);">${o.riderName} (${o.vehicleNo})</span>
        </td>
        <td><span class="status-tag ${delPillClass}">${o.deliveryStatus}</span></td>
        <td style="font-weight:700; color:${o.deliveryStatus === 'Delivered' ? '#2b7a4b' : 'var(--color-rust-red)'}; font-size:11.5px;">
          ${o.slaRemaining}
        </td>
        <td style="text-align:center;">
          <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
            ${actionButton}
            <button class="btn-row-action" style="background:var(--bg-app); color:var(--color-espresso);" onclick="viewOrderManifest('${o.orderId}')">View</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function handleOrdersSearch(val) {
  state.searchTerm = val.toLowerCase();
  const filtered = state.orders.filter(o =>
    o.orderId.toLowerCase().includes(state.searchTerm) ||
    o.orderRef.toLowerCase().includes(state.searchTerm) ||
    o.channel.toLowerCase().includes(state.searchTerm) ||
    o.itemsSummary.toLowerCase().includes(state.searchTerm) ||
    o.assignedPicker.toLowerCase().includes(state.searchTerm) ||
    (o.assignedPacker && o.assignedPacker.toLowerCase().includes(state.searchTerm)) ||
    o.deliveryPartner.toLowerCase().includes(state.searchTerm) ||
    o.riderName.toLowerCase().includes(state.searchTerm)
  );
  const tbody = document.getElementById('orders-tbody');
  const countBadge = document.getElementById('orders-count');
  if (tbody) tbody.innerHTML = renderOrdersRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} orders`;
}

// Stage Progression Engine
function advanceOrderStage(orderId, action) {
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  if (action === 'START_PICK') {
    order.pickingStatus = 'Picking In-Progress';
    order.deliveryStatus = 'Packing In-Progress';
  } else if (action === 'FINISH_PICK') {
    order.pickingStatus = 'Picked & Staged';
    order.deliveryStatus = 'Ready for Packing';
    // Link or update dispatch record
    const dsp = state.dispatches.find(d => d.orderId === orderId);
    if (!dsp) {
      state.dispatches.unshift({
        dispatchId: `DSP-202609-00${state.dispatches.length + 1}`,
        orderId: order.orderId,
        destination: 'Sector Rapid Delivery',
        assignedPacker: order.assignedPacker || 'Kiran (Packing & Dispatch Lead)',
        packageType: order.hasNearExpiry ? 'Thermal Cold Chain Bag' : 'Standard Corrugated Box',
        packWeightKg: `${(order.totalUnits * 0.45).toFixed(1)} kg`,
        sealBarcode: `SEAL-${Math.floor(100000 + Math.random() * 900000)}`,
        partner: order.deliveryPartner,
        riderName: order.riderName,
        riderPhone: order.riderPhone,
        vehicleNo: order.vehicleNo,
        status: 'Packing In-Progress',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  } else if (action === 'PACK_ORDER') {
    order.deliveryStatus = 'Ready for Rider';
    const dsp = state.dispatches.find(d => d.orderId === orderId);
    if (dsp) dsp.status = 'Ready for Rider';
  } else if (action === 'HANDOVER_RIDER') {
    order.deliveryStatus = 'Out for Delivery';
    const dsp = state.dispatches.find(d => d.orderId === orderId);
    if (dsp) dsp.status = 'In-Transit';
  } else if (action === 'MARK_DELIVERED') {
    order.deliveryStatus = 'Delivered';
    order.slaRemaining = 'Delivered ✓';
    order.deliveryTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const dsp = state.dispatches.find(d => d.orderId === orderId);
    if (dsp) dsp.status = 'Delivered';

    // Officially deduct reserved units and increment shipped counts in master catalog & inventory
    order.items.forEach(it => {
      const prod = state.products.find(p => p.sku === it.sku);
      if (prod) {
        prod.reserved = Math.max(0, prod.reserved - it.qty);
        prod.onHand = Math.max(0, prod.onHand - it.qty);
        prod.shippedToday += it.qty;
      }
      const inv = state.inventory.find(i => i.sku === it.sku && i.batch === it.batch);
      if (inv) {
        inv.reserved = Math.max(0, inv.reserved - it.qty);
        inv.onHand = Math.max(0, inv.onHand - it.qty);
      }
      // Record in Stock Movement History
      state.ledger.unshift({
        id: `MOV-0906-00${state.ledger.length + 1}`,
        time: new Date().toISOString().slice(0, 16).replace('T', ' '),
        type: 'DISPATCH_DELIVERED',
        sku: it.sku,
        batch: it.batch,
        fromBin: 'PACK_STATION',
        toBin: 'CUSTOMER_DELIVERED',
        qty: `-${it.qty}`,
        employee: order.riderName,
        ref: order.orderId
      });
    });
  }

  renderActiveView();
}

function viewOrderManifest(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;

  const itemsHtml = o.items.map(it => `
    <tr>
      <td><strong>${it.sku}</strong></td>
      <td>${it.name}</td>
      <td><span class="status-tag tag-urgent">${it.batch}</span></td>
      <td>${it.expiry}</td>
      <td style="text-align:right; font-weight:800;">${it.qty}</td>
    </tr>
  `).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Order Manifest & Dispatch Slip (${o.orderId})</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px; background:var(--bg-surface); padding:10px; border-radius:4px; border:1px solid var(--border-grid);">
            <div><strong>Channel:</strong> ${o.channel}</div>
            <div><strong>Order Ref:</strong> ${o.orderRef}</div>
            <div><strong>Assigned Picker:</strong> ${o.assignedPicker}</div>
            <div><strong>Assigned Packer:</strong> ${o.assignedPacker || 'Kiran'}</div>
            <div><strong>Delivery Fleet:</strong> ${o.deliveryPartner}</div>
            <div><strong>Rider:</strong> ${o.riderName} (${o.vehicleNo})</div>
            <div><strong>Status:</strong> ${o.deliveryStatus}</div>
            <div><strong>SLA Target:</strong> ${o.priority}</div>
          </div>

          <h4 style="margin-bottom:8px; font-size:12px; font-weight:800;">Allocated Items & FEFO Batches:</h4>
          <table class="wms-table" style="margin-bottom:12px;">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item Name</th>
                <th>Batch Code</th>
                <th>Expiry</th>
                <th style="text-align:right;">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn-sm btn-sm-excel" onclick="alert('Printing Quick Commerce Shipping Slip for ${o.orderId}'); closeModal();">Print Shipping Slip</button>
          <button class="btn-sm" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

// + New Sales Order Modal with dynamic FEFO Batch Allocation
function openAddOrderModal() {
  const prodOptions = state.products.map(p => `
    <option value="${p.sku}">${p.name} (Available: ${p.available} ${p.uom} • ${p.isNearExpiry ? '⚡ Near-Expiry FEFO Batch' : 'Safe'})</option>
  `).join('');

  const pickerOptions = state.employees.map(e => `<option value="${e}">${e}</option>`).join('');
  const shipperOptions = state.employees.map(e => `<option value="${e}">${e}</option>`).join('');
  const partnerOptions = state.partners.map(p => `<option value="${p}">${p}</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create New Quick Commerce Sales Order</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form id="new-order-form" onsubmit="handleCreateSalesOrder(event)">
          <div class="modal-body">
            <div class="form-group">
              <label>Order Channel / Platform *</label>
              <select class="form-input" id="new-ord-channel" required>
                <option value="Zepto DarkStore Hub">Zepto DarkStore Hub</option>
                <option value="Blinkit Instant Commerce">Blinkit Instant Commerce</option>
                <option value="Swiggy Instamart Pod">Swiggy Instamart Pod</option>
                <option value="Dunzo Merchant Fleet">Dunzo Merchant Fleet</option>
                <option value="Direct Consumer Quick App">Direct Consumer Quick App</option>
              </select>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Select Product *</label>
                <select class="form-input" id="new-ord-sku" required>
                  ${prodOptions}
                </select>
              </div>
              <div class="form-group">
                <label>Order Quantity *</label>
                <input type="number" class="form-input" id="new-ord-qty" min="1" max="100" value="2" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Assign Picker *</label>
                <select class="form-input" id="new-ord-picker" required>
                  ${pickerOptions}
                </select>
              </div>
              <div class="form-group">
                <label>Assign Packer / Shipper *</label>
                <select class="form-input" id="new-ord-shipper" required>
                  ${shipperOptions}
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Delivery Fleet Partner *</label>
                <select class="form-input" id="new-ord-partner" required>
                  ${partnerOptions}
                </select>
              </div>
              <div class="form-group">
                <label>Delivery SLA Priority *</label>
                <select class="form-input" id="new-ord-priority" required>
                  <option value="Express (10 Min SLA)">Express (10 Min SLA)</option>
                  <option value="Standard (15 Min SLA)">Standard (15 Min SLA)</option>
                  <option value="Scheduled (30 Min)">Scheduled (30 Min)</option>
                </select>
              </div>
            </div>

            <div style="background: rgba(40,90,115,0.08); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-grid); font-size: 11.5px; color: var(--color-espresso);">
              <strong>ℹ️ Automated FEFO Engine:</strong> Stock will be automatically reserved from the earliest expiring batch stored in dark store bins.
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Place Order & Reserve FEFO Stock</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleCreateSalesOrder(e) {
  e.preventDefault();
  const channel = document.getElementById('new-ord-channel').value;
  const sku = document.getElementById('new-ord-sku').value;
  const qty = parseInt(document.getElementById('new-ord-qty').value, 10);
  const picker = document.getElementById('new-ord-picker').value;
  const shipper = document.getElementById('new-ord-shipper').value;
  const partner = document.getElementById('new-ord-partner').value;
  const priority = document.getElementById('new-ord-priority').value;

  const prod = state.products.find(p => p.sku === sku);
  if (!prod || prod.available < qty) {
    alert(`Insufficient available stock for ${sku}. Available: ${prod ? prod.available : 0}`);
    return;
  }

  // Find earliest expiring batch for this SKU in inventory
  const invBatches = state.inventory.filter(i => i.sku === sku && i.avail >= qty).sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  const chosenBatch = invBatches.length > 0 ? invBatches[0] : (state.inventory.find(i => i.sku === sku) || { batch: 'BTH-AUTO', expiry: '2027-12-31' });

  // Reserve stock
  prod.reserved += qty;
  prod.available = Math.max(0, prod.onHand - prod.reserved);
  prod.pendingDemand += qty;

  const invRecord = state.inventory.find(i => i.sku === sku && i.batch === chosenBatch.batch);
  if (invRecord) {
    invRecord.reserved += qty;
    invRecord.avail = Math.max(0, invRecord.onHand - invRecord.reserved);
  }

  const orderNum = state.orders.length + 1;
  const orderId = `SO-202609-00${orderNum}`;
  const orderRef = `ORD-${channel.slice(0, 3).toUpperCase()}-00${orderNum}`;
  const totalVal = (prod.sellPrice || 30) * qty;

  const isNearExp = chosenBatch.daysLeft ? chosenBatch.daysLeft < 30 : prod.isNearExpiry;

  const newOrder = {
    orderId,
    orderRef,
    channel,
    itemsSummary: `${prod.name} (${qty})`,
    totalUnits: qty,
    totalValue: totalVal,
    fefoStockStatus: `${chosenBatch.batch} (${chosenBatch.expiry})`,
    hasNearExpiry: isNearExp,
    assignedPicker: picker,
    pickingStatus: 'Queued',
    assignedPacker: shipper,
    deliveryPartner: partner,
    riderName: 'Assigning Rapid Rider...',
    riderPhone: '—',
    vehicleNo: '—',
    deliveryStatus: 'Pending Pick',
    priority,
    slaRemaining: '10 mins remaining',
    orderTime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    items: [
      { sku: prod.sku, name: prod.name, qty: qty, batch: chosenBatch.batch, expiry: chosenBatch.expiry }
    ]
  };

  state.orders.unshift(newOrder);

  // Record reservation in Stock Movement History
  state.ledger.unshift({
    id: `MOV-0906-00${state.ledger.length + 1}`,
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    type: 'ORDER_RESERVE',
    sku: prod.sku,
    batch: chosenBatch.batch,
    fromBin: invRecord ? invRecord.bin : 'BIN-STORAGE',
    toBin: 'RESERVED_OPEN',
    qty: `${qty}`,
    employee: picker.split(' ')[0],
    ref: orderId
  });

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 2. PICK WAVES & ROUTING VIEW
// ==========================================================================
function renderPickWavesView() {
  const pendingWaves = state.pickWaves.filter(w => w.status === 'Pending').length;
  const inProgWaves = state.pickWaves.filter(w => w.status === 'In-Progress').length;
  const compWaves = state.pickWaves.filter(w => w.status === 'Completed').length;

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Total Pick Waves</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${state.pickWaves.length}</div>
          <div class="stat-box-sub">Optimized dark store paths</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Waves In-Progress</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">${inProgWaves}</div>
          <div class="stat-box-sub">Active picker walk paths</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Pending Waves</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${pendingWaves}</div>
          <div class="stat-box-sub">Waiting for picker assignment</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Completed Today</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${compWaves}</div>
          <div class="stat-box-sub">Staged at packing tables</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Pick Waves & S-Shape Routing</span>
          <span class="badge-count" id="waves-count">${state.pickWaves.length} waves</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="waves-search" placeholder="Search wave ID, picker, path..." oninput="handleWavesSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openCreatePickWaveModal()">+ Create Pick Wave</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Wave ID</th>
              <th>Orders Count</th>
              <th>Order IDs</th>
              <th>Total SKUs</th>
              <th>Total Units</th>
              <th>Assigned Picker</th>
              <th>S-Shape Bin Pick Path</th>
              <th>Est Time</th>
              <th>Status</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="waves-tbody">
            ${renderWavesRows(state.pickWaves)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderWavesRows(wavesList) {
  if (!wavesList.length) {
    return `<tr><td colspan="10" style="text-align:center; padding: 24px; color: var(--text-muted);">No pick waves found.</td></tr>`;
  }

  return wavesList.map(w => {
    let statusPill = 'tag-queued';
    if (w.status === 'In-Progress') statusPill = 'tag-picking';
    if (w.status === 'Completed') statusPill = 'tag-safe';

    let actionBtn = '';
    if (w.status === 'Pending') {
      actionBtn = `<button class="btn-row-action" onclick="advancePickWave('${w.waveId}', 'START')">Start Wave</button>`;
    } else if (w.status === 'In-Progress') {
      actionBtn = `<button class="btn-row-action" style="background:#2b7a4b; color:#fff;" onclick="advancePickWave('${w.waveId}', 'COMPLETE')">Complete Wave</button>`;
    } else {
      actionBtn = `<span style="font-size:11px; font-weight:700; color:#2b7a4b;">✓ Picked</span>`;
    }

    return `
      <tr>
        <td><strong>${w.waveId}</strong></td>
        <td><strong>${w.ordersCount} orders</strong></td>
        <td><span style="font-size:11px; color:var(--text-secondary);">${w.orderIds.join(', ')}</span></td>
        <td>${w.skusCount} SKUs</td>
        <td><strong>${w.totalUnits} units</strong></td>
        <td><strong>${w.assignedPicker}</strong></td>
        <td>
          <div style="font-family:monospace; font-size:11px; color:var(--color-steel-blue); font-weight:700;">
            ${w.pickPath}
          </div>
        </td>
        <td style="font-weight:700;">${w.estTime}</td>
        <td><span class="status-tag ${statusPill}">${w.status}</span></td>
        <td style="text-align:center;">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function handleWavesSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.pickWaves.filter(w =>
    w.waveId.toLowerCase().includes(query) ||
    w.assignedPicker.toLowerCase().includes(query) ||
    w.pickPath.toLowerCase().includes(query) ||
    w.orderIds.join(' ').toLowerCase().includes(query)
  );
  const tbody = document.getElementById('waves-tbody');
  const countBadge = document.getElementById('waves-count');
  if (tbody) tbody.innerHTML = renderWavesRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} waves`;
}

function advancePickWave(waveId, action) {
  const wave = state.pickWaves.find(w => w.waveId === waveId);
  if (!wave) return;

  if (action === 'START') {
    wave.status = 'In-Progress';
    wave.orderIds.forEach(oid => {
      const ord = state.orders.find(o => o.orderId === oid);
      if (ord) ord.pickingStatus = 'Picking In-Progress';
    });
  } else if (action === 'COMPLETE') {
    wave.status = 'Completed';
    wave.orderIds.forEach(oid => {
      const ord = state.orders.find(o => o.orderId === oid);
      if (ord) {
        ord.pickingStatus = 'Picked & Staged';
        ord.deliveryStatus = 'Ready for Packing';
      }
    });
  }
  renderActiveView();
}

function openCreatePickWaveModal() {
  const unpickedOrders = state.orders.filter(o => o.pickingStatus === 'Queued');
  const pickerOptions = state.employees.map(e => `<option value="${e}">${e}</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Multi-Order Pick Wave</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleCreatePickWaveSubmit(event)">
          <div class="modal-body">
            <div class="form-group">
              <label>Assign Picker *</label>
              <select class="form-input" id="wave-picker" required>
                ${pickerOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Available Unpicked Orders (${unpickedOrders.length} available)</label>
              <div style="background:var(--bg-surface); padding:8px; border-radius:4px; max-height:120px; overflow-y:auto; border:1px solid var(--border-grid);">
                ${unpickedOrders.length ? unpickedOrders.map(o => `
                  <label style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:12px;">
                    <input type="checkbox" name="wave-order" value="${o.orderId}" checked>
                    <strong>${o.orderId}</strong> (${o.channel}) - ${o.itemsSummary}
                  </label>
                `).join('') : '<span style="font-size:11px; color:var(--text-muted);">No unpicked orders in queue.</span>'}
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Generate S-Shape Pick Wave</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleCreatePickWaveSubmit(e) {
  e.preventDefault();
  const picker = document.getElementById('wave-picker').value;
  const selectedBoxes = Array.from(document.querySelectorAll('input[name="wave-order"]:checked')).map(cb => cb.value);

  if (!selectedBoxes.length) {
    alert('Please select at least one order to create a pick wave.');
    return;
  }

  const waveId = `WAV-0906-0${state.pickWaves.length + 1}`;
  let totalUnits = 0;
  selectedBoxes.forEach(oid => {
    const ord = state.orders.find(o => o.orderId === oid);
    if (ord) {
      totalUnits += ord.totalUnits;
      ord.assignedPicker = picker;
      ord.pickingStatus = 'Picking In-Progress';
    }
  });

  state.pickWaves.unshift({
    waveId,
    ordersCount: selectedBoxes.length,
    orderIds: selectedBoxes,
    skusCount: selectedBoxes.length * 2,
    totalUnits,
    assignedPicker: picker,
    status: 'In-Progress',
    estTime: `${selectedBoxes.length * 2 + 1} mins`,
    pickPath: 'CHILL-R1-A -> A1-R1-S1 -> A1-R1-S2'
  });

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 3. PACKING STATION & DISPATCH FLEET VIEW
// ==========================================================================
function renderPackingDispatchView() {
  const readyRider = state.dispatches.filter(d => d.status === 'Ready for Rider').length;
  const inTransit = state.dispatches.filter(d => d.status === 'In-Transit').length;
  const delivered = state.dispatches.filter(d => d.status === 'Delivered').length;

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Total Dispatched Packages</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${state.dispatches.length}</div>
          <div class="stat-box-sub">Packing station throughput</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Ready for Rider Pickup</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">${readyRider}</div>
          <div class="stat-box-sub">Bagged & seal-verified</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Out for Delivery (Riders)</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${inTransit}</div>
          <div class="stat-box-sub">Live in transit to customer</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Delivered Successfully</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${delivered}</div>
          <div class="stat-box-sub">Handover complete</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Packing Station & Rider Handover</span>
          <span class="badge-count" id="dispatches-count">${state.dispatches.length} dispatches</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="dispatch-search" placeholder="Search dispatch ID, order, partner, rider..." oninput="handleDispatchSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openCreateDispatchModal()">+ Create Dispatch</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Dispatch ID</th>
              <th>Order ID</th>
              <th>Destination</th>
              <th>Assigned Packer</th>
              <th>Package Type</th>
              <th>Weight</th>
              <th>Seal Barcode</th>
              <th>Delivery Partner</th>
              <th>Rider Name & Vehicle</th>
              <th>Status</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="dispatch-tbody">
            ${renderDispatchRows(state.dispatches)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDispatchRows(dispatchList) {
  if (!dispatchList.length) {
    return `<tr><td colspan="11" style="text-align:center; padding: 24px; color: var(--text-muted);">No dispatch packages found.</td></tr>`;
  }

  return dispatchList.map(d => {
    let pillClass = 'tag-queued';
    if (d.status === 'Packing In-Progress') pillClass = 'tag-packing';
    if (d.status === 'Ready for Rider') pillClass = 'tag-shipped';
    if (d.status === 'In-Transit') pillClass = 'tag-expiring';
    if (d.status === 'Delivered') pillClass = 'tag-delivered';

    let actionBtn = '';
    if (d.status === 'Ready for Rider') {
      actionBtn = `<button class="btn-row-action" onclick="advanceOrderStage('${d.orderId}', 'HANDOVER_RIDER')">Handover Rider</button>`;
    } else if (d.status === 'In-Transit') {
      actionBtn = `<button class="btn-row-action" style="background:#2b7a4b; color:#fff;" onclick="advanceOrderStage('${d.orderId}', 'MARK_DELIVERED')">Deliver</button>`;
    } else if (d.status === 'Delivered') {
      actionBtn = `<span style="font-size:11px; font-weight:700; color:#2b7a4b;">✓ Handed Over</span>`;
    } else {
      actionBtn = `<button class="btn-row-action" onclick="advanceOrderStage('${d.orderId}', 'PACK_ORDER')">Seal Box</button>`;
    }

    return `
      <tr>
        <td><strong>${d.dispatchId}</strong><br><span style="font-size:10.5px; color:var(--text-muted);">${d.time}</span></td>
        <td><strong>${d.orderId}</strong></td>
        <td>${d.destination}</td>
        <td><strong>${d.assignedPacker}</strong></td>
        <td><span class="status-tag ${d.packageType.includes('Cold') ? 'tag-urgent' : 'tag-safe'}">${d.packageType}</span></td>
        <td style="font-weight:700;">${d.packWeightKg}</td>
        <td><span style="font-family:monospace; font-size:11px; font-weight:700;">${d.sealBarcode}</span></td>
        <td><strong>${d.partner}</strong></td>
        <td>
          <strong>${d.riderName}</strong><br>
          <span style="font-size:10.5px; color:var(--text-muted);">${d.vehicleNo} • ${d.riderPhone}</span>
        </td>
        <td><span class="status-tag ${pillClass}">${d.status}</span></td>
        <td style="text-align:center;">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function handleDispatchSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.dispatches.filter(d =>
    d.dispatchId.toLowerCase().includes(query) ||
    d.orderId.toLowerCase().includes(query) ||
    d.assignedPacker.toLowerCase().includes(query) ||
    d.partner.toLowerCase().includes(query) ||
    d.riderName.toLowerCase().includes(query) ||
    d.sealBarcode.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('dispatch-tbody');
  const countBadge = document.getElementById('dispatches-count');
  if (tbody) tbody.innerHTML = renderDispatchRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} dispatches`;
}

function openCreateDispatchModal() {
  const openOrders = state.orders.filter(o => o.deliveryStatus === 'Ready for Packing' || o.deliveryStatus === 'Packing In-Progress' || o.deliveryStatus === 'Pending Pick');
  const packerOptions = state.employees.map(e => `<option value="${e}">${e}</option>`).join('');
  const partnerOptions = state.partners.map(p => `<option value="${p}">${p}</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Dispatch Package & Shipping Label</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleCreateDispatchSubmit(event)">
          <div class="modal-body">
            <div class="form-group">
              <label>Select Order *</label>
              <select class="form-input" id="dsp-order-id" required>
                ${openOrders.length ? openOrders.map(o => `<option value="${o.orderId}">${o.orderId} (${o.channel}) - ${o.itemsSummary}</option>`).join('') : '<option value="">No open orders waiting</option>'}
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Assigned Packer *</label>
                <select class="form-input" id="dsp-packer" required>
                  ${packerOptions}
                </select>
              </div>
              <div class="form-group">
                <label>Package Type *</label>
                <select class="form-input" id="dsp-pkg-type" required>
                  <option value="Thermal Cold Chain Bag">Thermal Cold Chain Bag</option>
                  <option value="Standard Heavy Corrugated Box">Standard Heavy Corrugated Box</option>
                  <option value="Quick Polybag Pouch">Quick Polybag Pouch</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Package Weight (kg) *</label>
                <input type="text" class="form-input" id="dsp-weight" value="1.5 kg" required>
              </div>
              <div class="form-group">
                <label>Delivery Fleet *</label>
                <select class="form-input" id="dsp-partner" required>
                  ${partnerOptions}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Rider Name *</label>
                <input type="text" class="form-input" id="dsp-rider-name" value="Naveen Reddy" required>
              </div>
              <div class="form-group">
                <label>Rider Vehicle No *</label>
                <input type="text" class="form-input" id="dsp-vehicle" value="AP-05-EV-0012" required>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Seal Box & Stage for Rider</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleCreateDispatchSubmit(e) {
  e.preventDefault();
  const orderId = document.getElementById('dsp-order-id').value;
  const packer = document.getElementById('dsp-packer').value;
  const pkgType = document.getElementById('dsp-pkg-type').value;
  const weight = document.getElementById('dsp-weight').value;
  const partner = document.getElementById('dsp-partner').value;
  const riderName = document.getElementById('dsp-rider-name').value;
  const vehicle = document.getElementById('dsp-vehicle').value;

  if (!orderId) {
    alert('Please select an order.');
    return;
  }

  const dispatchId = `DSP-202609-00${state.dispatches.length + 1}`;
  state.dispatches.unshift({
    dispatchId,
    orderId,
    destination: 'Sector Fast Delivery',
    assignedPacker: packer,
    packageType: pkgType,
    packWeightKg: weight,
    sealBarcode: `SEAL-${Math.floor(100000 + Math.random() * 900000)}`,
    partner,
    riderName,
    riderPhone: '+91 94401 55667',
    vehicleNo: vehicle,
    status: 'Ready for Rider',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  const ord = state.orders.find(o => o.orderId === orderId);
  if (ord) {
    ord.assignedPacker = packer;
    ord.deliveryPartner = partner;
    ord.riderName = riderName;
    ord.vehicleNo = vehicle;
    ord.deliveryStatus = 'Ready for Rider';
  }

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 4. INBOUND & RECEIVING VIEW
// ==========================================================================
function renderInboundTableView() {
  const totalReceived = state.inbounds.reduce((acc, i) => acc + i.received, 0);
  const totalAccepted = state.inbounds.reduce((acc, i) => acc + i.accepted, 0);
  const totalDamaged = state.inbounds.reduce((acc, i) => acc + i.damaged, 0);

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Inbound Consignments</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${state.inbounds.length}</div>
          <div class="stat-box-sub">Dock intake shipments</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Total Units Received</div>
          <div class="stat-box-value" style="color: var(--color-espresso);">${totalReceived.toLocaleString()}</div>
          <div class="stat-box-sub">Physical volume checked</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">QC Accepted Stock</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${totalAccepted.toLocaleString()}</div>
          <div class="stat-box-sub">Putaway to storage bins</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Damaged / Rejected</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${totalDamaged}</div>
          <div class="stat-box-sub">Quarantine dock write-off</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Inbound Consignments & Inspection Records</span>
          <span class="badge-count" id="inbound-count">${state.inbounds.length} entries</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="inbound-search" placeholder="Search inbound #, supplier, batch, bin, receiver..." oninput="handleInboundSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openAddInboundModal()">+ Add Inbound</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Inbound No</th>
              <th>Supplier</th>
              <th>Received Qty</th>
              <th>Accepted Qty</th>
              <th>Damaged Qty</th>
              <th>Batch Code</th>
              <th>MFG Date</th>
              <th>Expiry Date</th>
              <th>Receiver Staff</th>
              <th>QC Status</th>
              <th>Putaway Bin</th>
              <th>Status</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="inbound-tbody">
            ${renderInboundRows(state.inbounds)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderInboundRows(inboundsList) {
  if (!inboundsList.length) {
    return `<tr><td colspan="13" style="text-align:center; padding: 24px; color: var(--text-muted);">No inbound entries found.</td></tr>`;
  }

  return inboundsList.map(inb => `
    <tr>
      <td><strong>${inb.inboundNo}</strong></td>
      <td><strong>${inb.supplier}</strong><br><span style="font-size:10.5px; color:var(--text-muted);">${inb.warehouse}</span></td>
      <td style="font-weight:700;">${inb.received.toLocaleString()}</td>
      <td style="font-weight:700; color:#2b7a4b;">${inb.accepted.toLocaleString()}</td>
      <td style="font-weight:700; color:${inb.damaged > 0 ? 'var(--color-rust-red)' : 'var(--text-muted)'};">${inb.damaged}</td>
      <td><span class="status-tag tag-urgent">${inb.batch}</span></td>
      <td>${inb.mfgDate}</td>
      <td style="font-weight:700; color:var(--color-rust-red);">${inb.expiry}</td>
      <td><strong>${inb.receiver}</strong></td>
      <td><span class="status-tag tag-safe">${inb.qc}</span></td>
      <td><strong style="color:var(--color-steel-blue);">${inb.putaway}</strong></td>
      <td><span class="status-tag ${inb.status === 'Completed' ? 'tag-delivered' : 'tag-picking'}">${inb.status}</span></td>
      <td style="text-align:center;">
        <button class="btn-row-action" onclick="openEditInboundModal('${inb.inboundNo}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function handleInboundSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.inbounds.filter(i =>
    i.inboundNo.toLowerCase().includes(query) ||
    i.supplier.toLowerCase().includes(query) ||
    i.batch.toLowerCase().includes(query) ||
    i.receiver.toLowerCase().includes(query) ||
    i.putaway.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('inbound-tbody');
  const countBadge = document.getElementById('inbound-count');
  if (tbody) tbody.innerHTML = renderInboundRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} entries`;
}

function openAddInboundModal() {
  const empOptions = state.employees.map(e => `<option value="${e}">${e}</option>`).join('');
  const binOptions = state.locations.map(l => `<option value="${l.bin}">${l.bin} (${l.zone.split(' ')[0]})</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add Inbound Consignment & Putaway</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleAddInboundSubmit(event)">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>Inbound Number *</label>
                <input type="text" class="form-input" id="inb-no" value="INB-00128" required>
              </div>
              <div class="form-group">
                <label>Supplier / Vendor *</label>
                <input type="text" class="form-input" id="inb-supplier" placeholder="e.g. Nestle India" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Received Qty *</label>
                <input type="number" class="form-input" id="inb-received" value="500" required>
              </div>
              <div class="form-group">
                <label>Accepted Qty *</label>
                <input type="number" class="form-input" id="inb-accepted" value="498" required>
              </div>
              <div class="form-group">
                <label>Damaged Qty *</label>
                <input type="number" class="form-input" id="inb-damaged" value="2" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Batch Code *</label>
                <input type="text" class="form-input" id="inb-batch" value="BTH-NEW-01" required>
              </div>
              <div class="form-group">
                <label>Manufacturing Date *</label>
                <input type="date" class="form-input" id="inb-mfg" value="2026-09-01" required>
              </div>
              <div class="form-group">
                <label>Expiry Date *</label>
                <input type="date" class="form-input" id="inb-exp" value="2027-09-01" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Receiver Staff *</label>
                <select class="form-input" id="inb-receiver" required>
                  ${empOptions}
                </select>
              </div>
              <div class="form-group">
                <label>Putaway Target Bin *</label>
                <select class="form-input" id="inb-bin" required>
                  ${binOptions}
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Accept & Putaway to Stock</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleAddInboundSubmit(e) {
  e.preventDefault();
  const inboundNo = document.getElementById('inb-no').value;
  const supplier = document.getElementById('inb-supplier').value;
  const received = parseInt(document.getElementById('inb-received').value, 10);
  const accepted = parseInt(document.getElementById('inb-accepted').value, 10);
  const damaged = parseInt(document.getElementById('inb-damaged').value, 10);
  const batch = document.getElementById('inb-batch').value;
  const mfgDate = document.getElementById('inb-mfg').value;
  const expiry = document.getElementById('inb-exp').value;
  const receiver = document.getElementById('inb-receiver').value;
  const putaway = document.getElementById('inb-bin').value;

  state.inbounds.unshift({
    inboundNo,
    supplier,
    warehouse: 'RJY-DS-001',
    itemsCount: 1,
    received,
    accepted,
    damaged,
    batch,
    mfgDate,
    expiry,
    receiver,
    qc: 'Passed',
    putaway,
    status: 'Completed',
    items: []
  });

  // Calculate days left
  const daysLeft = Math.ceil((new Date(expiry) - new Date('2026-09-06')) / (1000 * 60 * 60 * 24));
  let statusText = 'Safe (>90d)';
  if (daysLeft < 7) statusText = 'Expiring Urgent (<7d)';
  else if (daysLeft < 30) statusText = 'Near Expiry (<30d)';

  // Append or update in physical inventory
  state.inventory.unshift({
    bin: putaway,
    zone: 'FMCG Pick Face (Zone A)',
    sku: 'SKU-INWARD',
    name: `${supplier} Inward Stock`,
    batch,
    mfgDate,
    onHand: accepted,
    reserved: 0,
    avail: accepted,
    expiry,
    daysLeft,
    status: statusText
  });

  // Record Inward in Stock Movement History
  state.ledger.unshift({
    id: `MOV-0906-00${state.ledger.length + 1}`,
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    type: 'INWARD_RECEIPT',
    sku: 'SKU-INWARD',
    batch,
    fromBin: 'DOCK-INBOUND',
    toBin: putaway,
    qty: `+${accepted}`,
    employee: receiver.split(' ')[0],
    ref: inboundNo
  });

  closeModal();
  renderActiveView();
}

function openEditInboundModal(inboundNo) {
  const inb = state.inbounds.find(i => i.inboundNo === inboundNo);
  if (!inb) return;

  const empOptions = state.employees.map(e => `<option value="${e}" ${inb.receiver === e ? 'selected' : ''}>${e}</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Edit Inbound Record (${inb.inboundNo})</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleEditInboundSubmit(event, '${inb.inboundNo}')">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>Supplier</label>
                <input type="text" class="form-input" id="edit-inb-supplier" value="${inb.supplier}" required>
              </div>
              <div class="form-group">
                <label>Receiver Staff</label>
                <select class="form-input" id="edit-inb-receiver">
                  ${empOptions}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Accepted Qty</label>
                <input type="number" class="form-input" id="edit-inb-accepted" value="${inb.accepted}" required>
              </div>
              <div class="form-group">
                <label>Damaged Qty</label>
                <input type="number" class="form-input" id="edit-inb-damaged" value="${inb.damaged}" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Putaway Bin</label>
                <input type="text" class="form-input" id="edit-inb-bin" value="${inb.putaway}" required>
              </div>
              <div class="form-group">
                <label>Status</label>
                <select class="form-input" id="edit-inb-status">
                  <option value="Completed" ${inb.status === 'Completed' ? 'selected' : ''}>Completed</option>
                  <option value="Receiving" ${inb.status === 'Receiving' ? 'selected' : ''}>Receiving</option>
                  <option value="QC Hold" ${inb.status === 'QC Hold' ? 'selected' : ''}>QC Hold</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Save Changes</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleEditInboundSubmit(e, inboundNo) {
  e.preventDefault();
  const inb = state.inbounds.find(i => i.inboundNo === inboundNo);
  if (!inb) return;

  inb.supplier = document.getElementById('edit-inb-supplier').value;
  inb.receiver = document.getElementById('edit-inb-receiver').value;
  inb.accepted = parseInt(document.getElementById('edit-inb-accepted').value, 10);
  inb.damaged = parseInt(document.getElementById('edit-inb-damaged').value, 10);
  inb.putaway = document.getElementById('edit-inb-bin').value;
  inb.status = document.getElementById('edit-inb-status').value;

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 5. STORAGE & BIN STOCK (FEFO & BATCHES)
// ==========================================================================
function renderStockView() {
  const totalOnHand = state.inventory.reduce((acc, i) => acc + i.onHand, 0);
  const totalReserved = state.inventory.reduce((acc, i) => acc + i.reserved, 0);
  const totalAvailable = state.inventory.reduce((acc, i) => acc + i.avail, 0);
  const nearExpiryCount = state.inventory.filter(i => i.daysLeft < 7).length;

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Physical Stock on Hand</div>
          <div class="stat-box-value" style="color: var(--color-espresso);">${totalOnHand.toLocaleString()}</div>
          <div class="stat-box-sub">Total units across bins</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Reserved in Open Orders</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">${totalReserved.toLocaleString()}</div>
          <div class="stat-box-sub">Locked for picking waves</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Net Available to Pick</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${totalAvailable.toLocaleString()}</div>
          <div class="stat-box-sub">Unrestricted sellable stock</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Near-Expiry FEFO Batches</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${nearExpiryCount}</div>
          <div class="stat-box-sub">Expiring within 7 days</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Bin Storage, Batches & FEFO Expiry</span>
          <span class="badge-count" id="stock-count">${state.inventory.length} bin batches</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="stock-search" placeholder="Search bin, zone, SKU, batch, status..." oninput="handleStockSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openTransferStockModal()">+ Transfer Stock</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Bin Location</th>
              <th>Storage Zone</th>
              <th>SKU / Code</th>
              <th>Product Name</th>
              <th>Batch Code</th>
              <th style="text-align:right;">On Hand</th>
              <th style="text-align:right;">Reserved</th>
              <th style="text-align:right;">Available</th>
              <th>Expiry Date</th>
              <th>Days Left</th>
              <th>FEFO Expiry Health</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="stock-tbody">
            ${renderStockRows(state.inventory)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStockRows(inventoryList) {
  if (!inventoryList.length) {
    return `<tr><td colspan="12" style="text-align:center; padding: 24px; color: var(--text-muted);">No stock entries found.</td></tr>`;
  }

  return inventoryList.map(item => {
    let pillClass = 'tag-safe';
    if (item.daysLeft < 7) pillClass = 'tag-urgent';
    else if (item.daysLeft < 30) pillClass = 'tag-expiring';

    return `
      <tr>
        <td><strong style="color:var(--color-steel-blue);">${item.bin}</strong></td>
        <td>${item.zone}</td>
        <td><strong>${item.sku}</strong></td>
        <td>${item.name}</td>
        <td><span class="status-tag tag-urgent">${item.batch}</span></td>
        <td style="text-align:right; font-weight:800;">${item.onHand}</td>
        <td style="text-align:right; font-weight:700; color:var(--color-warm-ochre);">${item.reserved}</td>
        <td style="text-align:right; font-weight:800; color:#2b7a4b;">${item.avail}</td>
        <td style="font-weight:700; color:${item.daysLeft < 7 ? 'var(--color-rust-red)' : 'var(--text-primary)'};">${item.expiry}</td>
        <td style="font-weight:800; color:${item.daysLeft < 7 ? 'var(--color-rust-red)' : 'var(--color-steel-blue)'};">${item.daysLeft}d</td>
        <td><span class="status-tag ${pillClass}">${item.daysLeft < 7 ? '⚡ FEFO 1st (' + item.daysLeft + 'd left)' : (item.daysLeft < 30 ? 'Near Expiry (' + item.daysLeft + 'd)' : 'Safe')}</span></td>
        <td style="text-align:center;">
          <button class="btn-row-action" onclick="openTransferStockModal('${item.sku}', '${item.batch}', '${item.bin}')">Transfer</button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleStockSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.inventory.filter(i =>
    i.bin.toLowerCase().includes(query) ||
    i.zone.toLowerCase().includes(query) ||
    i.sku.toLowerCase().includes(query) ||
    i.name.toLowerCase().includes(query) ||
    i.batch.toLowerCase().includes(query) ||
    i.status.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('stock-tbody');
  const countBadge = document.getElementById('stock-count');
  if (tbody) tbody.innerHTML = renderStockRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} bin batches`;
}

function openTransferStockModal(presetSku, presetBatch, presetBin) {
  const binOptions = state.locations.map(l => `<option value="${l.bin}">${l.bin} (${l.zone.split(' ')[0]})</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Internal Stock Transfer Between Bins</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleTransferStockSubmit(event)">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>SKU / Item *</label>
                <input type="text" class="form-input" id="trf-sku" value="${presetSku || 'SNK-CHIP-01'}" required>
              </div>
              <div class="form-group">
                <label>Batch Code *</label>
                <input type="text" class="form-input" id="trf-batch" value="${presetBatch || 'BTH-2408-A'}" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Source Bin *</label>
                <input type="text" class="form-input" id="trf-from-bin" value="${presetBin || 'BULK-A1-P1'}" required>
              </div>
              <div class="form-group">
                <label>Destination Target Bin *</label>
                <select class="form-input" id="trf-to-bin" required>
                  ${binOptions}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Transfer Quantity (Units) *</label>
              <input type="number" class="form-input" id="trf-qty" min="1" max="1000" value="50" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Execute Bin Transfer</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleTransferStockSubmit(e) {
  e.preventDefault();
  const sku = document.getElementById('trf-sku').value;
  const batch = document.getElementById('trf-batch').value;
  const fromBin = document.getElementById('trf-from-bin').value;
  const toBin = document.getElementById('trf-to-bin').value;
  const qty = parseInt(document.getElementById('trf-qty').value, 10);

  const src = state.inventory.find(i => i.bin === fromBin && i.batch === batch);
  if (src) {
    src.onHand = Math.max(0, src.onHand - qty);
    src.avail = Math.max(0, src.avail - qty);
  }

  let dest = state.inventory.find(i => i.bin === toBin && i.batch === batch);
  if (dest) {
    dest.onHand += qty;
    dest.avail += qty;
  } else {
    state.inventory.unshift({
      bin: toBin,
      zone: 'FMCG Pick Face (Zone A)',
      sku,
      name: src ? src.name : 'Transferred Item',
      batch,
      mfgDate: src ? src.mfgDate : '2026-01-01',
      onHand: qty,
      reserved: 0,
      avail: qty,
      expiry: src ? src.expiry : '2027-12-31',
      daysLeft: src ? src.daysLeft : 365,
      status: 'Safe (>90d)'
    });
  }

  // Record in Stock Movement History
  state.ledger.unshift({
    id: `MOV-0906-00${state.ledger.length + 1}`,
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    type: 'BIN_TRANSFER',
    sku,
    batch,
    fromBin,
    toBin,
    qty: `${qty}`,
    employee: 'Arjun',
    ref: 'INTERNAL_TRANSFER'
  });

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 6. MASTER PRODUCT CATALOG & DEMAND VIEW
// ==========================================================================
function renderProductsView() {
  const totalCatalog = state.products.length;
  const totalPhysical = state.products.reduce((acc, p) => acc + p.onHand, 0);
  const totalNearExpiry = state.products.reduce((acc, p) => acc + (p.isNearExpiry ? p.nearExpiryQty : 0), 0);
  const totalPendingDemand = state.products.reduce((acc, p) => acc + p.pendingDemand, 0);

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Catalog Products (SKUs)</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${totalCatalog}</div>
          <div class="stat-box-sub">Active quick commerce SKUs</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Physical Stock on Hand</div>
          <div class="stat-box-value" style="color: var(--color-espresso);">${totalPhysical.toLocaleString()}</div>
          <div class="stat-box-sub">Units stored in dark store</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Near-Expiry Units (<7d)</div>
          <div class="stat-box-value" style="color: var(--color-rust-red);">${totalNearExpiry.toLocaleString()}</div>
          <div class="stat-box-sub">FEFO Priority Dispatch</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Pending Demand Left to Pack</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">${totalPendingDemand}</div>
          <div class="stat-box-sub">Open order requirements</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Product Stock & Near-Expiry Intelligence</span>
          <span class="badge-count" id="product-count">${state.products.length} products</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="product-search" placeholder="Search SKU, name, category, barcode..." oninput="handleProductSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openAddProductModal()">+ Add New Product</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>SKU / Barcode</th>
              <th>Product Name</th>
              <th>Category</th>
              <th>Default Bin</th>
              <th style="text-align:right;">Stock on Hand</th>
              <th style="text-align:right;">Reserved Qty</th>
              <th style="text-align:right;">Net Available</th>
              <th>Near-Expiry Batch (FEFO)</th>
              <th style="text-align:right;">Shipped Today</th>
              <th style="text-align:right;">Pending Demand</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="product-tbody">
            ${renderProductRows(state.products)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderProductRows(productList) {
  if (!productList.length) {
    return `<tr><td colspan="11" style="text-align:center; padding: 24px; color: var(--text-muted);">No products found.</td></tr>`;
  }

  return productList.map(p => `
    <tr>
      <td><strong>${p.sku}</strong><br><span style="font-size:10.5px; color:var(--text-muted);">${p.barcode}</span></td>
      <td><strong>${p.name}</strong></td>
      <td>${p.category}</td>
      <td><strong style="color:var(--color-steel-blue);">${p.bin}</strong></td>
      <td style="text-align:right; font-weight:800;">${p.onHand}</td>
      <td style="text-align:right; font-weight:700; color:var(--color-warm-ochre);">${p.reserved}</td>
      <td style="text-align:right; font-weight:800; color:#2b7a4b;">${p.available}</td>
      <td>
        <span class="status-tag ${p.isNearExpiry ? 'tag-urgent' : 'tag-safe'}">
          ${p.isNearExpiry ? '⚡ ' : '✓ '}${p.nearExpiryBatch}
        </span>
      </td>
      <td style="text-align:right; font-weight:700; color:var(--color-steel-blue);">${p.shippedToday}</td>
      <td style="text-align:right; font-weight:700; color:${p.pendingDemand > 0 ? 'var(--color-rust-red)' : 'var(--text-muted)'};">${p.pendingDemand}</td>
      <td style="text-align:center;">
        <button class="btn-row-action" onclick="openTransferStockModal('${p.sku}')">Stock</button>
      </td>
    </tr>
  `).join('');
}

function handleProductSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.products.filter(p =>
    p.sku.toLowerCase().includes(query) ||
    p.name.toLowerCase().includes(query) ||
    p.category.toLowerCase().includes(query) ||
    p.barcode.toLowerCase().includes(query) ||
    p.bin.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('product-tbody');
  const countBadge = document.getElementById('product-count');
  if (tbody) tbody.innerHTML = renderProductRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} products`;
}

function openAddProductModal() {
  const binOptions = state.locations.map(l => `<option value="${l.bin}">${l.bin} (${l.zone.split(' ')[0]})</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add New Product to Dark Store Catalog</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleAddProductSubmit(event)">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>SKU Code *</label>
                <input type="text" class="form-input" id="new-prod-sku" placeholder="e.g. SNK-NAM-05" required>
              </div>
              <div class="form-group">
                <label>Barcode *</label>
                <input type="text" class="form-input" id="new-prod-barcode" placeholder="e.g. 890149909988" required>
              </div>
            </div>
            <div class="form-group">
              <label>Product Name *</label>
              <input type="text" class="form-input" id="new-prod-name" placeholder="e.g. Haldiram Bhujia 200g" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Category *</label>
                <input type="text" class="form-input" id="new-prod-cat" value="Snacks & Munchies" required>
              </div>
              <div class="form-group">
                <label>Default Bin *</label>
                <select class="form-input" id="new-prod-bin" required>
                  ${binOptions}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Purchase Cost (₹) *</label>
                <input type="number" class="form-input" id="new-prod-cost" value="45.00" step="0.5" required>
              </div>
              <div class="form-group">
                <label>Selling Price (₹) *</label>
                <input type="number" class="form-input" id="new-prod-price" value="60.00" step="0.5" required>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Add Product</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleAddProductSubmit(e) {
  e.preventDefault();
  const sku = document.getElementById('new-prod-sku').value;
  const barcode = document.getElementById('new-prod-barcode').value;
  const name = document.getElementById('new-prod-name').value;
  const category = document.getElementById('new-prod-cat').value;
  const bin = document.getElementById('new-prod-bin').value;
  const buyCost = parseFloat(document.getElementById('new-prod-cost').value);
  const sellPrice = parseFloat(document.getElementById('new-prod-price').value);

  state.products.unshift({
    sku,
    barcode,
    name,
    category,
    uom: 'PCS',
    bin,
    buyCost,
    sellPrice,
    onHand: 0,
    reserved: 0,
    available: 0,
    nearExpiryQty: 0,
    nearExpiryBatch: 'No Batches Registered',
    isNearExpiry: false,
    shippedToday: 0,
    pendingDemand: 0
  });

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 7. STORAGE ZONES & BINS (Practical Layout Metrics)
// ==========================================================================
function renderWarehouseLocationsView() {
  const totalBins = state.locations.length;
  const totalCapacity = state.locations.reduce((acc, l) => acc + l.capacity, 0);
  const totalStored = state.locations.reduce((acc, l) => acc + l.stored, 0);
  const totalFree = state.locations.reduce((acc, l) => acc + l.freeSpace, 0);

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Total Storage Bins</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${totalBins}</div>
          <div class="stat-box-sub">RJY-DS-001 Dark Store</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Total Dark Store Capacity</div>
          <div class="stat-box-value" style="color: var(--color-espresso);">${totalCapacity.toLocaleString()}</div>
          <div class="stat-box-sub">Unit slot capacity</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Currently Stored Units</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${totalStored.toLocaleString()}</div>
          <div class="stat-box-sub">Physical items stored</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Free Available Bin Space</div>
          <div class="stat-box-value" style="color: #2b7a4b;">${totalFree.toLocaleString()}</div>
          <div class="stat-box-sub">Available slots for inbound</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Storage Zones, Bins & Temperature Classes</span>
          <span class="badge-count" id="location-count">${state.locations.length} bins</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="loc-search" placeholder="Search bin, zone, aisle, stored items..." oninput="handleLocationSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openAddLocationModal()">+ Add Storage Bin</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Bin Location</th>
              <th>Zone / Section</th>
              <th>Aisle</th>
              <th>Rack - Shelf</th>
              <th>Temperature & Type</th>
              <th style="text-align:right;">Max Capacity</th>
              <th style="text-align:right;">Stored Units</th>
              <th style="text-align:right;">Free Space</th>
              <th>Stored Items</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody id="location-tbody">
            ${renderLocationRows(state.locations)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLocationRows(locationsList) {
  if (!locationsList.length) {
    return `<tr><td colspan="10" style="text-align:center; padding: 24px; color: var(--text-muted);">No locations found.</td></tr>`;
  }

  return locationsList.map(l => `
    <tr>
      <td><strong style="color:var(--color-steel-blue);">${l.bin}</strong></td>
      <td><strong>${l.zone}</strong></td>
      <td>${l.aisle}</td>
      <td>${l.rack} - ${l.shelf}</td>
      <td><span class="status-tag ${l.tempClass === 'Chilled' ? 'tag-urgent' : 'tag-safe'}">${l.binType}</span></td>
      <td style="text-align:right; font-weight:700;">${l.capacity}</td>
      <td style="text-align:right; font-weight:800; color:var(--color-espresso);">${l.stored}</td>
      <td style="text-align:right; font-weight:800; color:#2b7a4b;">${l.freeSpace} slots</td>
      <td><span style="font-size:11.5px; color:var(--text-secondary);">${l.storedItems}</span></td>
      <td style="text-align:center;">
        <button class="btn-row-action" onclick="openTransferStockModal('', '', '${l.bin}')">Load</button>
      </td>
    </tr>
  `).join('');
}

function handleLocationSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.locations.filter(l =>
    l.bin.toLowerCase().includes(query) ||
    l.zone.toLowerCase().includes(query) ||
    l.aisle.toLowerCase().includes(query) ||
    l.storedItems.toLowerCase().includes(query) ||
    l.binType.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('location-tbody');
  const countBadge = document.getElementById('location-count');
  if (tbody) tbody.innerHTML = renderLocationRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} bins`;
}

function openAddLocationModal() {
  const zoneOptions = state.zones.map(z => `<option value="${z}">${z}</option>`).join('');

  const modalHtml = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add New Storage Bin Location</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleAddLocationSubmit(event)">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label>Bin Identifier *</label>
                <input type="text" class="form-input" id="new-loc-bin" placeholder="e.g. A1-R3-S1" required>
              </div>
              <div class="form-group">
                <label>Zone Classification *</label>
                <select class="form-input" id="new-loc-zone" required>
                  ${zoneOptions}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Aisle *</label>
                <input type="text" class="form-input" id="new-loc-aisle" value="Aisle-A" required>
              </div>
              <div class="form-group">
                <label>Rack / Shelf *</label>
                <input type="text" class="form-input" id="new-loc-rack" value="R3 - S1" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Bin Storage Type *</label>
                <input type="text" class="form-input" id="new-loc-type" value="High-Density Gravity Flow Bin" required>
              </div>
              <div class="form-group">
                <label>Max Unit Capacity *</label>
                <input type="number" class="form-input" id="new-loc-cap" value="600" required>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Add Storage Bin</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modal-layer').innerHTML = modalHtml;
}

function handleAddLocationSubmit(e) {
  e.preventDefault();
  const bin = document.getElementById('new-loc-bin').value;
  const zone = document.getElementById('new-loc-zone').value;
  const aisle = document.getElementById('new-loc-aisle').value;
  const rackShelf = document.getElementById('new-loc-rack').value.split('-');
  const binType = document.getElementById('new-loc-type').value;
  const capacity = parseInt(document.getElementById('new-loc-cap').value, 10);

  state.locations.push({
    bin,
    zone,
    aisle,
    rack: rackShelf[0] ? rackShelf[0].trim() : 'R1',
    shelf: rackShelf[1] ? rackShelf[1].trim() : 'S1',
    binType,
    capacity,
    stored: 0,
    freeSpace: capacity,
    storedItems: 'Empty Slot',
    tempClass: zone.includes('Chilled') ? 'Chilled' : 'Ambient'
  });

  closeModal();
  renderActiveView();
}

// ==========================================================================
// 8. STOCK MOVEMENT HISTORY VIEW
// ==========================================================================
function renderStockLedgerView() {
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Stock Movement History</span>
          <span class="badge-count" id="ledger-count">${state.ledger.length} entries</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="ledger-search" placeholder="Search movement ID, SKU, batch, employee, ref..." oninput="handleLedgerSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Movement ID</th>
              <th>Timestamp</th>
              <th>Movement Type</th>
              <th>SKU Code</th>
              <th>Batch Code</th>
              <th>Source Bin</th>
              <th>Destination Bin</th>
              <th style="text-align:right;">Quantity</th>
              <th>Staff / Agent</th>
              <th>Reference ID</th>
            </tr>
          </thead>
          <tbody id="ledger-tbody">
            ${renderLedgerRows(state.ledger)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLedgerRows(ledgerList) {
  if (!ledgerList.length) {
    return `<tr><td colspan="10" style="text-align:center; padding: 24px; color: var(--text-muted);">No stock movements recorded.</td></tr>`;
  }

  return ledgerList.map(l => {
    let typePill = 'tag-safe';
    if (l.type.includes('INWARD')) typePill = 'tag-delivered';
    if (l.type.includes('RESERVE')) typePill = 'tag-packing';
    if (l.type.includes('PICK') || l.type.includes('DISPATCH')) typePill = 'tag-shipped';
    if (l.type.includes('DAMAGE')) typePill = 'tag-urgent';

    return `
      <tr>
        <td><strong>${l.id}</strong></td>
        <td>${l.time}</td>
        <td><span class="status-tag ${typePill}">${l.type}</span></td>
        <td><strong>${l.sku}</strong></td>
        <td><span class="status-tag tag-urgent">${l.batch}</span></td>
        <td><strong style="color:var(--color-steel-blue);">${l.fromBin}</strong></td>
        <td><strong style="color:var(--color-steel-blue);">${l.toBin}</strong></td>
        <td style="text-align:right; font-weight:800; color:${l.qty.startsWith('-') ? 'var(--color-rust-red)' : '#2b7a4b'};">${l.qty}</td>
        <td><strong>${l.employee}</strong></td>
        <td><span style="font-size:11px; color:var(--text-muted);">${l.ref}</span></td>
      </tr>
    `;
  }).join('');
}

function handleLedgerSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.ledger.filter(l =>
    l.id.toLowerCase().includes(query) ||
    l.sku.toLowerCase().includes(query) ||
    l.batch.toLowerCase().includes(query) ||
    l.employee.toLowerCase().includes(query) ||
    l.ref.toLowerCase().includes(query) ||
    l.type.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('ledger-tbody');
  const countBadge = document.getElementById('ledger-count');
  if (tbody) tbody.innerHTML = renderLedgerRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} entries`;
}

// ==========================================================================
// 9. WORKER FLOOR SHIFTS VIEW
// ==========================================================================
function renderFloorShiftsView() {
  const totalStaff = state.shifts.length;

  return `
    <div class="table-view-container">
      <div class="stats-strip">
        <div class="stat-box">
          <div class="stat-box-label">Active Dark Store Staff</div>
          <div class="stat-box-value" style="color: var(--color-steel-blue);">${totalStaff}</div>
          <div class="stat-box-sub">RJY-DS-001 Live Floor Team</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Active Picking Specialists</div>
          <div class="stat-box-value" style="color: var(--color-warm-ochre);">2</div>
          <div class="stat-box-sub">Walking active S-shape paths</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Packing & Dispatch Stations</div>
          <div class="stat-box-value" style="color: var(--color-espresso);">2</div>
          <div class="stat-box-sub">Sealing bags & rider handovers</div>
        </div>
        <div class="stat-box">
          <div class="stat-box-label">Average Pick Accuracy</div>
          <div class="stat-box-value" style="color: #2b7a4b;">99.8%</div>
          <div class="stat-box-sub">Shift quality score</div>
        </div>
      </div>

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Worker Floor Shifts & Task Allocations</span>
          <span class="badge-count" id="shifts-count">${state.shifts.length} active workers</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" id="shifts-search" placeholder="Search staff name, role, station, task..." oninput="handleShiftsSearch(this.value)">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Export Excel</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Staff Name</th>
              <th>Operational Role</th>
              <th>Assigned Station</th>
              <th>Active Floor Task</th>
              <th>Shift Timing</th>
              <th style="text-align:right;">Completed Tasks</th>
              <th style="text-align:right;">Accuracy</th>
            </tr>
          </thead>
          <tbody id="shifts-tbody">
            ${renderShiftsRows(state.shifts)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderShiftsRows(shiftsList) {
  if (!shiftsList.length) {
    return `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--text-muted);">No workers found.</td></tr>`;
  }

  return shiftsList.map(s => `
    <tr>
      <td><strong>${s.empId}</strong></td>
      <td><strong>${s.name}</strong></td>
      <td><span class="status-tag tag-safe">${s.role}</span></td>
      <td><strong style="color:var(--color-steel-blue);">${s.station}</strong></td>
      <td><strong>${s.activeTask}</strong></td>
      <td>${s.shift}</td>
      <td style="text-align:right; font-weight:800;">${s.completedPicks}</td>
      <td style="text-align:right; font-weight:800; color:#2b7a4b;">${s.accuracy}</td>
    </tr>
  `).join('');
}

function handleShiftsSearch(val) {
  const query = val.toLowerCase();
  const filtered = state.shifts.filter(s =>
    s.empId.toLowerCase().includes(query) ||
    s.name.toLowerCase().includes(query) ||
    s.role.toLowerCase().includes(query) ||
    s.station.toLowerCase().includes(query) ||
    s.activeTask.toLowerCase().includes(query)
  );
  const tbody = document.getElementById('shifts-tbody');
  const countBadge = document.getElementById('shifts-count');
  if (tbody) tbody.innerHTML = renderShiftsRows(filtered);
  if (countBadge) countBadge.innerText = `${filtered.length} active workers`;
}

// ==========================================================================
// UNIVERSAL EXPORT TO EXCEL
// ==========================================================================
function exportActiveViewToExcel() {
  const table = document.querySelector('.wms-table');
  if (!table) {
    alert('No active table found to export.');
    return;
  }

  let csvContent = '\uFEFF'; // UTF-8 BOM
  const rows = table.querySelectorAll('tr');

  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = [];
    cols.forEach(col => {
      // Clean inner text
      let text = col.innerText.replace(/(\r\n|\n|\r)/gm, ' ').replace(/"/g, '""').trim();
      rowData.push(`"${text}"`);
    });
    csvContent += rowData.join(',') + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Zippzo_${state.activeView}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Exported ${state.activeView} to Excel CSV successfully.`);
}

function showToast(msg) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:var(--color-espresso); color:var(--bg-app); padding:10px 16px; border-radius:4px; font-weight:700; font-size:12px; z-index:9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function closeModal() {
  document.getElementById('modal-layer').innerHTML = '';
}
