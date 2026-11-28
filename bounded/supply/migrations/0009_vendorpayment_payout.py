from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('supply', '0008_vendor_bank_payments'),
    ]

    operations = [
        migrations.AddField(model_name='vendorpayment', name='payout_channel', field=models.CharField(default='MANUAL', max_length=20)),
        migrations.AddField(model_name='vendorpayment', name='payout_status', field=models.CharField(default='NOT_STARTED', max_length=20)),
        migrations.AddField(model_name='vendorpayment', name='beneficiary_id', field=models.CharField(blank=True, max_length=60)),
        migrations.AddField(model_name='vendorpayment', name='transfer_id', field=models.CharField(blank=True, max_length=60)),
        migrations.AddField(model_name='vendorpayment', name='payout_reference', field=models.CharField(blank=True, max_length=80)),
        migrations.AddField(model_name='vendorpayment', name='payout_error', field=models.CharField(blank=True, max_length=240)),
        migrations.AddField(model_name='vendorpayment', name='payout_initiated_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='vendorpayment', name='payout_completed_at', field=models.DateTimeField(blank=True, null=True)),
    ]
