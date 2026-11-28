from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('network', '0005_employeecompensation'),
        ('delivery', '0006_deliverytask_bin_handoff'),
    ]

    operations = [
        migrations.CreateModel(
            name='RiderPaymentRule',
            fields=[
                ('rule_id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('base_per_km', models.DecimalField(decimal_places=2, max_digits=6, default='7.00')),
                ('delivery_radius_km', models.DecimalField(decimal_places=2, max_digits=5, default='5.00')),
                ('busy_bonus', models.DecimalField(decimal_places=2, max_digits=6, default='5.00')),
                ('rain_bonus', models.DecimalField(decimal_places=2, max_digits=6, default='5.00')),
                ('busy_rain_bonus', models.DecimalField(decimal_places=2, max_digits=6, default='10.00')),
                ('incentive_orders', models.PositiveIntegerField(default=15)),
                ('incentive_amount', models.DecimalField(decimal_places=2, max_digits=7, default='100.00')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('site', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='rider_payment_rule', to='network.site')),
            ],
            options={'db_table': 'rider_payment_rules', 'ordering': ['-created_at']},
        ),
    ]
