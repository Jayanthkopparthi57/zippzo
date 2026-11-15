from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0005_alter_stockbalance_options'),
    ]

    operations = [
        migrations.AddField(
            model_name='lpnmaster',
            name='manifest',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
