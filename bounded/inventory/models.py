# Inventory  LPN Master, Stock Movements, Stock Balances, Hash Chain
import uuid
from django.db import models


class LpnMaster(models.Model):
    TYPE_CHOICES = [('TOTE','Tote'),('CARTON','Carton'),('PALLET','Pallet'),('BAG','Bag'),('RIDER_BIN','Rider Bin'),('RETURN_TOTE','Return Tote')]
    STATUS_CHOICES = [('CREATED','Created'),('IN_USE','In Use'),('EMPTY','Empty'),('PACKED','Packed'),
                       ('SEALED','Sealed'),('STAGED','Staged'),('IN_TRANSIT','In Transit'),('RECEIVED','Received'),
                       ('CONSUMED','Consumed'),('RETIRED','Retired')]
    lpn_id = models.CharField(max_length=50, primary_key=True)
    barcode = models.CharField(max_length=100, unique=True)
    lpn_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='TOTE')
    current_site = models.ForeignKey('network.Site', null=True, on_delete=models.SET_NULL, related_name='lpns')
    source_site = models.ForeignKey('network.Site', null=True, blank=True, on_delete=models.SET_NULL, related_name='lpn_source')
    dest_site = models.ForeignKey('network.Site', null=True, blank=True, on_delete=models.SET_NULL, related_name='lpn_dest')
    transfer = models.ForeignKey('ds_ops.TransferOrder', null=True, blank=True, on_delete=models.SET_NULL, related_name='lpns')
    current_container = models.CharField(max_length=30, null=True, blank=True)
    current_ref_id = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='CREATED')
    is_insulated = models.BooleanField(default=False)
    temp_rating = models.CharField(max_length=20, null=True, blank=True)
    capacity_weight_g = models.BigIntegerField(null=True, blank=True)
    capacity_volume_ml = models.BigIntegerField(null=True, blank=True)
    created_by = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sealed_at = models.DateTimeField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'lpn_master'
        ordering = ['-created_at']

    def __str__(self):
        return self.barcode


class LpnContent(models.Model):
    lpn = models.ForeignKey(LpnMaster, on_delete=models.CASCADE, related_name='contents')
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='lpn_contents')
    lot = models.ForeignKey('catalog.InventoryLot', on_delete=models.CASCADE, related_name='lpn_lots')
    qty = models.PositiveIntegerField()
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'lpn_contents'
        unique_together = [('lpn', 'sku', 'lot')]


class StockMovement(models.Model):
    entry_id = models.BigAutoField(primary_key=True)
    movement_ref = models.CharField(max_length=30)
    ref_id = models.CharField(max_length=50)
    movement_type = models.CharField(max_length=30)
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='movements')
    lot = models.ForeignKey('catalog.InventoryLot', on_delete=models.CASCADE, related_name='movements')
    qty = models.PositiveIntegerField()
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='movements')
    from_container = models.CharField(max_length=30)
    from_ref_id = models.CharField(max_length=50, null=True, blank=True)
    to_container = models.CharField(max_length=30)
    to_ref_id = models.CharField(max_length=50, null=True, blank=True)
    owner_type = models.CharField(max_length=10, default='ZIPZOO')
    owner_id = models.CharField(max_length=50, null=True, blank=True)
    actor_id = models.CharField(max_length=64, null=True, blank=True)
    actor_type = models.CharField(max_length=20, default='SYSTEM')
    device_id = models.CharField(max_length=50, null=True, blank=True)
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)
    sellable_delta = models.SmallIntegerField(default=0)
    site_custody_delta = models.SmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    site_seq = models.BigIntegerField(default=0)
    prev_hash = models.BinaryField(null=True, blank=True)
    row_hash = models.BinaryField(null=True, blank=True)

    class Meta:
        db_table = 'stock_movements'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['sku', 'lot']),
            models.Index(fields=['site', 'created_at']),
            models.Index(fields=['movement_ref', 'ref_id']),
            models.Index(fields=['to_container', 'to_ref_id']),
        ]


class StockMovementsChain(models.Model):
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='chain')
    head_seq = models.BigIntegerField(default=0)
    head_hash = models.BinaryField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stock_movements_chain'


class StockBalance(models.Model):
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='balances')
    container = models.CharField(max_length=30)
    container_ref = models.CharField(max_length=50, default='')
    container_ref_type = models.CharField(max_length=20, default='NONE')
    sku = models.ForeignKey('catalog.Sku', on_delete=models.CASCADE, related_name='balances')
    lot = models.ForeignKey('catalog.InventoryLot', on_delete=models.CASCADE, related_name='balances')
    owner_type = models.CharField(max_length=10, default='ZIPZOO')
    owner_id = models.CharField(max_length=50, default='')
    qty = models.PositiveIntegerField(default=0)
    sellable = models.BooleanField(default=False)
    counts_toward_site_custody = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stock_balances'
        ordering = ['site', 'container', 'container_ref', 'sku', '-qty']
        unique_together = [('site', 'container', 'container_ref', 'sku', 'lot', 'owner_type', 'owner_id')]
        indexes = [
            models.Index(fields=['site', 'sku', 'container'], name='ix_atp', condition=models.Q(sellable=True, qty__gt=0)),
        ]
