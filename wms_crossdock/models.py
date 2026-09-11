import uuid
from django.db import models
from wms_master.models import Site, Sku
from wms_platform.models import User
from wms_inbound.models import Asn
from wms_outbound.models import Order


class CrossDockBatch(models.Model):
    STATUS_CHOICES = [
        ('UPLOADED', 'Uploaded'), ('INWARDING', 'Inwarding'),
        ('SORTING', 'Sorting'), ('COMPLETED', 'Completed'),
    ]

    xdb_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch_no = models.CharField(max_length=50, unique=True)
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='xdock_batches')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='UPLOADED')
    processing_type = models.CharField(max_length=20, default='LPN_BASED')
    orders_count = models.IntegerField(default=0)
    ordered_qty = models.IntegerField(default=0)
    ordered_skus = models.IntegerField(default=0)
    inwarded_qty = models.IntegerField(default=0)
    inwarded_short = models.IntegerField(default=0)
    sorted_qty = models.IntegerField(default=0)
    sorted_short = models.IntegerField(default=0)
    cancelled_skus = models.IntegerField(default=0)
    xdock_allocable_qty = models.IntegerField(default=0)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='xdock_batches')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cross_dock_batch'
        ordering = ['-created_at']

    def __str__(self):
        return self.batch_no


class CrossDockLine(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'), ('ALLOCATED', 'Allocated'),
        ('SORTED', 'Sorted'), ('SHIPPED', 'Shipped'),
    ]

    line_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    xdb = models.ForeignKey(CrossDockBatch, on_delete=models.CASCADE, related_name='lines')
    asn = models.ForeignKey(Asn, null=True, blank=True, on_delete=models.SET_NULL, related_name='xdock_lines')
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name='xdock_lines')
    sku = models.ForeignKey(Sku, on_delete=models.CASCADE, related_name='xdock_lines')
    qty = models.IntegerField(default=0)
    xdock_bin = models.CharField(max_length=100, blank=True)
    allocatable_qty = models.IntegerField(default=0)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='PENDING')

    class Meta:
        db_table = 'cross_dock_line'

    def __str__(self):
        return f"{self.xdb.batch_no} - {self.sku.sku_code}"
