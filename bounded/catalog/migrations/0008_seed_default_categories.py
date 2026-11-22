from django.db import migrations


CATEGORIES = [
    'Groceries',
    'Food & Beverages',
    'Personal Care',
    'Home Care',
    'Health, Baby & Pet Care',
]


def seed_categories(apps, schema_editor):
    SkuCategory = apps.get_model('catalog', 'SkuCategory')
    for name in CATEGORIES:
        SkuCategory.objects.get_or_create(name=name)


def unseed_categories(apps, schema_editor):
    SkuCategory = apps.get_model('catalog', 'SkuCategory')
    SkuCategory.objects.filter(name__in=CATEGORIES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('catalog', '0007_skucategory_description'),
    ]

    operations = [
        migrations.RunPython(seed_categories, unseed_categories),
    ]
