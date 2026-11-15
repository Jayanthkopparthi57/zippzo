# Catalog Views
import re
import uuid

from rest_framework import viewsets, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from bounded.iam.permissions import IsAdminUserOrReadOnly
from .models import (
    SkuCategory, Sku, SkuBarcode, Listing, InventoryLot, Coupon,
    ComboOffer, ProductReview, WishlistItem, StoreProductProfile,
)
from .serializers import (SkuCategorySerializer, SkuSerializer, SkuBarcodeSerializer,
                          ListingSerializer, InventoryLotSerializer, CouponSerializer,
                          ComboOfferSerializer, ProductReviewSerializer, WishlistItemSerializer,
                          StoreProductProfileSerializer)

# Images are stored on the same origin as the API. Extensions come from the
# upload's declared content type and SVG is deliberately absent: an SVG can
# carry script and would be served from our own origin.
IMAGE_CONTENT_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
}
MAX_IMAGE_BYTES = 2 * 1024 * 1024


def _site_query(identifier):
    try:
        uuid.UUID(str(identifier))
    except (TypeError, ValueError, AttributeError):
        return Q(site__code=identifier)
    return Q(site_id=identifier)


def _category_prefix(name):
    """Derive a short, readable prefix from a category name for SKU codes."""
    words = re.findall(r'[A-Za-z0-9]+', str(name or ''))
    initials = ''.join(word[0] for word in words[:3]).upper()
    return initials or 'SKU'


def _next_sku_seq(prefix):
    latest = Sku.objects.filter(sku_code__startswith=prefix + '-').values_list('sku_code', flat=True)
    best = 0
    pattern = re.compile(r'^' + re.escape(prefix) + r'-(\d+)$')
    for code in latest:
        match = pattern.match(code)
        if match:
            try:
                best = max(best, int(match.group(1)))
            except (TypeError, ValueError):
                continue
    return best + 1


def _filter_site(queryset, identifier):
    return queryset.filter(_site_query(identifier))


class SkuCategoryViewSet(viewsets.ModelViewSet):
    queryset = SkuCategory.objects.all()
    serializer_class = SkuCategorySerializer
    permission_classes = [IsAdminUserOrReadOnly]

