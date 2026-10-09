# Notifications Serializers
from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    # Every field is derived server-side. This viewset is read-only, and
    # exposing `user` as writable would be a path to address a notification to
    # somebody else's inbox if the route ever gains a write method.
    class Meta:
        model = Notification
        fields = ['notification_id','user','type','channel','idempotency_key','payload_json','sent_at','delivered_at','failed_at','read_at','retry_count','created_at']
        read_only_fields = fields
