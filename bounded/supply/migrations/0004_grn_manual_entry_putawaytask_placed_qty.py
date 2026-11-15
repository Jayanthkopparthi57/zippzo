from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('supply', '0003_grn_created_by_putawaytask_confirmed_by'),
    ]

    operations = [
        migrations.AddField(
            model_name='grn',
            name='batch_code',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='grn',
            name='manual_entry_by',
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='grn',
            name='manual_entry_reason',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='grn',
            name='manual_entry_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='putawaytask',
            name='placed_qty',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
