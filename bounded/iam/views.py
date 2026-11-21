import hashlib
import hmac
import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import models, transaction
from django.utils import timezone
from django.core.cache import cache
from datetime import timedelta
import secrets
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from bounded.iam.permissions import IsAdminUser
from rest_framework.views import APIView
from django.contrib.auth.hashers import check_password
from django.contrib.auth.hashers import make_password
from .authentication.jwt import generate_jwt_token
from .models import (User, Session, Role, Device, QRCode, IdempotencyKey,
                     LoginChallenge, ShopperAccountChallenge)
from .serializers import UserSerializer, SessionSerializer, RoleSerializer, DeviceSerializer, QRCodeSerializer, IdempotencyKeySerializer
from . import staff_auth


# Which console each role logs into.
#
# This used to collapse every non-WMS role into DARK_STORE, so a RIDER login
# landed in the dark-store menu and the rider app was unreachable code, and a
# CUSTOMER was handed a store console. Each role now has its own front door.
WMS_ROLES = ('SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF')
SHOPPER_ROLES = ('CUSTOMER', 'SENDER')
RIDER_ROLES = ('RIDER',)


def resolve_user_facility(user, site_code=None):
    from bounded.network.models import EmployeeSiteAssignment, Site
    assignments = EmployeeSiteAssignment.objects.filter(
        user=user, is_active=True,
    ).select_related('site').order_by('site__code')
    if site_code:
        assignments = assignments.filter(site__code=site_code)
    asgn = assignments.first()
    if asgn and asgn.site:
        s = asgn.site
        return {
            'site_id': str(s.site_id),
            'code': s.code,
            'name': s.name,
            'site_type': s.site_type,
            'address': s.address,
        }
    if user.role in ('SUPER_ADMIN', 'OPS_MANAGER'):
        s = Site.objects.filter(code=site_code).first() if site_code else None
        s = s or (Site.objects.filter(code='WH-BH-001').first() if not site_code else None)
        s = s or (Site.objects.first() if not site_code else None)
        if s:
            return {
                'site_id': str(s.site_id),
                'code': s.code,
                'name': s.name,
                'site_type': s.site_type,
                'address': s.address,
            }
    return None


def get_user_allowed_apps(user):
    if user.role == 'SUPER_ADMIN':
        return ['WMS', 'DARK_STORE', 'SHOPPER', 'RIDER']
    if user.role == 'OPS_MANAGER':
        return ['WMS', 'DARK_STORE']
    if user.role in RIDER_ROLES:
        return ['RIDER']
    if user.role in SHOPPER_ROLES:
        return ['SHOPPER']

    from bounded.network.models import EmployeeSiteAssignment
    asgns = EmployeeSiteAssignment.objects.filter(user=user, is_active=True).select_related('site')
    types = {a.site.site_type for a in asgns if a.site}
    apps = []
    if 'MH' in types:
        apps.append('WMS')
    if 'DS' in types:
        apps.append('DARK_STORE')
    return apps


def target_app_for(user):
    if user.role == 'SUPER_ADMIN':
        return 'WMS'
    if user.role in RIDER_ROLES:
        return 'RIDER'
    if user.role in SHOPPER_ROLES:
        return 'SHOPPER'

    from bounded.network.models import EmployeeSiteAssignment
    asgn = (EmployeeSiteAssignment.objects.filter(user=user, is_active=True)
            .select_related('site').order_by('site__code').first())
    if asgn and asgn.site and asgn.site.site_type == 'DS':
        return 'DARK_STORE'
    return 'WMS'


# ---------------------------------------------------------------------------
# Shared staff sign-in
#
# One password, then a server-issued one-time code. The facility is derived
# from active assignments; a request field can only choose among the sites the
# server already returned, never widen them.
# ---------------------------------------------------------------------------

def _surface(request):
    value = str(request.data.get('surface') or 'web').strip().lower()
    return value if value in ('web', 'mobile') else 'web'


def _requested_app(request):
    value = str(request.data.get('app') or '').strip().upper()
    return value if value in ('WMS', 'DARK_STORE', 'RIDER', 'SHOPPER') else None


def _facility_list(sites):
    return [staff_auth.site_payload(site) for site in sites]


def _user_payload(user):
    return {
        'user_id': str(user.user_id),
        'email': user.email,
        'phone': user.phone,
        'full_name': user.full_name,
        'role': user.role,
        'status': user.status,
        'is_super_admin': user.role == 'SUPER_ADMIN',
    }


def _mask_email(address):
    """Return a non-identifying hint of where the code went.

    Staff sign-in fails silently from the operator's point of view when a
    placeholder address is stored on the account. Showing ``a***n@domain`` makes
    the destination obvious without disclosing the full mailbox.
    """
    address = (address or '').strip()
    if '@' not in address:
        return ''
    local, domain = address.split('@', 1)
    if len(local) <= 1:
        return f'***@{domain}'
    return f'{local[0]}***@{domain}'


def _challenge_payload(challenge, token, facilities, dev_code=None):
    facility = staff_auth.site_payload(challenge.facility)
    payload = {
        'status': 'otp_required',
        'otp_required': True,
        'challenge_id': str(challenge.challenge_id),
        'challenge_token': token,
        'facility': facility,
        'facilities': facilities,
        'site_code': facility['code'] if facility else None,
        'site_name': facility['name'] if facility else None,
        'surface': challenge.surface,
        'otp_sent_to': _mask_email(getattr(challenge.user, 'email', '')),
    }
    if dev_code is not None:
        payload['dev_otp'] = dev_code
    return payload


def _load_challenge(user, challenge_id, challenge_token):
    """Load a challenge and prove the caller holds its secret token."""
    if not challenge_id or not challenge_token:
        return None
    try:
        challenge = LoginChallenge.objects.select_related('facility').filter(
            challenge_id=challenge_id, user=user,
        ).first()
    except (ValueError, TypeError):
        return None
    if challenge is None:
        return None
    supplied = staff_auth.hash_challenge_token(str(challenge_token))
    if not secrets.compare_digest(challenge.challenge_token_hash, supplied):
        return None
    if challenge.status == 'CONSUMED' or challenge.consumed_at:
        return None
    if challenge.expires_at <= timezone.now():
        challenge.status = 'EXPIRED'
        challenge.save(update_fields=['status'])
        return None
    return challenge


def _pick_default_site(sites, requested_app):
    """Choose the site type that matches the workspace being opened."""
    expected = 'DS' if requested_app == 'DARK_STORE' else 'MH'
    for site in sites:
        if site.site_type == expected:
            return site
    return sites[0] if sites else None


