from django.apps import AppConfig

class NotificationConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.notifications'
    verbose_name = 'Notifications - Push, SMS, WebSocket'
