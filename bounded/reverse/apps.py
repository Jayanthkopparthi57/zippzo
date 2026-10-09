from django.apps import AppConfig
class ReverseConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.reverse'
    verbose_name = 'Reverse - Returns, RTO, RTV, RTS'
