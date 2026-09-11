/* ==========================================================================
   ZIPPZO WMS - ULTRA-ROBUST DARK STORE INVENTORY & FULFILLMENT ENGINE
   Dark Store: RJY-DS-001 (Rajahmundry Rapid Hub)
   Color Palette: #E8DDC5 (Canvas), #285A73 (Header/Primary), #B83A32 (Rust/Alert),
                  #292622 (Espresso Text/Borders), #C49A45 (Ochre/Excel/Warning)
   Typography: Sans-Serif (Plus Jakarta Sans / Inter)
   ========================================================================== */

function closeModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (modalLayer) modalLayer.innerHTML = '';
}

function showToast(msg) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:var(--color-espresso); color:var(--bg-app); padding:9px 15px; border-radius:3px; font-weight:600; font-size:12px; z-index:9999; box-shadow: 0 4px 12px rgba(0,0,0,0.2); letter-spacing:0.3px;';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

let appMode = 'live';

const state = {
  activeView: 'inbound',
  searchTerm: '',
  selectedInboundNo: null,

  // ── SUB-TAB NAVIGATION STATE ──────────────────────────────────
  inboundSubTab: 'shipments',       // 'shipments' | 'items' | 'qc' | 'scans'
  storageSubTab: 'putaway',         // 'putaway' | 'inventory'
  pickingSubTab: 'tasks',           // 'tasks' | 'items' | 'scans'
  packingShippingSubTab: 'packing', // 'packing' | 'shipments' | 'delivery' | 'scans'

  // ── 1. INBOUND MAIN SHIPMENT LIST (TABLE 1) ───────────────────
  inboundShipments: [
    { inboundNo: 'INB-00124', type: 'Supplier Delivery', source: 'ABC Foods', warehouse: 'RJY-DS-001', items: 25, expectedQty: 1500, receivedQty: 1480, acceptedQty: 1475, rejectedQty: 0, damagedQty: 5, status: 'Receiving', expectedArrival: '06-Sep-2026 09:00', actualArrival: '06-Sep-2026 09:15' },
    { inboundNo: 'INB-00125', type: 'Warehouse Transfer', source: 'VSK-DC-CENTRAL', warehouse: 'RJY-DS-001', items: 12, expectedQty: 500, receivedQty: 500, acceptedQty: 498, rejectedQty: 0, damagedQty: 2, status: 'Putaway In Progress', expectedArrival: '06-Sep-2026 10:15', actualArrival: '06-Sep-2026 10:10' },
    { inboundNo: 'INB-00126', type: 'Supplier Delivery', source: 'Fresh Dairy', warehouse: 'RJY-DS-001', items: 8, expectedQty: 800, receivedQty: 800, acceptedQty: 798, rejectedQty: 0, damagedQty: 2, status: 'Putaway Pending', expectedArrival: '06-Sep-2026 08:00', actualArrival: '06-Sep-2026 08:10' }
  ],

  // ── 2. INBOUND PRODUCT / RECEIVING TABLE (TABLE 2) ────────────
  inboundProducts: [
    { inboundNo: 'INB-00124', itemName: 'Basmati Rice 5kg', productId: 'PROD-00182', sku: 'RICE-BAS-5KG', barcode: '8901234567890', batchNo: 'BTH-R2408', serialNo: 'N/A (Batch Tracked)', uom: 'Bag', packSize: '5kg', expected: 500, scanned: 498, received: 498, accepted: 495, rejected: 1, damaged: 2, shortage: 2, excess: 0, mfgDate: '15-Aug-2026', expiryDate: '15-Aug-2027', bestBefore: '12 Months', remainingShelfLife: '343 Days', temperature: '26°C', storageCondition: 'Ambient', qcStatus: 'Passed', scannerId: 'SCN-014', receiver: 'Arjun', scanTime: '10:53', status: 'Received' },
    { inboundNo: 'INB-00124', itemName: 'Fresh Milk 1L', productId: 'PROD-00183', sku: 'MILK-1L', barcode: '8909876543210', batchNo: 'MILK-0905', serialNo: 'N/A (Batch Tracked)', uom: 'Pack', packSize: '1L', expected: 300, scanned: 300, received: 300, accepted: 298, rejected: 0, damaged: 2, shortage: 0, excess: 0, mfgDate: '05-Sep-2026', expiryDate: '08-Sep-2026', bestBefore: '3 Days', remainingShelfLife: '2 Days', temperature: '4.2°C', storageCondition: 'Chilled', qcStatus: 'Passed', scannerId: 'SCN-014', receiver: 'Arjun', scanTime: '10:57', status: 'QC Completed' },
    { inboundNo: 'INB-00124', itemName: 'Coca-Cola 750ml', productId: 'PROD-00184', sku: 'COKE-750', barcode: '8905555555555', batchNo: 'COKE-A82', serialNo: 'N/A (Batch Tracked)', uom: 'Bottle', packSize: '750ml', expected: 200, scanned: 200, received: 200, accepted: 200, rejected: 0, damaged: 0, shortage: 0, excess: 0, mfgDate: '01-Aug-2026', expiryDate: '01-Feb-2027', bestBefore: '6 Months', remainingShelfLife: '148 Days', temperature: '25°C', storageCondition: 'Ambient', qcStatus: 'Passed', scannerId: 'SCN-014', receiver: 'Arjun', scanTime: '11:03', status: 'Ready for Putaway' }
  ],

  // ── 3. INBOUND QC TABLE (TABLE 3) ─────────────────────────────
  inboundQc: [
    { qcId: 'QC-00121', inboundNo: 'INB-00124', itemName: 'Basmati Rice 5kg', sku: 'RICE-BAS-5KG', batchNo: 'BTH-R2408', inspectedQty: 498, acceptedQty: 495, rejectedQty: 1, damagedQty: 2, qcStatus: 'Passed with Exceptions', damageType: 'Torn Packaging', rejectionReason: '1 unit failed packaging inspection', inspector: 'Priya', inspectionTime: '11:20', evidencePhotos: 'IMG-1021', notes: '2 bags moved to damaged area' },
    { qcId: 'QC-00122', inboundNo: 'INB-00124', itemName: 'Fresh Milk 1L', sku: 'MILK-1L', batchNo: 'MILK-0905', inspectedQty: 300, acceptedQty: 298, rejectedQty: 0, damagedQty: 2, qcStatus: 'Passed with Exceptions', damageType: 'Leakage', rejectionReason: 'None', inspector: 'Priya', inspectionTime: '11:28', evidencePhotos: 'IMG-1022', notes: 'Keep accepted stock chilled' },
    { qcId: 'QC-00123', inboundNo: 'INB-00124', itemName: 'Coca-Cola 750ml', sku: 'COKE-750', batchNo: 'COKE-A82', inspectedQty: 200, acceptedQty: 200, rejectedQty: 0, damagedQty: 0, qcStatus: 'Passed', damageType: 'None', rejectionReason: 'None', inspector: 'Priya', inspectionTime: '11:35', evidencePhotos: 'None', notes: 'Ready for storage' }
  ],

  // ── 4. INBOUND SCAN HISTORY TABLE (TABLE 4) ───────────────────
  inboundScans: [
    { scanId: 'SC-98211', inboundNo: 'INB-00124', scannerId: 'SCN-014', user: 'Arjun', scanType: 'Product Receive', barcode: '8901234567890', item: 'Basmati Rice 5kg', sku: 'RICE-BAS-5KG', batch: 'BTH-R2408', quantity: 1, location: 'Dock-03', scanTime: '10:53:12', result: 'Valid' },
    { scanId: 'SC-98212', inboundNo: 'INB-00124', scannerId: 'SCN-014', user: 'Arjun', scanType: 'Product Receive', barcode: '8909876543210', item: 'Fresh Milk 1L', sku: 'MILK-1L', batch: 'MILK-0905', quantity: 1, location: 'Dock-03', scanTime: '10:57:15', result: 'Valid' },
    { scanId: 'SC-98213', inboundNo: 'INB-00124', scannerId: 'SCN-014', user: 'Arjun', scanType: 'Product Receive', barcode: '8905555555555', item: 'Coca-Cola 750ml', sku: 'COKE-750', batch: 'COKE-A82', quantity: 1, location: 'Dock-03', scanTime: '11:03:21', result: 'Valid' }
  ],

  // ── 5. STORAGE / PUTAWAY TABLE (TABLE 5) ──────────────────────
  putawayTasks: [
    { putawayId: 'PUT-00982', inboundNo: 'INB-00124', itemName: 'Basmati Rice 5kg', sku: 'RICE-BAS-5KG', barcode: '8901234567890', batchNo: 'BTH-R2408', serialNo: 'N/A (Batch Tracked)', acceptedQty: 495, putawayQty: 495, pendingQty: 0, warehouse: 'RJY-DS-001', sourceLocation: 'Dock-03', zone: 'Grocery-A', aisle: 'A04', rack: 'R12', shelf: 'S03', bin: 'B04', destinationLocation: 'A04-R12-S03-B04', locationBarcode: 'LOC-A04-R12-S03-B04', storageType: 'Rack', capacity: 500, occupiedQty: 495, availableCapacity: 5, storageCondition: 'Ambient', temperature: '26°C', expiryDate: '15-Aug-2027', fefoPriority: 'Medium', scannerId: 'SCN-014', operator: 'Arjun', status: 'Completed', startedAt: '11:50', completedAt: '12:05' },
    { putawayId: 'PUT-00983', inboundNo: 'INB-00124', itemName: 'Fresh Milk 1L', sku: 'MILK-1L', barcode: '8909876543210', batchNo: 'MILK-0905', serialNo: 'N/A (Batch Tracked)', acceptedQty: 298, putawayQty: 298, pendingQty: 0, warehouse: 'RJY-DS-001', sourceLocation: 'QC-Chilled', zone: 'Chilled-A', aisle: 'A01', rack: 'R02', shelf: 'S01', bin: 'B08', destinationLocation: 'A01-R02-S01-B08', locationBarcode: 'LOC-A01-R02-S01-B08', storageType: 'Cold Rack', capacity: 300, occupiedQty: 298, availableCapacity: 2, storageCondition: 'Chilled', temperature: '4°C', expiryDate: '08-Sep-2026', fefoPriority: 'High', scannerId: 'SCN-014', operator: 'Arjun', status: 'Completed', startedAt: '11:55', completedAt: '12:12' },
    { putawayId: 'PUT-00984', inboundNo: 'INB-00124', itemName: 'Coca-Cola 750ml', sku: 'COKE-750', barcode: '8905555555555', batchNo: 'COKE-A82', serialNo: 'N/A (Batch Tracked)', acceptedQty: 200, putawayQty: 120, pendingQty: 80, warehouse: 'RJY-DS-001', sourceLocation: 'Dock-03', zone: 'Beverage-A', aisle: 'A07', rack: 'R03', shelf: 'S02', bin: 'B12', destinationLocation: 'A07-R03-S02-B12', locationBarcode: 'LOC-A07-R03-S02-B12', storageType: 'Rack', capacity: 400, occupiedQty: 320, availableCapacity: 80, storageCondition: 'Ambient', temperature: '25°C', expiryDate: '01-Feb-2027', fefoPriority: 'Low', scannerId: 'SCN-014', operator: 'Arjun', status: 'In Progress', startedAt: '12:00', completedAt: 'In Progress' }
  ],

  // ── 6. STORAGE LOCATION INVENTORY TABLE (TABLE 6) ─────────────
  locationInventory: [
    { location: 'A04-R12-S03-B04', warehouse: 'RJY-DS-001', zone: 'Grocery-A', aisle: 'A04', rack: 'R12', shelf: 'S03', bin: 'B04', locationBarcode: 'LOC-A04-R12-S03-B04', sku: 'RICE-BAS-5KG', itemName: 'Basmati Rice 5kg', batchNo: 'BTH-R2408', serialNo: 'N/A (Batch Tracked)', availableQty: 493, reservedQty: 2, pickedQty: 0, quarantineQty: 0, damagedQty: 2, capacity: 500, occupancyPct: '99%', mfgDate: '15-Aug-2026', expiryDate: '15-Aug-2027', storageCondition: 'Ambient', temperature: '26°C', stockStatus: 'Available' },
    { location: 'A01-R02-S01-B08', warehouse: 'RJY-DS-001', zone: 'Chilled-A', aisle: 'A01', rack: 'R02', shelf: 'S01', bin: 'B08', locationBarcode: 'LOC-A01-R02-S01-B08', sku: 'MILK-1L', itemName: 'Fresh Milk 1L', batchNo: 'MILK-0905', serialNo: 'N/A (Batch Tracked)', availableQty: 296, reservedQty: 2, pickedQty: 0, quarantineQty: 0, damagedQty: 2, capacity: 300, occupancyPct: '99%', mfgDate: '05-Sep-2026', expiryDate: '08-Sep-2026', storageCondition: 'Chilled', temperature: '4°C', stockStatus: 'Available' },
    { location: 'A07-R03-S02-B12', warehouse: 'RJY-DS-001', zone: 'Beverage-A', aisle: 'A07', rack: 'R03', shelf: 'S02', bin: 'B12', locationBarcode: 'LOC-A07-R03-S02-B12', sku: 'COKE-750', itemName: 'Coca-Cola 750ml', batchNo: 'COKE-A82', serialNo: 'N/A (Batch Tracked)', availableQty: 200, reservedQty: 0, pickedQty: 0, quarantineQty: 0, damagedQty: 0, capacity: 400, occupancyPct: '50%', mfgDate: '01-Aug-2026', expiryDate: '01-Feb-2027', storageCondition: 'Ambient', temperature: '25°C', stockStatus: 'Available' }
  ],

  // ── 7. PICKING TASK TABLE (TABLE 7) ───────────────────────────
  pickingTasks: [
    { pickTaskId: 'PICK-009821', orderId: 'ORD-00124', waveId: 'WAVE-00452', orderType: 'Customer Order', priority: 'High', warehouse: 'RJY-DS-001', picker: 'Rahul', zone: 'Mixed', pickRoute: 'A01 → A04 → A07', sequence: 1, totalItems: 8, totalUnits: 14, pickedItems: 8, pickedUnits: 14, exceptions: 0, startedAt: '12:30', completedAt: '12:48', status: 'Completed' },
    { pickTaskId: 'PICK-009822', orderId: 'ORD-00125', waveId: 'WAVE-00452', orderType: 'Customer Order', priority: 'Normal', warehouse: 'RJY-DS-001', picker: 'Priya', zone: 'Chilled-A', pickRoute: 'A01 → A02', sequence: 2, totalItems: 5, totalUnits: 7, pickedItems: 4, pickedUnits: 6, exceptions: 1, startedAt: '12:32', completedAt: 'In Progress', status: 'In Progress' },
    { pickTaskId: 'PICK-009823', orderId: 'ORD-00126', waveId: 'WAVE-00453', orderType: 'Customer Order', priority: 'Urgent', warehouse: 'RJY-DS-001', picker: 'Arjun', zone: 'Mixed', pickRoute: 'A03 → A04 → A07', sequence: 1, totalItems: 12, totalUnits: 21, pickedItems: 6, pickedUnits: 10, exceptions: 0, startedAt: '12:40', completedAt: 'In Progress', status: 'Picking' }
  ],

  // ── 8. PICKING ITEM DETAIL TABLE (TABLE 8) ────────────────────
  pickingItems: [
    { pickTask: 'PICK-009821', orderId: 'ORD-00124', sequence: 1, itemName: 'Fresh Milk 1L', sku: 'MILK-1L', barcode: '8909876543210', batchNo: 'MILK-0905', expiryDate: '08-Sep-2026', requiredQty: 2, availableQty: 296, reservedQty: 2, pickedQty: 2, shortQty: 0, damagedQty: 0, sourceLocation: 'A01-R02-S01-B08', locationBarcode: 'LOC-A01-R02-S01-B08', scannerId: 'SCN-021', picker: 'Rahul', scanTime: '12:35', fefoApplied: 'Yes', pickMethod: 'Wave', status: 'Picked' },
    { pickTask: 'PICK-009821', orderId: 'ORD-00124', sequence: 2, itemName: 'Basmati Rice 5kg', sku: 'RICE-BAS-5KG', barcode: '8901234567890', batchNo: 'BTH-R2408', expiryDate: '15-Aug-2027', requiredQty: 1, availableQty: 493, reservedQty: 1, pickedQty: 1, shortQty: 0, damagedQty: 0, sourceLocation: 'A04-R12-S03-B04', locationBarcode: 'LOC-A04-R12-S03-B04', scannerId: 'SCN-021', picker: 'Rahul', scanTime: '12:40', fefoApplied: 'Yes', pickMethod: 'Wave', status: 'Picked' },
    { pickTask: 'PICK-009821', orderId: 'ORD-00124', sequence: 3, itemName: 'Coca-Cola 750ml', sku: 'COKE-750', barcode: '8905555555555', batchNo: 'COKE-A82', expiryDate: '01-Feb-2027', requiredQty: 3, availableQty: 200, reservedQty: 3, pickedQty: 3, shortQty: 0, damagedQty: 0, sourceLocation: 'A07-R03-S02-B12', locationBarcode: 'LOC-A07-R03-S02-B12', scannerId: 'SCN-021', picker: 'Rahul', scanTime: '12:44', fefoApplied: 'Yes', pickMethod: 'Wave', status: 'Picked' }
  ],

  // ── 9. PICKING SCAN HISTORY TABLE (TABLE 9) ───────────────────
  pickingScans: [
    { scanId: 'PS-10021', pickTask: 'PICK-009821', order: 'ORD-00124', scanner: 'SCN-021', picker: 'Rahul', scanType: 'Location Scan', sku: 'LOC-BARCODE', barcode: 'LOC-A01-R02-S01-B08', batch: 'BIN-VERIFIED', location: 'A01-R02-S01-B08', quantity: 1, result: 'Valid', scanTime: '12:34:20' },
    { scanId: 'PS-10022', pickTask: 'PICK-009821', order: 'ORD-00124', scanner: 'SCN-021', picker: 'Rahul', scanType: 'Product Scan', sku: 'MILK-1L', barcode: '8909876543210', batch: 'MILK-0905', location: 'A01-R02-S01-B08', quantity: 2, result: 'Valid', scanTime: '12:35:12' },
    { scanId: 'PS-10023', pickTask: 'PICK-009821', order: 'ORD-00124', scanner: 'SCN-021', picker: 'Rahul', scanType: 'Product Scan', sku: 'RICE-BAS-5KG', barcode: '8901234567890', batch: 'BTH-R2408', location: 'A04-R12-S03-B04', quantity: 1, result: 'Valid', scanTime: '12:40:25' }
  ],

  // ── 10. PACKING TABLE (TABLE 10) ──────────────────────────────
  packingRecords: [
    { packingId: 'PACK-00981', orderId: 'ORD-00124', pickTaskId: 'PICK-009821', packageId: 'PKG-009821', packingStation: 'PACK-04', packer: 'Priya', itemsExpected: 8, itemsVerified: 8, units: 14, packageCount: 2, weight: '7.8 kg', dimensions: '40×30×25 cm', packageType: 'Standard Box', packageBarcode: 'PKG890123', sealNo: 'SEAL-48219', qcStatus: 'Passed', packedAt: '13:05', status: 'Packed' },
    { packingId: 'PACK-00982', orderId: 'ORD-00125', pickTaskId: 'PICK-009822', packageId: 'PKG-009822', packingStation: 'PACK-02', packer: 'Kiran', itemsExpected: 5, itemsVerified: 4, units: 6, packageCount: 1, weight: '3.2 kg', dimensions: '30×20×20 cm', packageType: 'Cold Bag', packageBarcode: 'PKG890124', sealNo: 'SEAL-48220', qcStatus: 'Pending', packedAt: 'Packing in Progress', status: 'Packing' }
  ],

  // ── 11. SHIPPING / DISPATCH TABLE (TABLE 11) ──────────────────
  shipmentMaster: [
    { shipmentId: 'SHP-000821', orderId: 'ORD-00124', packageId: 'PKG-009821', warehouse: 'RJY-DS-001', customer: 'Jay', deliveryZone: 'RJY-Z03', items: 8, units: 14, packages: 2, weight: '7.8 kg', transporter: 'Internal Fleet', rider: 'Suresh', vehicle: 'AP05CD4521', route: 'RT-00421', trackingId: 'TRK-982145', dispatchDock: 'DOCK-02', eta: '14:35', dispatchTime: '13:18', deliveryTime: '14:31', status: 'Delivered' },
    { shipmentId: 'SHP-000822', orderId: 'ORD-00125', packageId: 'PKG-009822', warehouse: 'RJY-DS-001', customer: 'Anil', deliveryZone: 'RJY-Z02', items: 5, units: 7, packages: 1, weight: '3.2 kg', transporter: 'Internal Fleet', rider: 'Ravi', vehicle: 'AP05EF7812', route: 'RT-00422', trackingId: 'TRK-982146', dispatchDock: 'DOCK-02', eta: '15:10', dispatchTime: 'Dock Staged', deliveryTime: 'In Transit', status: 'Ready for Dispatch' }
  ],

  // ── 12. SHIPPING / DELIVERY DETAIL TABLE (TABLE 12) ───────────
  shipmentDelivery: [
    { shipmentId: 'SHP-000821', customer: 'Jay', deliveryAddress: 'Rajahmundry', deliverySlot: '14:00–15:00', orderValue: '₹1,245', paymentMethod: 'UPI', paymentStatus: 'Paid', codAmount: 0, packageBarcode: 'PKG890123', shippingLabel: 'LAB-009821', dispatcher: 'Kiran', scannerId: 'SCN-031', transporter: 'Internal Fleet', riderId: 'DP-00152', riderName: 'Suresh', vehicleType: 'Bike', vehicleNumber: 'AP05CD4521', routeSequence: 5, dispatchScanTime: '13:15', deliveryOtp: 'Verified', pod: 'POD-8921', failedReason: '—', returnRequired: 'No', status: 'Delivered' },
    { shipmentId: 'SHP-000822', customer: 'Anil', deliveryAddress: 'Rajahmundry', deliverySlot: '15:00–16:00', orderValue: '₹875', paymentMethod: 'COD', paymentStatus: 'Pending', codAmount: '₹875', packageBarcode: 'PKG890124', shippingLabel: 'LAB-009822', dispatcher: 'Kiran', scannerId: 'SCN-031', transporter: 'Internal Fleet', riderId: 'DP-00153', riderName: 'Ravi', vehicleType: 'Bike', vehicleNumber: 'AP05EF7812', routeSequence: 3, dispatchScanTime: 'Staged at Bay', deliveryOtp: 'Pending Delivery', pod: 'Awaiting Signature', failedReason: 'None', returnRequired: 'No', status: 'Ready' }
  ],

  // ── 13. SHIPPING SCAN HISTORY TABLE (TABLE 13) ────────────────
  shippingScans: [
    { scanId: 'SS-00121', shipmentId: 'SHP-000821', packageId: 'PKG-009821', scannerId: 'SCN-031', user: 'Kiran', scanType: 'Package Verification', location: 'PACK-04', result: 'Valid', scanTime: '13:10' },
    { scanId: 'SS-00122', shipmentId: 'SHP-000821', packageId: 'PKG-009821', scannerId: 'SCN-031', user: 'Kiran', scanType: 'Dispatch Scan', location: 'DOCK-02', result: 'Valid', scanTime: '13:15' },
    { scanId: 'SS-00123', shipmentId: 'SHP-000821', packageId: 'PKG-009821', scannerId: 'SCN-031', user: 'Kiran', scanType: 'Vehicle Assignment', location: 'AP05CD4521', result: 'Valid', scanTime: '13:17' }
  ],

  // ── LEGACY ORDERS FOR LIVE PIPELINE ───────────────────────────
  orders: [
    { orderId: 'ORD-00124', channel: 'App', itemsSummary: 'Basmati Rice 5kg, Milk 1L, Coke 750ml', totalUnits: 14, totalValue: '₹1,245', deliveryStatus: 'Delivered', assignedPicker: 'Rahul', deliveryPartner: 'Internal Fleet', riderName: 'Suresh' },
    { orderId: 'ORD-00125', channel: 'Blinkit', itemsSummary: 'Milk 1L, Coke 750ml', totalUnits: 7, totalValue: '₹875', deliveryStatus: 'Ready for Dispatch', assignedPicker: 'Priya', deliveryPartner: 'Internal Fleet', riderName: 'Ravi' },
    { orderId: 'ORD-00126', channel: 'Zepto', itemsSummary: 'Groceries, Snacks', totalUnits: 21, totalValue: '₹2,490', deliveryStatus: 'Picking', assignedPicker: 'Arjun', deliveryPartner: 'Shadowfax', riderName: 'Unassigned' }
  ],

  // ── LOCATIONS & CATALOG METRICS ───────────────────────────────
  locations: [
    { bin: 'A04-R12-S03-B04', zone: 'Grocery-A', aisle: 'A04', rack: 'R12', shelf: 'S03', binType: 'Pallet Rack', capacity: 500, stored: 495, freeSpace: 5, storedItems: 'Basmati Rice 5kg', tempClass: 'Ambient' },
    { bin: 'A01-R02-S01-B08', zone: 'Chilled-A', aisle: 'A01', rack: 'R02', shelf: 'S01', binType: 'Cold Rack', capacity: 300, stored: 298, freeSpace: 2, storedItems: 'Fresh Milk 1L', tempClass: 'Chilled' },
    { bin: 'A07-R03-S02-B12', zone: 'Beverage-A', aisle: 'A07', rack: 'R03', shelf: 'S02', binType: 'Standard Shelf', capacity: 400, stored: 320, freeSpace: 80, storedItems: 'Coca-Cola 750ml', tempClass: 'Ambient' }
  ],

  products: [
    { sku: 'RICE-BAS-5KG', barcode: '8901234567890', name: 'Basmati Rice 5kg', category: 'Grocery', bin: 'A04-R12-S03-B04', onHand: 495, reserved: 2, available: 493, isNearExpiry: false, nearExpiryBatch: 'BTH-R2408', shippedToday: 14, pendingDemand: 2 },
    { sku: 'MILK-1L', barcode: '8909876543210', name: 'Fresh Milk 1L', category: 'Dairy', bin: 'A01-R02-S01-B08', onHand: 298, reserved: 2, available: 296, isNearExpiry: true, nearExpiryBatch: 'MILK-0905', shippedToday: 10, pendingDemand: 3 },
    { sku: 'COKE-750', barcode: '8905555555555', name: 'Coca-Cola 750ml', category: 'Beverages', bin: 'A07-R03-S02-B12', onHand: 320, reserved: 0, available: 320, isNearExpiry: false, nearExpiryBatch: 'COKE-A82', shippedToday: 6, pendingDemand: 0 }
  ],

  ledger: [
    { id: 'MOV-1001', time: '2026-09-06 10:53', type: 'INWARD_RECEIPT', sku: 'RICE-BAS-5KG', batch: 'BTH-R2408', fromBin: 'Dock-03', toBin: 'A04-R12-S03-B04', qty: '495', employee: 'Arjun', ref: 'INB-00124' },
    { id: 'MOV-1002', time: '2026-09-06 10:57', type: 'INWARD_RECEIPT', sku: 'MILK-1L', batch: 'MILK-0905', fromBin: 'QC-Chilled', toBin: 'A01-R02-S01-B08', qty: '298', employee: 'Arjun', ref: 'INB-00124' }
  ],

  shifts: [
    { id: 'SHF-01', name: 'Arjun Sharma', code: 'EMP-014', role: 'Inbound Receiver', zone: 'Dock-03', activeOrders: 1, pickRate: '65 UPH', status: 'Active' },
    { id: 'SHF-02', name: 'Rahul Kumar', code: 'EMP-035', role: 'Wave Picker', zone: 'Grocery-A', activeOrders: 2, pickRate: '88 UPH', status: 'Active' },
    { id: 'SHF-03', name: 'Priya Patel', code: 'EMP-022', role: 'QC Inspector', zone: 'QC Bay', activeOrders: 0, pickRate: '—', status: 'Active' },
    { id: 'SHF-04', name: 'Kiran Rao', code: 'EMP-048', role: 'Packing Station', zone: 'PACK-04', activeOrders: 3, pickRate: '—', status: 'Active' }
  ]
};

