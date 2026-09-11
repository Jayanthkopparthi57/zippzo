from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet, ReasonCodeViewSet
from .auth_views import SendOtpView, VerifyOtpView, CurrentUserView, LogoutView

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'reason-codes', ReasonCodeViewSet)

urlpatterns = [
    # Auth endpoints
    path('auth/send-code/', SendOtpView.as_view(), name='auth_send_code'),
    path('auth/verify-code/', VerifyOtpView.as_view(), name='auth_verify_code'),
    path('auth/me/', CurrentUserView.as_view(), name='auth_me'),
    path('auth/logout/', LogoutView.as_view(), name='auth_logout'),

    # REST API
    path('', include(router.urls)),
]
