from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'users', views.UserViewSet)
router.register(r'sessions', views.SessionViewSet)
router.register(r'roles', views.RoleViewSet)
router.register(r'devices', views.DeviceViewSet)
router.register(r'qrcodes', views.QRCodeViewSet)
router.register(r'idempotency', views.IdempotencyKeyViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login', views.LoginAPIView.as_view(), name='login'),
]
