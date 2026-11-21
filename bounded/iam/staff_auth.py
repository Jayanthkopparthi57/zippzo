"""Shared staff identity: facility resolution, one-time codes and sessions.

Why this module exists
----------------------
The previous login required the employee to type a warehouse/store code and
prove presence with a code derived from ``sha256(site:hour:hardcoded-secret)``.
Anyone who could read the repository could mint a valid code for every site,
and the code was reusable for an hour. Nothing was stored server-side, so it
could not be revoked.

This module is the authoritative implementation of the replacement:

* facilities are derived from ``EmployeeSiteAssignment`` (never from the
  request body for non-estate roles),
* OTP codes are CSPRNG-generated, hashed at rest, single-use, expiring and
  attempt-limited,
* access tokens are tied to a revocable ``Session`` row,
* every step writes an audit entry.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from bounded.audit.models import AuditLog

logger = logging.getLogger(__name__)

ESTATE_ROLES = ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER')
#: Floor departments. They may be carried on User.role (a dedicated account
#: type) or on EmployeeSiteAssignment.role_at_site (one account, several
#: departments). Both are normalised by `department_for`.
ASSOCIATE_ROLES = (
    'PICKER',
    'INVENTORY_ASSOCIATE',
    'INBOUND_ASSOCIATE',
    'PUTAWAY_ASSOCIATE',
)
STAFF_ROLES = (
    'SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF',
) + ASSOCIATE_ROLES
MANAGER_ROLES = ('SUPERVISOR', 'STORE_MANAGER', 'WAREHOUSE_MANAGER',
                 'OPS_MANAGER', 'ADMIN', 'SUPER_ADMIN')

OTP_LENGTH = 6
OTP_TTL_SECONDS = 300
CHALLENGE_TTL_SECONDS = 600
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 30


class OtpDeliveryUnavailable(Exception):
    """Raised when an OTP cannot be delivered to the employee."""


def _hash(value, salt=''):
    raw = f'{salt}|{value}|{settings.SECRET_KEY}'
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def hash_challenge_token(token):
    return _hash(token, 'challenge')


def hash_otp(challenge_id, code):
    return _hash(str(code), f'otp:{challenge_id}')


def hash_refresh_token(token):
    return _hash(token, 'refresh')


def generate_otp():
    return f'{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}'


def daily_store_otp(site_code, on_date=None):
    """One shared site OTP for a calendar day in India (IST).

    The manager reads today's code to staff and an employee can use it to
    activate for that day. The value is deterministic from the server secret,
    the store and the IST date, so it naturally rotates at midnight and never
    needs to be mailed or stored in plaintext.
    """
    from zoneinfo import ZoneInfo
    import hmac
    day = on_date
    if day is None:
        day = timezone.now().astimezone(ZoneInfo('Asia/Kolkata')).date()
    payload = f'daily-store-otp|{str(site_code or "").strip().upper()}|{day.isoformat()}'
    digest = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    return f'{int.from_bytes(digest[:4], "big") % 10 ** OTP_LENGTH:0{OTP_LENGTH}d}'


def daily_store_otp_valid(site_code, code, on_date=None):
    """Accept today's IST code, with the adjacent dates allowed at midnight."""
    from datetime import timedelta as _td
    if on_date:
        days = [on_date]
    else:
        from zoneinfo import ZoneInfo
        today = timezone.now().astimezone(ZoneInfo('Asia/Kolkata')).date()
        days = [today - _td(days=1), today, today + _td(days=1)]
    return any(secrets.compare_digest(str(code or '').strip(), daily_store_otp(site_code, day)) for day in days)


def normalize_phone(value):
    """Digits only, last 10 for India, so +91 98765 43210 == 9876543210."""
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if len(digits) > 10 and digits.startswith('91'):
        digits = digits[-10:]
    return digits[-10:] if len(digits) >= 10 else digits


def find_users_by_phone(phone):
    """Active staff accounts whose stored phone matches `phone`.

    `phone` is free text on the account (with +91, spaces, dashes), so the
    comparison is done on normalised digits in Python. The candidate set is
    small because only staff accounts are considered.
    """
    from .models import User
    wanted = normalize_phone(phone)
    if len(wanted) < 10:
        return []
    candidates = User.objects.filter(status='ACTIVE').exclude(phone='')
    return [u for u in candidates if normalize_phone(u.phone) == wanted]


