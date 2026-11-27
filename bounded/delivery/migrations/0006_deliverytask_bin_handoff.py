from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('delivery', '0005_deliverytask_cashcollected')]

    operations = [
        migrations.AddField(
            model_name='deliverytask',
            name='bin_code',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='deliverytask',
            name='bin_dropped_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='deliverytask',
            name='bin_dropped_by',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]
