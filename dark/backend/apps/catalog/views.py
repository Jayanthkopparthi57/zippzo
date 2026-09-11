from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Vendor, Customer, Product, Batch
from .serializers import VendorSerializer, CustomerSerializer, ProductSerializer, BatchSerializer

class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.filter(is_active=True)
    serializer_class = VendorSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'vendor_code', 'email']

class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.filter(deleted_at__isnull=True)
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'customer_code', 'email', 'phone']

class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.filter(is_active=True).select_related('category').prefetch_related('batches')
    serializer_class = ProductSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['category', 'is_active']
    search_fields = ['name', 'sku', 'barcode']

    @action(detail=False, methods=['get'], url_path='scan')
    def scan_product(self, request):
        code = request.query_params.get('code')
        if not code:
            return Response({'error': 'Code parameter required (SKU or Barcode)'}, status=status.HTTP_400_BAD_REQUEST)
        
        product = Product.objects.filter(models.Q(barcode=code) | models.Q(sku=code), is_active=True).first()
        if not product:
            return Response({'error': f'Product with code {code} not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(ProductSerializer(product).data)

class BatchViewSet(viewsets.ModelViewSet):
    queryset = Batch.objects.filter(deleted_at__isnull=True).select_related('product')
    serializer_class = BatchSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['product', 'currency']
    search_fields = ['internal_batch_id', 'vendor_batch_code', 'product__sku']