// ==============================================================================
// WAREHOUSEOS SUB-TAB HELPER & DYNAMIC EXCEL EXPORT ENGINE
// ==============================================================================

function renderSubTabs(section, tabs, activeTab) {
  return '<div class="subtab-bar">' +
    tabs.map(t => {
      const activeClass = t.id === activeTab ? ' active' : '';
      const badge = (t.count !== undefined) ? '<span class="subtab-badge">' + t.count + '</span>' : '';
      return '<button class="subtab-pill' + activeClass + '" onclick="switchSubTab(\'' + section + '\', \'' + t.id + '\')"><span>' + t.label + '</span>' + badge + '</button>';
    }).join('') +
  '</div>';
}

function switchSubTab(section, subTabId) {
  if (section === 'inbound') state.inboundSubTab = subTabId;
  else if (section === 'storage') state.storageSubTab = subTabId;
  else if (section === 'picking') state.pickingSubTab = subTabId;
  else if (section === 'packing-shipping') state.packingShippingSubTab = subTabId;
  state.searchTerm = '';
  renderActiveView();
}

function exportActiveViewToExcel() {
  let headers = [];
  let rows = [];
  let filename = 'Zippzo_WMS_Export.csv';

  if (state.activeView === 'inbound') {
    if (state.inboundSubTab === 'shipments') {
      filename = 'Inbound_Main_Shipments.csv';
      headers = ['Inbound No.', 'Type', 'Source', 'Warehouse', 'Items', 'Expected Qty', 'Received Qty', 'Accepted Qty', 'Rejected Qty', 'Damaged Qty', 'Status', 'Expected Arrival', 'Actual Arrival'];
      rows = state.inboundShipments.map(s => [s.inboundNo, s.type, s.source, s.warehouse, s.items, s.expectedQty, s.receivedQty, s.acceptedQty, s.rejectedQty, s.damagedQty, s.status, s.expectedArrival, s.actualArrival]);
    } else if (state.inboundSubTab === 'items') {
      filename = 'Inbound_Product_Receiving_Details.csv';
      headers = ['Inbound No.', 'Item Name', 'Product ID', 'SKU', 'Barcode', 'Batch No.', 'Serial No.', 'UOM', 'Pack Size', 'Expected', 'Scanned', 'Received', 'Accepted', 'Rejected', 'Damaged', 'Shortage', 'Excess', 'Mfg. Date', 'Expiry Date', 'Best Before', 'Remaining Shelf Life', 'Temperature', 'Storage Condition', 'QC Status', 'Scanner ID', 'Receiver', 'Scan Time', 'Status'];
      rows = state.inboundProducts.map(p => [p.inboundNo, p.itemName, p.productId, p.sku, p.barcode, p.batchNo, p.serialNo, p.uom, p.packSize, p.expected, p.scanned, p.received, p.accepted, p.rejected, p.damaged, p.shortage, p.excess, p.mfgDate, p.expiryDate, p.bestBefore, p.remainingShelfLife, p.temperature, p.storageCondition, p.qcStatus, p.scannerId, p.receiver, p.scanTime, p.status]);
    } else if (state.inboundSubTab === 'qc') {
      filename = 'Inbound_QC_Inspections.csv';
      headers = ['QC ID', 'Inbound No.', 'Item Name', 'SKU', 'Batch No.', 'Inspected Qty', 'Accepted Qty', 'Rejected Qty', 'Damaged Qty', 'QC Status', 'Damage Type', 'Rejection Reason', 'Inspector', 'Inspection Time', 'Evidence / Photos', 'Notes'];
      rows = state.inboundQc.map(q => [q.qcId, q.inboundNo, q.itemName, q.sku, q.batchNo, q.inspectedQty, q.acceptedQty, q.rejectedQty, q.damagedQty, q.qcStatus, q.damageType, q.rejectionReason, q.inspector, q.inspectionTime, q.evidencePhotos, q.notes]);
    } else {
      filename = 'Inbound_Scan_History.csv';
      headers = ['Scan ID', 'Inbound No.', 'Scanner ID', 'User', 'Scan Type', 'Barcode', 'Item', 'SKU', 'Batch', 'Quantity', 'Location', 'Scan Time', 'Result'];
      rows = state.inboundScans.map(s => [s.scanId, s.inboundNo, s.scannerId, s.user, s.scanType, s.barcode, s.item, s.sku, s.batch, s.quantity, s.location, s.scanTime, s.result]);
    }
  } else if (state.activeView === 'current-stock') {
    if (state.storageSubTab === 'putaway') {
      filename = 'Storage_Putaway_Tasks.csv';
      headers = ['Putaway ID', 'Inbound No.', 'Item Name', 'SKU', 'Barcode', 'Batch No.', 'Serial No.', 'Accepted Qty', 'Putaway Qty', 'Pending Qty', 'Warehouse', 'Source Location', 'Zone', 'Aisle', 'Rack', 'Shelf', 'Bin', 'Destination Location', 'Location Barcode', 'Storage Type', 'Capacity', 'Occupied Qty', 'Available Capacity', 'Storage Condition', 'Temperature', 'Expiry Date', 'FEFO Priority', 'Scanner ID', 'Operator', 'Status', 'Started At', 'Completed At'];
      rows = state.putawayTasks.map(t => [t.putawayId, t.inboundNo, t.itemName, t.sku, t.barcode, t.batchNo, t.serialNo, t.acceptedQty, t.putawayQty, t.pendingQty, t.warehouse, t.sourceLocation, t.zone, t.aisle, t.rack, t.shelf, t.bin, t.destinationLocation, t.locationBarcode, t.storageType, t.capacity, t.occupiedQty, t.availableCapacity, t.storageCondition, t.temperature, t.expiryDate, t.fefoPriority, t.scannerId, t.operator, t.status, t.startedAt, t.completedAt]);
    } else {
      filename = 'Storage_Location_Inventory.csv';
      headers = ['Location', 'Warehouse', 'Zone', 'Aisle', 'Rack', 'Shelf', 'Bin', 'Location Barcode', 'SKU', 'Item Name', 'Batch No.', 'Serial No.', 'Available Qty', 'Reserved Qty', 'Picked Qty', 'Quarantine Qty', 'Damaged Qty', 'Capacity', 'Occupancy %', 'Mfg. Date', 'Expiry Date', 'Storage Condition', 'Temperature', 'Stock Status'];
      rows = state.locationInventory.map(l => [l.location, l.warehouse, l.zone, l.aisle, l.rack, l.shelf, l.bin, l.locationBarcode, l.sku, l.itemName, l.batchNo, l.serialNo, l.availableQty, l.reservedQty, l.pickedQty, l.quarantineQty, l.damagedQty, l.capacity, l.occupancyPct, l.mfgDate, l.expiryDate, l.storageCondition, l.temperature, l.stockStatus]);
    }
  } else if (state.activeView === 'pick-waves') {
    if (state.pickingSubTab === 'tasks') {
      filename = 'Picking_Tasks.csv';
      headers = ['Pick Task ID', 'Order ID', 'Wave ID', 'Order Type', 'Priority', 'Warehouse', 'Picker', 'Zone', 'Pick Route', 'Sequence', 'Total Items', 'Total Units', 'Picked Items', 'Picked Units', 'Exceptions', 'Started At', 'Completed At', 'Status'];
      rows = state.pickingTasks.map(p => [p.pickTaskId, p.orderId, p.waveId, p.orderType, p.priority, p.warehouse, p.picker, p.zone, p.pickRoute, p.sequence, p.totalItems, p.totalUnits, p.pickedItems, p.pickedUnits, p.exceptions, p.startedAt, p.completedAt, p.status]);
    } else if (state.pickingSubTab === 'items') {
      filename = 'Picking_Item_Details.csv';
      headers = ['Pick Task', 'Order ID', 'Sequence', 'Item Name', 'SKU', 'Barcode', 'Batch No.', 'Expiry Date', 'Required Qty', 'Available Qty', 'Reserved Qty', 'Picked Qty', 'Short Qty', 'Damaged Qty', 'Source Location', 'Location Barcode', 'Scanner ID', 'Picker', 'Scan Time', 'FEFO Applied', 'Pick Method', 'Status'];
      rows = state.pickingItems.map(p => [p.pickTask, p.orderId, p.sequence, p.itemName, p.sku, p.barcode, p.batchNo, p.expiryDate, p.requiredQty, p.availableQty, p.reservedQty, p.pickedQty, p.shortQty, p.damagedQty, p.sourceLocation, p.locationBarcode, p.scannerId, p.picker, p.scanTime, p.fefoApplied, p.pickMethod, p.status]);
    } else {
      filename = 'Picking_Scan_History.csv';
      headers = ['Scan ID', 'Pick Task', 'Order', 'Scanner', 'Picker', 'Scan Type', 'SKU', 'Barcode', 'Batch', 'Location', 'Quantity', 'Result', 'Scan Time'];
      rows = state.pickingScans.map(s => [s.scanId, s.pickTask, s.order, s.scanner, s.picker, s.scanType, s.sku, s.barcode, s.batch, s.location, s.quantity, s.result, s.scanTime]);
    }
  } else if (state.packingShippingSubTab === 'packing') {
    filename = 'Packing_Records.csv';
    headers = ['Packing ID', 'Order ID', 'Pick Task ID', 'Package ID', 'Packing Station', 'Packer', 'Items Expected', 'Items Verified', 'Units', 'Package Count', 'Weight', 'Dimensions', 'Package Type', 'Package Barcode', 'Seal No.', 'QC Status', 'Packed At', 'Status'];
    rows = state.packingRecords.map(p => [p.packingId, p.orderId, p.pickTaskId, p.packageId, p.packingStation, p.packer, p.itemsExpected, p.itemsVerified, p.units, p.packageCount, p.weight, p.dimensions, p.packageType, p.packageBarcode, p.sealNo, p.qcStatus, p.packedAt, p.status]);
  } else if (state.packingShippingSubTab === 'shipments') {
    filename = 'Shipping_Dispatch_Master.csv';
    headers = ['Shipment ID', 'Order ID', 'Package ID', 'Warehouse', 'Customer', 'Delivery Zone', 'Items', 'Units', 'Packages', 'Weight', 'Transporter', 'Rider', 'Vehicle', 'Route', 'Tracking ID', 'Dispatch Dock', 'ETA', 'Dispatch Time', 'Delivery Time', 'Status'];
    rows = state.shipmentMaster.map(s => [s.shipmentId, s.orderId, s.packageId, s.warehouse, s.customer, s.deliveryZone, s.items, s.units, s.packages, s.weight, s.transporter, s.rider, s.vehicle, s.route, s.trackingId, s.dispatchDock, s.eta, s.dispatchTime, s.deliveryTime, s.status]);
  } else if (state.packingShippingSubTab === 'delivery') {
    filename = 'Shipping_Delivery_Details.csv';
    headers = ['Shipment ID', 'Customer', 'Delivery Address', 'Delivery Slot', 'Order Value', 'Payment Method', 'Payment Status', 'COD Amount', 'Package Barcode', 'Shipping Label', 'Dispatcher', 'Scanner ID', 'Transporter', 'Rider ID', 'Rider Name', 'Vehicle Type', 'Vehicle Number', 'Route Sequence', 'Dispatch Scan Time', 'Delivery OTP', 'POD', 'Failed Reason', 'Return Required', 'Status'];
    rows = state.shipmentDelivery.map(d => [d.shipmentId, d.customer, d.deliveryAddress, d.deliverySlot, d.orderValue, d.paymentMethod, d.paymentStatus, d.codAmount, d.packageBarcode, d.shippingLabel, d.dispatcher, d.scannerId, d.transporter, d.riderId, d.riderName, d.vehicleType, d.vehicleNumber, d.routeSequence, d.dispatchScanTime, d.deliveryOtp, d.pod, d.failedReason, d.returnRequired, d.status]);
  } else {
    filename = 'Shipping_Scan_History.csv';
    headers = ['Scan ID', 'Shipment ID', 'Package ID', 'Scanner ID', 'User', 'Scan Type', 'Location', 'Result', 'Scan Time'];
    rows = state.shippingScans.map(s => [s.scanId, s.shipmentId, s.packageId, s.scannerId, s.user, s.scanType, s.location, s.result, s.scanTime]);
  }

  const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => '"' + String(cell !== undefined && cell !== null ? cell : '').replace(/"/g, '""') + '"').join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Exported ' + filename + ' (' + rows.length + ' records)');
}

