# Catalog Serializers
from django.db import transaction
from rest_framework import serializers
from .models import (
    SkuCategory, Sku, SkuBarcode, Listing, InventoryLot, Coupon,
    ComboOffer, ComboOfferItem, ProductReview, WishlistItem, StoreProductProfile,
)

class SkuCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuCategory
        fields = ['category_id', 'name', 'parent', 'description']
        read_only_fields = ['category_id']

class SkuSerializer(serializers.ModelSerializer):
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = Sku
        fields = ['sku_id','sku_code','name','ean','category','category_name','sub_category','brand','pack_size',
                  'base_uom','storage_zone','shelf_life_days','is_food','is_hazardous','is_catch_weight',
                  'is_serialized','is_age_restricted','min_age_years','mrp','hsn_code','weight_g','image_url',
                  'description','ingredients','allergens','storage_notes','nutrition_facts',
                  'status','created_at']
        read_only_fields = ['sku_id','created_at']
        # The server mints the SKU code when the caller leaves it blank, so it
        # is not required from the registration forms any more.
        extra_kwargs = {'sku_code': {'required': False, 'allow_blank': True}}

    def get_category_name(self, obj):
        """The list screen shows the taxonomy name, not the category UUID."""
        return obj.category.name if obj.category_id else None

    def validate_ean(self, value):
        # The model's ean is unique=True. Empty strings are not equal for the
        # purposes of unique indexes in SQL (NULLs are), so normalise blank
        # input to None rather than crashing the second product saved this way.
        s = str(value or '').strip()
        return s or None

class SkuBarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SkuBarcode
        fields = ['barcode','symbology','sku','pack_level','qty_in_base','is_primary','is_active']
        read_only_fields = []

class ListingSerializer(serializers.ModelSerializer):
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)

    class Meta:
        model = Listing
        fields = ['listing_id','sku','sku_code','sku_name','site','site_code','price','mrp','discount_pct',
                  'is_listed','is_available','low_stock_threshold','updated_at']
        read_only_fields = ['listing_id']

    def validate(self, attrs):
        price = attrs.get('price', getattr(self.instance, 'price', None))
        mrp = attrs.get('mrp', getattr(self.instance, 'mrp', None))
        if price is not None and price <= 0:
            raise serializers.ValidationError({'price': 'Selling price must be greater than zero.'})
        if mrp is not None and price is not None and mrp < price:
            raise serializers.ValidationError({'mrp': 'MRP cannot be lower than the selling price.'})
        if price is not None and mrp is not None:
            from decimal import Decimal
            attrs['discount_pct'] = (
                (Decimal('1') - price / mrp) * Decimal('100')
            ).quantize(Decimal('0.01')) if mrp else Decimal('0.00')
        return attrs

