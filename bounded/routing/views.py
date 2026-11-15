from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsAdminUserOrReadOnly
from bounded.money.models import resolve_delivery_fee

from .models import DeliveryArea, RoutingDecision, Serviceability
from .serializers import (DeliveryAreaSerializer, RoutingDecisionSerializer,
                          ServiceabilitySerializer)


class DeliveryAreaViewSet(viewsets.ModelViewSet):
    """The pincodes each store delivers to.

    Readable by every signed-in operator (a cashier answering "do we deliver to
    560034?" needs the answer), writable only by admins: withdrawing a pincode
    stops orders for a whole area, which is not a shop-floor decision.
    """

    queryset = DeliveryArea.objects.select_related('site').all()
    serializer_class = DeliveryAreaSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['site', 'pincode', 'band', 'is_active']
    search_fields = ['pincode', 'site__code', 'site__name']

    def get_queryset(self):
        qs = super().get_queryset()
        # The admin screen filters by site code, not by uuid, so both spellings
        # work exactly like the rest of the console.
        site = self.request.query_params.get('site_code')
        if site:
            qs = qs.filter(site__code=site)
        return qs


class CoverageView(APIView):
    """Which stores can serve this pincode - the shopper's address check.

    `configured` is false while nobody has entered any delivery area: the
    storefront then keeps offering stores as it always did instead of telling
    every shopper their address is unserved.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        pincode = (request.query_params.get('pincode') or '').strip()
        if not pincode:
            return Response({'error': 'pincode is required.'}, status=400)
        if not (len(pincode) == 6 and pincode.isdigit()):
            return Response({'error': 'A pincode is exactly 6 digits.'}, status=400)

        rows = [
            row for row in DeliveryArea.sites_for(pincode)
            if row.site.site_type in ('DS', 'DARK_STORE')
            and row.site.status == 'ACTIVE'
            and row.site.is_accepting_orders
        ]
        sites = [
            {
                'site_id': str(row.site_id),
                'code': row.site.code,
                'name': row.site.name,
                'band': row.band,
                'delivery_fee': str(resolve_delivery_fee(row.site)),
                'is_accepting_orders': row.site.is_accepting_orders,
                'geo_lat': str(row.site.geo_lat) if row.site.geo_lat is not None else None,
                'geo_lng': str(row.site.geo_lng) if row.site.geo_lng is not None else None,
            }
            for row in rows
        ]
        return Response({
            'pincode': pincode,
            'configured': DeliveryArea.objects.filter(is_active=True).exists(),
            'sites': sites,
        })


class ServiceabilityViewSet(viewsets.ModelViewSet):
    queryset = Serviceability.objects.all()
    serializer_class = ServiceabilitySerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['site','band','day_of_week']


class RoutingDecisionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RoutingDecision.objects.all()
    serializer_class = RoutingDecisionSerializer
    permission_classes = [IsAuthenticated]
