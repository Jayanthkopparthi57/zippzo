import uuid

from django.db import migrations, models


def assign_line_ids(apps, schema_editor):
    OrderLine = apps.get_model('orders', 'CustomerOrderLine')
    for line in OrderLine.objects.all().iterator():
        OrderLine.objects.filter(pk=line.pk).update(line_id=uuid.uuid4())


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='customerorderline',
            name='line_id',
            field=models.UUIDField(null=True),
        ),
        migrations.RunPython(assign_line_ids, noop),
        migrations.RemoveField(
            model_name='customerorderline',
            name='id',
        ),
        migrations.AlterField(
            model_name='customerorderline',
            name='line_id',
            field=models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False),
        ),
    ]
