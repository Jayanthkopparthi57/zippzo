# Holds Views
from rest_framework import viewsets
from .models import Hold
from .serializers import HoldSerializer

class HoldViewSet(viewsets.ModelViewSet):
    queryset = Hold.objects.all()
    serializer_class = HoldSerializer
    filterset_fields = ['site', 'status']
