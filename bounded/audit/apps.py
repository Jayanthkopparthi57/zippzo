from django.apps import AppConfig

class AuditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.audit'
    verbose_name = 'Audit - Immutable Action Log'
