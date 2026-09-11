from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet, ReasonCodeViewSet
from .auth_views import RegisterView, LoginView, CurrentUserView, LogoutView

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'reason-codes', ReasonCodeViewSet)

urlpatterns = [
    # Auth endpoints
    path('auth/register/', RegisterView.as_view(), name='auth_register'),
    path('auth/login/', LoginView.as_view(), name='auth_login'),
    path('auth/me/', CurrentUserView.as_view(), name='auth_me'),
    path('auth/logout/', LogoutView.as_view(), name='auth_logout'),

    # REST API
    path('', include(router.urls)),
]
