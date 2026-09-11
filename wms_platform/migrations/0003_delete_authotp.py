from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('wms_platform', '0002_authotp_authsession'),
    ]

    operations = [
        migrations.DeleteModel(
            name='AuthOtp',
        ),
    ]
