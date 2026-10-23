# DS Operations  Pick Tasks, Pack Tasks, Sorting, Staged Aging
import uuid
from django.db import models


class PickTask(models.Model):
    STATUS_CHOICES = [('NOT_STARTED','Not Started'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed'),('CANCELLED','Cancelled')]
    TYPE_CHOICES = [('LPN','LPN'),('PIECE','Piece'),('CLUSTER','Cluster')]
    picklist_id = models.UUIDField()
    batch = models.UUIDField()
    # Without this a pick task cannot be attributed to the customer order it is
    # working on, so no "your order is being picked" notification can be raised
    # and a picker has no per-order queue. Nullable with SET_NULL on purpose:
    # pre-existing rows are seed data with no recoverable order, and deleting a
    # customer order must not delete the physical work record.
    order = models.ForeignKey(
        'orders.CustomerOrder', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='pick_tasks',
    )
    zone = models.CharField(max_length=50, null=True, blank=True)
    sku = models.UUIDField()
    lot = models.UUIDField(null=True, blank=True)
    bin = models.CharField(max_length=50, null=True, blank=True)
    qty = models.PositiveIntegerField()
    picked_qty = models.PositiveIntegerField(default=0)
    short_qty = models.PositiveIntegerField(default=0)
    pick_seq = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    assigned_to = models.UUIDField(null=True, blank=True)
    started_by = models.UUIDField(null=True, blank=True)
    completed_by = models.UUIDField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pick_tasks'
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['order', 'status'], name='ix_picktask_order_status')]


class OrderLineAllocation(models.Model):
    """Which bin(s) an order line is drawn from, and how much comes off each.

    Without this the pick screen has to guess where a lot lives. It used to ask
    StockBalance for the bin holding the most units, which means the answer
    moves as stock drains: a picker part-way through a line gets re-targeted at
    a different shelf, and a drop-out can no longer tell which bin to credit
    because the first bin now reads zero.

    An allocation fixes the decision up front, one row per bin, and the picker
    works down them in `seq` order. That is also what makes a lot split across
    three bins pickable at all - the scan can only be accepted against a bin
    that has an allocation with units still owing.

    `location_id` is a Location.location_id, matching StockBalance.container_ref
    for container='BIN', and it is pinned to `site` so a bin can never be moved
    between stores by a bad request.
    """
    STATUS_CHOICES = [
        ('ALLOCATED', 'Allocated'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('RELEASED', 'Released'),
        ('SHORT', 'Short'),
    ]
    allocation_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.CustomerOrder', on_delete=models.CASCADE, related_name='allocations')
    line = models.ForeignKey(
        'orders.CustomerOrderLine', on_delete=models.CASCADE, related_name='allocations',
    )
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='order_allocations')
    location_id = models.CharField(max_length=50)
    # Denormalised from Location so the pick list can render a shelf label
    # without a join, and so the original label survives a bin being renamed.
    bin_label = models.CharField(max_length=60, null=True, blank=True)
    seq = models.PositiveSmallIntegerField(default=1)
    qty = models.PositiveIntegerField(default=0)
    picked_qty = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ALLOCATED')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'order_line_allocations'
        # One line's allocations in pick order; cross-line ordering is done in
        # the query because line_no lives on CustomerOrderLine, not here.
        ordering = ['line_id', 'seq']
        constraints = [
            models.UniqueConstraint(
                fields=['line', 'location_id'], name='uq_alloc_line_location',
            ),
        ]
        indexes = [
            models.Index(fields=['order', 'status'], name='ix_alloc_order_status'),
            models.Index(fields=['line', 'seq'], name='ix_alloc_line_seq'),
        ]

    @property
    def outstanding(self):
        return max(0, self.qty - self.picked_qty)

    def __str__(self):
        return f'{self.line_id} <- {self.location_id} ({self.picked_qty}/{self.qty})'


class PackTask(models.Model):
    STATUS_CHOICES = [('NOT_STARTED','Not Started'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed'),('CANCELLED','Cancelled')]
    packlist_id = models.UUIDField()
    lpn = models.CharField(max_length=50, null=True, blank=True)
    # Same reasoning as PickTask.order: the pack task has to name the customer
    # order so "order packed, collect from <staging_bin>" can be raised.
    order = models.ForeignKey(
        'orders.CustomerOrder', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='pack_tasks',
    )
    sku = models.UUIDField()
    qty = models.PositiveIntegerField()
    packed_qty = models.PositiveIntegerField(default=0)
    # Where the packed tote physically waits for the rider. This is the value
    # the rider notification has to carry. CharField, not a Location FK, to
    # match PackTask.lpn and PickTask.bin: a staging slot is a label, and the
    # dark store does not necessarily have a Location row per shelf slot.
    staging_bin = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    assigned_to = models.UUIDField(null=True, blank=True)
    completed_by = models.UUIDField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pack_tasks'
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['order', 'status'], name='ix_packtask_order_status')]


class SortingWave(models.Model):
    STATUS_CHOICES = [('CREATED','Created'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed'),('CANCELLED','Cancelled')]
    wave_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.UUIDField()
    cluster_zone = models.CharField(max_length=50, null=True, blank=True)
    type = models.CharField(max_length=20, default='CLUSTER')
    assigned_qty = models.PositiveIntegerField(default=0)
    sorted_qty = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='CREATED')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sorting_waves'
        ordering = ['-created_at', 'wave_id']


class StagedAging(models.Model):
    STAGE_CHOICES = [('STAGED','Staged'),('OVER_20_MIN','Over 20min'),('OVER_60_MIN','Over 60min')]
    aging_id = models.BigAutoField(primary_key=True)
    order_id = models.UUIDField()
    site = models.CharField(max_length=50)
    staged_at = models.DateTimeField()
    current_stage = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'staged_aging'
        ordering = ['-created_at']


class TransferOrder(models.Model):
    STATUS_CHOICES = [('DRAFT','Draft'),('APPROVED','Approved'),('ALLOCATED','Allocated'),('PICKING','Picking'),
                       ('PICKED','Picked'),('SORTED','Sorted'),('PACKING','Packing'),('PACKED','Packed'),
                       ('LOADED','Loaded'),('IN_TRANSIT','In Transit'),('RECEIVED','Received'),('CLOSED','Closed'),('CANCELLED','Cancelled')]
    transfer_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='transfer_source')
    dest_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='transfer_dest')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='DRAFT')
    total_qty = models.PositiveIntegerField(default=0)
    # Who raised the transfer and who put it on the road — both server-side.
    created_by = models.UUIDField(null=True, blank=True)
    dispatched_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'transfer_orders'
        ordering = ['-created_at']


class BinTransfer(models.Model):
    STATUS_CHOICES = [('CREATED','Created'),('APPROVED','Approved'),('IN_PROGRESS','In Progress'),('COMPLETED','Completed'),('CANCELLED','Cancelled')]
    transfer_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_bin = models.CharField(max_length=50)
    dest_bin = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='CREATED')
    # Who requested the bin move and who executed it.
    created_by = models.UUIDField(null=True, blank=True)
    completed_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'bin_transfers'
        ordering = ['-created_at', 'transfer_id']
