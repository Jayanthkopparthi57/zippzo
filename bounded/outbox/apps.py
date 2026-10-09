from django.apps import AppConfig

class OutboxConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.outbox'
    verbose_name = 'Outbox - Transactional Events'
