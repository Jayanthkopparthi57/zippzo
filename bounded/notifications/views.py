# Notifications Views
from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer

# Pending outbox events converted into inbox rows on each read. Bounded so a
# long-idle queue cannot turn opening the bell into a long-running write.
DRAIN_LIMIT = 50


def _drain_outbox():
    """Turn pending outbox events into inbox rows.

    Without this the publisher only runs when somebody remembers to invoke the
    `publish_outbox` management command, and the inbox stays empty even though
    the events were committed. Draining on read is what makes the in-app channel
    self-sufficient - there is no worker in this deployment. `skip_locked` inside
    publish_batch keeps concurrent readers from blocking each other.
    """
    from .publish import publish_batch
    with transaction.atomic():
        publish_batch(DRAIN_LIMIT)


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """The signed-in user's in-app inbox.

    Strictly personal: `user` on Notification is a bare UUID, not a FK, so
    there is no relation through which DRF could scope this for free - an
    unscoped queryset here would hand every authenticated caller the whole
    table (and, on a ModelViewSet, the ability to delete it).
    """
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['type']
    # Declared only so the router can infer a basename; get_queryset() below
    # is what actually serves every request.
    queryset = Notification.objects.all()

    def get_queryset(self):
        user = getattr(self.request, 'user', None)
        if user is None or not getattr(user, 'is_authenticated', False):
            return Notification.objects.none()
        qs = Notification.objects.filter(user=user.user_id, channel='IN_APP')
        if self.request.query_params.get('unread') == 'true':
            qs = qs.filter(read_at__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        _drain_outbox()
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        _drain_outbox()
        return Response(
            {'unread': self.get_queryset().filter(read_at__isnull=True).count()})

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        # get_object() 404s through get_queryset(), so this only ever touches
        # rows the caller already owns - reading another user's id returns 404,
        # not 403, which would confirm the id exists.
        try:
            notification = self.get_object()
        except Http404:
            return Response({'error': 'Notification not found.'}, status=404)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=['read_at'])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        now = timezone.now()
        with transaction.atomic():
            updated = self.get_queryset().filter(read_at__isnull=True).update(
                read_at=now)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def clear_all(self, request):
        # Scoped delete: get_queryset() already filters to this user, so this
        # can never clear another shopper's inbox.
        with transaction.atomic():
            deleted, _ = self.get_queryset().delete()
        return Response({'deleted': deleted})
