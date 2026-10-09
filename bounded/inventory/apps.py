from django.apps import AppConfig

class InventoryConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.inventory'
    verbose_name = 'Inventory - LPNs, Stock Ledger'
