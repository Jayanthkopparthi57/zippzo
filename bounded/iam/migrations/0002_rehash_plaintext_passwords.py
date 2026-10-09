from django.db import migrations
from django.contrib.auth.hashers import make_password, identify_hasher


def _is_hashed(value):
    if not value:
        return False
    try:
        identify_hasher(value)
        return True
    except ValueError:
        return False


def rehash_plaintext_passwords(apps, schema_editor):
    """Accounts created before UserSerializer exposed `password` stored the raw
    credential (and API-created users stored an empty string). Re-hash any value
    that is not already a Django password hash, treating the stored value as the
    plaintext. Rows with an empty credential cannot be recovered and are left
    untouched so they stay unusable until an admin resets the password.
    """
    User = apps.get_model('iam', 'User')
    for user in User.objects.all().iterator():
        stored = user.password_hash
        if not stored or _is_hashed(stored):
            continue
        user.password_hash = make_password(stored)
        user.save(update_fields=['password_hash'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('iam', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(rehash_plaintext_passwords, noop),
    ]
