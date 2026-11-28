from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('supply', '0007_putaway_strategy'),
    ]

    operations = [
        migrations.AddField(
            model_name='vendor',
            name='bank_name',
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name='vendor',
            name='bank_account_number',
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name='vendor',
            name='ifsc',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name='vendor',
            name='account_holder_name',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='vendor',
            name='payment_status',
            field=models.CharField(choices=[('PENDING', 'Pending'), ('PAID', 'Paid')], default='PENDING', max_length=20),
        ),
        migrations.CreateModel(
            name='VendorPayment',
            fields=[
                ('payment_id', models.UUIDField(default=__import__('uuid').uuid4, editable=False, primary_key=True, serialize=False)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=14)),
                ('status', models.CharField(choices=[('COMPLETE', 'Complete'), ('PENDING', 'Pending')], default='PENDING', max_length=20)),
                ('payment_date', models.DateField()),
                ('bank_name', models.CharField(blank=True, max_length=80)),
                ('bank_account_number', models.CharField(blank=True, max_length=40)),
                ('ifsc', models.CharField(blank=True, max_length=20)),
                ('account_holder_name', models.CharField(blank=True, max_length=120)),
                ('reference', models.CharField(blank=True, max_length=80)),
                ('notes', models.TextField(blank=True)),
                ('created_by', models.UUIDField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('vendor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payments', to='supply.vendor')),
            ],
            options={
                'db_table': 'vendor_payments',
                'ordering': ['-payment_date', '-created_at'],
            },
        ),
    ]