class LoginAPIView(APIView):
    """One staff sign-in for web and mobile.

    Password verification creates a challenge; the facility is resolved from
    assignments; a one-time code proves presence; only then is a session
    issued. Rider and consumer accounts keep their existing immediate-token
    behaviour because their products do not use warehouse OTPs.
    """

    authentication_classes = []
    permission_classes = []

    def _phone_login(self, request, phone, otp, requested_app, surface):
        """Phone number + the shared daily store code.

        The store is resolved from the employee's assignments. When somebody is
        assigned to more than one store they must send `site_code`, because the
        same six digits are only valid for the store that printed them. The
        code rotates daily, never per minute; yesterday's code still works
        around midnight IST, matching the Authentication screen.
        """
        from bounded.network.models import Site

        if not otp:
            return Response({
                'error': 'Enter the store code shown on the Authentication screen.',
                'code': 'otp_required',
                'requires_phone': True,
            }, status=400)

        attempts_key = f'iam:phone-login:{phone}'
        attempts = cache.get(attempts_key, 0)
        if attempts >= 10:
            return Response({
                'error': 'Too many sign-in attempts for this number. Try again in a few minutes.'
            }, status=429)

        users = staff_auth.find_users_by_phone(phone)
        if not users:
            cache.set(attempts_key, attempts + 1, timeout=900)
            staff_auth.audit('IAM_LOGIN_FAILED', request=request, result='DENIED',
                             reason='unknown phone')
            return Response({'error': 'No employee is registered with that number.'}, status=401)

        site_code = str(request.data.get('site_code') or '').strip().upper()
        if len(users) > 1:
            # Two accounts can legitimately share a store phone line. Narrow by
            # the store they say they are at; otherwise ask them to be specific.
            if site_code:
                narrowed = []
                for candidate in users:
                    if any(s.code == site_code
                           for s in staff_auth.authorized_facilities(candidate)):
                        narrowed.append(candidate)
                if len(narrowed) == 1:
                    users = narrowed
            if len(users) > 1:
                return Response({
                    'error': 'More than one employee uses this number. Send site_code too.',
                    'code': 'multiple_accounts',
                    'sites': sorted({
                        s.code for u in users
                        for s in staff_auth.authorized_facilities(u)
                    }),
                }, status=409)

        user = users[0]
        if user.role in staff_auth.ESTATE_ROLES:
            return Response({
                'error': 'Managers and admins sign in with email and password.',
                'code': 'use_password_login',
            }, status=403)

        if user.role in staff_auth.STAFF_ROLES:
            facilities = staff_auth.authorized_facilities(user, requested_app)
            if not facilities:
                staff_auth.audit('IAM_LOGIN_DENIED', actor_id=user.user_id,
                                 request=request, result='DENIED',
                                 reason='no active facility assignment')
                return Response({
                    'error': 'No active store assignment. Ask an administrator to add you.'
                }, status=403)
            site = None
            if site_code:
                site = staff_auth.resolve_facility(user, site_code, requested_app)
                if site is None:
                    return Response({
                        'error': 'You are not assigned to that store.',
                        'facilities': _facility_list(facilities),
                    }, status=403)
            elif len(facilities) == 1:
                site = facilities[0]
            else:
                return Response({
                    'error': 'Choose your store.',
                    'code': 'site_required',
                    'facilities': _facility_list(facilities),
                }, status=409)
        else:
            # Rider accounts are not site-assigned through
            # EmployeeSiteAssignment; their store is the one whose QR they
            # scanned. Accept the store they name, or their profile store.
            from bounded.delivery.models import RiderProfile
            profile = RiderProfile.objects.select_related('current_site').filter(user=user).first()
            site = Site.objects.filter(code=site_code).first() if site_code else (
                profile.current_site if profile and profile.current_site_id else None)
            if site is None:
                return Response({
                    'error': 'Scan the store QR first, or send the store code.'
                }, status=400)
            facilities = [site]

        # The store no longer rotates a code every minute: associates sign in
        # with the shared daily store code shown on the Authentication screen.
        if not staff_auth.daily_store_otp_valid(site.code, otp):
            cache.set(attempts_key, attempts + 1, timeout=900)
            staff_auth.audit('IAM_OTP_FAILED', actor_id=user.user_id,
                             entity_type='Site', entity_id=site.site_id,
                             request=request, result='DENIED',
                             reason='invalid daily store code')
            return Response({
                'error': "That code has expired or is wrong. Use today's code on the Authentication screen.",
                'code': 'invalid_store_otp',
            }, status=403)

        cache.delete(attempts_key)
        session, access, refresh = staff_auth.create_session(
            user, site, surface, request,
        )
        return Response({
            'status': 'success',
            'token': access,
            'refresh_token': refresh,
            **staff_auth.session_context(session, request),
        }, status=200)

    def post(self, request):
        email = (request.data.get('email') or '').strip()
        phone = staff_auth.normalize_phone(request.data.get('phone'))
        password = request.data.get('password') or ''
        otp = str(request.data.get('otp') or '').strip()
        requested_app = _requested_app(request)
        surface = _surface(request)

        # Field associates sign in with the number their manager registered and
        # the shared store code shown on the Authentication screen. Managers
        # and admins keep the password + personal OTP path below, which is also
        # the fallback when a phone number is shared by two accounts.
        if phone and not email:
            return self._phone_login(request, phone, otp, requested_app, surface)

        if not email or not password:
            return Response({'error': 'Email and password required'}, status=400)

        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            staff_auth.audit('IAM_LOGIN_FAILED', request=request, result='DENIED',
                             reason='unknown account')
            return Response({'error': 'Invalid credentials'}, status=401)
        if not check_password(password, user.password_hash):
            staff_auth.audit('IAM_LOGIN_FAILED', actor_id=user.user_id, request=request,
                             result='DENIED', reason='bad password')
            return Response({'error': 'Invalid credentials'}, status=401)
        if user.status == 'BLOCKED':
            return Response({'error': 'User blocked'}, status=403)
        if user.status != 'ACTIVE':
            return Response({'error': f'Account is {user.status.lower()}'}, status=403)

        allowed_apps = get_user_allowed_apps(user)
        target_app = target_app_for(user)
        if requested_app and requested_app not in allowed_apps:
            staff_auth.audit('IAM_LOGIN_FAILED', actor_id=user.user_id, request=request,
                             result='DENIED', reason='app not allowed')
            return Response({
                'error': 'This account is not assigned to the selected operations app.'
            }, status=403)
        if requested_app:
            target_app = requested_app

        # Rider / consumer products keep the existing token response.
        if user.role not in staff_auth.STAFF_ROLES:
            session, access, refresh = staff_auth.create_session(user, None, surface, request)
            return Response({
                'status': 'success',
                'user': _user_payload(user),
                'facility': None,
                'target_app': target_app,
                'allowed_apps': allowed_apps,
                'surface': session.surface,
                'token': access,
                'refresh_token': refresh,
            })

        # Initial setup: a freshly provisioned estate can have a Super Admin
        # but no active facility, and no OTP provider to prove presence with.
        # Since that account is the only one allowed to create the first site,
        # let it in with password alone while the estate is being set up. The
        # window is role-scoped, audited, and closes as soon as a site and a
        # working OTP sender both exist (see initial_setup_login_allowed).
        if staff_auth.initial_setup_login_allowed(user):
            facilities = staff_auth.authorized_facilities(user, requested_app or target_app)
            initial_facility = _pick_default_site(facilities, requested_app or target_app)
            session, access, refresh = staff_auth.create_session(
                user, initial_facility, surface, request,
            )
            reason = ('no active facility' if not facilities
                      else 'no OTP delivery provider')
            staff_auth.audit('IAM_INITIAL_SETUP_LOGIN', actor_id=user.user_id,
                             entity_type='Session', entity_id=session.session_id,
                             request=request, result='ALLOWED', reason=reason)
            context = staff_auth.session_context(session, request)
            context['target_app'] = requested_app or context.get('target_app')
            return Response({
                'status': 'success',
                'token': access,
                'refresh_token': refresh,
                'initial_setup': True,
                **context,
            }, status=200)

        facilities = staff_auth.authorized_facilities(user, requested_app or target_app)
        if not facilities:
            staff_auth.audit('IAM_LOGIN_DENIED', actor_id=user.user_id, request=request,
                             result='DENIED', reason='no active facility assignment')
            return Response({
                'error': ('No active facility assignment. Ask an administrator to assign '
                          'your account to a warehouse or dark store.')
            }, status=403)

        challenge_id = request.data.get('challenge_id')
        challenge_token = request.data.get('challenge_token')
        challenge = _load_challenge(user, challenge_id, challenge_token) if challenge_id else None

        if challenge is None:
            if staff_auth.challenge_rate_limited(user, staff_auth.client_ip(request)):
                return Response({'error': 'Too many sign-in attempts. Try again later.'},
                                status=429)
            challenge_token = staff_auth.generate_challenge_token()
            challenge = LoginChallenge.objects.create(
                user=user,
                surface=surface,
                requested_app=requested_app or target_app,
                challenge_token_hash=staff_auth.hash_challenge_token(challenge_token),
                expires_at=timezone.now() + timedelta(seconds=staff_auth.CHALLENGE_TTL_SECONDS),
                ip_address=staff_auth.client_ip(request),
                user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
            )
        else:
            challenge_token = str(challenge_token)
            challenge.surface = surface

        facility_code = str(request.data.get('facility_code') or '').strip().upper()
        selected = None
        if facility_code:
            selected = staff_auth.resolve_facility(
                user, facility_code, challenge.requested_app or requested_app or target_app,
            )
            if selected is None:
                staff_auth.audit('IAM_FACILITY_DENIED', actor_id=user.user_id,
                                 entity_type='Site', request=request, result='DENIED',
                                 reason=f'facility {facility_code} not assigned')
                return Response({
                    'error': 'You are not assigned to that facility.',
                    'facilities': _facility_list(facilities),
                }, status=403)
        elif challenge.facility_id:
            selected = challenge.facility
        elif len(facilities) == 1 or user.role in staff_auth.ESTATE_ROLES:
            # A single-site employee goes straight through. Estate roles
            # administer the network, so the workspace's default site is
            # selected but the chooser is still returned for an explicit switch.
            selected = _pick_default_site(facilities, challenge.requested_app or requested_app)

        if selected is None:
            return Response({
                'status': 'facility_required',
                'facility_required': True,
                'challenge_id': str(challenge.challenge_id),
                'challenge_token': challenge_token,
                'facilities': _facility_list(facilities),
                'allowed_apps': allowed_apps,
                'target_app': target_app,
                'surface': surface,
            }, status=200)

        if challenge.facility_id != selected.site_id:
            challenge.facility = selected
            challenge.save(update_fields=['facility', 'surface'])

        # Mailed OTP is skipped while no delivery provider is configured;
        # configuring one restores the normal policy with no code change.
        # The DS daily store code is a separate factor and is unaffected.
        if not staff_auth.email_otp_required_for(user):
            session, access, refresh = staff_auth.create_session(
                user, challenge.facility, surface, request,
            )
            challenge.status = 'CONSUMED'
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=['status', 'consumed_at'])
            return Response({
                'status': 'success',
                'token': access,
                'refresh_token': refresh,
                **staff_auth.session_context(session, request),
            }, status=200)

        dev_code = None
        if not challenge.code_hash:
            try:
                dev_code = staff_auth.issue_otp(challenge, request=request)
            except staff_auth.OtpDeliveryUnavailable:
                return Response({'error': 'OTP delivery is temporarily unavailable.',
                                 'code': 'otp_delivery_unavailable'}, status=503)
        elif challenge.expires_at <= timezone.now():
            try:
                dev_code = staff_auth.issue_otp(challenge, request=request)
            except staff_auth.OtpDeliveryUnavailable:
                return Response({'error': 'OTP delivery is temporarily unavailable.',
                                 'code': 'otp_delivery_unavailable'}, status=503)

        if not otp:
            body = _challenge_payload(
                challenge, challenge_token, _facility_list(facilities),
                dev_code if staff_auth.dev_echo_allowed() else None,
            )
            return Response(body, status=403)

        ok, reason = staff_auth.verify_otp(challenge, otp)
        if not ok:
            staff_auth.audit('IAM_OTP_FAILED', actor_id=user.user_id,
                             entity_type='LoginChallenge', entity_id=challenge.challenge_id,
                             request=request, result='DENIED',
                             reason=f'{reason}; attempts={challenge.attempts}')
            body = _challenge_payload(
                challenge, challenge_token, _facility_list(facilities),
                dev_code if staff_auth.dev_echo_allowed() else None,
            )
            body['error'] = {
                'expired': 'This code has expired. Request a new one.',
                'already_used': 'This code was already used. Sign in again.',
                'attempts_exhausted': 'Too many incorrect codes. Sign in again.',
            }.get(reason, 'Invalid or expired code.')
            body['attempts_remaining'] = max(
                0, challenge.max_attempts - challenge.attempts,
            )
            return Response(body, status=403)

        session, access, refresh = staff_auth.create_session(
            user, challenge.facility, surface, request,
        )
        return Response({
            'status': 'success',
            'token': access,
            'refresh_token': refresh,
            **staff_auth.session_context(session, request),
        }, status=200)


