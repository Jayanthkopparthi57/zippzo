from django.contrib import admin
from .models import Vendor, Customer, Product, Batch

@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ('vendor_code', 'name', 'contact_person', 'email', 'currency', 'is_active')
    search_fields = ('vendor_code', 'name', 'email')

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('customer_code', 'name', 'email', 'phone', 'city')
    search_fields = ('customer_code', 'name', 'email')

@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('sku', 'name', 'category', 'barcode', 'uom', 'reorder_point', 'is_active')
    list_filter = ('category', 'is_active')
    search_fields = ('sku', 'barcode', 'name')

@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ('internal_batch_id', 'product', 'vendor_batch_code', 'expiry_date', 'unit_cost', 'currency')
    list_filter = ('expiry_date', 'currency')
    search_fields = ('internal_batch_id', 'vendor_batch_code', 'product__sku')
