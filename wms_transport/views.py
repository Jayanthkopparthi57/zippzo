from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import Trip, VehicleCheckin, TripReturnLeg
from .serializers import TripSerializer, VehicleCheckinSerializer, TripReturnLegSerializer


class TripViewSet(viewsets.ModelViewSet):
    queryset = Trip.objects.select_related('site', 'vehicle_type', 'transporter').all()
    serializer_class = TripSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'direction', 'site', 'delay_status', 'gps_status', 'billing_status']
    search_fields = ['trip_no', 'vehicle_no', 'driver_name', 'dest_site']
    ordering_fields = ['trip_date', 'created_at']


class VehicleCheckinViewSet(viewsets.ModelViewSet):
    queryset = VehicleCheckin.objects.select_related('trip', 'asn').all()
    serializer_class = VehicleCheckinSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['direction', 'trip', 'delay_status']
    search_fields = ['vehicle_no', 'driver_name', 'security_person']


class TripReturnLegViewSet(viewsets.ModelViewSet):
    queryset = TripReturnLeg.objects.select_related('trip').all()
    serializer_class = TripReturnLegSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'trip']
