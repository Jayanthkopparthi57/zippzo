"""Packer confirms the staged bag has been dropped in a collection bin.

The rider cannot collect before this step: the bin code is what they scan at
the counter. A repeat call is idempotent so a lost response cannot create a
second handoff.
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bounded.iam.permissions import IsFieldSurface
from .access import require_order_access


class DSBinDropView(APIView):
    permission_classes = [IsAuthenticated, IsFieldSurface]

    def post(self, request):
        from django.utils import timezone
        from bounded.delivery.models import DeliveryTask
        from bounded.orders.models import CustomerOrder

        order_id = request.data.get('order_id')
        task_id = request.data.get('task_id')
        task_qs = DeliveryTask.objects.select_related('order', 'site').all()
        if task_id:
            task = task_qs.filter(task_id=task_id).first()
        elif order_id:
            task = task_qs.filter(order_id=order_id).order_by('-created_at').first()
        else:
            return Response({'error': 'order_id or task_id is required'}, status=400)
        if task is None:
            return Response({'error': 'Delivery task not found'}, status=404)
        try:
            require_order_access(request.user, task.order)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=403)

        bin_code = str(
            request.data.get('bin_code')
            or request.data.get('bin')
            or task.staging_bin
            or ''
        ).strip()[:50]
        if not bin_code:
            return Response({'error': 'bin_code is required'}, status=400)

        now = timezone.now()
        task.bin_code = bin_code
        task.bin_dropped_at = task.bin_dropped_at or now
        actor_id = str(getattr(request.user, 'user_id', '') or '')
        task.bin_dropped_by = task.bin_dropped_by or actor_id
        task.save(update_fields=['bin_code', 'bin_dropped_at', 'bin_dropped_by'])
        return Response({
            'success': True,
            'task_id': str(task.task_id),
            'order_no': task.order.order_no,
            'bin_code': bin_code,
            'bin_dropped_at': task.bin_dropped_at.isoformat(),
        })
