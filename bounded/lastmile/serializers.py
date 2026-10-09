from rest_framework import serializers
from .models import PODEvidence

class PODEvidenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PODEvidence
        fields = ['pod_id','task','rider','signature','photo_url','method','otp_verified','delivered_at','created_at']
        read_only_fields = ['pod_id','created_at']
