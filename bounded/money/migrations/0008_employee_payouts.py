from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('iam', '0002_rehash_plaintext_passwords'),
        ('network', '0005_employeecompensation'),
        ('money', '0007_rider_payout'),
    ]

    operations = [
        migrations.CreateModel(
            name='EmployeeBankDetail',
            fields=[
                ('detail_id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('bank_name', models.CharField(blank=True, max_length=80)),
                ('bank_account_number', models.CharField(blank=True, max_length=40)),
                ('ifsc', models.CharField(blank=True, max_length=20)),
                ('account_holder_name', models.CharField(blank=True, max_length=120)),
                ('upi_id', models.CharField(blank=True, max_length=80)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='bank_detail', to='iam.user')),
            ],
            options={'db_table': 'employee_bank_details'},
        ),
        migrations.CreateModel(
            name='SalaryPayment',
            fields=[
                ('payment_id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('period_start', models.DateField(blank=True, null=True)),
                ('period_end', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('PAID', 'Paid'), ('FAILED', 'Failed')], default='PENDING', max_length=20)),
                ('reference', models.CharField(blank=True, max_length=80)),
                ('notes', models.TextField(blank=True)),
                ('payout_channel', models.CharField(default='MANUAL', max_length=20)),
                ('payout_status', models.CharField(default='NOT_STARTED', max_length=20)),
                ('beneficiary_id', models.CharField(blank=True, max_length=60)),
                ('transfer_id', models.CharField(blank=True, max_length=60)),
                ('payout_reference', models.CharField(blank=True, max_length=80)),
                ('payout_error', models.CharField(blank=True, max_length=240)),
                ('payout_initiated_at', models.DateTimeField(blank=True, null=True)),
                ('payout_completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.UUIDField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='salary_payments', to='network.site')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='salary_payments', to='iam.user')),
            ],
            options={'db_table': 'salary_payments', 'ordering': ['-created_at']},
        ),
    ]
