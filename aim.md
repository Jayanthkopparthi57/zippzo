| Restored table | Your file tab that needs it |
|---|---|
| `dispatch_plan` | Dispatch Plans (DPHYD09, DPAHM04, DP-2026, "Trips with Vehicles") |
| `cross_dock_batch` + `cross_dock_line` | Cross Dock Batches (XHYD080, Allocable Qty in XDock Bin, From/To Totes) |
| `trip_return_leg` | Returns (Return Lpns 0/257, unload check-in, dock cutoffs) |
| `droplist` | LPN Movement (DZPHYD00, Totes 3, Dropped/In Spider 3/0) |

**Final numbers: 39 core tables (100% of your file + the Inbound module) + 3 optional (counting/replenishment) = 42. Down from 85 — a 51% cut with zero lost screens.**

Everything else from last time stands as demoted: Tote QC → fields on `lpn` · holds → fields on `inventory_lot` · POD → field on `trip` · Re-Inventorization → view over the ledger · files → object storage refs.

---

### Sheet 1 — `A_Platform`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
user,user_id,uuid,PK,User identifier
user,emp_code,text,UK,Employee code e.g. 751703098 (shown as Tx Log User)
user,name,text,,Display name e.g. uppada.bha sreenivasa Jude Anil K
user,phone,text,,Contact number
user,role,enum,,PICKER / PACKER / SORTER / GRN_OP / QC / SUPERVISOR / ADMIN
user,site_id,uuid,FK -> site,Home site
user,status,enum,,ACTIVE / INACTIVE / BLOCKED
reason_code,rc_id,uuid,PK,Reason identifier
reason_code,category,enum,,SHORT_PICK / DAMAGE / DISCREPANCY / CHECK_IN_BREACH / CANCEL
reason_code,code,text,UK,Short code e.g. CHECK_IN_BREACH
reason_code,description,text,,Meaning
reason_code,requires_photo,bool,,Photo mandatory
reason_code,requires_remark,bool,,Remark mandatory (file shows Remark on Tx Log)
```

### Sheet 2 — `B_MasterData`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
site,site_id,uuid,PK,Site identifier
site,code,text,UK,HYD080M / HYD078S / CHN-DRY-MH2 / HYD-SS-MH3-K
site,type,enum,,MH / DS / SS / XDOCK
site,parent_site_id,uuid,FK -> site,SS to MH rollup
site,dh_precedence,text,,File value DEFAULT
site,ss_precedence,text,,File value SS_DEFAULT
site,status,enum,,ACTIVE / INACTIVE
sku,sku_id,uuid,PK,SKU identifier
sku,sku_code,text,UK,Internal code
sku,name,text,,Product name
sku,ean,text,UK,Barcode (file shows EAN 8.906E+12)
sku,category_id,uuid,FK -> sku_category,Category ID column
sku,sub_category,text,,Masala Dry Fruits & ...
sku,mrp,decimal,,MRP 469
sku,pack_size,text,,Formatted Packsize 1 pack (250g)
sku,storage_zone,enum,,DRY / COLD / FROZEN (file Storage Zone DRY)
sku,shelf_life_days,int,,FEFO guard
sku,is_food,bool,,Food flag (file Product Type Food)
sku,wac,decimal,,WAC column on SKU detail
sku,status,enum,,ACTIVE / INACTIVE
sku_category,category_id,uuid,PK,Category identifier
sku_category,name,text,,Atta Rice Dals & Pulses / Grocery
sku_category,parent_id,uuid,FK -> sku_category,Sub-category tree
vendor,vendor_id,uuid,PK,Vendor identifier
vendor,code,text,UK,KK-000100
vendor,name,text,,sap_testing (39070 vendors)
vendor,org_entity,text,,KIRA / KK (file OrgId/Entity)
vendor,gstin,text,,Tax registration
vendor,is_customer,bool,,File column Is Customer FALSE
vendor,is_sku_vendor,bool,,File column Sku Vendor No
vendor,status,enum,,Active
zone,zone_id,uuid,PK,Zone identifier
zone,site_id,uuid,FK -> site,Location HYD080M
zone,code,text,UK,HDR_FOOD (64 zones)
zone,category,text,,Grocery
zone,zone_type,enum,,GENERAL / MRP / FLEXI_FORWARD (file Zone Type)
zone,value_type,text,,General
zone,fragility,text,,General
zone,food_type,text,,General
zone,product_type,text,,Food
zone,is_advance_zone,bool,,ADVANCE_ZONE flag
zone,commingled_allowed,bool,,Commingling permitted (file Commingle)
zone,max_commingled,int,,File Max Commi = 5
zone,is_hazardous_allowed,bool,,File Hazardous F(ALSE)
zone,status,enum,,ACTIVE / INACTIVE / BLOCKED
bin,bin_id,uuid,PK,Bin identifier (44505 bins)
bin,site_id,uuid,FK -> site,Location
bin,zone_id,uuid,FK -> zone,Parent zone
bin,code,text,UK,LSO-L02-R10-3
bin,aisle,text,,L02
bin,rack,text,,R10
bin,level,int,,3
bin,level_class,text,,File Level Class
bin,rack_class,text,,File Rack Class
bin,roll_no,int,,File Roll No
bin,bin_type,text,,MTS_0.8x0 (also = Bin Type on Case Bin Lot)
bin,lbh,text,,Length-Breadth-Height
bin,putaway_max,int,,File Putaway Max
bin,condition,enum,,GOOD / DAMAGE (file Condition Good)
bin,is_pickzone,bool,,File Pickzone / PackZone
bin,zone_sub_type,text,,MTS_RC / ADVANCE_ZONE (file Zone column on Bins tab)
bin,status,enum,,ACTIVE / INACTIVE (file shows Inactive bins)
cluster_zone,cz_id,uuid,PK,PTL cluster id
cluster_zone,site_id,uuid,FK -> site,Site
cluster_zone,code,text,UK,CZ-02 (file Cluster Zone on batch)
cluster_zone,slot_count,int,,PTL light slots
cluster_zone,status,enum,,ACTIVE / INACTIVE
dock_door,door_id,uuid,PK,Dock door id
dock_door,site_id,uuid,FK -> site,Site
dock_door,code,text,,DOCK-01
dock_door,capability,enum,,LOAD / UNLOAD / BOTH
dock_door,status,enum,,OPEN / BUSY / CLOSED
vehicle_type,vt_id,uuid,PK,Vehicle type id
vehicle_type,code,text,UK,10FT_TRUCK / 14FT_TRUCK / 32FT_TRUCK_SX
vehicle_type,capacity_lpns,int,,LPN capacity
vehicle_type,temp_controlled,bool,,Cold chain capable
transporter,transporter_id,uuid,PK,Transporter id
transporter,code,text,UK,Smartship
transporter,name,text,,Vendor name
transporter,billing_basis,text,,File value 24hours_2t
transporter,status,enum,,ACTIVE / INACTIVE
```

