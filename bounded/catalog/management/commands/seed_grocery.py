"""
Seed the catalogue with a realistic quick-commerce grocery range.

Creates ~110 SKUs across ten categories with real Indian brands, pack sizes,
MRPs and sale prices, lists them at the given dark store(s), and puts stock on
the shelf so the storefront shows a full shelf from the first page load.

By default only seeds the first two active dark stores (enough for the demo
and E2E); pass --all-stores to seed every active DS. Uses bulk operations so
it finishes quickly even against a remote database.

Idempotent: re-running skips SKUs/listings/lots that already exist.
"""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from bounded.catalog.models import SkuCategory, Sku, Listing, InventoryLot, Coupon
from bounded.inventory.models import StockBalance
from bounded.network.models import Site, Location


# (name, brand, pack_size, mrp, price, category, image_key, storage_zone)
PRODUCTS = [
    # Fruits & Vegetables
    ('Banana Robusta', 'Fresh', '1 kg', 60, 49, 'Fruits & Vegetables', 'fruit', 'DRY'),
    ('Apple Shimla', 'Fresh', '500 g', 140, 119, 'Fruits & Vegetables', 'fruit', 'DRY'),
    ('Onion', 'Fresh', '1 kg', 45, 35, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Potato', 'Fresh', '1 kg', 40, 32, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Tomato Hybrid', 'Fresh', '500 g', 40, 28, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Lemon', 'Fresh', '250 g', 30, 22, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Cucumber', 'Fresh', '500 g', 35, 25, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Carrot', 'Fresh', '500 g', 45, 36, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Spinach (Palak)', 'Fresh', '250 g', 25, 18, 'Fruits & Vegetables', 'veg', 'COLD'),
    ('Capsicum Green', 'Fresh', '250 g', 40, 30, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Ginger', 'Fresh', '250 g', 50, 40, 'Fruits & Vegetables', 'veg', 'DRY'),
    ('Garlic', 'Fresh', '200 g', 60, 48, 'Fruits & Vegetables', 'veg', 'DRY'),
    # Dairy & Breakfast
    ('Amul Taaza Toned Milk', 'Amul', '500 ml', 28, 27, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Amul Butter', 'Amul', '100 g', 60, 58, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Amul Paneer Fresh', 'Amul', '200 g', 95, 89, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Amul Dahi (Curd)', 'Amul', '400 g', 45, 42, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Britannia Brown Bread', 'Britannia', '400 g', 45, 40, 'Dairy & Breakfast', 'bakery', 'DRY'),
    ('Britannia White Bread', 'Britannia', '400 g', 40, 35, 'Dairy & Breakfast', 'bakery', 'DRY'),
    ('Amul Cheese Slices', 'Amul', '100 g', 85, 79, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Farm Fresh Eggs', 'Farm', '6 pcs', 66, 59, 'Dairy & Breakfast', 'dairy', 'COLD'),
    ('Britannia Marie Gold', 'Britannia', '250 g', 35, 30, 'Dairy & Breakfast', 'bakery', 'DRY'),
    ('Amul Fresh Cream', 'Amul', '250 ml', 90, 85, 'Dairy & Breakfast', 'dairy', 'COLD'),
    # Snacks & Munchies
    ("Lay's Magic Masala", "Lay's", '52 g', 20, 20, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Kurkure Masala Munch', 'Kurkure', '90 g', 35, 35, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Haldiram Aloo Bhujia', 'Haldiram', '200 g', 52, 49, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Bingo Mad Angles', 'Bingo', '66 g', 20, 20, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Parle-G Gold', 'Parle', '100 g', 10, 10, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Oreo Original', 'Oreo', '137 g', 40, 38, 'Snacks & Munchies', 'snack', 'DRY'),
    ("Lay's Classic Salted", "Lay's", '52 g', 20, 20, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Haldiram Bhujia Sev', 'Haldiram', '400 g', 105, 99, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Too Yumm Multigrain', 'Too Yumm', '95 g', 40, 38, 'Snacks & Munchies', 'snack', 'DRY'),
    ('Nutella Hazelnut', 'Nutella', '350 g', 475, 449, 'Snacks & Munchies', 'snack', 'DRY'),
    # Beverages
    ('Coca-Cola', 'Coca-Cola', '750 ml', 45, 40, 'Beverages', 'beverage', 'DRY'),
    ('Pepsi', 'Pepsi', '750 ml', 45, 40, 'Beverages', 'beverage', 'DRY'),
    ('Sprite Lime', 'Sprite', '750 ml', 45, 40, 'Beverages', 'beverage', 'DRY'),
    ('Real Mixed Fruit Juice', 'Real', '1 L', 120, 110, 'Beverages', 'beverage', 'DRY'),
    ('Appy Fizz', 'Appy', '600 ml', 40, 36, 'Beverages', 'beverage', 'DRY'),
    ('Red Bull Energy', 'Red Bull', '250 ml', 125, 119, 'Beverages', 'beverage', 'DRY'),
    ('Nescafe Classic', 'Nescafe', '50 g', 260, 245, 'Beverages', 'beverage', 'DRY'),
    ('Lipton Yellow Label Tea', 'Lipton', '100 g', 130, 122, 'Beverages', 'beverage', 'DRY'),
    ('Bisleri Mineral Water', 'Bisleri', '1 L', 25, 22, 'Beverages', 'beverage', 'DRY'),
    ('Tropicana Orange Juice', 'Tropicana', '1 L', 120, 109, 'Beverages', 'beverage', 'COLD'),
    # Instant Food
    ('Maggi 2-Minute Noodles', 'Maggi', '12 x 70 g', 168, 152, 'Instant Food', 'instant', 'DRY'),
    ('Maggi Masala Instant', 'Maggi', '70 g', 14, 14, 'Instant Food', 'instant', 'DRY'),
    ('Yippee Magic Masala', 'Yippee', '60 g', 12, 12, 'Instant Food', 'instant', 'DRY'),
    ('Knorr Sweet Corn Soup', 'Knorr', '44 g', 55, 52, 'Instant Food', 'instant', 'DRY'),
    ("Kellogg's Corn Flakes", "Kellogg's", '275 g', 165, 155, 'Instant Food', 'instant', 'DRY'),
    ('Quaker Oats', 'Quaker', '1 kg', 195, 185, 'Instant Food', 'instant', 'DRY'),
    ('Maggi Pazzta Pasta', 'Maggi', '70 g', 14, 14, 'Instant Food', 'instant', 'DRY'),
    ('Cup Noodles', 'Nissin', '69 g', 55, 52, 'Instant Food', 'instant', 'DRY'),
    ('Saffola Masala Oats', 'Saffola', '500 g', 260, 245, 'Instant Food', 'instant', 'DRY'),
    ('MTR Gulab Jamun Mix', 'MTR', '200 g', 85, 79, 'Instant Food', 'instant', 'DRY'),
    # Home & Cleaning
    ('Surf Excel Easy Wash', 'Surf Excel', '1 kg', 130, 122, 'Home & Cleaning', 'home', 'DRY'),
    ('Vim Dishwash Bar', 'Vim', '300 g', 30, 28, 'Home & Cleaning', 'home', 'DRY'),
    ('Harpic Toilet Cleaner', 'Harpic', '1 L', 199, 185, 'Home & Cleaning', 'home', 'DRY'),
    ('Lizol Floor Cleaner', 'Lizol', '1 L', 199, 185, 'Home & Cleaning', 'home', 'DRY'),
    ('Dettol Original Handwash', 'Dettol', '200 ml', 99, 92, 'Home & Cleaning', 'home', 'DRY'),
    ('Colin Glass Cleaner', 'Colin', '500 ml', 99, 95, 'Home & Cleaning', 'home', 'DRY'),
    ('Bin Liner Garbage Bags', 'Generic', '30 pcs', 120, 99, 'Home & Cleaning', 'home', 'DRY'),
    ('Ariel Matic Detergent', 'Ariel', '1 kg', 155, 145, 'Home & Cleaning', 'home', 'DRY'),
    ('Comfort Fabric Softener', 'Comfort', '800 ml', 199, 185, 'Home & Cleaning', 'home', 'DRY'),
    ('Scotch-Brite Scrubber', 'Scotch-Brite', '3 pcs', 60, 55, 'Home & Cleaning', 'home', 'DRY'),
    # Personal Care
    ('Dove Beauty Cream Bar', 'Dove', '100 g', 65, 62, 'Personal Care', 'personal', 'DRY'),
    ('Colgate Strong Teeth', 'Colgate', '200 g', 115, 108, 'Personal Care', 'personal', 'DRY'),
    ('Head & Shoulders Shampoo', 'Head & Shoulders', '340 ml', 340, 320, 'Personal Care', 'personal', 'DRY'),
    ('Nivea Body Lotion', 'Nivea', '400 ml', 299, 285, 'Personal Care', 'personal', 'DRY'),
    ('Gillette Fusion Razor', 'Gillette', '1 pc', 399, 379, 'Personal Care', 'personal', 'DRY'),
    ('Vaseline Petroleum Jelly', 'Vaseline', '100 ml', 165, 155, 'Personal Care', 'personal', 'DRY'),
    ('Dettol Original Soap', 'Dettol', '4 x 125 g', 180, 168, 'Personal Care', 'personal', 'DRY'),
    ('Clinic Plus Shampoo', 'Clinic Plus', '340 ml', 215, 205, 'Personal Care', 'personal', 'DRY'),
    ('Fair & Lovely Cream', 'Fair & Lovely', '40 g', 85, 80, 'Personal Care', 'personal', 'DRY'),
    ('Sensodyne Toothpaste', 'Sensodyne', '100 g', 110, 105, 'Personal Care', 'personal', 'DRY'),
    # Baby Care
    ('Pampers All Round Pants', 'Pampers', 'M 44 pcs', 799, 749, 'Baby Care', 'baby', 'DRY'),
    ("Johnson's Baby Lotion", "Johnson's", '200 ml', 195, 185, 'Baby Care', 'baby', 'DRY'),
    ('Huggies Baby Wipes', 'Huggies', '72 pcs', 245, 229, 'Baby Care', 'baby', 'DRY'),
    ('Cerelac Wheat Apple', 'Cerelac', '300 g', 285, 270, 'Baby Care', 'baby', 'DRY'),
    ("Johnson's Baby Shampoo", "Johnson's", '200 ml', 210, 199, 'Baby Care', 'baby', 'DRY'),
    ('Mamypoko Pants', 'Mamypoko', 'L 38 pcs', 749, 699, 'Baby Care', 'baby', 'DRY'),
    # Bakery & Biscuits
    ('Britannia Good Day', 'Britannia', '200 g', 40, 38, 'Bakery & Biscuits', 'bakery', 'DRY'),
    ('Sunfeast Marie Light', 'Sunfeast', '250 g', 35, 32, 'Bakery & Biscuits', 'bakery', 'DRY'),
    ('Britannia Bourbon', 'Britannia', '150 g', 35, 33, 'Bakery & Biscuits', 'bakery', 'DRY'),
    ('Bournvita Jar', 'Cadbury', '500 g', 250, 235, 'Bakery & Biscuits', 'bakery', 'DRY'),
    ('Tiger Glucose Biscuits', 'Parle', '1 kg', 130, 120, 'Bakery & Biscuits', 'bakery', 'DRY'),
    ('Krackjack', 'Britannia', '200 g', 35, 33, 'Bakery & Biscuits', 'bakery', 'DRY'),
    # Pharma & Wellness
    ('Dolo 650 Tablet', 'Micro Labs', '15 tablets', 32, 30, 'Pharma & Wellness', 'wellness', 'DRY'),
    ('Combiflam Tablet', 'Sanofi', '20 tablets', 55, 52, 'Pharma & Wellness', 'wellness', 'DRY'),
    ('ORS Orange Flavour', 'FDC', '5 x 21 g', 80, 75, 'Pharma & Wellness', 'wellness', 'DRY'),
    ('Dettol Antiseptic Liquid', 'Dettol', '550 ml', 265, 250, 'Pharma & Wellness', 'wellness', 'DRY'),
    ('Volini Pain Relief Gel', 'Volini', '30 g', 165, 155, 'Pharma & Wellness', 'wellness', 'DRY'),
    ('Zandu Balm', 'Zandu', '25 ml', 80, 75, 'Pharma & Wellness', 'wellness', 'DRY'),
    # Staples
    ('Aashirvaad Atta', 'Aashirvaad', '5 kg', 310, 295, 'Staples', 'staple', 'DRY'),
    ('India Gate Basmati Rice', 'India Gate', '5 kg', 650, 599, 'Staples', 'staple', 'DRY'),
    ('Tata Salt Iodised', 'Tata', '1 kg', 28, 28, 'Staples', 'staple', 'DRY'),
    ('Fortune Sunlite Oil', 'Fortune', '1 L', 165, 155, 'Staples', 'staple', 'DRY'),
    ('Toor Dal (Arhar)', 'Generic', '1 kg', 180, 165, 'Staples', 'staple', 'DRY'),
    ('Chana Dal', 'Generic', '1 kg', 110, 99, 'Staples', 'staple', 'DRY'),
    ('Sugar', 'Generic', '1 kg', 48, 45, 'Staples', 'staple', 'DRY'),
    ('Double Horse Urad Dal', 'Double Horse', '1 kg', 190, 175, 'Staples', 'staple', 'DRY'),
    ('Saffola Gold Oil', 'Saffola', '5 L', 950, 899, 'Staples', 'staple', 'DRY'),
    ('Maida (Refined Flour)', 'Generic', '1 kg', 45, 40, 'Staples', 'staple', 'DRY'),
]

COUPONS = [
    ('WELCOME50', 'Flat ₹50 off on your first order', 'FLAT', '50', '199', None),
    ('SAVE20', '20% off up to ₹100', 'PERCENT', '20', '199', '100'),
    ('FRESH10', '10% off on orders above ₹299', 'PERCENT', '10', '299', '75'),
]


def _code(name, brand):
    base = (brand[:3] + name[:12]).upper().replace(' ', '').replace("'", '').replace('&', '')
    return f'{base}-{uuid.uuid4().hex[:4].upper()}'


class Command(BaseCommand):
    help = 'Seed a realistic grocery catalogue, listings, stock and coupons.'

    def add_arguments(self, parser):
        parser.add_argument('--all-stores', action='store_true',
                            help='Seed every active dark store, not just the first two.')

    def handle(self, *args, **options):
        now = timezone.now()
        cats = {}
        for name in sorted({p[5] for p in PRODUCTS}):
            cat, _ = SkuCategory.objects.get_or_create(name=name)
            cats[name] = cat

        qs = Site.objects.filter(site_type='DS', status='ACTIVE')
        if not options['all_stores']:
            qs = qs[:2]
        sites = list(qs)
        if not sites:
            self.stdout.write(self.style.WARNING('No active dark store found.'))
            return

        existing_codes = set(Sku.objects.values_list('sku_code', flat=True))
        new_skus = []
        for (name, brand, pack, mrp, price, cat_name, img, zone) in PRODUCTS:
            full = name if brand.lower() in name.lower() else f'{brand} {name}'
            # Deterministic code so re-runs skip rather than duplicate.
            code = (brand[:3] + name[:10]).upper().replace(' ', '').replace("'", '').replace('&', '')[:20]
            if code in existing_codes:
                continue
            existing_codes.add(code)
            new_skus.append(Sku(
                sku_code=code, name=full, brand=brand, pack_size=pack,
                category=cats[cat_name], sub_category=cat_name,
                mrp=Decimal(str(mrp)), image_url=f'/img/grocery/{img}.svg',
                status='ACTIVE', storage_zone=zone, shelf_life_days=180,
                is_food=cat_name in ('Fruits & Vegetables', 'Dairy & Breakfast',
                                     'Instant Food', 'Bakery & Biscuits', 'Staples'),
            ))
        if new_skus:
            Sku.objects.bulk_create(new_skus, batch_size=100, ignore_conflicts=True)

        # Look up all seeded SKUs (existing + new) by the deterministic codes.
        all_products = []
        for (name, brand, pack, mrp, price, cat_name, img, zone) in PRODUCTS:
            code = (brand[:3] + name[:10]).upper().replace(' ', '').replace("'", '').replace('&', '')[:20]
            all_products.append((code, mrp, price))

        code_to_sku = dict(Sku.objects.filter(
            sku_code__in=[c for c, _, _ in all_products]).values_list('sku_code', 'sku_id'))

        listings, lots, balances = [], [], []
        existing_listing_pairs = set(
            Listing.objects.filter(site__in=sites).values_list('sku_id', 'site_id'))
        for site in sites:
            for code, mrp, price in all_products:
                sku_id = code_to_sku.get(code)
                if sku_id is None:
                    continue
                if (sku_id, site.site_id) in existing_listing_pairs:
                    continue
                pct = round((1 - price / mrp) * 100, 2) if mrp > price else 0
                listings.append(Listing(
                    sku_id=sku_id, site=site,
                    price=Decimal(str(price)), mrp=Decimal(str(mrp)),
                    discount_pct=pct, is_listed=True, is_available=True,
                    low_stock_threshold=5,
                ))
        if listings:
            Listing.objects.bulk_create(listings, batch_size=200, ignore_conflicts=True)

        # One lot + BIN balance per (sku, site) so items are actually shelved.
        # The bin must be a real Location row: allocation stores its
        # location_id in StockBalance.container_ref and the pick screen
        # resolves scans against /ds-ops/resolve-bin, which only matches
        # Location barcodes/ids. A bare container_ref with no Location would
        # allocate but then reject every bin scan.
        bin_by_site = {}
        for site in sites:
            loc, _ = Location.objects.get_or_create(
                location_id=f'BIN-SEED-{site.code}',
                defaults=dict(
                    site=site, location_type='BIN', container='PICK_FACE',
                    aisle='A', rack='1', level='1', position='1',
                    barcode=f'BIN-SEED-{site.code}',
                    qr_payload=f'BIN-SEED-{site.code}',
                    is_sellable_bin=True, is_active=True,
                    created_by='seed_grocery',
                ),
            )
            bin_by_site[site.site_id] = loc.location_id

        existing_lot_keys = set(InventoryLot.objects.filter(
            site__in=sites, batch_number__startswith='SEED-'
        ).values_list('sku_id', 'site_id', flat=False))
        lot_map = {}
        for site in sites:
            for code, mrp, price in all_products:
                sku_id = code_to_sku.get(code)
                if sku_id is None or (sku_id, site.site_id) in existing_lot_keys:
                    continue
                lot_id = uuid.uuid4()
                lot_map[(sku_id, site.site_id)] = lot_id
                lots.append(InventoryLot(
                    lot_id=lot_id, sku_id=sku_id, site=site,
                    batch_number=f'SEED-{code}', bucket='Good', status='AVAILABLE',
                    expiry_date=(now + timedelta(days=180)).date(),
                    mfg_date=(now - timedelta(days=30)).date(),
                    mrp=Decimal(str(mrp)),
                ))
        if lots:
            InventoryLot.objects.bulk_create(lots, batch_size=200, ignore_conflicts=True)

        for (sku_id, site_id), lot_id in lot_map.items():
            site = next(s for s in sites if s.site_id == site_id)
            balances.append(StockBalance(
                site=site, container='BIN',
                container_ref=bin_by_site[site_id],
                sku_id=sku_id, lot_id=lot_id, owner_type='ZIPZOO', owner_id='',
                qty=50, sellable=True, counts_toward_site_custody=True,
            ))
        if balances:
            StockBalance.objects.bulk_create(balances, batch_size=200, ignore_conflicts=True)

        for code, title, dtype, dval, min_o, max_d in COUPONS:
            Coupon.objects.get_or_create(
                code=code,
                defaults=dict(
                    title=title, description=title, discount_type=dtype,
                    discount_value=Decimal(dval), min_order=Decimal(min_o),
                    max_discount=Decimal(max_d) if max_d else None,
                    valid_from=now - timedelta(days=1),
                    valid_until=now + timedelta(days=365), is_active=True,
                ),
            )

        self.stdout.write(self.style.SUCCESS(
            f'Seeded {len(new_skus)} new SKUs (catalogue now has '
            f'{Sku.objects.count()} SKUs), {len(listings)} new listings, '
            f'{len(lots)} lots, {len(balances)} balances, {len(COUPONS)} coupons '
            f'across {len(sites)} dark stores.'))
