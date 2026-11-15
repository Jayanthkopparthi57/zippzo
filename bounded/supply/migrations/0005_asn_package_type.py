from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('supply', '0004_grn_manual_entry_putawaytask_placed_qty'),
    ]

    operations = [
        migrations.AddField(
            model_name='asn',
            name='package_type',
            field=models.CharField(
                choices=[
                    ('TOTE', 'Tote'),
                    ('CARTON', 'Carton / Case'),
                    ('PALLET', 'Pallet'),
                    ('BAG', 'Bag'),
                ],
                default='TOTE',
                max_length=20,
            ),
        ),
    ]
