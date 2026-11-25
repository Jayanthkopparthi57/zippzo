"""Prune legacy top-level categories; keep only the 26-category taxonomy.

The earlier demo catalog left overlapping categories (Groceries, Staples,
Beverages, ...). SKUs pointing at them are remapped to the nearest new
category instead of being left uncategorised. Their child rows are removed.
"""
from django.db import migrations

# old name -> closest category in the 26-item taxonomy
REMAP = {
    'Bakery & Biscuits': 'Bakery',
    'Beverages': 'Cold Drinks & Beverages',
    'Dairy & Breakfast': 'Dairy & Eggs',
    'Groceries': None,
    'Health, Baby & Pet Care': 'Health & Wellness',
    'Home & Cleaning': 'Cleaning & Household',
    'Home Care': 'Home Essentials',
    'Instant Food': 'Instant & Packaged Food',
    'Pharma & Wellness': 'Health & Wellness',
    'Staples': 'Atta, Rice & Dal',
}


def prune(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    Sku = apps.get_model('catalog', 'Sku')
    Profile = apps.get_model('catalog', 'StoreProductProfile')
    Approval = apps.get_model('supply', 'SellerCategoryApproval')

    for old_name, new_name in REMAP.items():
        old = Category.objects.filter(name=old_name, parent__isnull=True).first()
        if old is None:
            continue
        target = Category.objects.filter(name=new_name, parent__isnull=True).first() if new_name else None
        Sku.objects.filter(category=old).update(category=target)
        Profile.objects.filter(category=old).update(category=target)
        for approval in Approval.objects.filter(category=old):
            if target and Approval.objects.filter(category=target, seller=approval.seller).exists():
                approval.delete()
            else:
                approval.category = target
                approval.save(update_fields=['category'])
        Category.objects.filter(parent=old).delete()
        old.delete()


def restore(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    for name in REMAP:
        Category.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [
        ('catalog', '0010_seed_retail_taxonomy'),
        ('supply', '0001_initial'),
    ]

    operations = [migrations.RunPython(prune, restore)]
