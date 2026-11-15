import React from 'react';
import StoreGate from '../../views/darkstore/StoreGate';
import DeliveryAreasPanel from '../../views/admin/DeliveryAreasPanel';
import { useDarkStore } from '../../views/darkstore/useDarkStore';

/**
 * Service areas — the pincodes this dark store promises to serve.
 *
 * The DeliveryAreasPanel enforces the rule on the backend side: checkout refuses
 * an address outside a store's published list, so this is the control that
 * opens or withdraws a pincode for this store.
 */
export default function ServiceAreasView() {
  const { darkStores } = useDarkStore();
  return (
    <StoreGate>
      <DeliveryAreasPanel stores={darkStores} />
    </StoreGate>
  );
}
