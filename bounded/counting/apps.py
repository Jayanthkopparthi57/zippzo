from django.apps import AppConfig


class CountingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.counting'
    verbose_name = 'Cycle Counting'
