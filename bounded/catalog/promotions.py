from decimal import Decimal

from django.utils import timezone

from .models import ComboOffer


CENT = Decimal('0.01')


def active_combo_offers(site):
    now = timezone.now()
    return (
        ComboOffer.objects
        .filter(site=site, is_active=True, valid_from__lte=now, valid_until__gte=now)
        .prefetch_related('items__sku')
        .order_by('created_at', 'offer_id')
    )


def combo_offer_quotes(site, prices, available=None):
    """Describe currently redeemable combos using this store's live prices."""
    available_by_sku = (
        {str(sku_id): int(qty) for sku_id, qty in available.items()}
        if available is not None else None
    )
    quotes = []
    for offer in active_combo_offers(site):
        lines = list(offer.items.all())
        if not lines:
            continue
        components = []
        regular_price = Decimal('0.00')
        eligible = True
        for item in lines:
            sku_id = str(item.sku_id)
            price = prices.get(sku_id)
            if price is None or (available_by_sku is not None
                                 and available_by_sku.get(sku_id, 0) < item.quantity):
                eligible = False
                break
            regular_price += price * item.quantity
            components.append({
                'sku_id': sku_id,
                'name': item.sku.name,
                'quantity': item.quantity,
                'price': str(price),
                'image': item.sku.image_url or '',
            })
        savings = (regular_price - offer.fixed_price).quantize(CENT)
        if not eligible or savings <= 0:
            continue
        quotes.append({
            'offer_id': str(offer.offer_id),
            'title': offer.title,
            'description': offer.description,
            'fixed_price': str(offer.fixed_price),
            'regular_price': str(regular_price.quantize(CENT)),
            'savings': str(savings),
            'items': components,
        })
    return quotes


def calculate_combo_discounts(site, quantities, prices):
    """Apply non-overlapping active combos in descending savings order."""
    remaining = {str(sku_id): int(qty) for sku_id, qty in quantities.items()}
    candidates = []
    for offer in active_combo_offers(site):
        lines = list(offer.items.all())
        if not lines:
            continue
        regular_price = Decimal('0.00')
        valid = True
        for item in lines:
            price = prices.get(str(item.sku_id))
            if price is None:
                valid = False
                break
            regular_price += price * item.quantity
        savings = (regular_price - offer.fixed_price).quantize(CENT)
        if valid and savings > 0:
            candidates.append((savings, offer, lines))

    candidates.sort(key=lambda row: (-row[0], str(row[1].offer_id)))
    total = Decimal('0.00')
    applied = []
    for saving_per_combo, offer, lines in candidates:
        combo_count = min(
            remaining.get(str(item.sku_id), 0) // item.quantity
            for item in lines
        )
        if combo_count <= 0:
            continue
        for item in lines:
            sku_id = str(item.sku_id)
            remaining[sku_id] -= item.quantity * combo_count
        saving = (saving_per_combo * combo_count).quantize(CENT)
        total += saving
        applied.append({
            'offer_id': str(offer.offer_id),
            'title': offer.title,
            'quantity': combo_count,
            'discount': str(saving),
        })
    return total.quantize(CENT), applied