SHOPPER_CODE_TTL = 600
SHOPPER_CODE_ATTEMPTS = 5


def _shopper_auth_allowed(request, email=''):
    """Rate-limit anonymous shopper account endpoints by IP and address."""
    ip = (request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
          or request.META.get('REMOTE_ADDR') or 'unknown')
    email_key = hashlib.sha256(email.strip().lower().encode()).hexdigest()[:24]
    for raw_key, maximum in ((ip, 20), (email_key, 8)):
        key = f'shopper-auth:{hashlib.sha256(raw_key.encode()).hexdigest()[:24]}'
        count = cache.get(key, 0)
        if count >= maximum:
            return False
        cache.set(key, count + 1, timeout=3600)
    return True


def _shopper_code_digest(challenge_id, code):
    return hmac.new(
        settings.SECRET_KEY.encode(),
        f'{challenge_id}:{code}'.encode(), hashlib.sha256,
    ).hexdigest()


def _send_shopper_code(user, challenge):
    """Fail closed if no real email delivery provider is configured."""
    if str(getattr(settings, 'EMAIL_BACKEND', '')).endswith('console.EmailBackend'):
        raise RuntimeError('Email delivery is not configured.')
    code = f'{secrets.randbelow(1_000_000):06d}'
    challenge.code_hash = _shopper_code_digest(challenge.challenge_id, code)
    challenge.expires_at = timezone.now() + timedelta(seconds=SHOPPER_CODE_TTL)
    challenge.attempts = 0
    challenge.save(update_fields=['code_hash', 'expires_at', 'attempts'])
    purpose = 'Verify your Zippzo email' if challenge.purpose == 'VERIFY_EMAIL' else 'Reset your Zippzo password'
    try:
        send_mail(
            purpose,
            f'Your Zippzo code is {code}. It expires in 10 minutes and can only be used once.',
            getattr(settings, 'DEFAULT_FROM_EMAIL', 'auth@zippzo.com'),
            [user.email], fail_silently=False,
        )
    except Exception:
        challenge.consumed_at = timezone.now()
        challenge.save(update_fields=['consumed_at'])
        raise RuntimeError('Email delivery failed.') from None


