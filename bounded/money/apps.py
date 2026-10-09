from django.apps import AppConfig
class MoneyConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'bounded.money'
    verbose_name = 'Money - Payments, Refunds, COD Custody, Earnings'
