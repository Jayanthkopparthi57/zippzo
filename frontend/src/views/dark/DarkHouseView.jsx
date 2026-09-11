import React, { useState, useEffect } from 'react';
import { useTabs } from '../../context/TabContext';
import {
  Zap,
  ShoppingBag,
  Clock,
  CheckCircle2,
  Truck,
  RotateCcw,
  Package,
  Plus,
  Minus,
  ArrowRight,
  RefreshCw,
  Sparkles,
  MapPin,
  AlertTriangle,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { apiClient } from '../../api/client';

export default function DarkHouseView() {
  const { openTab } = useTabs();

  // State
  const [skus, setSkus] = useState([]);
  const [lots, setLots] = useState([]);
  const [orders, setOrders] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cart State
  const [cart, setCart] = useState({});
  const [customerName, setCustomerName] = useState('Ananya Sharma');
  const [deliveryAddress, setDeliveryAddress] = useState('Flat 402, Apex Towers, Rajahmundry');
  const [selectedHub, setSelectedHub] = useState('RJY-DS-001');

  // Active Tab within Dark House
  const [activeSubtab, setActiveSubtab] = useState('storefront'); // 'storefront' | 'my-orders' | 'returns' | 'pipeline-monitor'

  // Return Modal State
  const [returnModalOrder, setReturnModalOrder] = useState(null);
  const [returnReason, setReturnReason] = useState('DAMAGED_ITEM');
  const [returnRemarks, setReturnRemarks] = useState('Packaging torn during transit');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  // Order Placement Loading State
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderSuccessMsg, setOrderSuccessMsg] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [skusRes, lotsRes, ordersRes, returnsRes] = await Promise.all([
        apiClient.get('/master/skus/'),
        apiClient.get('/inventory/lots/'),
        apiClient.get('/outbound/orders/'),
        apiClient.get('/outbound/cancellation-putaways/'),
      ]);

      setSkus(skusRes.results || skusRes || []);
      setLots(lotsRes.results || lotsRes || []);
      setOrders(ordersRes.results || ordersRes || []);
      setReturns(returnsRes.results || returnsRes || []);
    } catch (err) {
      console.error('Failed to load Dark House storefront data:', err);
      setError('Unable to connect to Zippzo WMS backend. Ensure Django server is running on port 8000.');
    } finally {
      setLoading(false);
    }
  };

  // Helper: Get available quantity for SKU from lots
  const getStockForSku = (skuId, skuCode) => {
    const matched = lots.filter(l => l.sku === skuId || l.sku_code === skuCode);
    if (!matched.length) return 50; // fallback default
    return matched.reduce((acc, l) => acc + (l.quantity_on_hand || l.available_qty || 0), 0);
  };

  // Cart operations
  const updateCartQty = (skuId, change) => {
    setCart(prev => {
      const current = prev[skuId] || 0;
      const next = Math.max(0, current + change);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[skuId];
        return copy;
      }
      return { ...prev, [skuId]: next };
    });
  };

  const getCartTotalItems = () => {
    return Object.values(cart).reduce((sum, q) => sum + q, 0);
  };

  const getCartTotalPrice = () => {
    return Object.entries(cart).reduce((total, [skuId, qty]) => {
      const item = skus.find(s => String(s.sku_id) === String(skuId) || String(s.id) === String(skuId));
      const price = item?.mrp || item?.cost_price || 120;
      return total + (price * qty);
    }, 0);
  };

  // Place Order Action (Customer -> WMS DB)
  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (getCartTotalItems() === 0) return;

    setPlacingOrder(true);
    setOrderSuccessMsg(null);

    try {
      const orderNo = `ORD-DH-${Math.floor(100000 + Math.random() * 900000)}`;
      const totalQty = getCartTotalItems();
      const skuCount = Object.keys(cart).length;

      // 1. Create Order in WMS DB
      const newOrderPayload = {
        order_no: orderNo,
        type: 'REGULAR',
        status: 'CREATED',
        processing_type: 'LPN_BASED',
        inventory_type: 'GOOD',
        shipment_type: 'EXPRESS_RIDER',
        reference_order: `CUST-${Date.now().toString().slice(-6)}`,
        ordered_qty: totalQty,
        ordered_skus: skuCount,
        allocated_qty: totalQty,
        remarks: `Dark House 10-Min Order for ${customerName} at ${deliveryAddress}`,
      };

      const createdOrder = await apiClient.post('/outbound/orders/', newOrderPayload);

      // 2. Create Order Lines
      for (const [skuId, qty] of Object.entries(cart)) {
        const skuObj = skus.find(s => String(s.sku_id) === String(skuId) || String(s.id) === String(skuId));
        if (skuObj) {
          await apiClient.post('/outbound/order-lines/', {
            order: createdOrder.order_id,
            sku: skuObj.sku_id || skuObj.id,
            ordered_qty: qty,
            allocated_qty: qty,
            line_status: 'CREATED',
          });
        }
      }

      // Reset cart and notify
      setCart({});
      setOrderSuccessMsg(`🎉 Order #${orderNo} placed successfully! Sent to WMS Dark Store Hub (${selectedHub}) for instant picking.`);
      await fetchData();
      setActiveSubtab('my-orders');
    } catch (err) {
      console.error('Order creation error:', err);
      alert(`Failed to place order: ${err.message}`);
    } finally {
      setPlacingOrder(false);
    }
  };

  // Submit Order Return Request (Customer -> WMS Cancellation Putaway)
  const handleSubmitReturn = async () => {
    if (!returnModalOrder) return;
    setReturnSubmitting(true);

    try {
      const payload = {
        order: returnModalOrder.order_id,
        order_no: returnModalOrder.order_no,
        pending_skus: returnModalOrder.ordered_skus || 1,
        remaining_qty: returnModalOrder.ordered_qty || 1,
        pending_lpns: 1,
        status: 'PENDING_QC',
        reason_code: returnReason,
        remarks: returnRemarks
      };

      await apiClient.post('/outbound/cancellation-putaways/', payload);

      // Update order status to CANCELLED / RETURNED
      await apiClient.patch(`/outbound/orders/${returnModalOrder.order_id}/`, {
        status: 'CANCELLED',
        remarks: `Return requested: ${returnRemarks}`,
      });

      alert(`✅ Return request registered for Order #${returnModalOrder.order_no}! Cancellation Putaway created in WMS.`);
      setReturnModalOrder(null);
      await fetchData();
      setActiveSubtab('returns');
    } catch (err) {
      console.error('Return error:', err);
      alert(`Failed to request return: ${err.message}`);
    } finally {
      setReturnSubmitting(false);
    }
  };

  // Fast Advance Order Status (Simulator Helper for Real User Testing)
  const advanceOrderStatus = async (orderId, currentStatus) => {
    const statusMap = {
      'CREATED': 'ALLOCATED',
      'ALLOCATED': 'PICKING',
      'PICKING': 'PACKED',
      'PACKED': 'SHIPPED',
      'SHIPPED': 'CLOSED',
    };
    const nextStatus = statusMap[currentStatus];
    if (!nextStatus) return;

    try {
      await apiClient.patch(`/outbound/orders/${orderId}/`, { status: nextStatus });
      await fetchData();
    } catch (err) {
      console.error('Failed to advance order status:', err);
    }
  };

  return (
    <div style={{ padding: '20px', background: 'var(--bg-app, #0f172a)', color: 'var(--text-primary, #f8fafc)', minHeight: 'calc(100vh - 110px)' }}>
      
      {/* BRANDING HEADER */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        padding: '20px 24px',
        borderRadius: '12px',
        border: '1px solid #334155',
        marginBottom: '20px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
            color: '#fff',
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(225, 29, 72, 0.4)'
          }}>
            <Zap size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#fff' }}>
                ZIPPZO DARK HOUSE
              </h1>
              <span style={{
                background: 'rgba(225, 29, 72, 0.15)',
                color: '#fb7185',
                border: '1px solid rgba(225, 29, 72, 0.3)',
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.05em'
              }}>
                ⚡ 10-MIN RAPID FULFILLMENT
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Dark Store Customer Order Portal & Real-Time WMS Pipeline Integrator (Hub: <strong>{selectedHub}</strong>)
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchData}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#334155',
              color: '#f8fafc',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Sync WMS DB
          </button>
          
          <button
            onClick={() => openTab('sto')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Package size={14} />
            Open WMS Console
          </button>
        </div>
      </div>

      {/* SUB-NAVIGATION RAILS */}
      <div style={{
        display: 'flex',
        gap: '8px',
        borderBottom: '1px solid #334155',
        marginBottom: '20px',
        paddingBottom: '2px'
      }}>
        <button
          onClick={() => setActiveSubtab('storefront')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            background: activeSubtab === 'storefront' ? '#2563eb' : 'transparent',
            color: activeSubtab === 'storefront' ? '#fff' : '#94a3b8',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <ShoppingBag size={15} />
          Dark Store Catalog & Cart
          {getCartTotalItems() > 0 && (
            <span style={{ background: '#e11d48', color: '#fff', padding: '1px 7px', borderRadius: '99px', fontSize: '11px' }}>
              {getCartTotalItems()}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubtab('my-orders')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            background: activeSubtab === 'my-orders' ? '#2563eb' : 'transparent',
            color: activeSubtab === 'my-orders' ? '#fff' : '#94a3b8',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Clock size={15} />
          Customer Orders ({orders.length})
        </button>

        <button
          onClick={() => setActiveSubtab('returns')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            background: activeSubtab === 'returns' ? '#2563eb' : 'transparent',
            color: activeSubtab === 'returns' ? '#fff' : '#94a3b8',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <RotateCcw size={15} />
          Returns & Cancellations ({returns.length})
        </button>

        <button
          onClick={() => setActiveSubtab('pipeline-monitor')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            background: activeSubtab === 'pipeline-monitor' ? '#2563eb' : 'transparent',
            color: activeSubtab === 'pipeline-monitor' ? '#fff' : '#94a3b8',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Sparkles size={15} />
          Live WMS Pipeline Monitor
        </button>
      </div>

      {/* SUCCESS BANNER */}
      {orderSuccessMsg && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          color: '#34d399',
          padding: '14px 18px',
          borderRadius: '8px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 600 }}>
            <CheckCircle2 size={18} />
            {orderSuccessMsg}
          </div>
          <button
            onClick={() => setOrderSuccessMsg(null)}
            style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', fontSize: '16px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ERROR BANNER */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#f87171',
          padding: '14px 18px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {/* VIEW 1: STOREFRONT & CART */}
      {activeSubtab === 'storefront' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
          
          {/* PRODUCT CATALOG GRID */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                Dark Store Inventory Catalog ({skus.length} SKUs in Hub)
              </h3>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Stock synced with bin storage lots
              </span>
            </div>

            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
                <div>Loading Dark Store Catalog...</div>
              </div>
            ) : skus.length === 0 ? (
              <div style={{ padding: '40px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                <Package size={32} style={{ color: '#64748b', marginBottom: '10px' }} />
                <div>No SKUs available in Dark Store master catalog.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
                {skus.map((sku) => {
                  const skuIdStr = String(sku.sku_id || sku.id);
                  const qtyInCart = cart[skuIdStr] || 0;
                  const availableStock = getStockForSku(sku.sku_id || sku.id, sku.sku_code);
                  const price = sku.mrp || sku.cost_price || 120;

                  return (
                    <div key={skuIdStr} style={{
                      background: '#1e293b',
                      borderRadius: '10px',
                      border: '1px solid #334155',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s ease',
                      boxShadow: qtyInCart > 0 ? '0 0 0 2px #2563eb' : 'none'
                    }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <span style={{
                            background: '#0f172a',
                            color: '#38bdf8',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {sku.category_name || 'GROCERY'}
                          </span>
                          <span style={{ fontSize: '11px', color: availableStock > 10 ? '#34d399' : '#fb7185', fontWeight: 600 }}>
                            {availableStock} in Bin
                          </span>
                        </div>

                        <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 4px', color: '#f8fafc' }}>
                          {sku.sku_name || sku.name || sku.sku_code}
                        </h4>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '12px' }}>
                          Code: {sku.sku_code}
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>
                            ₹{price}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            10-Min Delivery
                          </div>
                        </div>

                        {qtyInCart === 0 ? (
                          <button
                            onClick={() => updateCartQty(skuIdStr, 1)}
                            style={{
                              width: '100%',
                              background: '#2563eb',
                              color: '#fff',
                              border: 'none',
                              padding: '8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Plus size={14} /> Add to Cart
                          </button>
                        ) : (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: '#0f172a',
                            borderRadius: '6px',
                            padding: '4px'
                          }}>
                            <button
                              onClick={() => updateCartQty(skuIdStr, -1)}
                              style={{ background: '#334155', color: '#fff', border: 'none', width: '28px', height: '28px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Minus size={14} />
                            </button>
                            <span style={{ fontWeight: 800, fontSize: '14px', color: '#fff' }}>
                              {qtyInCart}
                            </span>
                            <button
                              onClick={() => updateCartQty(skuIdStr, 1)}
                              style={{ background: '#2563eb', color: '#fff', border: 'none', width: '28px', height: '28px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CHECKOUT / CART PANEL */}
          <div>
            <div style={{
              background: '#1e293b',
              borderRadius: '12px',
              border: '1px solid #334155',
              padding: '20px',
              position: 'sticky',
              top: '20px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #334155', paddingBottom: '12px' }}>
                <ShoppingBag size={18} style={{ color: '#38bdf8' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                  Order Summary
                </h3>
              </div>

              {/* Customer Details Form */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    color: '#fff',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    marginBottom: '10px'
                  }}
                />

                <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                  Delivery Address
                </label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    color: '#fff',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
              </div>

              {/* Cart Line Items */}
              <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                {Object.keys(cart).length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                    Cart is empty. Add items from the catalog.
                  </div>
                ) : (
                  Object.entries(cart).map(([skuId, qty]) => {
                    const skuObj = skus.find(s => String(s.sku_id) === String(skuId) || String(s.id) === String(skuId));
                    const price = skuObj?.mrp || skuObj?.cost_price || 120;
                    return (
                      <div key={skuId} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px dashed #334155',
                        fontSize: '12px'
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                            {skuObj?.sku_name || skuObj?.sku_code || 'Item'}
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                            {qty} x ₹{price}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: '#38bdf8' }}>
                          ₹{qty * price}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Total Calculation */}
              <div style={{ borderTop: '1px solid #334155', paddingTop: '12px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  <span>Item Subtotal ({getCartTotalItems()} items)</span>
                  <span>₹{getCartTotalPrice()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                  <span>Instant Delivery Charge</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>FREE</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: '#fff' }}>
                  <span>Total Amount</span>
                  <span style={{ color: '#fb7185' }}>₹{getCartTotalPrice()}</span>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handlePlaceOrder}
                disabled={getCartTotalItems() === 0 || placingOrder}
                style={{
                  width: '100%',
                  background: getCartTotalItems() === 0 ? '#334155' : 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: getCartTotalItems() === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: getCartTotalItems() > 0 ? '0 4px 14px rgba(225, 29, 72, 0.4)' : 'none'
                }}
              >
                {placingOrder ? (
                  <RefreshCw size={16} className="spin" />
                ) : (
                  <Zap size={16} />
                )}
                {placingOrder ? 'Sending to WMS Dark Store...' : '⚡ PLACE 10-MIN INSTANT ORDER'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: CUSTOMER ORDERS & LIVE TRACKING */}
      {activeSubtab === 'my-orders' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Live Customer Orders & 10-Min Delivery Pipeline
            </h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {orders.length} Total Orders in WMS Database
            </span>
          </div>

          {orders.length === 0 ? (
            <div style={{ padding: '40px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
              <Package size={32} style={{ color: '#64748b', marginBottom: '10px' }} />
              <div>No orders found. Place an order from the Dark Store Catalog tab.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {orders.map((ord) => {
                const isDelivered = ord.status === 'CLOSED' || ord.status === 'RECEIVED';
                const isCancelled = ord.status === 'CANCELLED';

                return (
                  <div key={ord.order_id} style={{
                    background: '#1e293b',
                    borderRadius: '10px',
                    border: '1px solid #334155',
                    padding: '20px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <h4 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: '#38bdf8' }}>
                            Order #{ord.order_no}
                          </h4>
                          <span style={{
                            background: isCancelled ? 'rgba(239, 68, 68, 0.2)' : isDelivered ? 'rgba(16, 185, 129, 0.2)' : 'rgba(37, 99, 235, 0.2)',
                            color: isCancelled ? '#f87171' : isDelivered ? '#34d399' : '#60a5fa',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700
                          }}>
                            {ord.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                          Ref: {ord.reference_order || 'N/A'} • Created: {new Date(ord.created_at).toLocaleTimeString()}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        {/* Simulation trigger to advance status */}
                        {!isDelivered && !isCancelled && (
                          <button
                            onClick={() => advanceOrderStatus(ord.order_id, ord.status)}
                            style={{
                              background: '#334155',
                              color: '#f8fafc',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            Advance WMS Status <ChevronRight size={14} />
                          </button>
                        )}

                        {/* Return Request Button */}
                        {!isCancelled && (
                          <button
                            onClick={() => setReturnModalOrder(ord)}
                            style={{
                              background: 'rgba(225, 29, 72, 0.15)',
                              color: '#fb7185',
                              border: '1px solid rgba(225, 29, 72, 0.3)',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <RotateCcw size={13} /> Request Return
                          </button>
                        )}
                      </div>
                    </div>

                    {/* LIVE 10-MIN PIPELINE TRACKER */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(5, 1fr)',
                      gap: '8px',
                      background: '#0f172a',
                      padding: '12px',
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      {[
                        { key: 'CREATED', label: '1. Received at Hub', desc: 'Order logged in WMS' },
                        { key: 'ALLOCATED', label: '2. Inventory Reserved', desc: 'Bin lots locked' },
                        { key: 'PICKING', label: '3. Picking in Bin', desc: 'Picker routing' },
                        { key: 'PACKED', label: '4. Packed & QC', desc: 'Station scan verified' },
                        { key: 'SHIPPED', label: '5. Out for Delivery', desc: 'Rider en route' },
                      ].map((step, idx) => {
                        const statusOrder = ['CREATED', 'ALLOCATED', 'PICKING', 'PACKED', 'SHIPPED', 'CLOSED'];
                        const currentIdx = statusOrder.indexOf(ord.status);
                        const isDone = currentIdx >= idx || ord.status === 'CLOSED';
                        const isCurrent = currentIdx === idx && ord.status !== 'CLOSED';

                        return (
                          <div key={step.key} style={{
                            textAlign: 'center',
                            padding: '8px',
                            borderRadius: '6px',
                            background: isCurrent ? 'rgba(37, 99, 235, 0.25)' : isDone ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                            border: isCurrent ? '1px solid #2563eb' : 'none'
                          }}>
                            <div style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: isDone ? '#10b981' : '#334155',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              fontWeight: 800,
                              margin: '0 auto 6px'
                            }}>
                              {isDone ? '✓' : idx + 1}
                            </div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: isDone ? '#34d399' : '#94a3b8' }}>
                              {step.label}
                            </div>
                            <div style={{ fontSize: '9px', color: '#64748b' }}>
                              {step.desc}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* ORDER META & ITEMS */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8' }}>
                      <div>
                        Ordered Qty: <strong style={{ color: '#fff' }}>{ord.ordered_qty} units</strong> • SKUs: <strong style={{ color: '#fff' }}>{ord.ordered_skus} lines</strong>
                      </div>
                      <div>
                        Hub: <strong style={{ color: '#fff' }}>{selectedHub}</strong> • Rider: <strong style={{ color: '#38bdf8' }}>Zippzo Express Rider #14</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: RETURNS & CANCELLATIONS */}
      {activeSubtab === 'returns' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Customer Order Returns & Cancellation Putaways
            </h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {returns.length} Return Records in WMS Database
            </span>
          </div>

          {returns.length === 0 ? (
            <div style={{ padding: '40px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
              <RotateCcw size={32} style={{ color: '#64748b', marginBottom: '10px' }} />
              <div>No return requests registered yet.</div>
            </div>
          ) : (
            <div style={{ background: '#1e293b', borderRadius: '10px', border: '1px solid #334155', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 16px' }}>Return ID</th>
                    <th style={{ padding: '12px 16px' }}>Order No</th>
                    <th style={{ padding: '12px 16px' }}>Pending SKUs</th>
                    <th style={{ padding: '12px 16px' }}>Remaining Qty</th>
                    <th style={{ padding: '12px 16px' }}>Reason</th>
                    <th style={{ padding: '12px 16px' }}>QC Status</th>
                    <th style={{ padding: '12px 16px' }}>WMS Action</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((ret) => (
                    <tr key={ret.cp_id} style={{ borderBottom: '1px solid #334155' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#38bdf8' }}>
                        CP-{ret.cp_id.toString().slice(0, 8)}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {ret.order_no}
                      </td>
                      <td style={{ padding: '12px 16px' }}>{ret.pending_skus}</td>
                      <td style={{ padding: '12px 16px' }}>{ret.remaining_qty}</td>
                      <td style={{ padding: '12px 16px', color: '#fb7185' }}>{ret.reason_code || 'Damaged'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: 'rgba(234, 179, 8, 0.2)',
                          color: '#facc15',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 700
                        }}>
                          {ret.status || 'PENDING_QC'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          onClick={() => openTab('cancellation-putaway')}
                          style={{
                            background: '#2563eb',
                            color: '#fff',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            cursor: 'pointer'
                          }}
                        >
                          Process in WMS
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: LIVE WMS PIPELINE MONITOR */}
      {activeSubtab === 'pipeline-monitor' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          
          <div style={{ background: '#1e293b', padding: '20px', borderRadius: '10px', border: '1px solid #334155' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 12px', color: '#38bdf8' }}>
              1. Inbound & Bin Storage
            </h4>
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
              <div>• Stock received via Supplier ASNs</div>
              <div>• Quality Inspection & GRN logging</div>
              <div>• Bin putaway: <strong style={{ color: '#fff' }}>A01-R02-S01-B08</strong></div>
              <div>• FEFO expiry date priority locked</div>
            </div>
            <button
              onClick={() => openTab('inbound-asns')}
              style={{ marginTop: '16px', background: '#334155', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
            >
              Open Inbound Console →
            </button>
          </div>

          <div style={{ background: '#1e293b', padding: '20px', borderRadius: '10px', border: '1px solid #334155' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 12px', color: '#fb7185' }}>
              2. Dark House Order Fulfillment
            </h4>
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
              <div>• Instant order allocation from bin stock</div>
              <div>• Picklist generation & picker assignment</div>
              <div>• Packing scan & box label print</div>
              <div>• Express Rider Manifest creation</div>
            </div>
            <button
              onClick={() => openTab('picklists')}
              style={{ marginTop: '16px', background: '#334155', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
            >
              Open Picklists Console →
            </button>
          </div>

          <div style={{ background: '#1e293b', padding: '20px', borderRadius: '10px', border: '1px solid #334155' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 12px', color: '#34d399' }}>
              3. Delivery & Return Loop
            </h4>
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6 }}>
              <div>• Real-time 10-Min order tracking</div>
              <div>• Customer Return / Damage claim trigger</div>
              <div>• Cancellation Putaway (CP) receiving</div>
              <div>• Stock restored back to storage bin</div>
            </div>
            <button
              onClick={() => openTab('cancellation-putaway')}
              style={{ marginTop: '16px', background: '#334155', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
            >
              Open Cancellation Putaway →
            </button>
          </div>

        </div>
      )}

      {/* RETURN MODAL */}
      {returnModalOrder && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 10000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '24px',
            width: '440px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#fb7185' }}>
                Request Order Return / Damage Claim
              </h3>
              <button
                onClick={() => setReturnModalOrder(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
              Order: <strong style={{ color: '#fff' }}>#{returnModalOrder.order_no}</strong> ({returnModalOrder.ordered_qty} units)
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                Reason Code
              </label>
              <select
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  color: '#fff',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
              >
                <option value="DAMAGED_ITEM">Item Damaged / Leaking</option>
                <option value="WRONG_ITEM">Wrong SKU Received</option>
                <option value="CUSTOMER_CANCEL">Customer Cancelled at Doorstep</option>
                <option value="EXPIRED_ITEM">Near Expiry / Quality Fail</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                Inspection Remarks
              </label>
              <textarea
                value={returnRemarks}
                onChange={e => setReturnRemarks(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  color: '#fff',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setReturnModalOrder(null)}
                style={{
                  flex: 1,
                  background: '#334155',
                  color: '#fff',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReturn}
                disabled={returnSubmitting}
                style={{
                  flex: 1,
                  background: '#e11d48',
                  color: '#fff',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {returnSubmitting ? 'Registering Return...' : 'Submit Return to WMS'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