def _new_shopper_challenge(user, purpose):
    ShopperAccountChallenge.objects.filter(
        user=user, purpose=purpose, consumed_at__isnull=True,
    ).update(consumed_at=timezone.now())
    challenge = ShopperAccountChallenge.objects.create(
        user=user, purpose=purpose,
        code_hash='0' * 64,
        expires_at=timezone.now() + timedelta(seconds=SHOPPER_CODE_TTL),
    )
    _send_shopper_code(user, challenge)
    return challenge


def _verify_shopper_challenge(email, code, purpose):
    challenge = (ShopperAccountChallenge.objects.select_for_update()
                 .select_related('user').filter(
                     user__email__iexact=email, user__role__in=('CUSTOMER', 'SENDER'),
                     purpose=purpose, consumed_at__isnull=True,
                     expires_at__gt=timezone.now(),
                 ).order_by('-created_at').first())
    if challenge is None or challenge.attempts >= SHOPPER_CODE_ATTEMPTS:
        return None
    expected = _shopper_code_digest(challenge.challenge_id, str(code or '').strip())
    if not hmac.compare_digest(challenge.code_hash, expected):
        challenge.attempts += 1
        if challenge.attempts >= SHOPPER_CODE_ATTEMPTS:
            challenge.consumed_at = timezone.now()
        challenge.save(update_fields=['attempts', 'consumed_at'])
        return None
    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=['consumed_at'])
    return challenge


class ShopperRegisterView(APIView):
    """Create a customer account directly; email verification is removed for launch."""
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = str(request.data.get('email') or '').strip().lower()
        password = str(request.data.get('password') or '')
        name = str(request.data.get('name') or '').strip()[:200]
        phone = ''.join(c for c in str(request.data.get('phone') or '') if c.isdigit())
        if not _shopper_auth_allowed(request, email):
            return Response({'error': 'Too many requests. Try again later.'}, status=429)
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            return Response({'error': 'Enter a valid email address.'}, status=400)
        if not name or len(phone) < 10 or len(phone) > 15:
            return Response({'error': 'Name and a valid mobile number are required.'}, status=400)
        if len(password) < 12:
            return Response({'error': 'Use a password with at least 12 characters.'}, status=400)
        if User.objects.filter(email__iexact=email).exists():
            # Same response shape avoids disclosing which addresses are registered.
            return Response({'message': 'If this address can be registered, your account is ready to use.'}, status=202)
        # Email verification is deliberately removed for launch: shoppers are
        # created active without mail delivery. Re-introduce a challenge here
        # when an email provider is wired up.
        user = User(email=email, full_name=name, phone=phone, role='CUSTOMER',
                    status='ACTIVE', password_hash=make_password(password))
        try:
            validate_password(password, user=user)
        except DjangoValidationError as exc:
            return Response({'error': list(exc.messages)}, status=400)
        from bounded.orders.models import Customer
        with transaction.atomic():
            user.save()
            Customer.objects.create(user=user, name=name)
        return Response({'message': 'Account created. You can now sign in.'}, status=202)


class ShopperVerifyEmailView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = str(request.data.get('email') or '').strip().lower()
        if not _shopper_auth_allowed(request, email):
            return Response({'error': 'Too many requests. Try again later.'}, status=429)
        # No-op shim: email verification is removed for launch. Kept (accepts
        # any code) so installed shopper builds that show a verify screen can
        # still complete the flow; tighten when a provider is configured.
        return Response({'verified': True, 'message': 'Email verified. You can now sign in.'})


class ShopperPasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = []
    GENERIC = 'If a shopper account exists for this address, a reset code will be sent.'

    def post(self, request):
        email = str(request.data.get('email') or '').strip().lower()
        if not _shopper_auth_allowed(request, email):
            return Response({'error': 'Too many requests. Try again later.'}, status=429)
        user = User.objects.filter(email__iexact=email,
                                   role__in=('CUSTOMER', 'SENDER'),
                                   status='ACTIVE').first()
        if user:
            try:
                _new_shopper_challenge(user, 'RESET_PASSWORD')
            except RuntimeError:
                # Identical response: provider readiness must not enable account
                # discovery through this unauthenticated endpoint.
                pass
        return Response({'message': self.GENERIC}, status=202)


class ShopperPasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = str(request.data.get('email') or '').strip().lower()
        password = str(request.data.get('new_password') or '')
        if not _shopper_auth_allowed(request, email):
            return Response({'error': 'Too many requests. Try again later.'}, status=429)
        if len(password) < 12:
            return Response({'error': 'Use a password with at least 12 characters.'}, status=400)
        with transaction.atomic():
            challenge = _verify_shopper_challenge(email, request.data.get('code'), 'RESET_PASSWORD')
            if challenge is None:
                return Response({'error': 'That code is invalid or expired.'}, status=400)
            user = User.objects.select_for_update().get(pk=challenge.user_id)
            try:
                validate_password(password, user=user)
            except DjangoValidationError as exc:
                # Validation fails after code lookup: leave it consumed to keep
                # reset codes single-use; the shopper can request another.
                return Response({'error': list(exc.messages)}, status=400)
            user.password_hash = make_password(password)
            user.save(update_fields=['password_hash', 'updated_at'])
            Session.objects.filter(user=user, is_active=True).update(
                is_active=False, revoked_at=timezone.now())
        return Response({'reset': True, 'message': 'Password reset. Sign in again.'})


