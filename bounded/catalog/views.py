# Catalog Views
import uuid

from rest_framework import viewsets, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from django.conf import settings
from django.core.files.storage import default_storage
from django.utils import timezone
from bounded.iam.permissions import IsAdminUserOrReadOnly
from .models import SkuCategory, Sku, SkuBarcode, Listing, InventoryLot, Coupon, ProductReview, WishlistItem
from .serializers import (SkuCategorySerializer, SkuSerializer, SkuBarcodeSerializer,
                          ListingSerializer, InventoryLotSerializer, CouponSerializer,
                          ProductReviewSerializer, WishlistItemSerializer)

# Images are stored on the same origin as the API. Extensions come from the
# upload's declared content type and SVG is deliberately absent: an SVG can
# carry script and would be served from our own origin.
IMAGE_CONTENT_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
}
MAX_IMAGE_BYTES = 2 * 1024 * 1024


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

class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.select_related('sku', 'site').all()
    serializer_class = ListingSerializer
    permission_classes = [IsAdminUserOrReadOnly]
    filterset_fields = ['is_listed', 'is_available', 'site']

class InventoryLotViewSet(viewsets.ModelViewSet):
    queryset = InventoryLot.objects.select_related('sku', 'site').all()
    serializer_class = InventoryLotSerializer
    filterset_fields = ['sku', 'site', 'bucket', 'status', 'batch_number']
    search_fields = ['batch_number', 'sku__sku_code', 'sku__ean']


class ActiveCouponViewSet(viewsets.ReadOnlyModelViewSet):
    """Active, in-window coupons a shopper can apply at checkout."""
    queryset = Coupon.objects.filter(is_active=True)
    serializer_class = CouponSerializer

    def get_queryset(self):
        now = timezone.now()
        return Coupon.objects.filter(is_active=True, valid_from__lte=now, valid_until__gte=now)


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