class StoreProductProfileSerializer(serializers.ModelSerializer):
    sku_code = serializers.CharField(source='sku.sku_code', read_only=True)
    sku_name = serializers.CharField(source='sku.name', read_only=True)
    site_code = serializers.CharField(source='site.code', read_only=True)
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = StoreProductProfile
        fields = ['profile_id','site','site_code','sku','sku_code','sku_name','images','category','category_name','sub_category','display_name','display_brand','is_featured','sort_order','created_at','updated_at']
        read_only_fields = ['profile_id','created_at','updated_at']

    def validate_images(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Images must be a list.')
        clean = [str(item or '').strip() for item in value if str(item or '').strip()]
        if len(clean) > 3:
            raise serializers.ValidationError('A product can have at most 3 images.')
        return clean[:3]

    def get_category_name(self, obj):
        return obj.category.name if obj.category_id else None

class InventoryLotSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryLot
        fields = ['lot_id','sku','site','batch_number','mfg_date','expiry_date','mrp','box_size',
                  'inbound_type','inbound_ref','source_site','source_vendor_id','bucket','status','created_at']
        read_only_fields = ['lot_id','created_at']

class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = ['coupon_id','code','title','description','discount_type','discount_value',
                  'min_order','max_discount','valid_from','valid_until','site','is_active']
        read_only_fields = ['coupon_id','created_at']

    def validate(self, attrs):
        valid_from = attrs.get('valid_from', getattr(self.instance, 'valid_from', None))
        valid_until = attrs.get('valid_until', getattr(self.instance, 'valid_until', None))
        if valid_from and valid_until and valid_until <= valid_from:
            raise serializers.ValidationError({'valid_until': 'End time must be after start time.'})
        value = attrs.get('discount_value', getattr(self.instance, 'discount_value', None))
        discount_type = attrs.get('discount_type', getattr(self.instance, 'discount_type', None))
        min_order = attrs.get('min_order', getattr(self.instance, 'min_order', 0))
        max_discount = attrs.get('max_discount', getattr(self.instance, 'max_discount', None))
        if value is not None and value <= 0:
            raise serializers.ValidationError({'discount_value': 'Discount must be greater than zero.'})
        if discount_type == 'PERCENT' and value is not None and value > 100:
            raise serializers.ValidationError({'discount_value': 'Percentage cannot exceed 100.'})
        if min_order < 0:
            raise serializers.ValidationError({'min_order': 'Minimum basket cannot be negative.'})
        if max_discount is not None and max_discount <= 0:
            raise serializers.ValidationError({'max_discount': 'Maximum discount must be greater than zero.'})
        attrs['code'] = attrs.get('code', getattr(self.instance, 'code', '')).strip().upper()
        return attrs


class ComboOfferItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComboOfferItem
        fields = ['sku', 'quantity']

    def validate_quantity(self, value):
        if value < 1:
            raise serializers.ValidationError('Each combo item must have a quantity of at least one.')
        return value


class ComboOfferSerializer(serializers.ModelSerializer):
    items = ComboOfferItemSerializer(many=True)

    class Meta:
        model = ComboOffer
        fields = [
            'offer_id', 'site', 'title', 'description', 'fixed_price',
            'valid_from', 'valid_until', 'is_active', 'created_at', 'items',
        ]
        read_only_fields = ['offer_id', 'created_at']

    def validate(self, attrs):
        valid_from = attrs.get('valid_from', getattr(self.instance, 'valid_from', None))
        valid_until = attrs.get('valid_until', getattr(self.instance, 'valid_until', None))
        if valid_from and valid_until and valid_until <= valid_from:
            raise serializers.ValidationError({'valid_until': 'End time must be after start time.'})
        fixed_price = attrs.get('fixed_price', getattr(self.instance, 'fixed_price', 0))
        if fixed_price <= 0:
            raise serializers.ValidationError({'fixed_price': 'Combo price must be greater than zero.'})
        items = attrs.get('items')
        site = attrs.get('site', getattr(self.instance, 'site', None))
        if items is not None:
            if not items:
                raise serializers.ValidationError({'items': 'A combo needs at least one product.'})
            sku_ids = [item['sku'].sku_id for item in items]
            if len(sku_ids) != len(set(sku_ids)):
                raise serializers.ValidationError({'items': 'Each product may appear only once; increase its quantity instead.'})
            selected = [(item['sku'], item['quantity']) for item in items]
        elif self.instance is not None:
            selected = [(item.sku, item.quantity) for item in self.instance.items.select_related('sku')]
        else:
            selected = []
        validate_combo_prices = (
            self.instance is None or items is not None
            or 'site' in attrs or 'fixed_price' in attrs
        )
        if site is not None and selected and validate_combo_prices:
            from .models import Listing
            prices = {
                listing.sku_id: listing.price
                for listing in Listing.objects.filter(
                    site=site, sku_id__in=[sku.sku_id for sku, _ in selected],
                    price__gt=0, is_listed=True, is_available=True,
                )
            }
            if len(prices) != len(selected):
                raise serializers.ValidationError({
                    'items': 'Every combo product must have an active listing at this store.'
                })
            regular_price = sum(
                (prices[sku.sku_id] * quantity for sku, quantity in selected),
                start=0,
            )
            if fixed_price >= regular_price:
                raise serializers.ValidationError({
                    'fixed_price': "Combo price must be lower than the items' current combined price."
                })
        return attrs

    def _save_items(self, offer, items):
        if items is None:
            return
        from .models import Listing
        sku_ids = [item['sku'].sku_id for item in items]
        listed = set(Listing.objects.filter(
            site=offer.site, sku_id__in=sku_ids, price__gt=0,
            is_listed=True, is_available=True,
        ).values_list('sku_id', flat=True))
        if listed != set(sku_ids):
            raise serializers.ValidationError({
                'items': 'Every combo product must have an active listing at this store.'
            })
        offer.items.all().delete()
        ComboOfferItem.objects.bulk_create([
            ComboOfferItem(offer=offer, **item) for item in items
        ])

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop('items')
        offer = ComboOffer.objects.create(**validated_data)
        self._save_items(offer, items)
        return offer

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop('items', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        self._save_items(instance, items)
        return instance

class ProductReviewSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    class Meta:
        model = ProductReview
        fields = ['review_id','sku','customer','customer_name','rating','comment','created_at']
        read_only_fields = ['review_id','customer','created_at']
    def get_customer_name(self, obj):
        return obj.customer.name or 'Anonymous'

class WishlistItemSerializer(serializers.ModelSerializer):
    sku_detail = SkuSerializer(source='sku', read_only=True)
    class Meta:
        model = WishlistItem
        fields = ['wishlist_id','customer','sku','sku_detail','created_at']
        read_only_fields = ['wishlist_id','customer','created_at']