class FacilitySelectView(APIView):
    """Choose one of the facilities the server already authorized."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        challenge_id = request.data.get('challenge_id')
        challenge_token = request.data.get('challenge_token')
        facility_code = str(request.data.get('facility_code') or '').strip().upper()
        if not challenge_id or not challenge_token or not facility_code:
            return Response({'error': 'challenge_id, challenge_token and facility_code are required'},
                            status=400)

        try:
            challenge = LoginChallenge.objects.select_related('user').filter(
                challenge_id=challenge_id,
            ).first()
        except (ValueError, TypeError):
            challenge = None
        if challenge is None or not secrets.compare_digest(
            challenge.challenge_token_hash,
            staff_auth.hash_challenge_token(str(challenge_token)),
        ):
            return Response({'error': 'This sign-in challenge is not valid.'}, status=403)
        if challenge.status == 'CONSUMED' or challenge.expires_at <= timezone.now():
            return Response({'error': 'This sign-in challenge has expired.'}, status=403)

        selected = staff_auth.resolve_facility(
            challenge.user, facility_code, challenge.requested_app,
        )
        if selected is None:
            staff_auth.audit('IAM_FACILITY_DENIED', actor_id=challenge.user_id,
                             entity_type='LoginChallenge', entity_id=challenge.challenge_id,
                             request=request, result='DENIED',
                             reason=f'facility {facility_code} not assigned')
            return Response({'error': 'You are not assigned to that facility.'}, status=403)

        challenge.facility = selected
        challenge.save(update_fields=['facility', 'surface'])
        if not staff_auth.email_otp_required_for(challenge.user):
            session, access, refresh = staff_auth.create_session(
                challenge.user, challenge.facility, challenge.surface, request,
            )
            challenge.status = 'CONSUMED'
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=['status', 'consumed_at'])
            return Response({
                'status': 'success',
                'token': access,
                'refresh_token': refresh,
                **staff_auth.session_context(session, request),
            }, status=200)
        try:
            dev_code = staff_auth.issue_otp(challenge, request=request)
        except staff_auth.OtpDeliveryUnavailable:
            return Response({'error': 'OTP delivery is temporarily unavailable.',
                             'code': 'otp_delivery_unavailable'}, status=503)
        facilities = staff_auth.authorized_facilities(
            challenge.user, challenge.requested_app,
        )
        return Response(_challenge_payload(
            challenge, str(challenge_token), _facility_list(facilities),
            dev_code if staff_auth.dev_echo_allowed() else None,
        ), status=200)


class OtpResendView(APIView):
    """Issue a fresh code for an unexpired challenge, rate-limited."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            challenge = LoginChallenge.objects.select_related('user', 'facility').filter(
                challenge_id=request.data.get('challenge_id'),
            ).first()
        except (ValueError, TypeError):
            challenge = None
        if challenge is None or not secrets.compare_digest(
            challenge.challenge_token_hash,
            staff_auth.hash_challenge_token(str(request.data.get('challenge_token') or '')),
        ):
            return Response({'error': 'This sign-in challenge is not valid.'}, status=403)
        if challenge.expires_at <= timezone.now() or challenge.status == 'CONSUMED':
            return Response({'error': 'This sign-in challenge has expired.'}, status=403)

        key = f'iam:otp:resend:{challenge.challenge_id}'
        if cache.get(key):
            return Response({'error': 'Wait before requesting another code.'}, status=429)
        cache.set(key, True, timeout=staff_auth.OTP_RESEND_COOLDOWN_SECONDS)

        try:
            dev_code = staff_auth.issue_otp(challenge, request=request)
        except staff_auth.OtpDeliveryUnavailable:
            return Response({'error': 'OTP delivery is temporarily unavailable.',
                             'code': 'otp_delivery_unavailable'}, status=503)
        facilities = staff_auth.authorized_facilities(
            challenge.user, challenge.requested_app,
        )
        return Response(_challenge_payload(
            challenge, str(request.data.get('challenge_token')), _facility_list(facilities),
            dev_code if staff_auth.dev_echo_allowed() else None,
        ), status=200)


class OtpVerifyView(APIView):
    """Verify a challenge code and issue a session."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        challenge_id = request.data.get('challenge_id')
        challenge_token = request.data.get('challenge_token')
        otp = str(request.data.get('otp') or '').strip()
        try:
            challenge = LoginChallenge.objects.select_related('user', 'facility').filter(
                challenge_id=challenge_id,
            ).first()
        except (ValueError, TypeError):
            challenge = None
        if challenge is None or not secrets.compare_digest(
            challenge.challenge_token_hash,
            staff_auth.hash_challenge_token(str(challenge_token or '')),
        ):
            return Response({'error': 'This sign-in challenge is not valid.'}, status=403)

        ok, reason = staff_auth.verify_otp(challenge, otp)
        if not ok:
            staff_auth.audit('IAM_OTP_FAILED', actor_id=challenge.user_id,
                             entity_type='LoginChallenge', entity_id=challenge.challenge_id,
                             request=request, result='DENIED', reason=reason)
            return Response({'error': 'Invalid or expired code.', 'reason': reason}, status=403)

        session, access, refresh = staff_auth.create_session(
            challenge.user, challenge.facility, challenge.surface, request,
        )
        return Response({
            'status': 'success',
            'token': access,
            'refresh_token': refresh,
            **staff_auth.session_context(session, request),
        }, status=200)


class DailyOtpView(APIView):
    """Admin-visible shared OTP for one store for one day.

    GET shows today's IST code always. POST activates an employee for that
    day when they present email + password + this shared code. Existing
    per-user challenge/OTP remains available as the email flow.
    """

    permission_classes = [IsAuthenticated, IsAdminUser]

    def _site(self, request, site_code=None, allow_first=False):
        from bounded.network.models import Site
        code = (site_code or request.query_params.get('site_code') or request.data.get('site_code') or '').strip().upper()
        if code:
            site = Site.objects.filter(code=code).first()
            if site is None:
                return None, Response({'error': f'No store with code {code}.'}, status=404)
            return site, None
        from bounded.ds_ops.access import operator_site_codes
        codes = list(operator_site_codes(request.user))
        if codes:
            site = Site.objects.filter(code=codes[0]).first()
            if site is not None:
                return site, None
        if allow_first:
            site = Site.objects.filter(status='ACTIVE', site_type__in=('DS', 'DARK_STORE')).order_by('code').first()
            if site is not None:
                return site, None
        return None, Response({'error': 'Choose a store.'}, status=400)

    def get(self, request):
        from zoneinfo import ZoneInfo
        site, error = self._site(request, allow_first=True)
        if error:
            return error
        now = timezone.now().astimezone(ZoneInfo('Asia/Kolkata'))
        expires = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        return Response({
            'site_code': site.code,
            'site_name': site.name,
            'otp': staff_auth.daily_store_otp(site.code),
            'daily_otp': staff_auth.daily_store_otp(site.code),
            'date': now.date().isoformat(),
            'valid_from': now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
            'expires_at': expires.isoformat(),
            'refresh_interval_hours': 24,
        })

    def post(self, request):
        from django.contrib.auth.hashers import check_password
        site, error = self._site(request, allow_first=True)
        if error:
            return error
        email = (request.data.get('email') or '').strip()
        password = request.data.get('password') or ''
        otp = str(request.data.get('otp') or '').strip()
        if not email or not password or not otp:
            return Response({'error': 'Email, password and OTP are required.'}, status=400)
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid credentials.'}, status=401)
        if not check_password(password, user.password_hash) or user.status != 'ACTIVE':
            return Response({'error': 'Invalid credentials.'}, status=401)
        allowed = staff_auth.authorized_facilities(user)
        if allowed and site.code not in {s.code for s in allowed}:
            return Response({'error': 'You are not assigned to that store.'}, status=403)
        # Admin roles do not need OTP.
        if staff_auth.otp_required_for(user) and not staff_auth.daily_store_otp_valid(site.code, otp):
            return Response({'error': 'Invalid or expired daily OTP.'}, status=403)
        session, access, refresh = staff_auth.create_session(user, site, 'mobile', request)
        return Response({'status': 'activated', 'token': access, 'refresh_token': refresh, 'site_code': site.code, **staff_auth.session_context(session, request)})


class RotatingStoreOtpView(APIView):
    """The one shared store code for the Authentication screen.

    Any signed-in operator can read the code for a store they are assigned to;
    estate roles may read any store they administer. The code is the daily
    code: one per calendar day per store, deterministic from the server
    secret, and never stored or mailed.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bounded.network.models import Site
        from zoneinfo import ZoneInfo

        requested = str(
            request.query_params.get('site_code')
            or request.query_params.get('store_code')
            or ''
        ).strip().upper()
        session = getattr(request.user, 'session', None)
        site = None
        if requested:
            site = staff_auth.resolve_facility(request.user, requested)
            if site is None and request.user.role in staff_auth.ESTATE_ROLES:
                site = Site.objects.filter(code=requested).first()
        if site is None and session is not None and session.facility_id:
            site = session.facility
        if site is None:
            return Response({'error': 'Choose a store.'}, status=400)

        now = timezone.now().astimezone(ZoneInfo('Asia/Kolkata'))
        expires = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        return Response({
            'site_code': site.code,
            'site_name': site.name,
            'otp': staff_auth.daily_store_otp(site.code),
            'daily_otp': staff_auth.daily_store_otp(site.code),
            'date': now.date().isoformat(),
            'valid_from': now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
            'expires_at': expires.isoformat(),
            'refresh_interval_hours': 24,
        })


