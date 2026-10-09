import uuid
from django.db import models

class Batch(models.Model):
    STATUS_CHOICES = [('UPLOADED','Uploaded'),('ALLOCATING','Allocating'),('ALLOCATED','Allocated'),('IN_PROGRESS','In Progress'),('CLOSED','Closed'),('CANCELLED','Cancelled')]
    batch_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_no = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='batches')
    type = models.CharField(max_length=10, choices=[('MANUAL','Manual'),('AUTO','Auto')], default='MANUAL')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='UPLOADED')
    order_type = models.CharField(max_length=30, blank=True)
    processing_type = models.CharField(max_length=20, default='LPN_BASED')
    picking_type = models.CharField(max_length=30, blank=True)
    cluster_zone = models.CharField(max_length=50, null=True, blank=True)
    sorting_eligible = models.BooleanField(default=True)
    dispatch_plan = models.UUIDField(null=True, blank=True)
    destinations = models.TextField(blank=True)
    totes = models.PositiveIntegerField(default=0)
    ordered_qty = models.PositiveIntegerField(default=0)
    ordered_skus = models.PositiveIntegerField(default=0)
    picked_qty = models.PositiveIntegerField(default=0)
    sorted_qty = models.PositiveIntegerField(default=0)
    short_qty = models.PositiveIntegerField(default=0)
    cutoff = models.DateTimeField(null=True, blank=True)
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'batches'
        ordering = ['-created_at']
    def __str__(self):
        return self.batch_no

class OrderAllocation(models.Model):
    STATUS_CHOICES = [('PENDING','Pending'),('ALLOCATED','Allocated'),('PICKED','Picked'),('SHORT','Short'),('CANCELLED','Cancelled')]
    alloc_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_line = models.UUIDField()
    lot = models.UUIDField(null=True, blank=True)
    bin = models.CharField(max_length=50, null=True, blank=True)
    lpn = models.CharField(max_length=50, null=True, blank=True)
    qty = models.PositiveIntegerField(default=0)
    batch = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'order_allocations'
