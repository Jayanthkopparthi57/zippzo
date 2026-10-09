# Outbox Views
from rest_framework import viewsets
from .models import OutboxEvent
from .serializers import OutboxEventSerializer

class OutboxEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OutboxEvent.objects.all()
    serializer_class = OutboxEventSerializer
    filterset_fields = ['aggregate_type', 'event_type', 'status']
