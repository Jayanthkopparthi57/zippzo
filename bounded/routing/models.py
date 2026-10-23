import uuid
from django.db import models


class DeliveryArea(models.Model):
    """One pincode a store promises to deliver to.

    A quick-commerce store does not serve a whole city: it serves the handful
    of pincodes its riders can reach inside the promise window. Keeping that
    list as rows (rather than a free-text field on Site) is what lets checkout
    decide *before* taking an order whether the address is even reachable, and
    lets the admin panel add or withdraw a pincode without touching a site.

    Stores with no rows at all are deliberately treated as "not configured":
    checkout stays permissive so a fresh estate is never blocked on admin work
    nobody has done yet. The moment a store has one active area, that list is
    the contract.
    """

    BAND_CHOICES = [
        ('CORE', 'Core'),
        ('STANDARD', 'Standard'),
        ('EXTENDED', 'Extended'),
    ]

    area_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE,
                             related_name='delivery_areas')
    pincode = models.CharField(max_length=6)
    band = models.CharField(max_length=20, choices=BAND_CHOICES, default='CORE')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'delivery_areas'
        unique_together = [('site', 'pincode')]
        ordering = ['site__code', 'pincode']
        indexes = [models.Index(fields=['pincode', 'is_active'],
                                name='ix_delivery_area_pincode')]

    def __str__(self):
        return f'{self.site.code}:{self.pincode}'

    @staticmethod
    def configured(site):
        """Whether this store has opted into pincode coverage at all."""
        if site is None:
            return False
        return DeliveryArea.objects.filter(
            site_id=getattr(site, 'site_id', None), is_active=True).exists()

    @staticmethod
    def covers(site, pincode):
        """Can this store deliver to this pincode?

        True when the store has no active areas (unconfigured stays permissive),
        otherwise only for a pincode explicitly listed for it.
        """
        if not DeliveryArea.configured(site):
            return True
        pincode = (pincode or '').strip()
        if not pincode:
            return False
        return DeliveryArea.objects.filter(
            site_id=getattr(site, 'site_id', None),
            pincode=pincode, is_active=True).exists()

    @staticmethod
    def sites_for(pincode):
        """The stores that list this pincode, best band first."""
        rank = {'CORE': 0, 'STANDARD': 1, 'EXTENDED': 2}
        rows = (DeliveryArea.objects
                .filter(pincode=(pincode or '').strip(), is_active=True)
                .select_related('site')
                .order_by('band', 'site__code'))
        rows = sorted(rows, key=lambda r: (rank.get(r.band, 9), r.site.code))
        return rows


class Serviceability(models.Model):
    service_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='serviceability')
    band = models.CharField(max_length=20)
    day_of_week = models.PositiveSmallIntegerField()
    start_hour = models.PositiveSmallIntegerField()
    end_hour = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    class Meta:
        db_table = 'serviceability'


class RoutingDecision(models.Model):
    decision_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_id = models.UUIDField()
    source_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='routing_source')
    dest_site = models.ForeignKey('network.Site', on_delete=models.CASCADE, related_name='routing_dest')
    eta_minutes = models.PositiveIntegerField()
    distance_m = models.PositiveIntegerField()
    vehicle_type = models.CharField(max_length=20, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = 'routing_decisions'
        ordering = ['-created_at']
