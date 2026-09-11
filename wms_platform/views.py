from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from .models import User, ReasonCode
from .serializers import UserSerializer, ReasonCodeSerializer


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['role', 'status', 'site_id']
    search_fields = ['name', 'emp_code', 'phone']
    ordering_fields = ['name', 'created_at']


class ReasonCodeViewSet(viewsets.ModelViewSet):
    queryset = ReasonCode.objects.all()
    serializer_class = ReasonCodeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category']
    search_fields = ['code', 'description']
