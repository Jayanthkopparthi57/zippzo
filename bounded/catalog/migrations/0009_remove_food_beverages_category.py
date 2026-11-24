"""Remove the Food & Beverages default category.

0008 used to seed five categories; the store now runs a single Groceries
category. Fresh databases get four from the edited 0008, and this migration
cleans the leftover row from databases that already ran it.

Before deleting the row, anything still pointing at it is moved to Groceries:
    * SKUs and store product profiles use SET_NULL, but an uncategorised SKU
      would fall out of the storefront's category tabs, so reassign instead;
    * seller category approvals are CASCADE + unique per (seller, category),
      so an approval is moved to Groceries only when that seller does not
      already have one there - otherwise the duplicate is dropped.
"""
from django.db import migrations

REMOVED = 'Food & Beverages'
REPLACEMENT = 'Groceries'


def remove_category(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    removed = Category.objects.filter(name=REMOVED).first()
    if removed is None:
        return
    replacement, _ = Category.objects.get_or_create(name=REPLACEMENT)

    Sku = apps.get_model('catalog', 'Sku')
    Sku.objects.filter(category=removed).update(category=replacement)

    Profile = apps.get_model('catalog', 'StoreProductProfile')
    Profile.objects.filter(category=removed).update(category=replacement)

    Approval = apps.get_model('supply', 'SellerCategoryApproval')
    for approval in Approval.objects.filter(category=removed):
        if Approval.objects.filter(
                seller=approval.seller, category=replacement).exists():
            approval.delete()
        else:
            approval.category = replacement
            approval.save(update_fields=['category'])

    removed.delete()


def restore_category(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    Category.objects.get_or_create(name=REMOVED)


class Migration(migrations.Migration):
    dependencies = [
        ('catalog', '0008_seed_default_categories'),
        ('supply', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(remove_category, restore_category),
    ]
