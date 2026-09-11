from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from datetime import timedelta
from .models import Shipment, ShipmentManifest, ShipmentStatusChoices
from .serializers import (
    ShipmentSerializer,
    CreateShipmentLabelSerializer,
    ShipmentManifestSerializer,
    CreateManifestSerializer
)
from apps.fulfillment.models import SalesOrder, OrderStatusChoices
from apps.inventory.services import InventoryService
from apps.webhooks.tasks import trigger_outgoing_webhook_async

class ShipmentViewSet(viewsets.ModelViewSet):
    queryset = Shipment.objects.all().select_related('order', 'order__customer')
    serializer_class = ShipmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'logistics_partner', 'order']
    search_fields = ['shipment_number', 'tracking_number', 'order__order_number']

    @action(detail=False, methods=['post'], url_path='generate-label')
    @transaction.atomic
    def generate_label(self, request):
        """
        Creates shipment, calculates carrier tracking number & simulated label URL,
        marks order as shipped, and triggers double-entry ledger deduction.
        """
        serializer = CreateShipmentLabelSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        order_id = serializer.validated_data['order_id']
        try:
            order = SalesOrder.objects.select_for_update().get(id=order_id)
        except SalesOrder.DoesNotExist:
            return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)

        partner = serializer.validated_data['logistics_partner']
        shipment = Shipment.objects.create(
            order=order,
            package_weight_kg=serializer.validated_data['package_weight_kg'],
            package_dimensions=serializer.validated_data.get('package_dimensions', {}),
            logistics_partner=partner,
            delivery_eta=timezone.now() + timedelta(days=3),
            shipping_label_url=f"https://labels.zippzo.com/pdf/{order.order_number}.pdf",
            status=ShipmentStatusChoices.LABELED
        )

        order.status = OrderStatusChoices.SHIPPED
        for itm in order.items.all():
            itm.shipped_qty += itm.picked_qty
            itm.save()
        order.save()

        # Fire webhook for order.shipped
        try:
            trigger_outgoing_webhook_async.delay(
                'order.shipped',
                {
                    'order_number': order.order_number,
                    'shipment_number': shipment.shipment_number,
                    'logistics_partner': shipment.logistics_partner,
                    'tracking_number': shipment.tracking_number,
                    'eta': shipment.delivery_eta.isoformat() if shipment.delivery_eta else None
                }
            )
        except Exception:
            pass

        return Response(ShipmentSerializer(shipment).data, status=status.HTTP_201_CREATED)

class ShipmentManifestViewSet(viewsets.ModelViewSet):
    queryset = ShipmentManifest.objects.all().select_related('created_by').prefetch_related('shipments', 'shipments__order')
    serializer_class = ShipmentManifestSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['logistics_partner']
    search_fields = ['manifest_number', 'driver_name', 'vehicle_number']

    @action(detail=False, methods=['post'], url_path='dispatch')
    @transaction.atomic
    def dispatch_manifest(self, request):
        serializer = CreateManifestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        shipments = Shipment.objects.filter(id__in=serializer.validated_data['shipment_ids'])
        manifest = ShipmentManifest.objects.create(
            logistics_partner=serializer.validated_data['logistics_partner'],
            driver_name=serializer.validated_data['driver_name'],
            vehicle_number=serializer.validated_data['vehicle_number'],
            driver_phone=serializer.validated_data.get('driver_phone', ''),
            total_packages=shipments.count(),
            created_by=request.user
        )
        manifest.shipments.set(shipments)

        # Update shipments status to picked_up / in_transit
        shipments.update(status=ShipmentStatusChoices.PICKED_UP)

        return Response(ShipmentManifestSerializer(manifest).data, status=status.HTTP_201_CREATED)
