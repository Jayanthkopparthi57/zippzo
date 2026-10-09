from django.apps import AppConfig

class CatalogConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.catalog'
    verbose_name = 'Catalog - SKUs, Categories, Listings'
