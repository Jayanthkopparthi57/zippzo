from django.apps import AppConfig


class MasterDataConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.masterdata'
    verbose_name = 'Master Data'