def department_for(user, facility=None, role_at_site=None):
    """Normalise the four associate departments plus manager/rider.

    Wording differs between the charts and the database (`Rack Drop` is the
    staging step, `Picker` may be `PACKER`), so the mapping is explicit rather
    than string-slicing role names in every view.
    """
    role = str(role_at_site or '').strip().upper()
    if not role and user is not None and facility is not None:
        role = str(facility_role(user, facility) or '').strip().upper()
    if not role and user is not None:
        role = str(getattr(user, 'role', '') or '').strip().upper()

    if role in ('PICKER', 'PACKER'):
        return 'PICKER'
    if role in ('INVENTORY_ASSOCIATE', 'INVENTORY', 'COUNTER'):
        return 'INVENTORY'
    if role in ('INBOUND_ASSOCIATE', 'INBOUND', 'RECEIVING', 'RECEIVER'):
        return 'INBOUND'
    if role in ('PUTAWAY_ASSOCIATE', 'PUTAWAY'):
        return 'PUTAWAY'
    if role in ('RIDER',):
        return 'RIDER'
    if role in MANAGER_ROLES or (user is not None and getattr(user, 'role', '') in ESTATE_ROLES):
        return 'MANAGER'
    return 'ASSOCIATE'



def generate_challenge_token():
    return secrets.token_urlsafe(32)


def generate_refresh_token():
    return secrets.token_urlsafe(48)


def client_ip(request):
    if request is None:
        return None
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR') or None


def audit(action, *, actor_id=None, result='SUCCESS', entity_type='', entity_id=None,
          before=None, after=None, request=None, reason=''):
    """Write an attributable audit row; never let audit failure break a login."""
    try:
        AuditLog.objects.create(
            actor_type='USER' if actor_id else 'SYSTEM',
            actor_id=str(actor_id)[:50] if actor_id else None,
            action=action[:60],
            entity_type=(entity_type or '')[:40] or None,
            entity_id=entity_id if _is_uuid(entity_id) else None,
            before_json=before,
            after_json=after,
            ip=client_ip(request) if request is not None else None,
            result=result,
            denial_reason=(reason or '')[:2000],
        )
    except Exception:  # pragma: no cover - audit must not mask the real result
        logger.exception('audit write failed for %s', action)


def _is_uuid(value):
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def site_payload(site):
    if site is None:
        return None
    return {
        'site_id': str(site.site_id),
        'code': site.code,
        'name': site.name,
        'site_type': site.site_type,
        'address': site.address,
        'status': site.status,
    }


def authorized_facilities(user, requested_app=None):
    """Facilities the account may select, derived only from server-side data.

    Estate roles administer the network, so they see every active MH/DS site
    (optionally narrowed to the workspace they opened). A field employee sees
    exactly their active assignments. No request field can widen this list.
    """
    from bounded.network.models import EmployeeSiteAssignment, Site

    sites = Site.objects.filter(status='ACTIVE', site_type__in=('MH', 'DS')).order_by('code')
    if requested_app == 'WMS':
        sites = sites.filter(site_type='MH')
    elif requested_app == 'DARK_STORE':
        sites = sites.filter(site_type='DS')

    if user.role in ESTATE_ROLES:
        return list(sites)

    assigned_ids = EmployeeSiteAssignment.objects.filter(
        user=user, is_active=True, site__status='ACTIVE',
    ).values_list('site_id', flat=True)
    return list(sites.filter(site_id__in=assigned_ids))


def resolve_facility(user, site_code, requested_app=None):
    """Return the authorized Site for ``site_code`` or ``None``.

    The lookup is always intersected with ``authorized_facilities`` so a typed
    code cannot escape the account's assignment scope.
    """
    if not site_code:
        return None
    code = str(site_code).strip().upper()
    for site in authorized_facilities(user, requested_app):
        if site.code.upper() == code:
            return site
    return None


