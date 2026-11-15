# DS Ops Serializers
from rest_framework import serializers
from bounded.iam.names import display_name
from .models import PickTask, PackTask, SortingWave, StagedAging, TransferOrder, TransferOrderLine, BinTransfer, Droplist

# Every bare-UUID actor column this module renders gets a sibling `_name`
# field resolved from the per-response user_map in serializer context (see
# bounded.iam.names). The UUID itself stays in the payload for filtering.

class PickTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    site_code = serializers.SerializerMethodField()
    started_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PickTask
        fields = ['id','picklist_id','batch','order','zone','sku','lot','bin','qty','picked_qty','short_qty','pick_seq','status',
                  'assigned_to','assigned_to_name','site_code','started_by','started_by_name','completed_by','completed_by_name',
                  'started_at','completed_at','created_at']
        read_only_fields = ['id','started_by','completed_by','assigned_to_name','started_by_name',
                            'completed_by_name','created_at']

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_site_code(self, obj):
        return obj.order.site.code if obj.order_id and obj.order.site_id else ''

    def get_started_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.started_by)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)

class PackTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    site_code = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PackTask
        fields = ['id','packlist_id','lpn','order','sku','qty','packed_qty','staging_bin','status',
                  'assigned_to','assigned_to_name','site_code','completed_by','completed_by_name',
                  'started_at','completed_at','created_at']
        read_only_fields = ['id','completed_by','assigned_to_name','completed_by_name','created_at']

    def get_assigned_to_name(self, obj):
        return display_name(self.context.get('user_map'), obj.assigned_to)

    def get_site_code(self, obj):
        return obj.order.site.code if obj.order_id and obj.order.site_id else ''

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)

class SortingWaveSerializer(serializers.ModelSerializer):
    class Meta:
        model = SortingWave
        fields = ['wave_id','batch','cluster_zone','type','assigned_qty','sorted_qty','status','created_at']
        read_only_fields = ['wave_id','created_at']

class StagedAgingSerializer(serializers.ModelSerializer):
    class Meta:
        model = StagedAging
        fields = ['aging_id','order_id','site','staged_at','current_stage','created_at']
        read_only_fields = ['aging_id','created_at']

class TransferOrderSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    dispatched_by_name = serializers.SerializerMethodField()
    source_site_code = serializers.CharField(source='source_site.code', read_only=True)
    source_site_name = serializers.CharField(source='source_site.name', read_only=True)
    dest_site_code = serializers.CharField(source='dest_site.code', read_only=True)
    dest_site_name = serializers.CharField(source='dest_site.name', read_only=True)
    # Lifecycle totals. These are annotated onto the queryset in
    # TransferOrderViewSet (one SQL projection per list, not a query per row),
    # and summarise the pick lines and packed LPNs that belong to the transfer.
    # SerializerMethodField rather than IntegerField so a freshly created
    # instance (which has no annotations) reports 0 instead of raising.
    pick_lines = serializers.SerializerMethodField()
    sku_count = serializers.SerializerMethodField()
    ordered_units = serializers.SerializerMethodField()
    picked_units = serializers.SerializerMethodField()
    short_units = serializers.SerializerMethodField()
    shipped_units = serializers.SerializerMethodField()
    shipped_skus = serializers.SerializerMethodField()
    received_units = serializers.SerializerMethodField()
    received_skus = serializers.SerializerMethodField()
    # Category of the first SKU on the pick list; there is no section column on
    # a transfer order, and a blank beats a fabricated "GROCERY".
    section = serializers.SerializerMethodField()

    def _count(self, obj, name):
        return getattr(obj, name, 0) or 0

    def get_section(self, obj):
        return getattr(obj, 'section', None)

    def get_pick_lines(self, obj):
        return self._count(obj, 'pick_lines')

    def get_sku_count(self, obj):
        return self._count(obj, 'sku_count')

    def get_ordered_units(self, obj):
        # What was ordered at creation; pick lines mirror it once allocated.
        return obj.total_qty or self._count(obj, 'ordered_units')

    def get_picked_units(self, obj):
        return self._count(obj, 'picked_units')

    def get_short_units(self, obj):
        return self._count(obj, 'short_units')

    def get_shipped_units(self, obj):
        # Packed contents only count as shipped once the transfer has actually
        # left the source. Deriving this from the transfer status (rather than
        # the LPN's current status) keeps the number stable after the
        # destination shelves the stock and the tote goes back to EMPTY.
        if obj.status not in ('IN_TRANSIT', 'RECEIVED', 'CLOSED'):
            return 0
        return self._count(obj, 'lpn_units')

    def get_shipped_skus(self, obj):
        if obj.status not in ('IN_TRANSIT', 'RECEIVED', 'CLOSED'):
            return 0
        return self._count(obj, 'lpn_sku_count')

    def get_received_units(self, obj):
        if obj.status not in ('RECEIVED', 'CLOSED'):
            return 0
        return self._count(obj, 'lpn_units')

    def get_received_skus(self, obj):
        if obj.status not in ('RECEIVED', 'CLOSED'):
            return 0
        return self._count(obj, 'lpn_sku_count')

    class Meta:
        model = TransferOrder
        fields = ['transfer_id','source_site','source_site_code','source_site_name',
                  'dest_site','dest_site_code','dest_site_name','status','total_qty',
                  'section','pick_lines','sku_count','ordered_units','picked_units',
                  'short_units','shipped_units','shipped_skus','received_units',
                  'received_skus',
                  'created_by','created_by_name','dispatched_by','dispatched_by_name','created_at']
        read_only_fields = ['transfer_id','created_by','dispatched_by','created_by_name',
                            'dispatched_by_name','created_at','source_site_code',
                            'source_site_name','dest_site_code','dest_site_name',
                            'section','pick_lines','sku_count','ordered_units',
                            'picked_units','short_units','shipped_units','shipped_skus',
                            'received_units','received_skus']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_dispatched_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.dispatched_by)