class SkuViewSet(viewsets.ModelViewSet):
    queryset = Sku.objects.select_related('category').all()
    serializer_class = SkuSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['storage_zone', 'status', 'is_food']
    search_fields = ['sku_code', 'name', 'ean']

    def perform_create(self, serializer):
        code = (serializer.validated_data.get('sku_code') or '').strip()
        if code:
            serializer.save()
            return
        # The registration forms leave the SKU code blank on purpose: mint
        # one from the category initials plus the next sequence for it.
        category = serializer.validated_data.get('category')
        prefix = _category_prefix(getattr(category, 'name', None))
        base = _next_sku_seq(prefix)
        for offset in range(20):
            candidate = f'{prefix}-{base + offset:04d}'
            if not Sku.objects.filter(sku_code=candidate).exists():
                serializer.validated_data['sku_code'] = candidate
                serializer.save()
                return
        raise serializers.ValidationError({'sku_code': 'Could not allocate a SKU code.'})

    @action(detail=False, methods=['post'], url_path='image-upload',
            parser_classes=[MultiPartParser, FormParser])
    def image_upload(self, request):
        """Accept a product photo and return the URL to store on the SKU.

        Keeping the file upload separate from the SKU payload lets the client
        upload first, show a preview, and then create or patch the record with
        the resulting `image_url`. The permission class makes this admin-only
        because it is a write.
        """
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'detail': 'No file uploaded (expected field "file").'},
                            status=status.HTTP_400_BAD_REQUEST)
        ext = IMAGE_CONTENT_TYPES.get((upload.content_type or '').lower())
        if ext is None:
            return Response({'detail': 'Only PNG, JPEG or WebP images are accepted.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_IMAGE_BYTES:
            return Response({'detail': 'Image must be 2 MB or smaller.'},
                            status=status.HTTP_400_BAD_REQUEST)
        saved_name = default_storage.save(f'sku_images/{uuid.uuid4().hex}.{ext}', upload)
        return Response({'image_url': f'{settings.MEDIA_URL}{saved_name}'},
                        status=status.HTTP_201_CREATED)

class SkuBarcodeViewSet(viewsets.ModelViewSet):
    queryset = SkuBarcode.objects.all()
    serializer_class = SkuBarcodeSerializer
    # The mobile app resolves scanned barcodes with ?search=barcode — without
    # search_fields the param is ignored and every barcode comes back.
    search_fields = ['barcode', 'sku__sku_code', 'sku__ean']
    filterset_fields = ['sku', 'is_active', 'pack_level', 'is_primary']

class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.select_related('sku', 'site').all()
    serializer_class = ListingSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['is_listed', 'is_available', 'sku']

    def get_queryset(self):
        from bounded.ds_ops.access import operator_site_codes
        queryset = self.queryset
        site = self.request.query_params.get('site')
        if site:
            queryset = _filter_site(queryset, site)
        if self.request.user.role not in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'):
            queryset = queryset.filter(site__code__in=operator_site_codes(self.request.user))
        return queryset

    def _require_listing_site(self, user, site):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        require_site_access(user, site.code)
        require_session_facility(user, site.code)

    def perform_create(self, serializer):
        self._require_listing_site(self.request.user, serializer.validated_data['site'])
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get('site', serializer.instance.site)
        self._require_listing_site(self.request.user, site)
        serializer.save()


class StoreProductProfileViewSet(viewsets.ModelViewSet):
    queryset = StoreProductProfile.objects.select_related('sku', 'site', 'category').all()
    serializer_class = StoreProductProfileSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['sku', 'is_featured']
    search_fields = ['sku__sku_code', 'sku__name']

    def get_queryset(self):
        from bounded.ds_ops.access import operator_site_codes
        queryset = self.queryset
        site = self.request.query_params.get('site')
        if site:
            queryset = _filter_site(queryset, site)
        if self.request.user.role not in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'):
            queryset = queryset.filter(site__code__in=operator_site_codes(self.request.user))
        return queryset

    def perform_create(self, serializer):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        site = serializer.validated_data['site']
        require_site_access(self.request.user, site.code)
        require_session_facility(self.request.user, site.code)
        serializer.save()

    def perform_update(self, serializer):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        site = serializer.validated_data.get('site', serializer.instance.site)
        require_site_access(self.request.user, site.code)
        require_session_facility(self.request.user, site.code)
        serializer.save()

class InventoryLotViewSet(viewsets.ModelViewSet):
    queryset = InventoryLot.objects.select_related('sku', 'site').all()
    serializer_class = InventoryLotSerializer
    filterset_fields = ['sku', 'site', 'bucket', 'status', 'batch_number']
    search_fields = ['batch_number', 'sku__sku_code', 'sku__ean']

    def get_queryset(self):
        from bounded.ds_ops.access import is_superuser, operator_site_codes
        if is_superuser(self.request.user):
            return self.queryset
        return self.queryset.filter(site__code__in=operator_site_codes(self.request.user))

    def perform_create(self, serializer):
        from bounded.ds_ops.access import require_site_access
        require_site_access(self.request.user, serializer.validated_data['site'].code)
        serializer.save()

    def perform_update(self, serializer):
        from bounded.ds_ops.access import require_site_access
        site = serializer.validated_data.get('site', serializer.instance.site)
        require_site_access(self.request.user, site.code)
        serializer.save()


class ActiveCouponViewSet(viewsets.ModelViewSet):
    """Shopper-visible active coupons and admin-managed store coupons."""
    queryset = Coupon.objects.filter(is_active=True)
    serializer_class = CouponSerializer
    permission_classes = [IsAdminUserOrReadOnly]

    def get_queryset(self):
        now = timezone.now()
        management = self.request.query_params.get('management') == 'true'
        is_admin = self.request.user.role in ('SUPER_ADMIN', 'OPS_MANAGER')
        if management and not is_admin:
            raise PermissionDenied('Admin access required to manage offers.')
        queryset = Coupon.objects.all()
        site = self.request.query_params.get('site')
        if management:
            if site:
                queryset = _filter_site(queryset, site)
        else:
            queryset = queryset.filter(is_active=True, valid_from__lte=now, valid_until__gte=now)
            if site:
                queryset = queryset.filter(Q(site__isnull=True) | _site_query(site))
            else:
                queryset = queryset.filter(site__isnull=True)
        return queryset

    def _require_coupon_site(self, user, site):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        if site is None:
            raise serializers.ValidationError({'site': 'Offers must be assigned to a dark store.'})
        require_site_access(user, site.code)
        require_session_facility(user, site.code)

    def perform_create(self, serializer):
        site = serializer.validated_data.get('site')
        self._require_coupon_site(self.request.user, site)
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get('site', serializer.instance.site)
        self._require_coupon_site(self.request.user, site)
        serializer.save()


class ComboOfferViewSet(viewsets.ModelViewSet):
    queryset = ComboOffer.objects.select_related('site').prefetch_related('items__sku')
    serializer_class = ComboOfferSerializer
    permission_classes = [IsAdminUserOrReadOnly]

    def get_queryset(self):
        now = timezone.now()
        management = self.request.query_params.get('management') == 'true'
        if management and self.request.user.role not in ('SUPER_ADMIN', 'OPS_MANAGER'):
            raise PermissionDenied('Admin access required to manage offers.')
        site = self.request.query_params.get('site')
        queryset = self.queryset
        if site:
            queryset = _filter_site(queryset, site)
        else:
            return queryset.none()
        if not management:
            queryset = queryset.filter(is_active=True, valid_from__lte=now, valid_until__gte=now)
        return queryset

    def _require_offer_site(self, user, site):
        from bounded.ds_ops.access import require_site_access, require_session_facility
        if site is None:
            raise serializers.ValidationError({'site': 'Combo offers must be assigned to a dark store.'})
        require_site_access(user, site.code)
        require_session_facility(user, site.code)

    def perform_create(self, serializer):
        self._require_offer_site(self.request.user, serializer.validated_data.get('site'))
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get('site', serializer.instance.site)
        self._require_offer_site(self.request.user, site)
        serializer.save()


class ProductReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ProductReviewSerializer
    filterset_fields = ['sku']

    def get_queryset(self):
        return ProductReview.objects.select_related('customer', 'sku').all()

    def perform_create(self, serializer):
        # The reviewer is the signed-in shopper, never a body field.
        from bounded.orders.models import Customer
        customer = Customer.objects.filter(user_id=self.request.user.user_id).first()
        if customer is None:
            raise serializers.ValidationError('No customer profile linked to this login.')
        sku_id = self.request.data.get('sku')
        if ProductReview.objects.filter(sku_id=sku_id, customer=customer).exists():
            raise serializers.ValidationError('You have already reviewed this product.')
        serializer.save(customer=customer)


class WishlistViewSet(viewsets.ModelViewSet):
    serializer_class = WishlistItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from bounded.orders.models import Customer
        customer = Customer.objects.filter(user_id=self.request.user.user_id).first()
        if customer is None:
            return WishlistItem.objects.none()
        return WishlistItem.objects.filter(customer=customer).select_related('sku')

    def perform_create(self, serializer):
        from bounded.orders.models import Customer
        customer = Customer.objects.filter(user_id=self.request.user.user_id).first()
        if customer is None:
            raise serializers.ValidationError('No customer profile linked to this login.')
        sku_id = self.request.data.get('sku')
        if WishlistItem.objects.filter(customer=customer, sku_id=sku_id).exists():
            raise serializers.ValidationError('Already in your wishlist.')
        serializer.save(customer=customer)
