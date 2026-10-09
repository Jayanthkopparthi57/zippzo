from django.apps import AppConfig
class OrdersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.orders'
    verbose_name = 'Orders - Customer Orders, Cart, Lines'
