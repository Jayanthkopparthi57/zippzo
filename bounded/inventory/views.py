# Inventory Views
from rest_framework import viewsets
from .models import LpnMaster, LpnContent, StockMovement, StockBalance, StockMovementsChain
from .serializers import LpnMasterSerializer, LpnContentSerializer, StockMovementSerializer, StockBalanceSerializer, StockMovementsChainSerializer


def _ledger_scope(user):
    """Site codes this caller may read, or None for the network-wide view.

    Every balance and every movement of every store used to be readable by any
    authenticated account - stock levels across the network, with the site and
    lot each one sits on. Administrators keep the network-wide view.
    """
    from bounded.ds_ops.access import is_superuser, operator_site_codes

    if user is None or not getattr(user, 'is_authenticated', False):
        return set()
    if is_superuser(user):
        return None
    return operator_site_codes(user)


class LpnMasterViewSet(viewsets.ModelViewSet):
    queryset = LpnMaster.objects.all()
    serializer_class = LpnMasterSerializer
    # The pack screen asks for `?status__in=EMPTY,CREATED` and the rider
    # handoff asks for `?status__in=<a few task states>`. Declaring
    # `filterset_fields = ['status']` only ever builds an *exact* match, so
    # `status__in` was not a known parameter: django-filter dropped it and the
    # query came back with every row for the site. The packer was therefore
    # offered totes that were already sealed onto another order.
    filterset_fields = {
        'status': ['exact', 'in'],
        'lpn_type': ['exact', 'in'],
        'current_site': ['exact'],
    }
    search_fields = ['barcode', 'lpn_id']

class LpnContentViewSet(viewsets.ModelViewSet):
    queryset = LpnContent.objects.select_related('lpn', 'sku', 'lot').all()
    serializer_class = LpnContentSerializer
    # Packing loads and increments one tote's manifest. This viewset had no
    # filterset at all, so `?lpn=` was silently dropped and the caller read
    # every LpnContent row in the database (84+ rows, unordered) as if it were
    # the contents of the tote in front of them.
    filterset_fields = ['lpn', 'sku', 'lot']

class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockMovement.objects.select_related('sku', 'lot', 'site').all()
    serializer_class = StockMovementSerializer
    filterset_fields = ['movement_type', 'site', 'from_container', 'to_container', 'actor_type']

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)

class StockBalanceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockBalance.objects.select_related('site', 'sku', 'lot').all()
    serializer_class = StockBalanceSerializer
    filterset_fields = ['site', 'container', 'sku', 'sellable']

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)

class StockMovementsChainViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StockMovementsChain.objects.select_related('site').all()
    serializer_class = StockMovementsChainSerializer

    def get_queryset(self):
        codes = _ledger_scope(self.request.user)
        if codes is None:
            return self.queryset
        return self.queryset.filter(site__code__in=codes)