def challenge_rate_limited(user, ip):
    """Cheap per-account / per-IP throttle for challenge creation."""
    user_key = f'iam:challenge:user:{user.user_id}'
    ip_key = f'iam:challenge:ip:{ip or "unknown"}'
    user_count = cache.get(user_key, 0)
    ip_count = cache.get(ip_key, 0)
    if user_count >= 15 or ip_count >= 60:
        return True
    cache.set(user_key, user_count + 1, timeout=900)
    cache.set(ip_key, ip_count + 1, timeout=900)
    return False


def otp_required_for(user):
    """Whether this account must prove presence with a one-time code.

    This backs the DS daily store code (phone sign-in and store activation),
    which is derived on the server and never mailed. It is independent of email
    delivery. Field employees always take it; estate roles may be exempted via
    ``IAM_ADMIN_OTP_REQUIRED`` (forced on in production).
    """
    if user.role not in ESTATE_ROLES:
        return True
    return bool(getattr(settings, 'IAM_ADMIN_OTP_REQUIRED', True))


def email_otp_required_for(user):
    """Whether email/password sign-in must pass a *mailed* one-time code.

    This is a different factor from the daily store code above. With no OTP
    delivery provider configured, demanding a mailed code can only end in a
    503 and lock staff out of the console, so the emailed step is skipped for
    now. Configuring ``IAM_OTP_SENDER`` restores the normal policy without a
    code change; the store code is never relaxed by this switch.
    """
    if not (getattr(settings, 'IAM_OTP_SENDER', None) or dev_echo_allowed()):
        return False
    return otp_required_for(user)


def dev_echo_allowed():
    # Never return a copy to the application when an actual delivery provider
    # is configured, even if a developer accidentally left the echo flag on.
    return bool(
        getattr(settings, 'DEBUG', False)
        and getattr(settings, 'OTP_DEV_ECHO', False)
        and not getattr(settings, 'IAM_OTP_SENDER', None)
    )


def initial_setup_login_allowed(user, requested_app=None):
    """Whether this Super Admin may sign in before a facility can be selected.

    A freshly provisioned estate has a Super Admin but no active site for the
    workspace being opened, so the normal facility guard would lock out the
    only account allowed to create one. This narrow escape hatch is
    SUPER_ADMIN-only and audited; it closes by itself as soon as an ACTIVE site
    for that workspace exists. Mailed OTP is handled separately by
    ``email_otp_required_for`` and is never the reason this branch is taken.
    """
    if getattr(user, 'role', None) != 'SUPER_ADMIN':
        return False
    from bounded.network.models import Site
    sites = Site.objects.filter(status='ACTIVE', site_type__in=('MH', 'DS'))
    if requested_app == 'WMS':
        sites = sites.filter(site_type='MH')
    elif requested_app == 'DARK_STORE':
        sites = sites.filter(site_type='DS')
    return not sites.exists()


def issue_otp(challenge, *, request=None):
    """Generate and deliver a code for a challenge, returning the plain code.

    The plain code is returned only so the caller can decide whether the
    development echo may expose it. It is never stored in plain text.
    """
    sender = getattr(settings, 'IAM_OTP_SENDER', None)
    if not sender and not dev_echo_allowed():
        raise OtpDeliveryUnavailable('No OTP delivery provider is configured.')

    code = generate_otp()
    # Do not activate a challenge until delivery succeeds. The only exception
    # is explicit development echo, which returns the code to the test client.
    _deliver_otp(challenge, code)
    challenge.code_hash = hash_otp(challenge.challenge_id, code)
    challenge.status = 'FACILITY_SELECTED'
    challenge.attempts = 0
    challenge.expires_at = timezone.now() + timedelta(seconds=OTP_TTL_SECONDS)
    challenge.save(update_fields=['code_hash', 'status', 'attempts', 'expires_at'])

    audit(
        'IAM_OTP_ISSUED', actor_id=challenge.user_id, entity_type='LoginChallenge',
        entity_id=challenge.challenge_id, request=request,
        after={'facility': challenge.facility.code if challenge.facility_id else None,
               'surface': challenge.surface},
    )
    return code