// ==============================================================================
// AUTHENTICATION & NAVIGATION
// ==============================================================================

function initApp() {
  renderSidebar();
  renderActiveView();
  updateUserDisplay();
}

function renderLoginScreen() {
  const loginScreen = document.getElementById('login-screen');
  const sidebar = document.getElementById('sidebar');
  const mainWrapper = document.querySelector('.main-wrapper');
  if (loginScreen) loginScreen.style.display = 'flex';
  if (sidebar) sidebar.style.display = 'none';
  if (mainWrapper) mainWrapper.style.display = 'none';
}

function hideAuthScreens() {
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.style.display = 'none';
}

function showDashboard() {
  const sidebar = document.getElementById('sidebar');
  const mainWrapper = document.querySelector('.main-wrapper');
  if (sidebar) sidebar.style.display = 'flex';
  if (mainWrapper) mainWrapper.style.display = 'flex';
}

let pendingAuthRequestId = null;
let pendingAuthEmail = null;

function resetLoginToEmail() {
  const emailStep = document.getElementById('email-step-form');
  const codeStep = document.getElementById('code-step-form');
  const emailMsg = document.getElementById('email-status-msg');
  const codeMsg = document.getElementById('code-status-msg');
  if (emailStep) emailStep.style.display = 'block';
  if (codeStep) codeStep.style.display = 'none';
  if (emailMsg) emailMsg.style.display = 'none';
  if (codeMsg) codeMsg.style.display = 'none';
  const codeInput = document.getElementById('login-code');
  if (codeInput) codeInput.value = '';
}

async function handleSendEmailCode(e, isResend = false) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const emailMsg = document.getElementById('email-status-msg');
  const codeMsg = document.getElementById('code-status-msg');
  const btnSend = document.getElementById('btn-send-code');
  const email = (emailInput ? emailInput.value : '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    if (emailMsg) {
      emailMsg.style.display = 'block';
      emailMsg.style.color = 'var(--color-rust-red)';
      emailMsg.innerText = 'Please enter a valid organisation email address.';
    }
    return;
  }

  pendingAuthEmail = email;
  if (btnSend) {
    btnSend.disabled = true;
    btnSend.innerText = 'Sending Code...';
  }

  try {
    const res = await api.sendCode(email);
    pendingAuthRequestId = res.request_id;
    
    // Switch to step 2
    const emailStep = document.getElementById('email-step-form');
    const codeStep = document.getElementById('code-step-form');
    if (emailStep) emailStep.style.display = 'none';
    if (codeStep) codeStep.style.display = 'block';

    const codeInput = document.getElementById('login-code');
    if (res.code_hint && codeInput) {
      codeInput.value = res.code_hint;
    }

    if (codeMsg) {
      codeMsg.style.display = 'block';
      codeMsg.style.color = 'var(--color-steel-blue)';
      codeMsg.innerText = 'Verification code sent to ' + email + (res.code_hint ? ' (Code: ' + res.code_hint + ')' : '');
    }

    showToast('Verification code sent to ' + email);
    if (codeInput) codeInput.focus();
  } catch (err) {
    if (emailMsg) {
      emailMsg.style.display = 'block';
      emailMsg.style.color = 'var(--color-rust-red)';
      emailMsg.innerText = err.message || 'Failed to send verification code. Please try again.';
    }
    showToast('Failed to send verification code: ' + err.message);
  } finally {
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.innerText = 'Send Verification Code';
    }
  }
}

async function handleVerifyEmailCode(e) {
  if (e) e.preventDefault();
  const codeInput = document.getElementById('login-code');
  const codeMsg = document.getElementById('code-status-msg');
  const btnVerify = document.getElementById('btn-verify-code');
  const code = (codeInput ? codeInput.value : '').trim();

  if (!code || code.length !== 6) {
    if (codeMsg) {
      codeMsg.style.display = 'block';
      codeMsg.style.color = 'var(--color-rust-red)';
      codeMsg.innerText = 'Please enter the 6-digit verification code.';
    }
    return;
  }

  if (btnVerify) {
    btnVerify.disabled = true;
    btnVerify.innerText = 'Verifying Code...';
  }

  try {
    const res = await api.verifyCode(pendingAuthEmail, code, pendingAuthRequestId);
    appMode = 'live';
    hideAuthScreens();
    showDashboard();
    updateUserDisplay();
    initApp();
    showToast('Welcome ' + (res.user?.first_name || res.user?.username || pendingAuthEmail) + '! Operations terminal authorized.');
  } catch (err) {
    if (codeMsg) {
      codeMsg.style.display = 'block';
      codeMsg.style.color = 'var(--color-rust-red)';
      codeMsg.innerText = err.message || 'Invalid or expired verification code.';
    }
    showToast('Verification failed: ' + err.message);
  } finally {
    if (btnVerify) {
      btnVerify.disabled = false;
      btnVerify.innerText = 'Verify & Sign In';
    }
  }
}

function quickFillLogin(email) {
  const emailEl = document.getElementById('login-email');
  if (emailEl) emailEl.value = email;
  handleSendEmailCode();
}

// Backward compatibility alias
function handleLogin(e) {
  handleSendEmailCode(e);
}


function enterDemoMode() {
  appMode = 'demo';
  if (typeof TokenManager !== 'undefined') TokenManager.clear();
  hideAuthScreens();
  showDashboard();
  updateUserDisplay();
  state.activeView = 'inbound';
  renderSidebar();
  renderActiveView();
  showToast('Entered demo mode as Shift Lead (Arjun Sharma)');
}

function handleLogoutClick() {
  if (typeof api !== 'undefined') api.logout();
  appMode = 'demo';
  renderLoginScreen();
  showToast('Logged out of organisation session.');
}

function updateUserDisplay() {
  const sidebarLabel = document.getElementById('sidebar-user-label');
  const topbarUsername = document.getElementById('topbar-username');

  if (appMode === 'live' && typeof TokenManager !== 'undefined') {
    const user = TokenManager.getUser();
    if (user) {
      const roleStr = user.roles && user.roles.length ? user.roles[0].toUpperCase() : 'ADMIN';
      if (sidebarLabel) sidebarLabel.innerText = `${user.username} (${roleStr})`;
      if (topbarUsername) topbarUsername.innerText = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.username;
    }
  } else {
    if (sidebarLabel) sidebarLabel.innerText = 'Shift Lead: Arjun (EMP-014)';
    if (topbarUsername) topbarUsername.innerText = 'Arjun Sharma';
  }
}

function navigateTo(viewName, e) {
  if (e) e.preventDefault();
  state.activeView = viewName;
  state.searchTerm = '';
  renderSidebar();
  renderActiveView();
}

function renderSidebar() {
  const links = document.querySelectorAll('.sidebar-nav .nav-link');
  links.forEach(l => {
    if (l.getAttribute('data-view') === state.activeView) {
      l.classList.add('active');
    } else {
      l.classList.remove('active');
    }
  });
}