### Sheet 3 — `C_Inventory`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
inventory_lot,lot_id,uuid,PK,Lot ID e.g. 5U9A6AK30126
inventory_lot,sku_id,uuid,FK -> sku,SKU
inventory_lot,site_id,uuid,FK -> site,Site Location HYD-DRY-MH2
inventory_lot,bin_id,uuid,FK -> bin,Bin
inventory_lot,lpn_id,uuid,FK -> lpn,LPN column on SKU Bin LPN
inventory_lot,parent_pallet_id,uuid,FK -> lpn,Pallet column on SKU Bin LPN
inventory_lot,lot_code,text,,Lot identifier
inventory_lot,expiry_date,date,,File Expiry Date 2026/1/01
inventory_lot,mrp,decimal,,File MRP 205
inventory_lot,box_size,int,,Box Size / Case Size columns
inventory_lot,inbound_type,enum,,EXTERNAL / INTERNAL (External & Internal Inbound ID cols)
inventory_lot,inbound_ref,text,,GRN or STO reference
inventory_lot,source_site_id,uuid,FK -> site,File Source MH Id / Source HYD-DRY-MH2
inventory_lot,source_vendor_id,uuid,FK -> vendor,File Source Vendor Id 70b51cec-d328-4
inventory_lot,bucket,enum,,Inventory Bucket Good / BAD / QC_HOLD / InProgress
inventory_lot,qty,int,,Total Qty (Free = qty minus open allocations via view)
inventory_lot,status,enum,,AVAILABLE / HELD / PICKING / DEPLETED
inventory_lot,on_hold,bool,,File On Hold No
inventory_lot,hold_by,uuid,FK -> user,File Hold By
inventory_lot,hold_at,timestamp,,File Hold At
inventory_tx,tx_id,bigint,PK,Ledger sequence (SKU Transaction Log)
inventory_tx,site_id,uuid,FK -> site,Site
inventory_tx,sku_id,uuid,FK -> sku,SKU Code + Name + EAN via join
inventory_tx,from_lot_id,uuid,FK -> inventory_lot,From Lot (Re-Inventorization)
inventory_tx,to_lot_id,uuid,FK -> inventory_lot,To Lot (null = same lot)
inventory_tx,from_bin,text,,File From Bin HDR-L07-D2FSORTB
inventory_tx,to_bin,text,,File To Bin
inventory_tx,qty,int,,Opening/Closing/Available derived in view
inventory_tx,flow,enum,,GRN / PUTAWAY / PICK / SORT / PACK / SHIP / RECEIVE / MOVEMENT / ADJUST / SCRAP / REINVENTORIZE / COUNT
inventory_tx,ref_type,text,,File Type INVENTORY / doc type
inventory_tx,ref_id,uuid,,Linked document
inventory_tx,remark,text,,File Remark
inventory_tx,category,text,,File Category Atta Rice ...
inventory_tx,subcategory,text,,File Subcategory Dals & Pulses
inventory_tx,user_id,uuid,FK -> user,File User 751703098
inventory_tx,created_at,timestamp,,When
lpn,lpn_id,uuid,PK,LPN identifier
lpn,barcode,text,UK,149871 / PL-HYD16 / L-OHYD08 / tote numbers
lpn,type,enum,,TOTE / CARTON / PALLET
lpn,current_site_id,uuid,FK -> site,Current site
lpn,current_bin,text,,Current location
lpn,status,enum,,EMPTY / PICKING / SORT_DONE / QC_DONE / IRT_DONE / PACKED / IN_TRANSIT / RECEIVED / CLOSED (file Tote QC IRT_DONE Dispatch CLOSED)
lpn,is_superstore,bool,,File SuperStore No
lpn,order_id,uuid,FK -> orders,File Order ID OHYD0800
lpn,picklist_id,uuid,FK -> picklist,File Picklist ID BHYD0800
lpn,source_site_id,uuid,FK -> site,File Source Store HYD080M HYD-DRY
lpn,dest_site_id,uuid,FK -> site,File Destination HYD023S HYD-Begumpet
lpn,qc_by,uuid,FK -> user,File QC Done By 812190908
lpn,qc_at,timestamp,,File QC Started/Ended
lpn,irt_by,uuid,FK -> user,File IRT Done By
lpn,irt_at,timestamp,,File IRT Started/Ended
droplist,droplist_id,uuid,PK,Droplist id (LPN Movement screen)
droplist,code,text,UK,DZPHYD00
droplist,lpn_id,uuid,FK -> lpn,LPN search key
droplist,totes,int,,File Totes 3
droplist,dropped_count,int,,File Dropped 3
droplist,in_spider_count,int,,File In Spider 0
droplist,status,enum,,OPEN / IN_PROGRESS / COMPLETED (file COMPLETE)
droplist,started_at,timestamp,,File Started At
droplist,completed_by,uuid,FK -> user,Jude Anil K
```

### Sheet 4 — `D_Inbound` *(added module — not in your file, required to run a warehouse)*
```csv
Table_Name,Column_Name,Data_Type,Key,Description
asn,asn_id,uuid,PK,Advance shipping notice
asn,asn_no,text,UK,Sequence-generated
asn,type,enum,,VENDOR_PO / MH_TRANSFER / STORE_RETURN / RTV_IN (file inbound from MH = MH_TRANSFER)
asn,source_site_id,uuid,FK -> site,CHN-DRY-MH2 for transfers
asn,source_vendor_id,uuid,FK -> vendor,For POs
asn,dest_site_id,uuid,FK -> site,Receiving site
asn,po_ref,text,,SAP PO
asn,door_id,uuid,FK -> dock_door,Assigned dock
asn,slot_start,timestamp,,Dock slot from
asn,slot_end,timestamp,,Dock slot to
asn,expected_vehicle,text,,KA02AH9731
asn,total_lpns,int,,File Forward Lpns 143
asn,total_skus,int,,Expected SKU count
asn,total_qty,int,,Expected quantity
asn,status,enum,,DRAFT / CONFIRMED / IN_TRANSIT / ARRIVED / CHECKED_IN / UNLOADED / QC_PENDING / PUTAWAY_PENDING / CLOSED
asn_line,line_id,uuid,PK,ASN line
asn_line,asn_id,uuid,FK -> asn,Parent
asn_line,sku_id,uuid,FK -> sku,SKU
asn_line,ean,text,,Expected barcode
asn_line,ordered_qty,int,,Expected qty
asn_line,expected_expiry,date,,Expected expiry
asn_line,line_status,enum,,OPEN / PARTIAL / RECEIVED / SHORT
grn,grn_id,uuid,PK,Goods receipt
grn,grn_no,text,UK,Receipt number
grn,asn_id,uuid,FK -> asn,Source ASN
grn,mode,enum,,LPN_SCAN / CASE_SCAN / PIECE / FILE
grn,status,enum,,DRAFT / IN_PROGRESS / PARTIAL / COMPLETED
grn,has_discrepancy,bool,,Any line mismatch
grn,received_by,uuid,FK -> user,Operator
grn,completed_at,timestamp,,Completion
grn_line,line_id,uuid,PK,Receipt line
grn_line,grn_id,uuid,FK -> grn,Parent
grn_line,asn_line_id,uuid,FK -> asn_line,Against line
grn_line,sku_id,uuid,FK -> sku,SKU
grn_line,ordered_qty,int,,Expected
grn_line,received_qty,int,,Good received
grn_line,damaged_qty,int,,Damage
grn_line,expired_qty,int,,Expired
grn_line,excess_qty,int,,Over-receipt
grn_line,expiry_date,date,,Captured expiry
grn_line,mrp,decimal,,Captured MRP
grn_line,lot_id,uuid,FK -> inventory_lot,Created lot
grn_line,reason_code,uuid,FK -> reason_code,If mismatch
putaway_task,putaway_id,uuid,PK,Directed putaway task
putaway_task,grn_line_id,uuid,FK -> grn_line,Source line
putaway_task,lpn_id,uuid,FK -> lpn,Handling unit
putaway_task,from_location,text,,RECV-STAGE staging
putaway_task,to_bin_id,uuid,FK -> bin,System-suggested bin (xdock bin first)
putaway_task,priority,int,,Cross-dock first
putaway_task,status,enum,,CREATED / ASSIGNED / COMPLETED / EXCEPTION
putaway_task,assigned_to,uuid,FK -> user,Operator
putaway_task,started_at,timestamp,,
putaway_task,completed_at,timestamp,,
putaway_task,exception_reason,text,,If bin refused
inbound_discrepancy,disc_id,uuid,PK,Discrepancy case
inbound_discrepancy,asn_id,uuid,FK -> asn,Against ASN
inbound_discrepancy,sku_id,uuid,FK -> sku,SKU
inbound_discrepancy,type,enum,,SHORT / EXCESS / DAMAGE / WRONG_MRP
inbound_discrepancy,claimed_qty,int,,Expected
inbound_discrepancy,found_qty,int,,Actual
inbound_discrepancy,value,decimal,,Claim value
inbound_discrepancy,status,enum,,OPEN / RESOLVED
inbound_discrepancy,maker_id,uuid,FK -> user,Maker-checker
inbound_discrepancy,checker_id,uuid,FK -> user,Approver
```

### Sheet 5 — `E_Outbound`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
orders,order_id,uuid,PK,Order identifier
orders,order_no,text,UK,OHYD080QE510 / REHYD080 / SSHYD080
orders,type,enum,,REGULAR / STO / RETURN / EXTERNAL_RTV / SECONDARY_SALES / SCRAP / CROSSDOCK (file tabs)
orders,processing_type,enum,,LPN_BASED / PIECE (file Processing Type)
orders,inventory_type,enum,,GOOD / BAD (file GOOD BAD)
orders,shipment_type,enum,,VENDOR_PICKUP / SELF_DISPATCH / LINEHAUL (file columns)
orders,picking_type,text,,QUICK_SH / REDISTRIBUTION (file)
orders,section,text,,File Section
orders,reference_order,text,,Return Sale Order column
orders,source_site_id,uuid,FK -> site,Source Store HYD080M
orders,next_dest_id,uuid,FK -> site,Next Destination HYD068S
orders,final_dest_id,uuid,FK -> site,Final Destination HYD-KPH
orders,to_vendor_id,uuid,FK -> vendor,COLMAN / FASHION / SHAKTHI (vendor master holds is_customer)
orders,multi_run,bool,,File Multi Run 1
orders,run_no,int,,Run number
orders,ordered_qty,int,,Ordered / Expected Qty
orders,ordered_skus,int,,SKU count
orders,allocated_qty,int,,Allocated Qty (cached)
orders,picked_qty,int,,Picked Qty (cached)
orders,shipped_qty,int,,Shipped
orders,short_qty,int,,Short Picked
orders,received_qty,int,,Received at Destination (STO/xdock)
orders,discrepancy_qty,int,,File Discrepancy
orders,upload_ref,text,,Uploaded File (S3 ref; error file alongside)
orders,remarks,text,,File Remarks / Documents
orders,status,enum,,CREATED / UPLOADED / ALLOCATED / PICKING / SORTED / PACKED / SHIPPED / IN_TRANSIT / RECEIVED / CLOSED / CANCELLED (file CREATED PACKED DISPATCHED SHIPPED)
orders,shipped_at,timestamp,,File Shipped At 2026/8/5 12:17
orders,canceled_at,timestamp,,File Canceled At
orders,canceled_by,uuid,FK -> user,File Canceled By
orders,created_by,uuid,FK -> user,
orders,created_at,timestamp,,
order_line,line_id,uuid,PK,Order line
order_line,order_id,uuid,FK -> orders,Parent
order_line,sku_id,uuid,FK -> sku,SKU
order_line,ordered_qty,int,,Per line
order_line,allocated_qty,int,,Allocated
order_line,actual_allocated_qty,int,,File ActualAllocated
order_line,allocated_bin,text,,File Allocated Bin / Good Bin
order_line,picked_qty,int,,Picked
order_line,short_qty,int,,Short Picked
order_line,shipped_qty,int,,Shipped
order_line,received_qty,int,,At destination
order_line,discrepancy_qty,int,,Mismatch at receipt
order_line,line_status,enum,,Mirrors order statuses
order_allocation,alloc_id,uuid,PK,Allocation (FEFO)
order_allocation,order_line_id,uuid,FK -> order_line,Against line
order_allocation,lot_id,uuid,FK -> inventory_lot,Chosen lot (FEFO)
order_allocation,bin_id,uuid,FK -> bin,Pick bin
order_allocation,lpn_id,uuid,FK -> lpn,For LPN-based picking
order_allocation,qty,int,,Allocated qty
order_allocation,batch_id,uuid,FK -> batch,Wave assignment (replaces batch_order)
order_allocation,status,enum,,PENDING / ALLOCATED / PICKED / SHORT / CANCELLED
batch,batch_id,uuid,PK,Batch / wave
batch,batch_no,text,UK,BHYD0800 (file Batch ID)
batch,site_id,uuid,FK -> site,Site
batch,type,enum,,MANUAL / AUTO (file Batch Type Manual)
batch,status,enum,,UPLOADED / ALLOCATING / ALLOCATED / IN_PROGRESS / CLOSED / CANCELLED (file UPLOADED)
batch,order_type,enum,,REGULAR etc (file Order Type)
batch,processing_type,enum,,LPN_BASED (file)
batch,picking_type,text,,REDISTRIBUTION (file)
batch,cluster_zone_id,uuid,FK -> cluster_zone,File Cluster Zone CZ-02
batch,sorting_eligible,bool,,File Batch Sorting Eligible
batch,dispatch_plan_id,uuid,FK -> dispatch_plan,File Plan column
batch,destinations,text,,HYD147S / multi-dest list
batch,totes,int,,Tote count
batch,ordered_qty,int,,1634
batch,ordered_skus,int,,440
batch,picked_qty,int,,Cached
batch,sorted_qty,int,,Cached
batch,short_qty,int,,0 Short
batch,cutoff,timestamp,,Dispatch Cutoff (########## in file = datetime col)
batch,created_by,uuid,FK -> user,uppada.bha
batch,created_at,timestamp,,Created At
picklist,picklist_id,uuid,PK,Picklist
picklist,code,text,UK,BHYD0800 (file Picklist ID)
picklist,batch_id,uuid,FK -> batch,Parent wave
picklist,zone_id,uuid,FK -> zone,File Zone PackZone
picklist,type,enum,,LPN / PIECE / CLUSTER
picklist,status,enum,,NOT_STARTED / IN_PROGRESS / COMPLETED (file NOT_STARTED)
picklist,assigned_to,uuid,FK -> user,File Picker
picklist,assigned_qty,int,,1634
picklist,assigned_skus,int,,440
picklist,picked_qty,int,,Picked
picklist,pending_qty,int,,Pending
picklist,short_qty,int,,0 Short
picklist,cancelled_qty,int,,File Cancelled Qty
picklist,started_at,timestamp,,
picklist,completed_at,timestamp,,
picklist_line,line_id,uuid,PK,Pick task
picklist_line,picklist_id,uuid,FK -> picklist,Parent
picklist_line,alloc_id,uuid,FK -> order_allocation,Source allocation
picklist_line,sku_id,uuid,FK -> sku,SKU
picklist_line,bin_id,uuid,FK -> bin,Pick bin
picklist_line,lot_id,uuid,FK -> inventory_lot,FEFO lot
picklist_line,qty,int,,To pick
picklist_line,picked_qty,int,,Picked
picklist_line,short_qty,int,,Short (reason via reason_code on tx)
picklist_line,pick_seq,int,,Walk sequence
picklist_line,status,enum,,PENDING / PICKED / SHORT / CANCELLED
sortlist,sortlist_id,uuid,PK,Sortlist
sortlist,code,text,UK,BHYD0800 (file Sortlist ID)
sortlist,batch_id,uuid,FK -> batch,Parent wave
sortlist,type,enum,,CLUSTER / PTL / FLOW (file Sorting Type CLUSTER)
sortlist,cluster_zone_id,uuid,FK -> cluster_zone,PTL wall
sortlist,assigned_qty,int,,226
sortlist,assigned_skus,int,,47
sortlist,sorted_qty,int,,Sorted
sortlist,pending_qty,int,,File 5 0 Pending
sortlist,short_qty,int,,0 Short
sortlist,sorter,text,,PTL Packer (file Sorter)
sortlist,close_type,text,,File Close Type
sortlist,closed_by,uuid,FK -> user,File Closed By
sortlist,close_suggested_at,timestamp,,File Close Suggestion
sortlist,status,enum,,CREATED / IN_PROGRESS / COMPLETED / CANCELLED
sortlist,started_at,timestamp,,File Created At
sortlist,completed_at,timestamp,,
sortlist_line,line_id,uuid,PK,Sort task
sortlist_line,sortlist_id,uuid,FK -> sortlist,Parent
sortlist_line,order_id,uuid,FK -> orders,Destination order
sortlist_line,dest_tote,text,,PTL slot / tote (file Tote/LPN PL-HYD16)
sortlist_line,sku_id,uuid,FK -> sku,SKU
sortlist_line,qty,int,,To sort (20)
sortlist_line,sorted_qty,int,,Sorted
sortlist_line,status,enum,,PENDING / SORTED / SHORT
manifest,manifest_id,uuid,PK,Manifest
manifest,manifest_no,text,UK,MFHYD080 (file Manifest No)
manifest,site_id,uuid,FK -> site,Site
manifest,type,enum,,LPN_BASED / PIECE (file Type LPN Base)
manifest,status,enum,,CREATED / SEALED / DISPATCHED / CLOSED (file Created)
manifest,trip_id,uuid,FK -> trip,File Trip ID
manifest,vehicle_no,text,,TG08T695 (file Vehicle Nu)
manifest,dest_store_id,uuid,FK -> site,File Store HYD078S HYD-Chin
manifest,shipments_count,int,,File Shipments 2
manifest,packed_qty,int,,File Packed Qty 285
manifest,packed_totes,int,,File 21 Totes
manifest,pod_template,text,,LPN_SCANNING (file POD Templ)
manifest,created_by,uuid,FK -> user,
manifest_line,line_id,uuid,PK,Manifest tote
manifest_line,manifest_id,uuid,FK -> manifest,Parent
manifest_line,tote_lpn,text,FK -> lpn,Tote in shipment
manifest_line,order_id,uuid,FK -> orders,Order OHYD080QE510
manifest_line,qty,int,,8 / 20 etc
cancellation_putaway,cp_id,uuid,PK,Cancellation putaway (file tab exact)
cancellation_putaway,order_id,uuid,FK -> orders,File Return No
cancellation_putaway,status,enum,,CREATED / IN_PROGRESS / COMPLETED
cancellation_putaway,created_at,timestamp,,File Putaway Created At
cancellation_putaway,started_at,timestamp,,File Putaway Started At
cancellation_putaway,completed_at,timestamp,,File Putaway Complete
cancellation_putaway,pending_skus,int,,File Pending SKU
cancellation_putaway,remaining_qty,int,,File Remaining Qty
cancellation_putaway,pending_lpns,int,,File Pending LPN
dispatch_plan,plan_id,uuid,PK,Dispatch plan (file tab)
dispatch_plan,code,text,UK,DPHYD09 / DPAHM04 / DP-20260
dispatch_plan,site_id,uuid,FK -> site,Owning MH
dispatch_plan,mh_locations,text,,HYD-DRY-MH2 (file MH Locations)
dispatch_plan,status,enum,,ACTIVE / COMPLETED / EXPIRED (file Active Completed)
dispatch_plan,creation_time,timestamp,,File Plan Creation Time
dispatch_plan,expiry_time,timestamp,,File Plan Expiry Time
dispatch_plan,start_date,date,,2026/9/7
dispatch_plan,end_date,date,,2026/9/8
dispatch_plan,total_trips,int,,100 / 105
dispatch_plan,trips_with_vehicles,int,,0 / 86
dispatch_plan,updated_by,text,,ahmcold-pick1@zepto...
```