class TransferOrderLineSerializer(serializers.ModelSerializer):
    transfer_code = serializers.CharField(source='transfer.transfer_id', read_only=True)
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    lot_number = serializers.CharField(source='lot.batch_number', read_only=True)

    class Meta:
        model = TransferOrderLine
        fields = [
            'line_id','transfer','transfer_code','line_no','sku','sku_code','sku_name',
            'lot','lot_number','ordered_qty','picked_qty','shipped_qty','received_qty',
            'status','created_at','updated_at',
        ]
        read_only_fields = ['line_id','transfer_code','sku_code','sku_name','lot_number','created_at','updated_at']

    def validate(self, attrs):
        for field in ('picked_qty', 'shipped_qty', 'received_qty'):
            value = attrs.get(field, getattr(self.instance, field, 0) or 0)
            ordered = attrs.get('ordered_qty', getattr(self.instance, 'ordered_qty', 0) or 0)
            if int(value) > int(ordered):
                raise serializers.ValidationError({field: f'{field} cannot exceed ordered quantity.'})
        return attrs

class BinTransferSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BinTransfer
        fields = ['transfer_id','source_bin','dest_bin','scanned_items','status',
                  'created_by','created_by_name','completed_by','completed_by_name','created_at']
        read_only_fields = ['transfer_id','created_by','completed_by','created_by_name',
                            'completed_by_name','created_at']

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)


class DroplistSerializer(serializers.ModelSerializer):
    site_code = serializers.CharField(source='site.code', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Droplist
        fields = [
            'droplist_id','code','site','site_code','source_bin','dest_bin',
            'tote_count','dropped_count','status','notes','created_by','created_by_name',
            'completed_by','completed_by_name','created_at','updated_at',
        ]
        read_only_fields = [
            'droplist_id','site_code','created_by','created_by_name',
            'completed_by','completed_by_name','created_at','updated_at',
        ]

    def validate(self, attrs):
        source_bin = attrs.get('source_bin', getattr(self.instance, 'source_bin', None))
        dest_bin = attrs.get('dest_bin', getattr(self.instance, 'dest_bin', None))
        if source_bin and dest_bin and source_bin == dest_bin:
            raise serializers.ValidationError({'dest_bin': 'Source and destination bins must differ.'})
        tote_count = attrs.get('tote_count', getattr(self.instance, 'tote_count', 0) or 0)
        dropped_count = attrs.get('dropped_count', getattr(self.instance, 'dropped_count', 0) or 0)
        if dropped_count > tote_count:
            raise serializers.ValidationError({'dropped_count': 'Dropped count cannot exceed tote count.'})
        return attrs

    def get_created_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.created_by)

    def get_completed_by_name(self, obj):
        return display_name(self.context.get('user_map'), obj.completed_by)
