from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('network', '0005_employeecompensation'),
    ]

    operations = [
        migrations.AddField(
            model_name='location',
            name='category',
            field=models.CharField(blank=True, max_length=100),
        ),
    ]