function renderActiveView() {
  const contentArea = document.getElementById('content-area');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');
  const topbarBtn = document.getElementById('topbar-add-btn');

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
      navigateTo('inbound');
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

// ==============================================================================
// 1. INBOUND OPERATIONS (TABLES 1 - 4)
// ==============================================================================

function renderInboundTableView() {
  const tabs = [
    { id: 'shipments', label: '1. Main Shipments', count: state.inboundShipments.length },
    { id: 'items', label: '2. Product Receiving Details', count: state.inboundProducts.length },
    { id: 'qc', label: '3. Inbound QC Inspections', count: state.inboundQc.length },
    { id: 'scans', label: '4. Inbound Scan History', count: state.inboundScans.length }
  ];

  const subTabHtml = renderSubTabs('inbound', tabs, state.inboundSubTab);
  let tableContent = '';
  let countLabel = '';

  if (state.inboundSubTab === 'shipments') {
    countLabel = `${state.inboundShipments.length} consignments`;
    const filtered = state.inboundShipments.filter(s =>
      !state.searchTerm ||
      s.inboundNo.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.source.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.status.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Inbound No.</th>
            <th>Type</th>
            <th>Source</th>
            <th>Warehouse</th>
            <th class="table-num-cell">Items</th>
            <th class="table-num-cell">Expected Qty</th>
            <th class="table-num-cell">Received Qty</th>
            <th class="table-num-cell">Accepted Qty</th>
            <th class="table-num-cell">Rejected Qty</th>
            <th class="table-num-cell">Damaged Qty</th>
            <th>Status</th>
            <th>Expected Arrival</th>
            <th>Actual Arrival</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td><strong>${s.inboundNo}</strong></td>
              <td>${s.type}</td>
              <td><strong>${s.source}</strong></td>
              <td><span class="barcode-mono">${s.warehouse}</span></td>
              <td class="table-num-cell">${s.items}</td>
              <td class="table-num-cell">${typeof s.expectedQty === 'number' ? s.expectedQty.toLocaleString() : s.expectedQty}</td>
              <td class="table-num-cell">${typeof s.receivedQty === 'number' ? s.receivedQty.toLocaleString() : s.receivedQty}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${typeof s.acceptedQty === 'number' ? s.acceptedQty.toLocaleString() : s.acceptedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red);">${s.rejectedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${s.damagedQty}</td>
              <td><span class="status-tag">${s.status}</span></td>
              <td>${s.expectedArrival}</td>
              <td>${s.actualArrival}</td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('inbound-shipment', '${s.inboundNo}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.inboundSubTab === 'items') {
    countLabel = `${state.inboundProducts.length} product entries`;
    const filtered = state.inboundProducts.filter(p =>
      !state.searchTerm ||
      p.inboundNo.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.itemName.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.barcode.includes(state.searchTerm) ||
      p.batchNo.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Inbound No.</th>
            <th>Item Name</th>
            <th>Product ID</th>
            <th>SKU</th>
            <th>Barcode</th>
            <th>Batch No.</th>
            <th>Serial No.</th>
            <th>UOM</th>
            <th>Pack Size</th>
            <th class="table-num-cell">Expected</th>
            <th class="table-num-cell">Scanned</th>
            <th class="table-num-cell">Received</th>
            <th class="table-num-cell">Accepted</th>
            <th class="table-num-cell">Rejected</th>
            <th class="table-num-cell">Damaged</th>
            <th class="table-num-cell">Shortage</th>
            <th class="table-num-cell">Excess</th>
            <th>Mfg. Date</th>
            <th>Expiry Date</th>
            <th>Best Before</th>
            <th>Remaining Shelf Life</th>
            <th>Temperature</th>
            <th>Storage Condition</th>
            <th>QC Status</th>
            <th>Scanner ID</th>
            <th>Receiver</th>
            <th>Scan Time</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(p => `
            <tr>
              <td><strong>${p.inboundNo}</strong></td>
              <td><strong>${p.itemName}</strong></td>
              <td><span class="barcode-mono">${p.productId}</span></td>
              <td><strong style="color:var(--color-steel-blue);">${p.sku}</strong></td>
              <td><span class="barcode-mono">${p.barcode}</span></td>
              <td><span class="barcode-mono">${p.batchNo}</span></td>
              <td>${p.serialNo}</td>
              <td>${p.uom}</td>
              <td>${p.packSize}</td>
              <td class="table-num-cell">${p.expected}</td>
              <td class="table-num-cell">${p.scanned}</td>
              <td class="table-num-cell">${p.received}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${p.accepted}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red);">${p.rejected}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${p.damaged}</td>
              <td class="table-num-cell">${p.shortage}</td>
              <td class="table-num-cell">${p.excess}</td>
              <td>${p.mfgDate}</td>
              <td><strong>${p.expiryDate}</strong></td>
              <td>${p.bestBefore}</td>
              <td>${p.remainingShelfLife}</td>
              <td><span class="badge-temperature ${p.storageCondition === 'Chilled' ? 'badge-chilled' : 'badge-ambient'}">${p.temperature}</span></td>
              <td>${p.storageCondition}</td>
              <td><span class="status-tag">${p.qcStatus}</span></td>
              <td>${p.scannerId}</td>
              <td>${p.receiver}</td>
              <td>${p.scanTime}</td>
              <td><span class="status-tag">${p.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('inbound-product', '${p.productId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.inboundSubTab === 'qc') {
    countLabel = `${state.inboundQc.length} QC inspections`;
    const filtered = state.inboundQc.filter(q =>
      !state.searchTerm ||
      q.qcId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      q.inboundNo.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      q.sku.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      q.inspector.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>QC ID</th>
            <th>Inbound No.</th>
            <th>Item Name</th>
            <th>SKU</th>
            <th>Batch No.</th>
            <th class="table-num-cell">Inspected Qty</th>
            <th class="table-num-cell">Accepted Qty</th>
            <th class="table-num-cell">Rejected Qty</th>
            <th class="table-num-cell">Damaged Qty</th>
            <th>QC Status</th>
            <th>Damage Type</th>
            <th>Rejection Reason</th>
            <th>Inspector</th>
            <th>Inspection Time</th>
            <th>Evidence / Photos</th>
            <th>Notes</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(q => `
            <tr>
              <td><strong>${q.qcId}</strong></td>
              <td>${q.inboundNo}</td>
              <td><strong>${q.itemName}</strong></td>
              <td><span class="barcode-mono">${q.sku}</span></td>
              <td><span class="barcode-mono">${q.batchNo}</span></td>
              <td class="table-num-cell">${q.inspectedQty}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${q.acceptedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red);">${q.rejectedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${q.damagedQty}</td>
              <td><span class="status-tag">${q.qcStatus}</span></td>
              <td>${q.damageType}</td>
              <td>${q.rejectionReason}</td>
              <td>${q.inspector}</td>
              <td>${q.inspectionTime}</td>
              <td>${q.evidencePhotos}</td>
              <td>${q.notes}</td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('inbound-qc', '${q.qcId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    countLabel = `${state.inboundScans.length} scan logs`;
    const filtered = state.inboundScans.filter(s =>
      !state.searchTerm ||
      s.scanId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.inboundNo.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.barcode.includes(state.searchTerm) ||
      s.user.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Scan ID</th>
            <th>Inbound No.</th>
            <th>Scanner ID</th>
            <th>User</th>
            <th>Scan Type</th>
            <th>Barcode</th>
            <th>Item</th>
            <th>SKU</th>
            <th>Batch</th>
            <th class="table-num-cell">Quantity</th>
            <th>Location</th>
            <th>Scan Time</th>
            <th>Result</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td><strong>${s.scanId}</strong></td>
              <td>${s.inboundNo}</td>
              <td>${s.scannerId}</td>
              <td>${s.user}</td>
              <td>${s.scanType}</td>
              <td><span class="barcode-mono">${s.barcode}</span></td>
              <td><strong>${s.item}</strong></td>
              <td><span class="barcode-mono">${s.sku}</span></td>
              <td>${s.batch}</td>
              <td class="table-num-cell">${s.quantity}</td>
              <td>${s.location}</td>
              <td>${s.scanTime}</td>
              <td><span class="status-tag">${s.result}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('inbound-scan', '${s.scanId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <div class="table-view-container">
      ${subTabHtml}

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Inbound Intake & Inspection Control</span>
          <span class="badge-count">${countLabel}</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" placeholder="Search Inbound Records..." value="${state.searchTerm}" oninput="state.searchTerm = this.value; renderActiveView();">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Download Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openAddInboundModal()">+ Add Inbound</button>
        </div>
      </div>

      <div class="table-responsive">
        ${tableContent}
      </div>
    </div>
  `;
}

// ==============================================================================
// 2. STORAGE & PUTAWAY OPERATIONS (TABLES 5 - 6)
// ==============================================================================

function renderStockView() {
  const tabs = [
    { id: 'putaway', label: '5. Putaway Tasks', count: state.putawayTasks.length },
    { id: 'inventory', label: '6. Location Inventory (Bin-Level)', count: state.locationInventory.length }
  ];

  const subTabHtml = renderSubTabs('storage', tabs, state.storageSubTab);
  let tableContent = '';
  let countLabel = '';

  if (state.storageSubTab === 'putaway') {
    countLabel = `${state.putawayTasks.length} putaway tasks`;
    const filtered = state.putawayTasks.filter(t =>
      !state.searchTerm ||
      t.putawayId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      t.inboundNo.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      t.sku.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      t.destinationLocation.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Putaway ID</th>
            <th>Inbound No.</th>
            <th>Item Name</th>
            <th>SKU</th>
            <th>Barcode</th>
            <th>Batch No.</th>
            <th>Serial No.</th>
            <th class="table-num-cell">Accepted Qty</th>
            <th class="table-num-cell">Putaway Qty</th>
            <th class="table-num-cell">Pending Qty</th>
            <th>Warehouse</th>
            <th>Source Location</th>
            <th>Zone</th>
            <th>Aisle</th>
            <th>Rack</th>
            <th>Shelf</th>
            <th>Bin</th>
            <th>Destination Location</th>
            <th>Location Barcode</th>
            <th>Storage Type</th>
            <th class="table-num-cell">Capacity</th>
            <th class="table-num-cell">Occupied Qty</th>
            <th class="table-num-cell">Available Capacity</th>
            <th>Storage Condition</th>
            <th>Temperature</th>
            <th>Expiry Date</th>
            <th>FEFO Priority</th>
            <th>Scanner ID</th>
            <th>Operator</th>
            <th>Status</th>
            <th>Started At</th>
            <th>Completed At</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(t => `
            <tr>
              <td><strong>${t.putawayId}</strong></td>
              <td>${t.inboundNo}</td>
              <td><strong>${t.itemName}</strong></td>
              <td><strong style="color:var(--color-steel-blue);">${t.sku}</strong></td>
              <td><span class="barcode-mono">${t.barcode}</span></td>
              <td><span class="barcode-mono">${t.batchNo}</span></td>
              <td>${t.serialNo}</td>
              <td class="table-num-cell">${t.acceptedQty}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${t.putawayQty}</td>
              <td class="table-num-cell" style="color:${t.pendingQty > 0 ? 'var(--color-rust-red)' : 'inherit'}; font-weight:700;">${t.pendingQty}</td>
              <td>${t.warehouse}</td>
              <td>${t.sourceLocation}</td>
              <td>${t.zone}</td>
              <td>${t.aisle}</td>
              <td>${t.rack}</td>
              <td>${t.shelf}</td>
              <td>${t.bin}</td>
              <td><span class="barcode-mono" style="color:var(--color-steel-blue); font-weight:700;">${t.destinationLocation}</span></td>
              <td><span class="barcode-mono">${t.locationBarcode}</span></td>
              <td>${t.storageType}</td>
              <td class="table-num-cell">${t.capacity}</td>
              <td class="table-num-cell">${t.occupiedQty}</td>
              <td class="table-num-cell">${t.availableCapacity}</td>
              <td>${t.storageCondition}</td>
              <td>${t.temperature}</td>
              <td><strong>${t.expiryDate}</strong></td>
              <td><span class="status-tag">${t.fefoPriority}</span></td>
              <td>${t.scannerId}</td>
              <td>${t.operator}</td>
              <td><span class="status-tag">${t.status}</span></td>
              <td>${t.startedAt}</td>
              <td>${t.completedAt}</td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('putaway-task', '${t.putawayId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    countLabel = `${state.locationInventory.length} bin locations`;
    const filtered = state.locationInventory.filter(l =>
      !state.searchTerm ||
      l.location.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      l.sku.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      l.itemName.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      l.zone.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Warehouse</th>
            <th>Zone</th>
            <th>Aisle</th>
            <th>Rack</th>
            <th>Shelf</th>
            <th>Bin</th>
            <th>Location Barcode</th>
            <th>SKU</th>
            <th>Item Name</th>
            <th>Batch No.</th>
            <th>Serial No.</th>
            <th class="table-num-cell">Available Qty</th>
            <th class="table-num-cell">Reserved Qty</th>
            <th class="table-num-cell">Picked Qty</th>
            <th class="table-num-cell">Quarantine Qty</th>
            <th class="table-num-cell">Damaged Qty</th>
            <th class="table-num-cell">Capacity</th>
            <th class="table-num-cell">Occupancy %</th>
            <th>Mfg. Date</th>
            <th>Expiry Date</th>
            <th>Storage Condition</th>
            <th>Temperature</th>
            <th>Stock Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(l => `
            <tr>
              <td><strong style="color:var(--color-steel-blue); font-family:monospace;">${l.location}</strong></td>
              <td>${l.warehouse}</td>
              <td>${l.zone}</td>
              <td>${l.aisle}</td>
              <td>${l.rack}</td>
              <td>${l.shelf}</td>
              <td>${l.bin}</td>
              <td><span class="barcode-mono">${l.locationBarcode}</span></td>
              <td><strong>${l.sku}</strong></td>
              <td>${l.itemName}</td>
              <td><span class="barcode-mono">${l.batchNo}</span></td>
              <td>${l.serialNo}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:700;">${l.availableQty}</td>
              <td class="table-num-cell" style="color:#8c6310;">${l.reservedQty}</td>
              <td class="table-num-cell">${l.pickedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red);">${l.quarantineQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${l.damagedQty}</td>
              <td class="table-num-cell">${l.capacity}</td>
              <td class="table-num-cell" style="font-weight:700;">${l.occupancyPct}</td>
              <td>${l.mfgDate}</td>
              <td><strong>${l.expiryDate}</strong></td>
              <td>${l.storageCondition}</td>
              <td>${l.temperature}</td>
              <td><span class="status-tag">${l.stockStatus}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('location-inventory', '${l.location}_${l.sku}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <div class="table-view-container">
      ${subTabHtml}

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Storage Bin Inventory & Putaway Tracking</span>
          <span class="badge-count">${countLabel}</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" placeholder="Search Storage / Bin Records..." value="${state.searchTerm}" oninput="state.searchTerm = this.value; renderActiveView();">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Download Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openTransferStockModal()">+ Transfer Stock</button>
        </div>
      </div>

      <div class="table-responsive">
        ${tableContent}
      </div>
    </div>
  `;
}

// ==============================================================================
// 3. PICKING OPERATIONS (TABLES 7 - 9)
// ==============================================================================

function renderPickWavesView() {
  const tabs = [
    { id: 'tasks', label: '7. Picking Tasks', count: state.pickingTasks.length },
    { id: 'items', label: '8. Picking Item Details', count: state.pickingItems.length },
    { id: 'scans', label: '9. Picking Scan History', count: state.pickingScans.length }
  ];

  const subTabHtml = renderSubTabs('picking', tabs, state.pickingSubTab);
  let tableContent = '';
  let countLabel = '';

  if (state.pickingSubTab === 'tasks') {
    countLabel = `${state.pickingTasks.length} pick tasks`;
    const filtered = state.pickingTasks.filter(p =>
      !state.searchTerm ||
      p.pickTaskId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.orderId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.waveId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.picker.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Pick Task ID</th>
            <th>Order ID</th>
            <th>Wave ID</th>
            <th>Order Type</th>
            <th>Priority</th>
            <th>Warehouse</th>
            <th>Picker</th>
            <th>Zone</th>
            <th>Pick Route</th>
            <th class="table-num-cell">Sequence</th>
            <th class="table-num-cell">Total Items</th>
            <th class="table-num-cell">Total Units</th>
            <th class="table-num-cell">Picked Items</th>
            <th class="table-num-cell">Picked Units</th>
            <th class="table-num-cell">Exceptions</th>
            <th>Started At</th>
            <th>Completed At</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(p => `
            <tr>
              <td><strong>${p.pickTaskId}</strong></td>
              <td><strong>${p.orderId}</strong></td>
              <td><span class="barcode-mono">${p.waveId}</span></td>
              <td>${p.orderType}</td>
              <td><span class="status-tag">${p.priority}</span></td>
              <td>${p.warehouse}</td>
              <td><strong>${p.picker}</strong></td>
              <td>${p.zone}</td>
              <td><span class="barcode-mono" style="color:var(--color-steel-blue); font-weight:700;">${p.pickRoute}</span></td>
              <td class="table-num-cell">${p.sequence}</td>
              <td class="table-num-cell">${p.totalItems}</td>
              <td class="table-num-cell"><strong>${p.totalUnits}</strong></td>
              <td class="table-num-cell">${p.pickedItems}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${p.pickedUnits}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${p.exceptions}</td>
              <td>${p.startedAt}</td>
              <td>${p.completedAt}</td>
              <td><span class="status-tag">${p.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('picking-task', '${p.pickTaskId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.pickingSubTab === 'items') {
    countLabel = `${state.pickingItems.length} pick item entries`;
    const filtered = state.pickingItems.filter(i =>
      !state.searchTerm ||
      i.pickTask.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      i.orderId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      i.itemName.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      i.sku.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Pick Task</th>
            <th>Order ID</th>
            <th class="table-num-cell">Sequence</th>
            <th>Item Name</th>
            <th>SKU</th>
            <th>Barcode</th>
            <th>Batch No.</th>
            <th>Expiry Date</th>
            <th class="table-num-cell">Required Qty</th>
            <th class="table-num-cell">Available Qty</th>
            <th class="table-num-cell">Reserved Qty</th>
            <th class="table-num-cell">Picked Qty</th>
            <th class="table-num-cell">Short Qty</th>
            <th class="table-num-cell">Damaged Qty</th>
            <th>Source Location</th>
            <th>Location Barcode</th>
            <th>Scanner ID</th>
            <th>Picker</th>
            <th>Scan Time</th>
            <th>FEFO Applied</th>
            <th>Pick Method</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(i => `
            <tr>
              <td><strong>${i.pickTask}</strong></td>
              <td><strong>${i.orderId}</strong></td>
              <td class="table-num-cell">${i.sequence}</td>
              <td><strong>${i.itemName}</strong></td>
              <td><strong style="color:var(--color-steel-blue);">${i.sku}</strong></td>
              <td><span class="barcode-mono">${i.barcode}</span></td>
              <td><span class="barcode-mono">${i.batchNo}</span></td>
              <td><strong>${i.expiryDate}</strong></td>
              <td class="table-num-cell"><strong>${i.requiredQty}</strong></td>
              <td class="table-num-cell">${i.availableQty}</td>
              <td class="table-num-cell">${i.reservedQty}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:700;">${i.pickedQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red);">${i.shortQty}</td>
              <td class="table-num-cell" style="color:var(--color-rust-red); font-weight:700;">${i.damagedQty}</td>
              <td><span class="barcode-mono" style="color:var(--color-steel-blue);">${i.sourceLocation}</span></td>
              <td><span class="barcode-mono">${i.locationBarcode}</span></td>
              <td>${i.scannerId}</td>
              <td>${i.picker}</td>
              <td>${i.scanTime}</td>
              <td>${i.fefoApplied}</td>
              <td>${i.pickMethod}</td>
              <td><span class="status-tag">${i.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('picking-item', '${i.pickTask}_${i.sku}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    countLabel = `${state.pickingScans.length} pick scan logs`;
    const filtered = state.pickingScans.filter(s =>
      !state.searchTerm ||
      s.scanId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.pickTask.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.barcode.includes(state.searchTerm)
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Scan ID</th>
            <th>Pick Task</th>
            <th>Order</th>
            <th>Scanner</th>
            <th>Picker</th>
            <th>Scan Type</th>
            <th>SKU</th>
            <th>Barcode</th>
            <th>Batch</th>
            <th>Location</th>
            <th class="table-num-cell">Quantity</th>
            <th>Result</th>
            <th>Scan Time</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td><strong>${s.scanId}</strong></td>
              <td>${s.pickTask}</td>
              <td>${s.order}</td>
              <td>${s.scanner}</td>
              <td>${s.picker}</td>
              <td>${s.scanType}</td>
              <td><span class="barcode-mono">${s.sku}</span></td>
              <td><span class="barcode-mono">${s.barcode}</span></td>
              <td>${s.batch}</td>
              <td>${s.location}</td>
              <td class="table-num-cell">${s.quantity}</td>
              <td><span class="status-tag">${s.result}</span></td>
              <td>${s.scanTime}</td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('picking-scan', '${s.scanId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <div class="table-view-container">
      ${subTabHtml}

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Wave Picking & Bin Path Routing</span>
          <span class="badge-count">${countLabel}</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" placeholder="Search Picking Tasks / Items..." value="${state.searchTerm}" oninput="state.searchTerm = this.value; renderActiveView();">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Download Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openCreatePickWaveModal()">+ Create Pick Wave</button>
        </div>
      </div>

      <div class="table-responsive">
        ${tableContent}
      </div>
    </div>
  `;
}

// ==============================================================================
// 4. PACKING & SHIPPING OPERATIONS (TABLES 10 - 13)
// ==============================================================================

function renderPackingDispatchView() {
  const tabs = [
    { id: 'packing', label: '10. Packing Records', count: state.packingRecords.length },
    { id: 'shipments', label: '11. Shipping / Dispatch', count: state.shipmentMaster.length },
    { id: 'delivery', label: '12. Shipping / Delivery Details', count: state.shipmentDelivery.length },
    { id: 'scans', label: '13. Shipping Scan History', count: state.shippingScans.length }
  ];

  const subTabHtml = renderSubTabs('packing-shipping', tabs, state.packingShippingSubTab);
  let tableContent = '';
  let countLabel = '';

  if (state.packingShippingSubTab === 'packing') {
    countLabel = `${state.packingRecords.length} packing orders`;
    const filtered = state.packingRecords.filter(p =>
      !state.searchTerm ||
      p.packingId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.orderId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      p.packageId.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Packing ID</th>
            <th>Order ID</th>
            <th>Pick Task ID</th>
            <th>Package ID</th>
            <th>Packing Station</th>
            <th>Packer</th>
            <th class="table-num-cell">Items Expected</th>
            <th class="table-num-cell">Items Verified</th>
            <th class="table-num-cell">Units</th>
            <th class="table-num-cell">Package Count</th>
            <th>Weight</th>
            <th>Dimensions</th>
            <th>Package Type</th>
            <th>Package Barcode</th>
            <th>Seal No.</th>
            <th>QC Status</th>
            <th>Packed At</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(p => `
            <tr>
              <td><strong>${p.packingId}</strong></td>
              <td><strong>${p.orderId}</strong></td>
              <td>${p.pickTaskId}</td>
              <td><span class="barcode-mono">${p.packageId}</span></td>
              <td>${p.packingStation}</td>
              <td><strong>${p.packer}</strong></td>
              <td class="table-num-cell">${p.itemsExpected}</td>
              <td class="table-num-cell" style="color:#2b7a4b; font-weight:600;">${p.itemsVerified}</td>
              <td class="table-num-cell"><strong>${p.units}</strong></td>
              <td class="table-num-cell">${p.packageCount}</td>
              <td><strong>${p.weight}</strong></td>
              <td>${p.dimensions}</td>
              <td>${p.packageType}</td>
              <td><span class="barcode-mono">${p.packageBarcode}</span></td>
              <td><span class="barcode-mono">${p.sealNo}</span></td>
              <td><span class="status-tag">${p.qcStatus}</span></td>
              <td>${p.packedAt}</td>
              <td><span class="status-tag">${p.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('packing-record', '${p.packingId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.packingShippingSubTab === 'shipments') {
    countLabel = `${state.shipmentMaster.length} shipments`;
    const filtered = state.shipmentMaster.filter(s =>
      !state.searchTerm ||
      s.shipmentId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.customer.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.trackingId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.status.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Shipment ID</th>
            <th>Order ID</th>
            <th>Package ID</th>
            <th>Warehouse</th>
            <th>Customer</th>
            <th>Delivery Zone</th>
            <th class="table-num-cell">Items</th>
            <th class="table-num-cell">Units</th>
            <th class="table-num-cell">Packages</th>
            <th>Weight</th>
            <th>Transporter</th>
            <th>Rider</th>
            <th>Vehicle</th>
            <th>Route</th>
            <th>Tracking ID</th>
            <th>Dispatch Dock</th>
            <th>ETA</th>
            <th>Dispatch Time</th>
            <th>Delivery Time</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td><strong>${s.shipmentId}</strong></td>
              <td><strong>${s.orderId}</strong></td>
              <td><span class="barcode-mono">${s.packageId}</span></td>
              <td>${s.warehouse}</td>
              <td><strong>${s.customer}</strong></td>
              <td>${s.deliveryZone}</td>
              <td class="table-num-cell">${s.items}</td>
              <td class="table-num-cell">${s.units}</td>
              <td class="table-num-cell">${s.packages}</td>
              <td>${s.weight}</td>
              <td>${s.transporter}</td>
              <td><strong>${s.rider}</strong></td>
              <td><span class="barcode-mono">${s.vehicle}</span></td>
              <td>${s.route}</td>
              <td><span class="barcode-mono" style="color:var(--color-steel-blue);">${s.trackingId}</span></td>
              <td>${s.dispatchDock}</td>
              <td>${s.eta}</td>
              <td>${s.dispatchTime}</td>
              <td>${s.deliveryTime}</td>
              <td><span class="status-tag">${s.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('shipping-master', '${s.shipmentId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (state.packingShippingSubTab === 'delivery') {
    countLabel = `${state.shipmentDelivery.length} delivery records`;
    const filtered = state.shipmentDelivery.filter(d =>
      !state.searchTerm ||
      d.shipmentId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      d.customer.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      d.deliveryAddress.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Shipment ID</th>
            <th>Customer</th>
            <th>Delivery Address</th>
            <th>Delivery Slot</th>
            <th class="table-num-cell">Order Value</th>
            <th>Payment Method</th>
            <th>Payment Status</th>
            <th class="table-num-cell">COD Amount</th>
            <th>Package Barcode</th>
            <th>Shipping Label</th>
            <th>Dispatcher</th>
            <th>Scanner ID</th>
            <th>Transporter</th>
            <th>Rider ID</th>
            <th>Rider Name</th>
            <th>Vehicle Type</th>
            <th>Vehicle Number</th>
            <th class="table-num-cell">Route Sequence</th>
            <th>Dispatch Scan Time</th>
            <th>Delivery OTP</th>
            <th>POD</th>
            <th>Failed Reason</th>
            <th>Return Required</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(d => `
            <tr>
              <td><strong>${d.shipmentId}</strong></td>
              <td><strong>${d.customer}</strong></td>
              <td>${d.deliveryAddress}</td>
              <td>${d.deliverySlot}</td>
              <td class="table-num-cell"><strong>${d.orderValue}</strong></td>
              <td>${d.paymentMethod}</td>
              <td><span class="status-tag">${d.paymentStatus}</span></td>
              <td class="table-num-cell">${d.codAmount}</td>
              <td><span class="barcode-mono">${d.packageBarcode}</span></td>
              <td><span class="barcode-mono">${d.shippingLabel}</span></td>
              <td>${d.dispatcher}</td>
              <td>${d.scannerId}</td>
              <td>${d.transporter}</td>
              <td>${d.riderId}</td>
              <td><strong>${d.riderName}</strong></td>
              <td>${d.vehicleType}</td>
              <td><span class="barcode-mono">${d.vehicleNumber}</span></td>
              <td class="table-num-cell">${d.routeSequence}</td>
              <td>${d.dispatchScanTime}</td>
              <td>${d.deliveryOtp}</td>
              <td>${d.pod}</td>
              <td>${d.failedReason}</td>
              <td>${d.returnRequired}</td>
              <td><span class="status-tag">${d.status}</span></td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('delivery-detail', '${d.shipmentId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    countLabel = `${state.shippingScans.length} dispatch scans`;
    const filtered = state.shippingScans.filter(s =>
      !state.searchTerm ||
      s.scanId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.shipmentId.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      s.packageId.toLowerCase().includes(state.searchTerm.toLowerCase())
    );
    tableContent = `
      <table class="wms-table">
        <thead>
          <tr>
            <th>Scan ID</th>
            <th>Shipment ID</th>
            <th>Package ID</th>
            <th>Scanner ID</th>
            <th>User</th>
            <th>Scan Type</th>
            <th>Location</th>
            <th>Result</th>
            <th>Scan Time</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => `
            <tr>
              <td><strong>${s.scanId}</strong></td>
              <td><strong>${s.shipmentId}</strong></td>
              <td><span class="barcode-mono">${s.packageId}</span></td>
              <td>${s.scannerId}</td>
              <td>${s.user}</td>
              <td>${s.scanType}</td>
              <td>${s.location}</td>
              <td><span class="status-tag">${s.result}</span></td>
              <td>${s.scanTime}</td>
              <td style="text-align:center;">
                <button class="btn-row-edit" onclick="openEditRecordModal('shipping-scan', '${s.scanId}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <div class="table-view-container">
      ${subTabHtml}

      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Packing Station & Dispatch Fleet Management</span>
          <span class="badge-count">${countLabel}</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" placeholder="Search Shipping / Packing Records..." value="${state.searchTerm}" oninput="state.searchTerm = this.value; renderActiveView();">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Download Excel</button>
          <button class="btn-sm btn-sm-primary" onclick="openCreateDispatchModal()">+ Create Dispatch</button>
        </div>
      </div>

      <div class="table-responsive">
        ${tableContent}
      </div>
    </div>
  `;
}

// ==============================================================================
// 5. LIVE ORDERS PIPELINE VIEW
// ==============================================================================

function renderOrdersPipelineView() {
  const totalOrders = state.orders.length;
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Live Sales Orders & Fulfillment</span>
          <span class="badge-count">${totalOrders} orders</span>
        </div>
        <div class="table-header-right">
          <input type="text" class="search-input" placeholder="Search Orders..." value="${state.searchTerm}" oninput="state.searchTerm = this.value; renderActiveView();">
          <button class="btn-sm btn-sm-excel" onclick="exportActiveViewToExcel()">Download Excel</button>
        </div>
      </div>
      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Channel</th>
              <th>Items Summary</th>
              <th class="table-num-cell">Total Units</th>
              <th class="table-num-cell">Order Value</th>
              <th>Delivery Status</th>
              <th>Assigned Picker</th>
              <th>Delivery Partner</th>
              <th>Rider Name</th>
            </tr>
          </thead>
          <tbody>
            ${state.orders.filter(o => !state.searchTerm || o.orderId.toLowerCase().includes(state.searchTerm.toLowerCase()) || o.itemsSummary.toLowerCase().includes(state.searchTerm.toLowerCase())).map(o => `
              <tr>
                <td><strong>${o.orderId}</strong></td>
                <td>${o.channel}</td>
                <td>${o.itemsSummary}</td>
                <td class="table-num-cell"><strong>${o.totalUnits}</strong></td>
                <td class="table-num-cell"><strong>${o.totalValue}</strong></td>
                <td><span class="status-tag">${o.deliveryStatus}</span></td>
                <td>${o.assignedPicker}</td>
                <td>${o.deliveryPartner}</td>
                <td>${o.riderName}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==============================================================================
// 6. STORAGE LOCATIONS, PRODUCTS, LEDGER & SHIFTS
// ==============================================================================

function renderWarehouseLocationsView() {
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Warehouse Storage Bins & Layout</span>
          <span class="badge-count">${state.locations.length} bins</span>
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
              <th>Storage Type</th>
              <th class="table-num-cell">Max Capacity</th>
              <th class="table-num-cell">Stored Units</th>
              <th class="table-num-cell">Free Space</th>
              <th>Stored Items</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            ${state.locations.map(l => `
              <tr>
                <td><strong style="color:var(--color-steel-blue); font-family:monospace;">${l.bin}</strong></td>
                <td><strong>${l.zone}</strong></td>
                <td>${l.aisle}</td>
                <td>${l.rack} - ${l.shelf}</td>
                <td>${l.binType}</td>
                <td class="table-num-cell">${l.capacity}</td>
                <td class="table-num-cell" style="font-weight:700;">${l.stored}</td>
                <td class="table-num-cell" style="color:#2b7a4b; font-weight:700;">${l.freeSpace}</td>
                <td>${l.storedItems}</td>
                <td><span class="status-tag">${l.tempClass}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderProductsView() {
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Product Catalog & Demand</span>
          <span class="badge-count">${state.products.length} products</span>
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
              <th class="table-num-cell">On Hand</th>
              <th class="table-num-cell">Reserved</th>
              <th class="table-num-cell">Available</th>
              <th>Batch (FEFO)</th>
              <th class="table-num-cell">Shipped Today</th>
              <th class="table-num-cell">Demand</th>
            </tr>
          </thead>
          <tbody>
            ${state.products.map(p => `
              <tr>
                <td><strong>${p.sku}</strong><br><span class="barcode-mono">${p.barcode}</span></td>
                <td><strong>${p.name}</strong></td>
                <td>${p.category}</td>
                <td><strong style="color:var(--color-steel-blue); font-family:monospace;">${p.bin}</strong></td>
                <td class="table-num-cell" style="font-weight:700;">${p.onHand}</td>
                <td class="table-num-cell">${p.reserved}</td>
                <td class="table-num-cell" style="color:#2b7a4b; font-weight:700;">${p.available}</td>
                <td><span class="status-tag">${p.nearExpiryBatch}</span></td>
                <td class="table-num-cell">${p.shippedToday}</td>
                <td class="table-num-cell">${p.pendingDemand}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStockLedgerView() {
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Stock Movement History</span>
          <span class="badge-count">${state.ledger.length} movements</span>
        </div>
      </div>
      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Movement ID</th>
              <th>Timestamp</th>
              <th>Action Type</th>
              <th>SKU</th>
              <th>Batch</th>
              <th>From Location</th>
              <th>To Location</th>
              <th class="table-num-cell">Quantity</th>
              <th>Operator</th>
              <th>Ref</th>
            </tr>
          </thead>
          <tbody>
            ${state.ledger.map(m => `
              <tr>
                <td><strong>${m.id}</strong></td>
                <td>${m.time}</td>
                <td><span class="status-tag">${m.type}</span></td>
                <td><strong>${m.sku}</strong></td>
                <td><span class="barcode-mono">${m.batch}</span></td>
                <td>${m.fromBin}</td>
                <td>${m.toBin}</td>
                <td class="table-num-cell" style="font-weight:700;">${m.qty}</td>
                <td>${m.employee}</td>
                <td>${m.ref}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderFloorShiftsView() {
  return `
    <div class="table-view-container">
      <div class="table-header-strip">
        <div class="table-header-left">
          <span class="table-title">Worker Floor Shifts</span>
          <span class="badge-count">${state.shifts.length} workers</span>
        </div>
      </div>
      <div class="table-responsive">
        <table class="wms-table">
          <thead>
            <tr>
              <th>Shift ID</th>
              <th>Staff Name</th>
              <th>Employee Code</th>
              <th>Role</th>
              <th>Designated Zone</th>
              <th class="table-num-cell">Active Tasks</th>
              <th class="table-num-cell">Pick Rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${state.shifts.map(s => `
              <tr>
                <td><strong>${s.id}</strong></td>
                <td><strong>${s.name}</strong></td>
                <td><span class="barcode-mono">${s.code}</span></td>
                <td>${s.role}</td>
                <td>${s.zone}</td>
                <td class="table-num-cell">${s.activeOrders}</td>
                <td class="table-num-cell">${s.pickRate}</td>
                <td><span class="status-tag">${s.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ==============================================================================
// ENTERPRISE RECORD QUICK EDIT ENGINE (ALL 13 TABLES)
// ==============================================================================

function openEditRecordModal(tableType, recordId) {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  let title = 'Edit Record';
  let fieldsHtml = '';

  if (tableType === 'inbound-shipment') {
    const rec = state.inboundShipments.find(s => s.inboundNo === recordId);
    if (!rec) return;
    title = 'Edit Inbound Consignment: ' + rec.inboundNo;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Inbound No.</label>
          <input type="text" class="form-input" value="${rec.inboundNo}" disabled>
        </div>
        <div class="form-group">
          <label>Source / Supplier</label>
          <input type="text" class="form-input" id="edit-source" value="${rec.source}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Expected Qty</label>
          <input type="number" class="form-input" id="edit-expected" value="${rec.expectedQty}">
        </div>
        <div class="form-group">
          <label>Received Qty</label>
          <input type="number" class="form-input" id="edit-received" value="${rec.receivedQty}">
        </div>
        <div class="form-group">
          <label>Accepted Qty</label>
          <input type="number" class="form-input" id="edit-accepted" value="${rec.acceptedQty}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Rejected Qty</label>
          <input type="number" class="form-input" id="edit-rejected" value="${rec.rejectedQty}">
        </div>
        <div class="form-group">
          <label>Damaged Qty</label>
          <input type="number" class="form-input" id="edit-damaged" value="${rec.damagedQty}">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Scheduled" ${rec.status === 'Scheduled' ? 'selected' : ''}>Scheduled</option>
            <option value="Receiving" ${rec.status === 'Receiving' ? 'selected' : ''}>Receiving</option>
            <option value="QC Completed" ${rec.status === 'QC Completed' ? 'selected' : ''}>QC Completed</option>
            <option value="Putaway Pending" ${rec.status === 'Putaway Pending' ? 'selected' : ''}>Putaway Pending</option>
            <option value="Completed" ${rec.status === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Expected Arrival</label>
          <input type="text" class="form-input" id="edit-exp-arrival" value="${rec.expectedArrival}">
        </div>
        <div class="form-group">
          <label>Actual Arrival</label>
          <input type="text" class="form-input" id="edit-act-arrival" value="${rec.actualArrival}">
        </div>
      </div>
    `;
  } else if (tableType === 'inbound-product') {
    const rec = state.inboundProducts.find(p => p.productId === recordId || p.sku === recordId);
    if (!rec) return;
    title = 'Edit Receiving Item: ' + rec.itemName + ' (' + rec.sku + ')';
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Item Name</label>
          <input type="text" class="form-input" id="edit-item-name" value="${rec.itemName}">
        </div>
        <div class="form-group">
          <label>Batch No.</label>
          <input type="text" class="form-input" id="edit-batch-no" value="${rec.batchNo}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Expected</label>
          <input type="number" class="form-input" id="edit-expected" value="${rec.expected}">
        </div>
        <div class="form-group">
          <label>Scanned</label>
          <input type="number" class="form-input" id="edit-scanned" value="${rec.scanned}">
        </div>
        <div class="form-group">
          <label>Received</label>
          <input type="number" class="form-input" id="edit-received" value="${rec.received}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Accepted</label>
          <input type="number" class="form-input" id="edit-accepted" value="${rec.accepted}">
        </div>
        <div class="form-group">
          <label>Rejected</label>
          <input type="number" class="form-input" id="edit-rejected" value="${rec.rejected}">
        </div>
        <div class="form-group">
          <label>Damaged</label>
          <input type="number" class="form-input" id="edit-damaged" value="${rec.damaged}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>QC Status</label>
          <select class="form-select" id="edit-qc-status">
            <option value="Passed" ${rec.qcStatus === 'Passed' ? 'selected' : ''}>Passed</option>
            <option value="Failed" ${rec.qcStatus === 'Failed' ? 'selected' : ''}>Failed</option>
            <option value="Pending" ${rec.qcStatus === 'Pending' ? 'selected' : ''}>Pending</option>
          </select>
        </div>
        <div class="form-group">
          <label>Storage Condition</label>
          <select class="form-select" id="edit-storage-cond">
            <option value="Ambient" ${rec.storageCondition === 'Ambient' ? 'selected' : ''}>Ambient</option>
            <option value="Chilled" ${rec.storageCondition === 'Chilled' ? 'selected' : ''}>Chilled</option>
            <option value="Frozen" ${rec.storageCondition === 'Frozen' ? 'selected' : ''}>Frozen</option>
          </select>
        </div>
        <div class="form-group">
          <label>Temperature</label>
          <input type="text" class="form-input" id="edit-temperature" value="${rec.temperature}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Expiry Date</label>
          <input type="text" class="form-input" id="edit-expiry-date" value="${rec.expiryDate}">
        </div>
        <div class="form-group">
          <label>Overall Status</label>
          <select class="form-select" id="edit-status">
            <option value="Received" ${rec.status === 'Received' ? 'selected' : ''}>Received</option>
            <option value="QC Completed" ${rec.status === 'QC Completed' ? 'selected' : ''}>QC Completed</option>
            <option value="Ready for Putaway" ${rec.status === 'Ready for Putaway' ? 'selected' : ''}>Ready for Putaway</option>
            <option value="Putaway Completed" ${rec.status === 'Putaway Completed' ? 'selected' : ''}>Putaway Completed</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'inbound-qc') {
    const rec = state.inboundQc.find(q => q.qcId === recordId);
    if (!rec) return;
    title = 'Edit QC Inspection: ' + rec.qcId + ' (' + rec.itemName + ')';
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Inspector</label>
          <input type="text" class="form-input" id="edit-inspector" value="${rec.inspector}">
        </div>
        <div class="form-group">
          <label>QC Status</label>
          <select class="form-select" id="edit-qc-status">
            <option value="Passed" ${rec.qcStatus === 'Passed' ? 'selected' : ''}>Passed</option>
            <option value="Passed with Exceptions" ${rec.qcStatus === 'Passed with Exceptions' ? 'selected' : ''}>Passed with Exceptions</option>
            <option value="Failed" ${rec.qcStatus === 'Failed' ? 'selected' : ''}>Failed</option>
          </select>
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Inspected Qty</label>
          <input type="number" class="form-input" id="edit-inspected" value="${rec.inspectedQty}">
        </div>
        <div class="form-group">
          <label>Accepted Qty</label>
          <input type="number" class="form-input" id="edit-accepted" value="${rec.acceptedQty}">
        </div>
        <div class="form-group">
          <label>Damaged Qty</label>
          <input type="number" class="form-input" id="edit-damaged" value="${rec.damagedQty}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Damage Type</label>
          <input type="text" class="form-input" id="edit-damage-type" value="${rec.damageType}">
        </div>
        <div class="form-group">
          <label>Rejection Reason</label>
          <input type="text" class="form-input" id="edit-rejection-reason" value="${rec.rejectionReason}">
        </div>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Inspection Notes</label>
        <input type="text" class="form-input" id="edit-notes" value="${rec.notes}">
      </div>
    `;
  } else if (tableType === 'inbound-scan') {
    const rec = state.inboundScans.find(s => s.scanId === recordId);
    if (!rec) return;
    title = 'Edit Scan Log: ' + rec.scanId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Scan Type</label>
          <input type="text" class="form-input" id="edit-scan-type" value="${rec.scanType}">
        </div>
        <div class="form-group">
          <label>Location</label>
          <input type="text" class="form-input" id="edit-location" value="${rec.location}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Quantity</label>
          <input type="number" class="form-input" id="edit-qty" value="${rec.quantity}">
        </div>
        <div class="form-group">
          <label>Result</label>
          <select class="form-select" id="edit-result">
            <option value="Valid" ${rec.result === 'Valid' ? 'selected' : ''}>Valid</option>
            <option value="Invalid" ${rec.result === 'Invalid' ? 'selected' : ''}>Invalid</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'putaway-task') {
    const rec = state.putawayTasks.find(t => t.putawayId === recordId);
    if (!rec) return;
    title = 'Edit Putaway Task: ' + rec.putawayId + ' (' + rec.itemName + ')';
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Destination Location</label>
          <input type="text" class="form-input" id="edit-dest-location" value="${rec.destinationLocation}">
        </div>
        <div class="form-group">
          <label>Assigned Operator</label>
          <input type="text" class="form-input" id="edit-operator" value="${rec.operator}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Accepted Qty</label>
          <input type="number" class="form-input" id="edit-accepted" value="${rec.acceptedQty}">
        </div>
        <div class="form-group">
          <label>Putaway Qty</label>
          <input type="number" class="form-input" id="edit-putaway" value="${rec.putawayQty}">
        </div>
        <div class="form-group">
          <label>Pending Qty</label>
          <input type="number" class="form-input" id="edit-pending" value="${rec.pendingQty}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>FEFO Priority</label>
          <select class="form-select" id="edit-fefo-priority">
            <option value="High" ${rec.fefoPriority === 'High' ? 'selected' : ''}>High</option>
            <option value="Medium" ${rec.fefoPriority === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Low" ${rec.fefoPriority === 'Low' ? 'selected' : ''}>Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Pending" ${rec.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="In Progress" ${rec.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Completed" ${rec.status === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'location-inventory') {
    const rec = state.locationInventory.find(l => (l.location + '_' + l.sku) === recordId || l.location === recordId);
    if (!rec) return;
    title = 'Adjust Bin Stock: ' + rec.location + ' (' + rec.itemName + ')';
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Location</label>
          <input type="text" class="form-input" value="${rec.location}" disabled>
        </div>
        <div class="form-group">
          <label>SKU</label>
          <input type="text" class="form-input" value="${rec.sku}" disabled>
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Available Qty</label>
          <input type="number" class="form-input" id="edit-avail" value="${rec.availableQty}">
        </div>
        <div class="form-group">
          <label>Reserved Qty</label>
          <input type="number" class="form-input" id="edit-reserved" value="${rec.reservedQty}">
        </div>
        <div class="form-group">
          <label>Quarantine Qty</label>
          <input type="number" class="form-input" id="edit-quarantine" value="${rec.quarantineQty}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Damaged Qty</label>
          <input type="number" class="form-input" id="edit-damaged" value="${rec.damagedQty}">
        </div>
        <div class="form-group">
          <label>Stock Status</label>
          <select class="form-select" id="edit-status">
            <option value="Available" ${rec.stockStatus === 'Available' ? 'selected' : ''}>Available</option>
            <option value="Low Stock" ${rec.stockStatus === 'Low Stock' ? 'selected' : ''}>Low Stock</option>
            <option value="Quarantine" ${rec.stockStatus === 'Quarantine' ? 'selected' : ''}>Quarantine</option>
            <option value="Blocked" ${rec.stockStatus === 'Blocked' ? 'selected' : ''}>Blocked</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'picking-task') {
    const rec = state.pickingTasks.find(p => p.pickTaskId === recordId);
    if (!rec) return;
    title = 'Edit Picking Task: ' + rec.pickTaskId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Assigned Picker</label>
          <input type="text" class="form-input" id="edit-picker" value="${rec.picker}">
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select class="form-select" id="edit-priority">
            <option value="Urgent" ${rec.priority === 'Urgent' ? 'selected' : ''}>Urgent</option>
            <option value="High" ${rec.priority === 'High' ? 'selected' : ''}>High</option>
            <option value="Normal" ${rec.priority === 'Normal' ? 'selected' : ''}>Normal</option>
          </select>
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Picked Items</label>
          <input type="number" class="form-input" id="edit-picked-items" value="${rec.pickedItems}">
        </div>
        <div class="form-group">
          <label>Picked Units</label>
          <input type="number" class="form-input" id="edit-picked-units" value="${rec.pickedUnits}">
        </div>
        <div class="form-group">
          <label>Exceptions</label>
          <input type="number" class="form-input" id="edit-exceptions" value="${rec.exceptions}">
        </div>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Status</label>
        <select class="form-select" id="edit-status">
          <option value="Picking" ${rec.status === 'Picking' ? 'selected' : ''}>Picking</option>
          <option value="In Progress" ${rec.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="Completed" ${rec.status === 'Completed' ? 'selected' : ''}>Completed</option>
        </select>
      </div>
    `;
  } else if (tableType === 'picking-item') {
    const rec = state.pickingItems.find(p => (p.pickTask + '_' + p.sku) === recordId || p.sku === recordId);
    if (!rec) return;
    title = 'Edit Pick Item: ' + rec.itemName + ' (' + rec.sku + ')';
    fieldsHtml = `
      <div class="form-grid-3col">
        <div class="form-group">
          <label>Required Qty</label>
          <input type="number" class="form-input" id="edit-required" value="${rec.requiredQty}">
        </div>
        <div class="form-group">
          <label>Picked Qty</label>
          <input type="number" class="form-input" id="edit-picked" value="${rec.pickedQty}">
        </div>
        <div class="form-group">
          <label>Short Qty</label>
          <input type="number" class="form-input" id="edit-short" value="${rec.shortQty}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Damaged Qty</label>
          <input type="number" class="form-input" id="edit-damaged" value="${rec.damagedQty}">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Pending" ${rec.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Picking" ${rec.status === 'Picking' ? 'selected' : ''}>Picking</option>
            <option value="Picked" ${rec.status === 'Picked' ? 'selected' : ''}>Picked</option>
            <option value="Shortage" ${rec.status === 'Shortage' ? 'selected' : ''}>Shortage</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'picking-scan') {
    const rec = state.pickingScans.find(s => s.scanId === recordId);
    if (!rec) return;
    title = 'Edit Pick Scan: ' + rec.scanId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Quantity</label>
          <input type="number" class="form-input" id="edit-qty" value="${rec.quantity || 1}">
        </div>
        <div class="form-group">
          <label>Result</label>
          <select class="form-select" id="edit-result">
            <option value="Valid" ${rec.result === 'Valid' ? 'selected' : ''}>Valid</option>
            <option value="Invalid" ${rec.result === 'Invalid' ? 'selected' : ''}>Invalid</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'packing-record') {
    const rec = state.packingRecords.find(p => p.packingId === recordId);
    if (!rec) return;
    title = 'Edit Packing Record: ' + rec.packingId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Packer Staff</label>
          <input type="text" class="form-input" id="edit-packer" value="${rec.packer}">
        </div>
        <div class="form-group">
          <label>Package Seal No.</label>
          <input type="text" class="form-input" id="edit-seal-no" value="${rec.sealNo}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Items Verified</label>
          <input type="number" class="form-input" id="edit-items-verified" value="${rec.itemsVerified}">
        </div>
        <div class="form-group">
          <label>Package Count</label>
          <input type="number" class="form-input" id="edit-package-count" value="${rec.packageCount}">
        </div>
        <div class="form-group">
          <label>Weight</label>
          <input type="text" class="form-input" id="edit-weight" value="${rec.weight}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>QC Status</label>
          <select class="form-select" id="edit-qc-status">
            <option value="Passed" ${rec.qcStatus === 'Passed' ? 'selected' : ''}>Passed</option>
            <option value="Pending" ${rec.qcStatus === 'Pending' ? 'selected' : ''}>Pending</option>
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Packing" ${rec.status === 'Packing' ? 'selected' : ''}>Packing</option>
            <option value="Packed" ${rec.status === 'Packed' ? 'selected' : ''}>Packed</option>
            <option value="Staged" ${rec.status === 'Staged' ? 'selected' : ''}>Staged</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'shipping-master') {
    const rec = state.shipmentMaster.find(s => s.shipmentId === recordId);
    if (!rec) return;
    title = 'Edit Shipment: ' + rec.shipmentId;
    fieldsHtml = `
      <div class="form-grid-3col">
        <div class="form-group">
          <label>Transporter</label>
          <input type="text" class="form-input" id="edit-transporter" value="${rec.transporter}">
        </div>
        <div class="form-group">
          <label>Rider Name</label>
          <input type="text" class="form-input" id="edit-rider" value="${rec.rider}">
        </div>
        <div class="form-group">
          <label>Vehicle Number</label>
          <input type="text" class="form-input" id="edit-vehicle" value="${rec.vehicle}">
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Dispatch Dock</label>
          <input type="text" class="form-input" id="edit-dock" value="${rec.dispatchDock}">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Ready for Dispatch" ${rec.status === 'Ready for Dispatch' ? 'selected' : ''}>Ready for Dispatch</option>
            <option value="Dispatched" ${rec.status === 'Dispatched' ? 'selected' : ''}>Dispatched</option>
            <option value="Out for Delivery" ${rec.status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
            <option value="Delivered" ${rec.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
          </select>
        </div>
      </div>
    `;
  } else if (tableType === 'delivery-detail') {
    const rec = state.shipmentDelivery.find(d => d.shipmentId === recordId);
    if (!rec) return;
    title = 'Edit Delivery Detail: ' + rec.shipmentId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Delivery Address</label>
          <input type="text" class="form-input" id="edit-address" value="${rec.deliveryAddress}">
        </div>
        <div class="form-group">
          <label>Delivery Slot</label>
          <input type="text" class="form-input" id="edit-slot" value="${rec.deliverySlot}">
        </div>
      </div>
      <div class="form-grid-3col" style="margin-top:10px;">
        <div class="form-group">
          <label>Payment Status</label>
          <select class="form-select" id="edit-pay-status">
            <option value="Paid" ${rec.paymentStatus === 'Paid' ? 'selected' : ''}>Paid</option>
            <option value="Pending" ${rec.paymentStatus === 'Pending' ? 'selected' : ''}>Pending</option>
          </select>
        </div>
        <div class="form-group">
          <label>COD Amount</label>
          <input type="text" class="form-input" id="edit-cod" value="${rec.codAmount}">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-select" id="edit-status">
            <option value="Ready" ${rec.status === 'Ready' ? 'selected' : ''}>Ready</option>
            <option value="Out for Delivery" ${rec.status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
            <option value="Delivered" ${rec.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
          </select>
        </div>
      </div>
      <div class="form-grid-2col" style="margin-top:10px;">
        <div class="form-group">
          <label>Delivery OTP Status</label>
          <input type="text" class="form-input" id="edit-otp" value="${rec.deliveryOtp}">
        </div>
        <div class="form-group">
          <label>Proof of Delivery (POD)</label>
          <input type="text" class="form-input" id="edit-pod" value="${rec.pod}">
        </div>
      </div>
    `;
  } else if (tableType === 'shipping-scan') {
    const rec = state.shippingScans.find(s => s.scanId === recordId);
    if (!rec) return;
    title = 'Edit Shipping Scan: ' + rec.scanId;
    fieldsHtml = `
      <div class="form-grid-2col">
        <div class="form-group">
          <label>Location</label>
          <input type="text" class="form-input" id="edit-location" value="${rec.location}">
        </div>
        <div class="form-group">
          <label>Result</label>
          <select class="form-select" id="edit-result">
            <option value="Valid" ${rec.result === 'Valid' ? 'selected' : ''}>Valid</option>
            <option value="Invalid" ${rec.result === 'Invalid' ? 'selected' : ''}>Invalid</option>
          </select>
        </div>
      </div>
    `;
  }

  modalLayer.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="btn-modal-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveEditRecord('${tableType}', '${recordId}', event)" style="padding: 16px;">
          ${fieldsHtml}
          <div style="margin-top: 18px; display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn-sm btn-sm-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveEditRecord(tableType, recordId, e) {
  if (e) e.preventDefault();

  if (tableType === 'inbound-shipment') {
    const rec = state.inboundShipments.find(s => s.inboundNo === recordId);
    if (rec) {
      const source = document.getElementById('edit-source');
      const exp = document.getElementById('edit-expected');
      const recd = document.getElementById('edit-received');
      const acc = document.getElementById('edit-accepted');
      const rej = document.getElementById('edit-rejected');
      const dam = document.getElementById('edit-damaged');
      const stat = document.getElementById('edit-status');
      const expArr = document.getElementById('edit-exp-arrival');
      const actArr = document.getElementById('edit-act-arrival');
      if (source) rec.source = source.value;
      if (exp) rec.expectedQty = Number(exp.value) || rec.expectedQty;
      if (recd) rec.receivedQty = Number(recd.value) || rec.receivedQty;
      if (acc) rec.acceptedQty = Number(acc.value) || rec.acceptedQty;
      if (rej) rec.rejectedQty = Number(rej.value) || 0;
      if (dam) rec.damagedQty = Number(dam.value) || 0;
      if (stat) rec.status = stat.value;
      if (expArr) rec.expectedArrival = expArr.value;
      if (actArr) rec.actualArrival = actArr.value;
    }
  } else if (tableType === 'inbound-product') {
    const rec = state.inboundProducts.find(p => p.productId === recordId || p.sku === recordId);
    if (rec) {
      const name = document.getElementById('edit-item-name');
      const batch = document.getElementById('edit-batch-no');
      const exp = document.getElementById('edit-expected');
      const scn = document.getElementById('edit-scanned');
      const recd = document.getElementById('edit-received');
      const acc = document.getElementById('edit-accepted');
      const rej = document.getElementById('edit-rejected');
      const dam = document.getElementById('edit-damaged');
      const qc = document.getElementById('edit-qc-status');
      const cond = document.getElementById('edit-storage-cond');
      const temp = document.getElementById('edit-temperature');
      const expiry = document.getElementById('edit-expiry-date');
      const stat = document.getElementById('edit-status');
      if (name) rec.itemName = name.value;
      if (batch) rec.batchNo = batch.value;
      if (exp) rec.expected = Number(exp.value) || rec.expected;
      if (scn) rec.scanned = Number(scn.value) || rec.scanned;
      if (recd) rec.received = Number(recd.value) || rec.received;
      if (acc) rec.accepted = Number(acc.value) || rec.accepted;
      if (rej) rec.rejected = Number(rej.value) || 0;
      if (dam) rec.damaged = Number(dam.value) || 0;
      if (qc) rec.qcStatus = qc.value;
      if (cond) rec.storageCondition = cond.value;
      if (temp) rec.temperature = temp.value;
      if (expiry) rec.expiryDate = expiry.value;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'inbound-qc') {
    const rec = state.inboundQc.find(q => q.qcId === recordId);
    if (rec) {
      const insp = document.getElementById('edit-inspector');
      const stat = document.getElementById('edit-qc-status');
      const insQty = document.getElementById('edit-inspected');
      const accQty = document.getElementById('edit-accepted');
      const damQty = document.getElementById('edit-damaged');
      const damType = document.getElementById('edit-damage-type');
      const rejReason = document.getElementById('edit-rejection-reason');
      const notes = document.getElementById('edit-notes');
      if (insp) rec.inspector = insp.value;
      if (stat) rec.qcStatus = stat.value;
      if (insQty) rec.inspectedQty = Number(insQty.value) || rec.inspectedQty;
      if (accQty) rec.acceptedQty = Number(accQty.value) || rec.acceptedQty;
      if (damQty) rec.damagedQty = Number(damQty.value) || 0;
      if (damType) rec.damageType = damType.value;
      if (rejReason) rec.rejectionReason = rejReason.value;
      if (notes) rec.notes = notes.value;
    }
  } else if (tableType === 'inbound-scan') {
    const rec = state.inboundScans.find(s => s.scanId === recordId);
    if (rec) {
      const type = document.getElementById('edit-scan-type');
      const loc = document.getElementById('edit-location');
      const qty = document.getElementById('edit-qty');
      const res = document.getElementById('edit-result');
      if (type) rec.scanType = type.value;
      if (loc) rec.location = loc.value;
      if (qty) rec.quantity = Number(qty.value) || rec.quantity;
      if (res) rec.result = res.value;
    }
  } else if (tableType === 'putaway-task') {
    const rec = state.putawayTasks.find(t => t.putawayId === recordId);
    if (rec) {
      const dest = document.getElementById('edit-dest-location');
      const op = document.getElementById('edit-operator');
      const acc = document.getElementById('edit-accepted');
      const put = document.getElementById('edit-putaway');
      const pend = document.getElementById('edit-pending');
      const fefo = document.getElementById('edit-fefo-priority');
      const stat = document.getElementById('edit-status');
      if (dest) rec.destinationLocation = dest.value;
      if (op) rec.operator = op.value;
      if (acc) rec.acceptedQty = Number(acc.value) || rec.acceptedQty;
      if (put) rec.putawayQty = Number(put.value) || rec.putawayQty;
      if (pend) rec.pendingQty = Number(pend.value) || 0;
      if (fefo) rec.fefoPriority = fefo.value;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'location-inventory') {
    const rec = state.locationInventory.find(l => (l.location + '_' + l.sku) === recordId || l.location === recordId);
    if (rec) {
      const avail = document.getElementById('edit-avail');
      const res = document.getElementById('edit-reserved');
      const quar = document.getElementById('edit-quarantine');
      const dam = document.getElementById('edit-damaged');
      const stat = document.getElementById('edit-status');
      if (avail) rec.availableQty = Number(avail.value) || rec.availableQty;
      if (res) rec.reservedQty = Number(res.value) || rec.reservedQty;
      if (quar) rec.quarantineQty = Number(quar.value) || 0;
      if (dam) rec.damagedQty = Number(dam.value) || 0;
      if (stat) rec.stockStatus = stat.value;
    }
  } else if (tableType === 'picking-task') {
    const rec = state.pickingTasks.find(p => p.pickTaskId === recordId);
    if (rec) {
      const picker = document.getElementById('edit-picker');
      const prio = document.getElementById('edit-priority');
      const pItems = document.getElementById('edit-picked-items');
      const pUnits = document.getElementById('edit-picked-units');
      const ex = document.getElementById('edit-exceptions');
      const stat = document.getElementById('edit-status');
      if (picker) rec.picker = picker.value;
      if (prio) rec.priority = prio.value;
      if (pItems) rec.pickedItems = Number(pItems.value) || rec.pickedItems;
      if (pUnits) rec.pickedUnits = Number(pUnits.value) || rec.pickedUnits;
      if (ex) rec.exceptions = Number(ex.value) || 0;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'picking-item') {
    const rec = state.pickingItems.find(p => (p.pickTask + '_' + p.sku) === recordId || p.sku === recordId);
    if (rec) {
      const req = document.getElementById('edit-required');
      const p = document.getElementById('edit-picked');
      const sh = document.getElementById('edit-short');
      const dam = document.getElementById('edit-damaged');
      const stat = document.getElementById('edit-status');
      if (req) rec.requiredQty = Number(req.value) || rec.requiredQty;
      if (p) rec.pickedQty = Number(p.value) || rec.pickedQty;
      if (sh) rec.shortQty = Number(sh.value) || 0;
      if (dam) rec.damagedQty = Number(dam.value) || 0;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'picking-scan') {
    const rec = state.pickingScans.find(s => s.scanId === recordId);
    if (rec) {
      const qty = document.getElementById('edit-qty');
      const res = document.getElementById('edit-result');
      if (qty) rec.quantity = Number(qty.value) || rec.quantity;
      if (res) rec.result = res.value;
    }
  } else if (tableType === 'packing-record') {
    const rec = state.packingRecords.find(p => p.packingId === recordId);
    if (rec) {
      const packer = document.getElementById('edit-packer');
      const seal = document.getElementById('edit-seal-no');
      const ver = document.getElementById('edit-items-verified');
      const count = document.getElementById('edit-package-count');
      const weight = document.getElementById('edit-weight');
      const qc = document.getElementById('edit-qc-status');
      const stat = document.getElementById('edit-status');
      if (packer) rec.packer = packer.value;
      if (seal) rec.sealNo = seal.value;
      if (ver) rec.itemsVerified = Number(ver.value) || rec.itemsVerified;
      if (count) rec.packageCount = Number(count.value) || rec.packageCount;
      if (weight) rec.weight = weight.value;
      if (qc) rec.qcStatus = qc.value;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'shipping-master') {
    const rec = state.shipmentMaster.find(s => s.shipmentId === recordId);
    if (rec) {
      const trans = document.getElementById('edit-transporter');
      const rider = document.getElementById('edit-rider');
      const veh = document.getElementById('edit-vehicle');
      const dock = document.getElementById('edit-dock');
      const stat = document.getElementById('edit-status');
      if (trans) rec.transporter = trans.value;
      if (rider) rec.rider = rider.value;
      if (veh) rec.vehicle = veh.value;
      if (dock) rec.dispatchDock = dock.value;
      if (stat) rec.status = stat.value;
    }
  } else if (tableType === 'delivery-detail') {
    const rec = state.shipmentDelivery.find(d => d.shipmentId === recordId);
    if (rec) {
      const addr = document.getElementById('edit-address');
      const slot = document.getElementById('edit-slot');
      const payStat = document.getElementById('edit-pay-status');
      const cod = document.getElementById('edit-cod');
      const stat = document.getElementById('edit-status');
      const otp = document.getElementById('edit-otp');
      const pod = document.getElementById('edit-pod');
      if (addr) rec.deliveryAddress = addr.value;
      if (slot) rec.deliverySlot = slot.value;
      if (payStat) rec.paymentStatus = payStat.value;
      if (cod) rec.codAmount = cod.value;
      if (stat) rec.status = stat.value;
      if (otp) rec.deliveryOtp = otp.value;
      if (pod) rec.pod = pod.value;
    }
  } else if (tableType === 'shipping-scan') {
    const rec = state.shippingScans.find(s => s.scanId === recordId);
    if (rec) {
      const loc = document.getElementById('edit-location');
      const res = document.getElementById('edit-result');
      if (loc) rec.location = loc.value;
      if (res) rec.result = res.value;
    }
  }

  closeModal();
  renderActiveView();
  showToast('Record ' + recordId + ' updated successfully.');
}

// ==============================================================================
// APP INITIALIZATION
// ==============================================================================


// ==============================================================================
// ADD RECORD & TRANSACTION MODALS
// ==============================================================================

function openAddInboundModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  const nextId = 'INB-' + String(state.inboundShipments.length + 124).padStart(5, '0');

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:640px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Inbound Consignment</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveAddInboundRecord(event)">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Inbound Consignment No.</label>
                <input type="text" class="form-input" id="new-inb-no" value="${nextId}" required>
              </div>
              <div class="form-group">
                <label>Shipment Type</label>
                <select class="form-select" id="new-inb-type" required>
                  <option value="Supplier Delivery">Supplier Delivery</option>
                  <option value="Warehouse Transfer">Warehouse Transfer</option>
                  <option value="Customer Return">Customer Return</option>
                </select>
              </div>
            </div>

            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Supplier / Source Vendor</label>
                <input type="text" class="form-input" id="new-inb-source" placeholder="e.g. Nestle India" required>
              </div>
              <div class="form-group">
                <label>Destination Warehouse Hub</label>
                <input type="text" class="form-input" id="new-inb-wh" value="RJY-DS-001" required>
              </div>
            </div>

            <div class="form-grid-3col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Total SKU Items</label>
                <input type="number" class="form-input" id="new-inb-items" value="10" min="1" required>
              </div>
              <div class="form-group">
                <label>Expected Total Qty</label>
                <input type="number" class="form-input" id="new-inb-expqty" value="500" min="1" required>
              </div>
              <div class="form-group">
                <label>Initial Status</label>
                <select class="form-select" id="new-inb-status" required>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Receiving">Receiving</option>
                  <option value="QC Pending">QC Pending</option>
                </select>
              </div>
            </div>

            <div class="form-grid-2col">
              <div class="form-group">
                <label>Expected Arrival Date & Time</label>
                <input type="text" class="form-input" id="new-inb-arrival" value="07-Sep-2026 10:00" required>
              </div>
              <div class="form-group">
                <label>Dock Bay Assignment</label>
                <select class="form-select" id="new-inb-dock">
                  <option value="Bay-01 (Rapid Unload)">Bay-01 (Rapid Unload)</option>
                  <option value="Bay-02 (Cold Chain Inward)">Bay-02 (Cold Chain Inward)</option>
                  <option value="Bay-03 (Bulk Pallets)">Bay-03 (Bulk Pallets)</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Register Inbound Consignment</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveAddInboundRecord(e) {
  e.preventDefault();
  const inboundNo = document.getElementById('new-inb-no').value.trim();
  const type = document.getElementById('new-inb-type').value;
  const source = document.getElementById('new-inb-source').value.trim();
  const warehouse = document.getElementById('new-inb-wh').value.trim();
  const items = parseInt(document.getElementById('new-inb-items').value, 10) || 1;
  const expectedQty = parseInt(document.getElementById('new-inb-expqty').value, 10) || 100;
  const status = document.getElementById('new-inb-status').value;
  const expectedArrival = document.getElementById('new-inb-arrival').value.trim();

  state.inboundShipments.unshift({
    inboundNo,
    type,
    source,
    warehouse,
    items,
    expectedQty,
    receivedQty: status === 'Receiving' ? expectedQty : '—',
    acceptedQty: status === 'Receiving' ? expectedQty : '—',
    rejectedQty: status === 'Receiving' ? 0 : '—',
    damagedQty: status === 'Receiving' ? 0 : '—',
    status,
    expectedArrival,
    actualArrival: status === 'Receiving' ? '06-Sep-2026 11:30' : '—'
  });

  closeModal();
  renderActiveView();
  showToast('Consignment ' + inboundNo + ' created successfully.');
}

function openAddOrderModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:560px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Outbound Sales Order</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveAddOrderRecord(event, '${orderId}')">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Sales Order ID</label>
                <input type="text" class="form-input" value="${orderId}" disabled>
              </div>
              <div class="form-group">
                <label>Customer Name</label>
                <input type="text" class="form-input" id="new-ord-customer" placeholder="e.g. Ramesh Varma" required>
              </div>
            </div>
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Delivery Hub</label>
                <input type="text" class="form-input" value="RJY-DS-001" disabled>
              </div>
              <div class="form-group">
                <label>Item Count</label>
                <input type="number" class="form-input" id="new-ord-items" value="4" min="1" required>
              </div>
            </div>
            <div class="form-group">
              <label>Delivery Address</label>
              <input type="text" class="form-input" id="new-ord-address" placeholder="Flat 402, River View Apts, Danavaipeta" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Confirm & Queue for Picking</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveAddOrderRecord(e, orderId) {
  e.preventDefault();
  const customer = document.getElementById('new-ord-customer').value.trim();
  const items = parseInt(document.getElementById('new-ord-items').value, 10) || 1;
  const address = document.getElementById('new-ord-address').value.trim();

  state.orders.unshift({
    id: orderId,
    customer,
    address,
    status: 'Pending',
    itemsCount: items,
    time: 'Just Now'
  });

  closeModal();
  renderActiveView();
  showToast('Sales Order ' + orderId + ' queued for wave picking.');
}

function openTransferStockModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  const binOptions = state.binStock.map(b => '<option value="' + b.bin + '">' + b.bin + ' - ' + b.sku + ' (' + b.stockQty + ' ' + b.uom + ')</option>').join('');

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:540px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Internal Bin Stock Transfer</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveTransferStock(event)">
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:12px;">
              <label>Source Bin & Product</label>
              <select class="form-select" id="trans-source-bin" required>
                ${binOptions}
              </select>
            </div>
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Transfer Quantity</label>
                <input type="number" class="form-input" id="trans-qty" value="10" min="1" required>
              </div>
              <div class="form-group">
                <label>Target Destination Bin</label>
                <input type="text" class="form-input" id="trans-target-bin" value="A-01-02-A" required>
              </div>
            </div>
            <div class="form-group">
              <label>Reason / Note</label>
              <input type="text" class="form-input" id="trans-reason" placeholder="e.g. Replenishment to primary pick face">
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
}

function saveTransferStock(e) {
  e.preventDefault();
  const sourceBin = document.getElementById('trans-source-bin').value;
  const targetBin = document.getElementById('trans-target-bin').value.trim();
  const qty = parseInt(document.getElementById('trans-qty').value, 10) || 1;

  const sourceItem = state.binStock.find(b => b.bin === sourceBin);
  if (sourceItem && sourceItem.stockQty >= qty) {
    sourceItem.stockQty -= qty;
    showToast('Transferred ' + qty + ' units from ' + sourceBin + ' to ' + targetBin + '.');
  } else {
    showToast('Transfer logged to ' + targetBin + '.');
  }

  closeModal();
  renderActiveView();
}

function openAddLocationModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:540px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Register Storage Bin Location</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveAddLocation(event)">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Bin Identifier Code</label>
                <input type="text" class="form-input" id="new-bin-code" placeholder="e.g. A-03-01-A" required>
              </div>
              <div class="form-group">
                <label>Zone Name</label>
                <select class="form-select" id="new-bin-zone" required>
                  <option value="Zone A - Rapid Pick Face">Zone A - Rapid Pick Face</option>
                  <option value="Zone B - Chilled Fresh">Zone B - Chilled Fresh</option>
                  <option value="Zone C - Bulk Pallets">Zone C - Bulk Pallets</option>
                </select>
              </div>
            </div>
            <div class="form-grid-3col">
              <div class="form-group">
                <label>Max Volume (m³)</label>
                <input type="number" step="0.1" class="form-input" id="new-bin-vol" value="1.2" required>
              </div>
              <div class="form-group">
                <label>Max Weight (kg)</label>
                <input type="number" class="form-input" id="new-bin-wt" value="150" required>
              </div>
              <div class="form-group">
                <label>Velocity</label>
                <select class="form-select" id="new-bin-vel">
                  <option value="High (Fast Mover)">High (Fast Mover)</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Add Storage Location</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveAddLocation(e) {
  e.preventDefault();
  const bin = document.getElementById('new-bin-code').value.trim();
  const zone = document.getElementById('new-bin-zone').value;
  const maxVol = parseFloat(document.getElementById('new-bin-vol').value) || 1.0;
  const maxWeight = parseFloat(document.getElementById('new-bin-wt').value) || 100;
  const velocity = document.getElementById('new-bin-vel').value;

  state.binCapacity.unshift({
    bin,
    zone,
    shelf: '01',
    maxVol,
    currVol: 0.0,
    utilVol: '0%',
    maxWeight,
    currWeight: 0,
    utilWeight: '0%',
    status: 'Empty',
    velocity
  });

  closeModal();
  renderActiveView();
  showToast('Storage Bin ' + bin + ' registered successfully.');
}

function openAddProductModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:560px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Add Product Master Record</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveAddProduct(event)">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Product SKU Code</label>
                <input type="text" class="form-input" id="new-prod-sku" placeholder="e.g. BIS-OREO-120G" required>
              </div>
              <div class="form-group">
                <label>Barcode (EAN-13)</label>
                <input type="text" class="form-input" id="new-prod-barcode" placeholder="e.g. 8901234567890" required>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
              <label>Product Name</label>
              <input type="text" class="form-input" id="new-prod-name" placeholder="e.g. Oreo Chocolate Biscuits 120g" required>
            </div>
            <div class="form-grid-3col">
              <div class="form-group">
                <label>Category</label>
                <select class="form-select" id="new-prod-cat">
                  <option value="FMCG">FMCG</option>
                  <option value="Dairy">Dairy</option>
                  <option value="Beverages">Beverages</option>
                  <option value="Staples">Staples</option>
                </select>
              </div>
              <div class="form-group">
                <label>MRP (INR)</label>
                <input type="number" class="form-input" id="new-prod-mrp" value="40" required>
              </div>
              <div class="form-group">
                <label>Storage Type</label>
                <select class="form-select" id="new-prod-temp">
                  <option value="Ambient">Ambient</option>
                  <option value="Chilled (0-4°C)">Chilled (0-4°C)</option>
                  <option value="Frozen (-18°C)">Frozen (-18°C)</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Save Product</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveAddProduct(e) {
  e.preventDefault();
  const sku = document.getElementById('new-prod-sku').value.trim();
  const barcode = document.getElementById('new-prod-barcode').value.trim();
  const name = document.getElementById('new-prod-name').value.trim();
  const category = document.getElementById('new-prod-cat').value;
  const mrp = parseFloat(document.getElementById('new-prod-mrp').value) || 0;

  state.products.unshift({
    sku,
    barcode,
    name,
    category,
    mrp,
    stock: 0,
    unit: 'Units'
  });

  closeModal();
  renderActiveView();
  showToast('Product ' + sku + ' added to Master Catalog.');
}

function openCreatePickWaveModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  const waveId = 'WAV-00' + (state.pickWaves.length + 101);

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:540px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Picking Wave</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveCreatePickWave(event, '${waveId}')">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Pick Wave Number</label>
                <input type="text" class="form-input" value="${waveId}" disabled>
              </div>
              <div class="form-group">
                <label>Wave Type</label>
                <select class="form-select" id="new-wave-type">
                  <option value="Multi-Order Batch">Multi-Order Batch</option>
                  <option value="Single Order Express">Single Order Express</option>
                  <option value="Bulk Ambient Pick">Bulk Ambient Pick</option>
                </select>
              </div>
            </div>
            <div class="form-grid-3col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Total Orders</label>
                <input type="number" class="form-input" id="new-wave-orders" value="6" min="1" required>
              </div>
              <div class="form-group">
                <label>Total Items</label>
                <input type="number" class="form-input" id="new-wave-items" value="24" min="1" required>
              </div>
              <div class="form-group">
                <label>Zone</label>
                <select class="form-select" id="new-wave-zone">
                  <option value="Zone A">Zone A</option>
                  <option value="Zone B">Zone B</option>
                  <option value="Zone C">Zone C</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Assigned Picker Staff</label>
              <select class="form-select" id="new-wave-picker">
                <option value="Rahul">Rahul (EMP-014)</option>
                <option value="Arjun">Arjun (EMP-001)</option>
                <option value="Kiran">Kiran (EMP-008)</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Initialize Pick Wave</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveCreatePickWave(e, waveId) {
  e.preventDefault();
  const waveType = document.getElementById('new-wave-type').value;
  const orders = parseInt(document.getElementById('new-wave-orders').value, 10) || 1;
  const items = parseInt(document.getElementById('new-wave-items').value, 10) || 1;
  const zone = document.getElementById('new-wave-zone').value;
  const picker = document.getElementById('new-wave-picker').value;

  state.pickWaves.unshift({
    waveNo: waveId,
    waveType,
    zone,
    orders,
    items,
    pickedItems: 0,
    pendingItems: items,
    picker,
    startTime: 'Just Now',
    endTime: '—',
    status: 'In Progress'
  });

  closeModal();
  renderActiveView();
  showToast('Pick Wave ' + waveId + ' initialized.');
}

function openCreateDispatchModal() {
  const modalLayer = document.getElementById('modal-layer');
  if (!modalLayer) return;

  const dispNo = 'DSP-00' + (state.dispatchConsignments.length + 801);

  modalLayer.innerHTML = `
    <div class="modal-backdrop" onclick="closeModal()">
      <div class="modal-card" style="max-width:540px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Create Dispatch Manifest</h3>
          <button class="btn-close" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="saveCreateDispatch(event, '${dispNo}')">
          <div class="modal-body">
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Dispatch Manifest No.</label>
                <input type="text" class="form-input" value="${dispNo}" disabled>
              </div>
              <div class="form-group">
                <label>Carrier / 3PL Partner</label>
                <select class="form-select" id="new-disp-carrier">
                  <option value="Shadowfax">Shadowfax</option>
                  <option value="Zypp Electric">Zypp Electric</option>
                  <option value="Porter">Porter</option>
                  <option value="Internal Rider Fleet">Internal Rider Fleet</option>
                </select>
              </div>
            </div>
            <div class="form-grid-2col" style="margin-bottom:12px;">
              <div class="form-group">
                <label>Order Packages Count</label>
                <input type="number" class="form-input" id="new-disp-orders" value="5" min="1" required>
              </div>
              <div class="form-group">
                <label>Dispatch Bay</label>
                <select class="form-select" id="new-disp-bay">
                  <option value="Bay D-01">Bay D-01</option>
                  <option value="Bay D-02">Bay D-02</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Delivery Route / Zone</label>
              <input type="text" class="form-input" id="new-disp-route" value="RJY North - Morampudi Cluster" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn-sm btn-sm-primary">Finalize Dispatch Manifest</button>
            <button type="button" class="btn-sm" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function saveCreateDispatch(e, dispNo) {
  e.preventDefault();
  const carrier = document.getElementById('new-disp-carrier').value;
  const orders = parseInt(document.getElementById('new-disp-orders').value, 10) || 1;
  const bay = document.getElementById('new-disp-bay').value;
  const route = document.getElementById('new-disp-route').value.trim();

  state.dispatchConsignments.unshift({
    dispatchNo: dispNo,
    manifestId: 'MNF-' + Math.floor(1000 + Math.random() * 9000),
    carrier,
    orders,
    packages: orders,
    bay,
    route,
    status: 'Ready for Pickup',
    handoverTime: '—'
  });

  closeModal();
  renderActiveView();
  showToast('Dispatch Manifest ' + dispNo + ' ready for carrier pickup.');
}

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const clearSession = urlParams.get('clear');
  const userParam = urlParams.get('user');

  if (clearSession === '1') {
    if (typeof TokenManager !== 'undefined') TokenManager.clear();
    appMode = 'demo';
    renderLoginScreen();
    return;
  }

  if (userParam) {
    appMode = 'demo';
    hideAuthScreens();
    showDashboard();
    const sidebarLabel = document.getElementById('sidebar-user-label');
    const topbarUsername = document.getElementById('topbar-username');
    if (sidebarLabel) sidebarLabel.innerText = 'Shift Lead: ' + userParam.toUpperCase() + ' (EMP-014)';
    if (topbarUsername) topbarUsername.innerText = userParam.toUpperCase() + ' Sharma';
    initApp();
    return;
  }

  if (typeof TokenManager !== 'undefined' && TokenManager.isLoggedIn()) {
    appMode = 'live';
    hideAuthScreens();
    showDashboard();
    updateUserDisplay();
    initApp();
  } else {
    renderLoginScreen();
  }
});