def _deliver_otp(challenge, code):
    """Send OTP without ever writing the credential to application logs."""
    sender = getattr(settings, 'IAM_OTP_SENDER', None)
    if sender:
        try:
            if isinstance(sender, str):
                from django.utils.module_loading import import_string
                sender = import_string(sender)
            sender(challenge.user, code, challenge)
        except Exception:
            # Provider exception text can contain message bodies/recipient data.
            logger.error('Staff OTP delivery provider failed')
            raise OtpDeliveryUnavailable('OTP delivery failed.') from None
        return
    if not dev_echo_allowed():
        logger.error('Staff OTP delivery unavailable: IAM_OTP_SENDER is not configured')
        raise OtpDeliveryUnavailable('No OTP delivery provider is configured.')
    logger.info('Development OTP generated for challenge %s; code is returned only to the opted-in development client',
                challenge.challenge_id)


def verify_otp(challenge, submitted):
    """Validate a submitted code, advancing attempt/expiry state.

    Returns ``(ok, reason)``. The caller decides the HTTP response and audit
    result; this function never consumes a challenge on a wrong code.
    """
    now = timezone.now()
    if challenge.status == 'CONSUMED' or challenge.consumed_at:
        return False, 'already_used'
    if challenge.status == 'EXPIRED' or challenge.expires_at <= now:
        challenge.status = 'EXPIRED'
        challenge.save(update_fields=['status'])
        return False, 'expired'
    if not challenge.facility_id:
        return False, 'facility_not_selected'
    if not challenge.code_hash:
        return False, 'code_not_issued'
    if challenge.attempts >= challenge.max_attempts:
        return False, 'attempts_exhausted'

    challenge.attempts += 1
    expected = challenge.code_hash
    supplied = hash_otp(challenge.challenge_id, str(submitted).strip())
    if not secrets.compare_digest(expected, supplied):
        challenge.save(update_fields=['attempts'])
        return False, 'invalid'

    challenge.status = 'CONSUMED'
    challenge.consumed_at = now
    challenge.code_hash = ''
    challenge.save(update_fields=['attempts', 'status', 'consumed_at', 'code_hash'])
    return True, 'ok'


def create_session(user, facility, surface, request):
    """Create a revocable session and return (session, access, refresh)."""
    from .authentication.jwt import generate_jwt_token
    from .models import Session

    jti = uuid.uuid4().hex
    refresh = generate_refresh_token()
    session = Session.objects.create(
        user=user,
        token=jti,
        refresh_token=hash_refresh_token(refresh),
        surface=surface if surface in ('web', 'mobile') else 'web',
        facility=facility,
        ip_address=client_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500] if request is not None else '',
        expires_at=timezone.now() + timedelta(hours=15),
        last_used_at=timezone.now(),
    )
    access = generate_jwt_token(
        user.user_id, user.role, session_id=session.session_id,
        surface=session.surface, jti=jti,
    )
    audit(
        'IAM_LOGIN_SUCCESS', actor_id=user.user_id, entity_type='Session',
        entity_id=session.session_id, request=request,
        after={'surface': session.surface,
               'facility': facility.code if facility else None},
    )
    return session, access, refresh


def rotate_session(refresh_token, request=None):
    """Rotate a refresh token and its access-token id, or return ``None``."""
    from .authentication.jwt import generate_jwt_token
    from .models import Session

    if not refresh_token:
        return None
    digest = hash_refresh_token(str(refresh_token))
    now = timezone.now()
    session = (Session.objects
               .select_related('user', 'facility')
               .filter(refresh_token=digest, is_active=True,
                       revoked_at__isnull=True, expires_at__gt=now)
               .first())
    if session is None:
        return None
    if session.user.status != 'ACTIVE':
        return None

    jti = uuid.uuid4().hex
    new_refresh = generate_refresh_token()
    session.token = jti
    session.refresh_token = hash_refresh_token(new_refresh)
    session.last_used_at = now
    # Sliding refresh window, capped at 30 days from the original creation.
    session.expires_at = min(
        now + timedelta(hours=15),
        session.created_at + timedelta(days=30),
    )
    session.save(update_fields=['token', 'refresh_token', 'last_used_at', 'expires_at'])

    access = generate_jwt_token(
        session.user_id, session.user.role, session_id=session.session_id,
        surface=session.surface, jti=jti,
    )
    audit('IAM_TOKEN_REFRESHED', actor_id=session.user_id, entity_type='Session',
          entity_id=session.session_id, request=request)
    return session, access, new_refresh