### Sheet 6 — `F_Transport`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
trip,trip_id,uuid,PK,Trip
trip,trip_no,text,UK,ZMT-2026
trip,site_id,uuid,FK -> site,Origin HYD080M HYD-DRY-MH2
trip,direction,enum,,FORWARD / RETURN / INBOUND_MH (file tabs incl inbound from MH)
trip,dest_site,text,,HYD-NCB / HYD-KOTI / KIRA-Pudur-Hyd
trip,trip_date,date,,6-Sep-26
trip,batch_slot,text,,Batch_1 2:00 PM (file Batch)
trip,batch_id,uuid,FK -> batch,Linked batch
trip,dispatch_plan_id,uuid,FK -> dispatch_plan,Parent plan
trip,vehicle_type_id,uuid,FK -> vehicle_type,14FT_TRUCK
trip,transporter_id,uuid,FK -> transporter,Smartship (file Vendor)
trip,vehicle_no,text,,TG08X176 / TS11UC70 (Assigned when set)
trip,driver_name,text,,Nikhil / Ramesh / Nitin
trip,driver_phone,text,,7.994E+09
trip,otr_cutoff,timestamp,,File OTR Cutoff
trip,otd_cutoff,timestamp,,File OTD Cutoff
trip,reporting_cutoff,timestamp,,File Reporting Cutoff 2026/9/7 6:00
trip,dock_in_at,timestamp,,File Dock In Time 2026/9/6 20:30
trip,dock_out_cutoff,timestamp,,File Dock Out Cutoff 21:30
trip,gate_out_at,timestamp,,Gate out
trip,completed_at,timestamp,,Completed
trip,lpns_loaded,int,,File 10 LPNs
trip,load_weight,text,,File ~79kg
trip,forward_lpns_total,int,,File 0/143 inbound MH
trip,delay_status,enum,,ON_TRACK / DELAYED (file both values)
trip,gps_status,enum,,LIVE / STALE / OFF (file GPS Status)
trip,pod_template,text,,LPN_SCANNING (file POD Template)
trip,paired_master_trip,uuid,FK -> trip,File Paired Master ZMT-2026
trip,billing_status,enum,,PLANNED / BILLED / PAID (file Billing Basis Planned)
trip,billing_basis,text,,24hours_2t (file Trip Contract)
trip,source_system,text,,Dhanalaxmi - Zepto (file Source)
trip,status,enum,,PLANNED / VEHICLE_ASSIGNED / CHECKED_IN / DOCKED_IN / LOADING / LOADED / IN_TRANSIT / ARRIVED / COMPLETED / CANCELLED (file Docked In Loading etc)
vehicle_checkin,checkin_id,uuid,PK,Check-in record (one table both directions)
vehicle_checkin,direction,enum,,OUTBOUND / INBOUND
vehicle_checkin,trip_id,uuid,FK -> trip,ZMT-2026
vehicle_checkin,asn_id,uuid,FK -> asn,For inbound receiving
vehicle_checkin,vehicle_no,text,,TS11UC70 / TG08T234
vehicle_checkin,driver_name,text,,Parag Jyoti
vehicle_checkin,driver_phone,text,,797537507
vehicle_checkin,checkin_at,timestamp,,File Check-In Time
vehicle_checkin,checkin_cutoff,timestamp,,File Cutoff 7:30 am
vehicle_checkin,dl_valid,bool,,File Valid DL Yes
vehicle_checkin,rc_valid,bool,,File Valid RC Yes
vehicle_checkin,six_sided,bool,,File Six-Sided Yes
vehicle_checkin,seal_no,text,,Inbound seal
vehicle_checkin,temp_reading,decimal,,Cold chain reading
vehicle_checkin,security_person,text,,SIBA SUNAR
vehicle_checkin,loading_manifest_id,uuid,FK -> manifest,File Loading Ma
vehicle_checkin,unloading_manifest_id,uuid,FK -> manifest,File Unloading M
vehicle_checkin,delay_status,enum,,ON_TRACK / DELAYED (file DELAYED)
vehicle_checkin,breach_type,text,,File CHECK_IN_BREACH
trip_return_leg,leg_id,uuid,PK,Return leg (file Returns tab)
trip_return_leg,trip_id,uuid,FK -> trip,Parent trip
trip_return_leg,return_lpns,int,,257
trip_return_leg,lpns_unloaded,int,,File 0/257
trip_return_leg,unload_checkin_at,timestamp,,File Unload Check In Time
trip_return_leg,dock_in_cutoff,timestamp,,File Cutoff 10:00 pm
trip_return_leg,dock_out_cutoff,timestamp,,File 2026/9/6 23:00
trip_return_leg,status,enum,,PENDING / RETURN_IN_TRANSIT / RETURNED / CLOSED (file Return In Transit)
```

### Sheet 7 — `G_CrossDock`
```csv
Table_Name,Column_Name,Data_Type,Key,Description
cross_dock_batch,xdb_id,uuid,PK,Cross dock batch (file tab)
cross_dock_batch,batch_no,text,UK,XHYD080 (file Cross Dock)
cross_dock_batch,site_id,uuid,FK -> site,Site
cross_dock_batch,status,enum,,UPLOADED / INWARDING / SORTING / COMPLETED (file UPLOADED)
cross_dock_batch,processing_type,enum,,LPN_BASED (file LPN_BAS)
cross_dock_batch,orders_count,int,,File Orders 5
cross_dock_batch,ordered_qty,int,,1431
cross_dock_batch,ordered_skus,int,,32
cross_dock_batch,inwarded_qty,int,,File 0
cross_dock_batch,inwarded_short,int,,0 Short
cross_dock_batch,sorted_qty,int,,1431
cross_dock_batch,sorted_short,int,,0 Short
cross_dock_batch,cancelled_skus,int,,File 0 SKUs
cross_dock_batch,xdock_allocable_qty,int,,File 1588873 Allocable Qty in XDock Bin
cross_dock_batch,created_by,uuid,FK -> user,
cross_dock_line,line_id,uuid,PK,Cross dock line
cross_dock_line,xdb_id,uuid,FK -> cross_dock_batch,Parent
cross_dock_line,asn_id,uuid,FK -> asn,Inwarding source
cross_dock_line,order_id,uuid,FK -> orders,OHYD0800 (file From Totes 6 To Totes 0)
cross_dock_line,sku_id,uuid,FK -> sku,SKU
cross_dock_line,qty,int,,Qty
cross_dock_line,xdock_bin,text,,XDock staging bin
cross_dock_line,allocatable_qty,int,,File Allocable Qty
cross_dock_line,status,enum,,PENDING / ALLOCATED / SORTED / SHIPPED
```

### Sheet 8 — `H_Optional` *(enable per site — not present in your file)*
```csv
Table_Name,Column_Name,Data_Type,Key,Description
cycle_count,count_id,uuid,PK,Count document
cycle_count,site_id,uuid,FK -> site,Site
cycle_count,type,enum,,BIN / SKU / BLIND
cycle_count,scope,text,,Bins or SKUs in scope
cycle_count,status,enum,,PLANNED / IN_PROGRESS / COMPLETED
cycle_count,created_by,uuid,FK -> user,
cycle_count_line,line_id,uuid,PK,Count line
cycle_count_line,count_id,uuid,FK -> cycle_count,Parent
cycle_count_line,sku_id,uuid,FK -> sku,SKU
cycle_count_line,bin_id,uuid,FK -> bin,Bin
cycle_count_line,system_qty,int,,Book stock
cycle_count_line,counted_qty,int,,Physical
cycle_count_line,variance,int,,Delta
cycle_count_line,status,enum,,PENDING / MATCHED / VARIANCE / ADJUSTED
replenishment_task,rep_id,uuid,PK,Refill task
replenishment_task,site_id,uuid,FK -> site,Site
replenishment_task,sku_id,uuid,FK -> sku,SKU
replenishment_task,from_bin_id,uuid,FK -> bin,Reserve bin
replenishment_task,to_bin_id,uuid,FK -> bin,Pickzone bin
replenishment_task,qty,int,,Quantity
replenishment_task,trigger,enum,,ALLOCATION / THRESHOLD
replenishment_task,status,enum,,CREATED / ASSIGNED / DONE / CANCELLED
```

---

## Coverage Proof — Every Tab in Your Input File → Table or View

| Your file tab | Served by | Your file tab | Served by |
|---|---|---|---|
| Transfer Orders / STO | `orders` + `order_line` | SKU Transaction Log | view `v_tx_log` ← `inventory_tx` |
| RETURN / EXTERNAL RTV / Secondary Sales / Scrap | `orders` (type + inventory_type + shipment_type) | LPN Movement | `droplist` + `lpn` |
| Cancellation putaway (all 8 cols) | `cancellation_putaway` — exact | Re-Inventorization Enquiry | view `v_reinvent` ← `inventory_tx` (from/to lot cols) |
| Batches (incl. Cluster Code CZ-02, Sorting Eligible) | `batch` | Catalog / Bins / Zone / Vendor Master | `sku` / `bin` / `zone` / `vendor` |
| Pick list | `picklist` | On Hold / Hold By / Hold At | `inventory_lot.on_hold/hold_by/hold_at` |
| Sorting List (Close Suggestion/Closed By/Close Type) | `sortlist` | External & Internal Inbound IDs | `inventory_lot.inbound_type + inbound_ref` |
| Tote Sorting / Dispatch (tote level) | `sortlist_line`, `manifest_line` | Source MH Id / Source Vendor Id | `inventory_lot.source_site_id / source_vendor_id` |
| Tote QC (QC/IRT, SuperStore) | `lpn` (qc/irt fields — demoted from table) | Pallet | `lpn.parent_pallet_id` |
| Cross Dock Batches (Allocable in XDock) | `cross_dock_batch` + `_line` | DH/SS Precedence | `site.dh_precedence / ss_precedence` |
| Dispatch Plans (Active/Completed) | `dispatch_plan` | WAC / EAN / Section / MRP / Expiry | `sku.wac/ean` + `sku_category` + `inventory_lot` |
| Manifests (285/21 totes, LPN Base) | `manifest` + `manifest_line` | Bin detail (Level/Rack Class/MTS_0.8x0/LBH/Putaway Max/Roll No) | `bin` |
| Docked Vehicles | `trip` (docked fields) | Zone detail (MRP/Flexi/Commingled/Hazardous/ADVANCE_ZONE) | `zone` |
| Trips / OTR / OTD / Assigned | `trip` | Multi Run / ActualAllocated / Allocated Bin | `orders.multi_run` / `order_line.actual_allocated_qty / allocated_bin` |
| Vehicle Check-In (RC/6-sided/DL/Security/Breach) | `vehicle_checkin` | Shipped/Canceled At/By, Received at Dest, Discrepancy | `orders` |
| Loading pending / in progress (Batch_1 2PM, 10 LPNs ~79kg) | `trip.batch_slot / lpns_loaded / load_weight` | Uploaded File / Error File | `orders.upload_ref` (S3) + `file_upload` pattern at infra |
| In transit (GPS/On Track/driver) | `trip.delay_status / gps_status / driver` | Created By / Updated By (names, emails) | `user` FKs throughout |
| Returns (0/257, dock cutoffs) | `trip_return_leg` | Billing Basis 24hours_2t / Paired Master / POD Template | `trip.billing_basis / paired_master_trip / pod_template` |
| Inbound from MH (0/143 forward LPNs) | `trip.direction=INBOUND_MH` + `forward_lpns_total` → feeds `asn` | CHECK_IN_BREACH / DELAYED / Reporting Cutoff | `vehicle_checkin.breach_type` / `trip.delay_status` / `trip.reporting_cutoff` |
| — *not in your file* — | **Inbound module** `asn, asn_line, grn, grn_line, putaway_task, inbound_discrepancy` | — *not in your file* — | Optional: cycle counting, replenishment |

