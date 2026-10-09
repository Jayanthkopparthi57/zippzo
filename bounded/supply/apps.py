from django.apps import AppConfig

class SupplyConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.supply'
    verbose_name = 'Supply - Vendors, ASN, GRN, Putaway'
