"""Seed the 26-category retail taxonomy with subcategories.

Each top-level entry carries the operator's description; the items named in
that description are stored as child rows so product registration can offer
them as a real subcategory list instead of free text. Existing categories are
left alone so SKUs that already reference them keep their category.
"""
from django.db import migrations

CATEGORIES = [
    ('Fruits & Vegetables', 'Fresh fruits, vegetables, leafy greens and herbs',
     ['Fresh fruits', 'Vegetables', 'Leafy greens', 'Herbs']),
    ('Atta, Rice & Dal', 'Rice, wheat flour, pulses, millets and grains',
     ['Rice', 'Wheat flour', 'Pulses', 'Millets', 'Grains']),
    ('Oil, Ghee & Masala', 'Cooking oils, ghee, spices, masalas and salt',
     ['Cooking oils', 'Ghee', 'Spices', 'Masalas', 'Salt']),
    ('Dairy & Eggs', 'Milk, curd, paneer, butter, cheese and eggs',
     ['Milk', 'Curd', 'Paneer', 'Butter', 'Cheese', 'Eggs']),
    ('Bakery', 'Bread, cakes, buns, pastries and cookies',
     ['Bread', 'Cakes', 'Buns', 'Pastries', 'Cookies']),
    ('Snacks & Munchies', 'Chips, namkeen, popcorn, nuts and chocolates',
     ['Chips', 'Namkeen', 'Popcorn', 'Nuts', 'Chocolates']),
    ('Cold Drinks & Beverages', 'Soft drinks, juices, bottled water and energy drinks',
     ['Soft drinks', 'Juices', 'Bottled water', 'Energy drinks']),
    ('Tea & Coffee', 'Tea, coffee, green tea and premixes',
     ['Tea', 'Coffee', 'Green tea', 'Premixes']),
    ('Instant & Packaged Food', 'Noodles, pasta, oats, cereals and ready-to-eat meals',
     ['Noodles', 'Pasta', 'Oats', 'Cereals', 'Ready-to-eat meals']),
    ('Frozen Food & Ice Cream', 'Frozen snacks, frozen vegetables and ice cream',
     ['Frozen snacks', 'Frozen vegetables', 'Ice cream']),
    ('Personal Care', 'Shampoo, soap, toothpaste, skincare and deodorants',
     ['Shampoo', 'Soap', 'Toothpaste', 'Skincare', 'Deodorants']),
    ('Beauty & Cosmetics', 'Makeup, cosmetics, beauty tools and fragrances',
     ['Makeup', 'Cosmetics', 'Beauty tools', 'Fragrances']),
    ('Cleaning & Household', 'Detergent, dishwash, floor cleaners and disinfectants',
     ['Detergent', 'Dishwash', 'Floor cleaners', 'Disinfectants']),
    ('Home Essentials', 'Tissues, garbage bags, toilet rolls and household supplies',
     ['Tissues', 'Garbage bags', 'Toilet rolls', 'Household supplies']),
    ('Baby Care', 'Diapers, wipes, baby food and baby toiletries',
     ['Diapers', 'Wipes', 'Baby food', 'Baby toiletries']),
    ('Pet Supplies', 'Pet food, treats, toys and grooming products',
     ['Pet food', 'Treats', 'Toys', 'Grooming products']),
    ('Kitchen & Dining', 'Cookware, utensils, bottles and food containers',
     ['Cookware', 'Utensils', 'Bottles', 'Food containers']),
    ('Home & Lifestyle', 'Home décor, storage, lighting and accessories',
     ['Home décor', 'Storage', 'Lighting', 'Accessories']),
    ('Electronics & Accessories', 'Chargers, cables, earphones and batteries',
     ['Chargers', 'Cables', 'Earphones', 'Batteries']),
    ('Stationery & Office', 'Pens, notebooks, paper and office supplies',
     ['Pens', 'Notebooks', 'Paper', 'Office supplies']),
    ('Health & Wellness', 'OTC healthcare, hygiene and wellness essentials',
     ['OTC healthcare', 'Hygiene', 'Wellness essentials']),
    ('Sports & Fitness', 'Yoga mats, fitness accessories and sports equipment',
     ['Yoga mats', 'Fitness accessories', 'Sports equipment']),
    ('Automotive', 'Car and bike accessories and cleaning products',
     ['Car accessories', 'Bike accessories', 'Cleaning products']),
    ('Flowers & Gardening', 'Flowers, bouquets, plants and gardening supplies',
     ['Flowers', 'Bouquets', 'Plants', 'Gardening supplies']),
    ('Pooja & Festival Essentials', 'Pooja items, diyas, incense and festival decorations',
     ['Pooja items', 'Diyas', 'Incense', 'Festival decorations']),
    ('Sweets', 'Milk-based sweets, Nut and dry fruit sweets, Fruit and vegetable-based sweets, Frozen desserts',
     ['Milk-based sweets', 'Nut and dry fruit sweets',
      'Fruit and vegetable-based sweets', 'Frozen desserts']),
]


def seed(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    for name, description, children in CATEGORIES:
        parent, _ = Category.objects.get_or_create(
            name=name, defaults={'description': description})
        if parent.description != description:
            parent.description = description
            parent.save(update_fields=['description'])
        for child_name in children:
            Category.objects.get_or_create(
                name=child_name, parent=parent,
                defaults={'description': f'{child_name} · {name}'})


def unseed(apps, schema_editor):
    Category = apps.get_model('catalog', 'SkuCategory')
    for name, _description, children in CATEGORIES:
        Category.objects.filter(name__in=children, parent__name=name).delete()
        Category.objects.filter(name=name, parent__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [('catalog', '0009_remove_food_beverages_category')]

    operations = [migrations.RunPython(seed, unseed)]
