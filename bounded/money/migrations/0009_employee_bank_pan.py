from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('money', '0008_employee_payouts'),
    ]

    operations = [
        migrations.AddField(
            model_name='employeebankdetail',
            name='pan',
            field=models.CharField(blank=True, max_length=10),
        ),
    ]
