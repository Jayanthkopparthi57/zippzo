# Outbox Serializers
from rest_framework import serializers
from .models import OutboxEvent

class OutboxEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = OutboxEvent
        fields = ['event_id','aggregate_type','aggregate_id','event_type','payload_json','status','attempts','created_at','published_at']
        read_only_fields = ['event_id','created_at']
