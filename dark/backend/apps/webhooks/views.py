from rest_framework import serializers, viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import OutgoingWebhook
from .tasks import trigger_outgoing_webhook_async

class OutgoingWebhookSerializer(serializers.ModelSerializer):
    class Meta:
        model = OutgoingWebhook
        fields = '__all__'
        read_only_fields = ['webhook_id', 'retry_count', 'last_triggered_at', 'last_response_code', 'last_error_message', 'created_at']

class OutgoingWebhookViewSet(viewsets.ModelViewSet):
    queryset = OutgoingWebhook.objects.all()
    serializer_class = OutgoingWebhookSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['event_type', 'is_active']

    @action(detail=True, methods=['post'], url_path='test-ping')
    def test_ping(self, request, pk=None):
        hook = self.get_object()
        sample_payload = {
            'ping': 'test_event',
            'message': 'Zippzo ERP outgoing webhook connection verification test.',
            'event_type': hook.event_type
        }
        try:
            trigger_outgoing_webhook_async.delay(hook.event_type, sample_payload)
            return Response({'message': f'Test webhook triggered for {hook.event_type}'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
