"""
Scan-first packing: seal a picked order into a tote the rider will collect.
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsFieldSurface
from .access import require_order_access, require_session_facility


class DSPackOrderView(APIView):
    """Seal a picked order into a tote and raise the rider job.

    This is the operation that earns the word PACKED. It refuses anything that is
    not fully picked, requires the tote the operator scanned and the staging slot
    the rider will collect from, and writes the delivery task and the outbox
    events in the same transaction as the stock move - so a rolled-back pack
    cannot leave a promise to notify a rider behind.
    """
    permission_classes = [IsAuthenticated, IsFieldSurface]

    def post(self, request):
        from bounded.orders.models import CustomerOrder
        from .pack import PackError, pack_order

        data = request.data
        order_id = data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=400)

        try:
            order = CustomerOrder.objects.select_related('site').get(order_id=order_id)
        except (CustomerOrder.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Order not found'}, status=404)

        require_order_access(request.user, order)
        require_session_facility(request.user, order.site.code)

        try:
            result = pack_order(
                order=order, actor=request.user,
                lpn_barcode=data.get('lpn_barcode'),
                lpn_id=data.get('lpn_id'),
                staging_bin=data.get('staging_bin'),
            )
        except PackError as e:
            return Response({'error': e.message, **e.detail}, status=e.status)

        return Response({'success': True, **result})