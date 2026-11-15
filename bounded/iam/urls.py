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

    # Shared staff sign-in. One password, server-resolved facilities, one-time
    # code, revocable session. Web and mobile use the same sequence.
    path('auth/login', views.LoginAPIView.as_view(), name='login'),
    path('auth/shopper/register', views.ShopperRegisterView.as_view(), name='shopper-register'),
    path('auth/shopper/verify-email', views.ShopperVerifyEmailView.as_view(), name='shopper-verify-email'),
    path('auth/shopper/password-reset', views.ShopperPasswordResetRequestView.as_view(), name='shopper-password-reset'),
    path('auth/shopper/password-reset/confirm', views.ShopperPasswordResetConfirmView.as_view(), name='shopper-password-reset-confirm'),
    path('auth/facility', views.FacilitySelectView.as_view(), name='facility-select'),
    path('auth/otp/verify', views.OtpVerifyView.as_view(), name='otp-verify'),
    path('auth/otp/resend', views.OtpResendView.as_view(), name='otp-resend'),
    path('auth/daily-otp', views.DailyOtpView.as_view(), name='daily-otp'),
    path('auth/store-code', views.RotatingStoreOtpView.as_view(), name='store-code'),
    path('auth/dashboard', views.MyDashboardView.as_view(), name='my-dashboard'),
    path('auth/refresh', views.RefreshTokenView.as_view(), name='token-refresh'),
    path('auth/logout', views.LogoutView.as_view(), name='logout'),
    path('auth/me', views.MeAPIView.as_view(), name='me'),
    path('auth/facilities', views.FacilitiesView.as_view(), name='facilities'),
    path('auth/my-work', views.MyWorkView.as_view(), name='my-work'),
    path('auth/switch-facility', views.FacilitySwitchView.as_view(), name='facility-switch'),
    # Retired: per-facility reusable codes. Kept as an explicit 410 so old
    # clients fail loudly instead of treating a 404 as a transient error.
    path('auth/store-otp', views.StoreOtpView.as_view(), name='store-otp'),
]