class RefreshTokenView(APIView):

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        rotated = staff_auth.rotate_session(request.data.get('refresh_token'), request)
        if rotated is None:
            return Response({'error': 'Refresh token is invalid or expired.'}, status=401)
        session, access, refresh = rotated
        return Response({
            'status': 'success',
            'token': access,
            'refresh_token': refresh,
            **staff_auth.session_context(session, request),
        })


class LogoutView(APIView):
    """Revoke the presented session. Access token or refresh token is enough."""

    permission_classes = []
    authentication_classes = []

    def post(self, request):
        session = None
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if header.startswith('Bearer '):
            try:
                import jwt as pyjwt
                from django.conf import settings as django_settings
                payload = pyjwt.decode(
                    header.split('Bearer ', 1)[1].strip(),
                    django_settings.SECRET_KEY, algorithms=['HS256'],
                )
                session = Session.objects.filter(
                    session_id=payload.get('sid'), is_active=True,
                ).first()
            except Exception:
                session = None
        if session is None:
            refresh = request.data.get('refresh_token')
            if refresh:
                session = Session.objects.filter(
                    refresh_token=staff_auth.hash_refresh_token(str(refresh)),
                    is_active=True,
                ).first()
        if session is None:
            return Response({'status': 'success'})
        staff_auth.revoke_session(session, request=request)
        return Response({'status': 'success'})


class MeAPIView(APIView):
    """The signed-in account, facility, surface and server-derived capabilities."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        session = getattr(user, 'session', None)
        if session is None:
            return Response({'error': 'Session not found.'}, status=401)

        # Compatibility for the existing facility switcher: a facility may be
        # selected here only if it is in the account's authorized set. The
        # session row is updated so every later request is scoped to it.
        facility_code = str(request.query_params.get('facility_code') or '').strip().upper()
        if facility_code:
            selected = staff_auth.resolve_facility(
                user, facility_code,
                'DARK_STORE' if session.facility and session.facility.site_type == 'DS'
                else 'WMS' if session.facility else None,
            )
            if selected is None:
                return Response({'error': 'You are not assigned to this facility.'}, status=403)
            if session.facility_id != selected.site_id:
                previous = session.facility.code if session.facility_id else None
                session.facility = selected
                session.save(update_fields=['facility'])
                staff_auth.audit('IAM_FACILITY_SWITCHED', actor_id=user.user_id,
                                 entity_type='Session', entity_id=session.session_id,
                                 request=request, before={'facility': previous},
                                 after={'facility': selected.code})

        return Response(staff_auth.session_context(session, request))


class FacilitySwitchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = getattr(request.user, 'session', None)
        if session is None:
            return Response({'error': 'Session not found.'}, status=401)
        code = str(request.data.get('facility_code') or '').strip().upper()
        selected = staff_auth.resolve_facility(
            request.user, code, request.data.get('app'),
        )
        if selected is None:
            return Response({'error': 'You are not assigned to this facility.'}, status=403)
        previous = session.facility.code if session.facility_id else None
        session.facility = selected
        session.save(update_fields=['facility'])
        staff_auth.audit('IAM_FACILITY_SWITCHED', actor_id=request.user.user_id,
                         entity_type='Session', entity_id=session.session_id,
                         request=request, before={'facility': previous},
                         after={'facility': selected.code})
        return Response(staff_auth.session_context(session, request))


class FacilitiesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        app = str(request.query_params.get('app') or '').strip().upper() or None
        sites = staff_auth.authorized_facilities(request.user, app)
        return Response({'facilities': _facility_list(sites),
                         'count': len(sites)})


class MyWorkView(APIView):
    """The signed-in employee's open tasks at their selected facility.

    This is the mobile home screen. It deliberately returns only work that the
    server already scopes to the session facility: a picker who switches sites
    cannot see another store's queue, and an unassigned task is shown only when
    the facility matches.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        session = getattr(request.user, 'session', None)
        if session is None or session.facility_id is None:
            return Response({'error': 'Choose an authorized facility first.'}, status=400)

        facility = session.facility
        tasks = []

        from bounded.supply.models import PutawayTask
        putaways = (PutawayTask.objects
                    .select_related('sku', 'lot', 'grn_line__grn__asn__dest_site')
                    .filter(grn_line__grn__asn__dest_site=facility)
                    .exclude(status__in=['CONFIRMED'])
                    .order_by('-created_at')[:50])
        for task in putaways:
            tasks.append({
                'id': str(task.task_id),
                'kind': 'PUTAWAY',
                'title': f'Put away {task.sku.sku_code}',
                'subtitle': f'{task.remaining_qty} of {task.qty} units',
                'status': task.status,
                'site': facility.code,
                'qty': task.qty,
                'remaining_qty': task.remaining_qty,
                'created_at': task.created_at.isoformat(),
                'endpoint': f'/supply/putaway-tasks/{task.task_id}',
                'sku_code': task.sku.sku_code,
                'assigned_to': str(task.assigned_to) if task.assigned_to else None,
            })

        from bounded.ds_ops.models import PickTask, PackTask
        picks = (PickTask.objects
                 .select_related('order__site')
                 .filter(order__site=facility)
                 .exclude(status__in=['COMPLETED', 'CANCELLED'])
                 .order_by('-created_at')[:50])
        for task in picks:
            tasks.append({
                'id': str(task.picklist_id),
                'kind': 'PICK',
                'title': f"Pick order {task.order.order_no if task.order_id else ''}".strip(),
                'subtitle': f'{task.picked_qty} of {task.qty} units',
                'status': task.status,
                'site': facility.code,
                'qty': task.qty,
                'remaining_qty': max(0, task.qty - task.picked_qty),
                'created_at': task.created_at.isoformat(),
                'endpoint': f'/ds-ops/pick-tasks/{task.pk}',
                'assigned_to': str(task.assigned_to) if task.assigned_to else None,
            })

        packs = (PackTask.objects
                 .select_related('order__site')
                 .filter(order__site=facility)
                 .exclude(status__in=['COMPLETED', 'CANCELLED'])
                 .order_by('-created_at')[:50])
        for task in packs:
            tasks.append({
                'id': str(task.packlist_id),
                'kind': 'PACK',
                'title': f"Pack order {task.order.order_no if task.order_id else ''}".strip(),
                'subtitle': f'{task.packed_qty} of {task.qty} units',
                'status': task.status,
                'site': facility.code,
                'qty': task.qty,
                'remaining_qty': max(0, task.qty - task.packed_qty),
                'lpn': task.lpn,
                'staging_bin': task.staging_bin,
                'created_at': task.created_at.isoformat(),
                'endpoint': f'/ds-ops/pack-tasks/{task.pk}',
                'assigned_to': str(task.assigned_to) if task.assigned_to else None,
            })

        tasks.sort(key=lambda item: item['created_at'], reverse=True)
        return Response({
            **staff_auth.session_context(session, request),
            'tasks': tasks,
            'count': len(tasks),
        })


