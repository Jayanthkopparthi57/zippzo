from rest_framework import viewsets
from .models import Serviceability, RoutingDecision
from .serializers import ServiceabilitySerializer, RoutingDecisionSerializer

class ServiceabilityViewSet(viewsets.ModelViewSet):
    queryset = Serviceability.objects.all()
    serializer_class = ServiceabilitySerializer
    filterset_fields = ['site','band','day_of_week']

class RoutingDecisionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RoutingDecision.objects.all()
    serializer_class = RoutingDecisionSerializer
