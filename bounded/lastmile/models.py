import uuid
from django.db import models

class PODEvidence(models.Model):
    pod_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey('delivery.DeliveryTask', on_delete=models.CASCADE, related_name='pod_evidence')
    rider = models.ForeignKey('delivery.RiderProfile', on_delete=models.CASCADE, related_name='pods')
    signature = models.CharField(max_length=500, blank=True)
    photo_url = models.CharField(max_length=500, blank=True)
    method = models.CharField(max_length=20, choices=[('PIN','PIN'),('SIGNATURE','Signature'),('PHOTO','Photo'),('BIOMETRIC','Biometric'),('NONE','None')], default='NONE')
    otp_verified = models.BooleanField(default=False)
    delivered_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'pod_evidence'