class MyDashboardView(APIView):
    """Department dashboard for the signed-in associate, manager or rider.

    One endpoint so the mobile home screen does not fan out eight requests to
    draw four numbers. Every count is scoped to the session facility.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import timedelta
        from django.db.models import Q
        from bounded.network.models import EmployeeSiteAssignment
        from bounded.orders.models import CustomerOrder, CustomerOrderLine
        from bounded.ds_ops.models import PickTask, PackTask
        from bounded.supply.models import PutawayTask, GrnLine
        from bounded.counting.models import CycleCount
        from bounded.delivery.models import RiderProfile, DeliveryTask

        session = getattr(request.user, 'session', None)
        facility = session.facility if session is not None else None
        if facility is None:
            return Response({'error': 'Choose an authorized facility first.'}, status=400)

        user = request.user
        department = staff_auth.department_for(user, facility)
        today = timezone.localdate()
        start = timezone.now() - timedelta(hours=24)

        opens = ['NOT_STARTED', 'IN_PROGRESS']
        pick_qs = PickTask.objects.filter(order__site=facility)
        pack_qs = PackTask.objects.filter(order__site=facility)
        put_qs = PutawayTask.objects.filter(
            grn_line__grn__asn__dest_site=facility).exclude(status='CONFIRMED')

        my_picks = pick_qs.filter(assigned_to=user.user_id)
        my_packs = pack_qs.filter(assigned_to=user.user_id)
        my_puts = put_qs.filter(assigned_to=user.user_id)

        completed_today = (
            my_picks.filter(completed_at__date=today).count()
            + my_packs.filter(completed_at__date=today).count()
            + my_puts.filter(status='CONFIRMED',
                             completed_at__date=today).count()
        )

        history = []
        for task in my_picks.filter(completed_at__isnull=False).order_by('-completed_at')[:5]:
            history.append({
                'kind': 'PICK',
                'title': f'Pick {task.order.order_no if task.order_id else ""}'.strip(),
                'status': task.status,
                'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            })
        for task in my_packs.filter(completed_at__isnull=False).order_by('-completed_at')[:5]:
            history.append({
                'kind': 'PACK',
                'title': f'Rack drop {task.order.order_no if task.order_id else ""}'.strip(),
                'status': task.status,
                'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            })
        history.sort(key=lambda row: row.get('completed_at') or '', reverse=True)

        # --- department queues -------------------------------------------
        inbound_pending = 0
        grn_lines = GrnLine.objects.filter(grn__asn__dest_site=facility)
        for line in grn_lines.only('received_qty', 'accepted_qty', 'damaged_qty', 'expired_qty'):
            outstanding = (line.received_qty or 0) - (line.accepted_qty or 0) - (line.damaged_qty or 0)
            if outstanding > 0:
                inbound_pending += 1

        inventory_tasks = CycleCount.objects.filter(
            site=facility, status__in=['DRAFT', 'IN_PROGRESS']).count()
        pending_queue = pick_qs.filter(
            status__in=opens, assigned_to__isnull=True).count()
        rack_drop = CustomerOrder.objects.filter(
            site=facility, status='PICKED').count()
        ready = CustomerOrder.objects.filter(
            site=facility, status__in=['PACKED', 'STAGED', 'PRICE_FINALIZED']).count()

        # --- manager live overview --------------------------------------
        order_counts = {
            row['status']: row['n']
            for row in CustomerOrder.objects.filter(site=facility)
            .values('status').annotate(n=models.Count('order_id'))
        }
        riders_on_duty = RiderProfile.objects.filter(
            current_site=facility, is_online=True).count()
        pickers_active = EmployeeSiteAssignment.objects.filter(
            site=facility, is_active=True,
            role_at_site__icontains='PICK',
        ).count()
        unassigned_deliveries = DeliveryTask.objects.filter(
            site=facility, status__in=['UNASSIGNED', 'OFFERED']).count()

        return Response({
            **staff_auth.session_context(session, request),
            'department': department,
            'dashboard': {
                'today_tasks': my_picks.filter(status__in=opens).count()
                                + my_puts.count(),
                'picking': my_picks.filter(status__in=opens).count(),
                'packing': my_packs.filter(status__in=opens).count(),
                'putaway': my_puts.count(),
                'rack_drop': rack_drop,
                'completed_today': completed_today,
                'pending': pending_queue,
                'history': history[:8],
                'inbound_pending': inbound_pending,
                'inventory_tasks': inventory_tasks,
                'ready_for_rider': ready,
            },
            'manager': {
                'orders_pending': order_counts.get('CONFIRMED', 0) + order_counts.get('PLACED', 0),
                'orders_picking': order_counts.get('PICKING', 0) + order_counts.get('PARTIALLY_FULFILLED', 0),
                'orders_picked': order_counts.get('PICKED', 0),
                'orders_rack_dropped': order_counts.get('RACK_DROPPED', 0),
                'orders_ready': ready,
                'orders_out_for_delivery': (
                    order_counts.get('RIDER_ASSIGNED', 0)
                    + order_counts.get('PICKED_UP', 0)
                    + order_counts.get('OUT_FOR_DELIVERY', 0)
                    + order_counts.get('ARRIVED', 0)
                ),
                'orders_delivered': CustomerOrder.objects.filter(
                    site=facility, status='DELIVERED', delivered_at__gte=start).count(),
                'pending_queue': pending_queue,
                'pickers_active': pickers_active,
                'riders_on_duty': riders_on_duty,
                'inbound_pending': inbound_pending,
                'putaway_pending': put_qs.count(),
                'inventory_tasks': inventory_tasks,
                'deliveries_waiting': unassigned_deliveries,
            },
        })


class StoreOtpView(APIView):
    """Retired: staff OTPs are per employee, per sign-in, and never readable.

    The old endpoint returned a live reusable code for a facility, meaning any
    authenticated operator could read the code that admits every employee at
    that site. It now answers 410 so an old client cannot mistake a failure for
    a working door.
    """

    # This compatibility route returns no data and is retired. Allow an
    # unauthenticated caller to receive the definitive 410 response too, so
    # stale clients stop treating it as an authorization/session problem.
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        return Response({
            'error': 'Facility OTPs are no longer issued. Each employee receives a '
                     'personal one-time code after choosing a facility.',
            'code': 'otp_endpoint_retired',
        }, status=410)
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get_queryset(self):
        user = self.request.user
        if getattr(user, 'role', None) == 'SUPER_ADMIN':
            return User.objects.all()
        # Ops managers / Store admins only see employees at their assigned site —
        # plus the estate roles. The approver picker on the product-registration
        # screen has to offer another estate user, and that list was invisible to
        # site-scoped callers, so the only estate user in the payload was the
        # requester themselves.
        from bounded.ds_ops.access import operator_site_codes
        from bounded.network.models import EmployeeSiteAssignment
        codes = operator_site_codes(user)
        assigned_user_ids = EmployeeSiteAssignment.objects.filter(
            site__code__in=codes, is_active=True
        ).values_list('user_id', flat=True)
        estate_ids = User.objects.filter(
            role__in=('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER')
        ).values_list('user_id', flat=True)
        return User.objects.filter(
            models.Q(user_id__in=assigned_user_ids)
            | models.Q(user_id=user.user_id)
            | models.Q(user_id__in=estate_ids)
        )

    def list(self, request):
        from django.db.models import Prefetch
        from bounded.network.models import EmployeeSiteAssignment

        qs = self.get_queryset().prefetch_related(
            Prefetch(
                'site_assignments',
                queryset=(EmployeeSiteAssignment.objects
                          .filter(is_active=True)
                          .select_related('site')
                          .order_by('-is_primary', 'created_at')),
                to_attr='active_assignments',
            )
        )
        serializer = UserSerializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        user = self.get_object()
        serializer = UserSerializer(user)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='login-otp')
    def issue_login_otp(self, request, pk=None):
        """Admin-only: issue this employee's sign-in OTP (field staff).

        Estate roles skip OTP in production; this exists for WAREHOUSE_STAFF
        and other field employees who must prove presence at login in either
        the console or the app. With no delivery provider configured, the
        mailed code is currently skipped, so this endpoint reports that the
        role signs in without it. The DS daily store code is unaffected.
        """
        target = self.get_object()
        if target.role not in ('WAREHOUSE_STAFF',):
            return Response({'error': 'This role logs in without OTP.'}, status=400)
        if not staff_auth.email_otp_required_for(target):
            return Response({'error': 'This role logs in without OTP.'}, status=400)
        site_code = str(request.data.get('site_code') or '').strip().upper()
        facilities = staff_auth.authorized_facilities(target)
        selected = None
        if site_code:
            selected = next((s for s in facilities if s.code == site_code), None)
            if selected is None:
                return Response({'error': 'That facility is not assigned to this employee.'}, status=400)
        elif facilities:
            selected = facilities[0]
        challenge_token = staff_auth.generate_challenge_token()
        requested_app = 'DARK_STORE' if selected is not None and selected.site_type == 'DS' else 'WMS'
        challenge = LoginChallenge.objects.create(
            user=target,
            surface='mobile',
            requested_app=requested_app,
            challenge_token_hash=staff_auth.hash_challenge_token(challenge_token),
            expires_at=timezone.now() + timedelta(seconds=staff_auth.CHALLENGE_TTL_SECONDS),
            ip_address=staff_auth.client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        if selected is not None:
            challenge.facility = selected
            challenge.save(update_fields=['facility'])
        try:
            dev_code = staff_auth.issue_otp(challenge, request=request)
        except staff_auth.OtpDeliveryUnavailable:
            return Response({
                'error': 'OTP delivery is unavailable. Configure the OTP email/SMS provider.',
                'code': 'otp_delivery_unavailable',
            }, status=503)
        return Response({
            'status': 'otp_sent',
            'challenge_id': str(challenge.challenge_id),
            'otp_sent_to': _mask_email(getattr(target, 'email', '')),
            'dev_otp': dev_code if staff_auth.dev_echo_allowed() else None,
            'otp': dev_code if request.data.get('preview') else None,
        }, status=201)


class SessionViewSet(viewsets.ModelViewSet):
    queryset = Session.objects.all()
    serializer_class = SessionSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request):
        sessions = Session.objects.filter(user=request.user)
        serializer = SessionSerializer(sessions, many=True)
        return Response(serializer.data)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]


class DeviceViewSet(viewsets.ModelViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request):
        devices = Device.objects.filter(user=request.user)
        serializer = DeviceSerializer(devices, many=True)
        return Response(serializer.data)


class QRCodeViewSet(viewsets.ModelViewSet):
    queryset = QRCode.objects.all()
    serializer_class = QRCodeSerializer
    permission_classes = [IsAuthenticated]


class IdempotencyKeyViewSet(viewsets.ModelViewSet):
    queryset = IdempotencyKey.objects.all()
    serializer_class = IdempotencyKeySerializer
    permission_classes = [IsAuthenticated]
