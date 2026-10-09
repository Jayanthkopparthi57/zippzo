from django.apps import AppConfig

class HoldConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.holds'
    verbose_name = 'Holds - Stock Holds & Invariants'