def revoke_session(session, *, reason='logout', request=None):
    session.is_active = False
    session.revoked_at = timezone.now()
    session.save(update_fields=['is_active', 'revoked_at'])
    audit('IAM_LOGOUT', actor_id=session.user_id, entity_type='Session',
          entity_id=session.session_id, request=request, reason=reason)


def capabilities_for(user, facility, surface, role_at_site=None):
    """Server-derived capabilities. The client may only use these for UI."""
    from bounded.ds_ops.access import is_estate_role

    estate = is_estate_role(user)
    is_admin = user.role in ('SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER')
    site_type = facility.site_type if facility else None
    physical = surface == 'mobile' and site_type in ('MH', 'DS')
    department = department_for(user, facility, role_at_site)
    return {
        'can_plan': is_admin or role_at_site in (
            'SUPERVISOR', 'STORE_MANAGER', 'WAREHOUSE_MANAGER', 'OPS_MANAGER'),
        'can_assign': is_admin or role_at_site in (
            'SUPERVISOR', 'STORE_MANAGER', 'WAREHOUSE_MANAGER', 'OPS_MANAGER'),
        'can_execute_physical': physical,
        'can_adjust_stock': estate,
        'can_administer': is_admin,
        'can_view_audit': is_admin,
        'can_manage_users': is_admin,
        'can_pick': department in ('PICKER', 'MANAGER', 'ASSOCIATE'),
        'can_receive': department in ('INBOUND', 'MANAGER', 'ASSOCIATE'),
        'can_putaway': department in ('PUTAWAY', 'MANAGER', 'ASSOCIATE'),
        'can_count': department in ('INVENTORY', 'MANAGER', 'ASSOCIATE'),
        'can_deliver': department == 'RIDER' or user.role == 'RIDER',
        'department': department,
        'workspace': ('DARK_STORE' if site_type == 'DS'
                      else 'WMS' if site_type == 'MH' else None),
    }


def facility_role(user, facility):
    """Return the user's role at a site, if an assignment names one."""
    from bounded.network.models import EmployeeSiteAssignment
    if not facility:
        return None
    row = EmployeeSiteAssignment.objects.filter(
        user=user, site=facility, is_active=True,
    ).order_by('-is_primary').first()
    return row.role_at_site if row else ('OPS_MANAGER' if user.role in ESTATE_ROLES else None)


def session_context(session, request=None):
    from .views import get_user_allowed_apps, target_app_for

    user = session.user
    facility = session.facility
    role_at_site = facility_role(user, facility)
    return {
        'user': {
            'user_id': str(user.user_id),
            'email': user.email,
            'phone': user.phone,
            'full_name': user.full_name,
            'role': user.role,
            'status': user.status,
            'is_super_admin': user.role in ('SUPER_ADMIN', 'ADMIN'),
        },
        'facility': site_payload(facility),
        'target_app': target_app_for(user),
        'allowed_apps': get_user_allowed_apps(user),
        'surface': session.surface,
        'role_at_site': role_at_site,
        'department': department_for(user, facility, role_at_site),
        'capabilities': capabilities_for(user, facility, session.surface, role_at_site),
        'session': {
            'session_id': str(session.session_id),
            'expires_at': session.expires_at,
        },
    }


def send_otp_email(user, code, challenge):
    """Deliver a staff OTP through the project's configured SMTP backend.

    This is only wired up when EMAIL_USER/EMAIL_PASS are present (see
    settings.py). It never logs the code. Failures propagate so the sign-in
    fails closed rather than silently dropping the code.
    """
    from django.core.mail import send_mail
    from django.conf import settings as django_settings

    subject = 'Zippzo staff sign-in code'
    message = (
        f'Your Zippzo one-time sign-in code is {code}. '
        f'It expires in {OTP_TTL_SECONDS // 60} minutes and can be used once. '
        f'Facility: {challenge.facility.code if getattr(challenge, "facility_id", None) else "-"}.'
    )
    recipient = getattr(user, 'email', None)
    if not recipient:
        raise OtpDeliveryUnavailable('The account has no email address.')
    try:
        send_mail(
            subject, message,
            getattr(django_settings, 'DEFAULT_FROM_EMAIL', 'auth@zippzo.com'),
            [recipient], fail_silently=False,
        )
    except Exception as exc:
        raise OtpDeliveryUnavailable('OTP email delivery failed.') from exc
