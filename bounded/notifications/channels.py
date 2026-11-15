"""Provider adapters for the notification channels that leave the app.

The in-app inbox and the WebSocket are delivered by ``publish.py``: the row is
the delivery. Push and SMS are different - the row records intent, and a
provider has to accept it - so this module owns the network edge:

  * **Push** goes to Firebase Cloud Messaging. Device tokens come from the
    ``iam_devices`` rows the apps register (and the legacy
    ``User.device_token`` column); a device that FCM rejects is deactivated so
    the next fan-out does not keep paying for a dead token.
  * **SMS** goes to Twilio when ``SMS_PROVIDER=twilio`` or to any HTTP gateway
    that accepts ``{to, message}`` when ``SMS_PROVIDER=http``.

Every adapter is optional. A deployment with no credentials is a valid one:
dispatch reports ``skipped`` and leaves ``sent_at`` NULL rather than pretending
a message went out. Nothing in here raises into the outbox publisher - a
provider outage must not turn a confirmed order into a failed event.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10

#: What a customer or rider actually reads. Keyed by Notification.type so a new
#: route only needs a template, not a code change in the adapter.
TEMPLATES = {
    'ORDER_PLACED': (
        'Order placed',
        'Your Zippzo order {order_no} is confirmed. We will deliver it in minutes.',
    ),
    'ORDER_PACKED': (
        'Order packed',
        'Order {order_no} is packed and waiting for a rider.',
    ),
    'ORDER_ON_THE_WAY': (
        'On the way',
        'Your Zippzo order {order_no} is on the way.',
    ),
    'ORDER_DELIVERED': (
        'Delivered',
        'Order {order_no} was delivered. Thanks for shopping with Zippzo.',
    ),
    'ORDER_CANCELLED': (
        'Order cancelled',
        'Order {order_no} was cancelled. Nothing was charged.',
    ),
    'DELIVERY_OTP': (
        'Your delivery code',
        '{otp} is your delivery code for order {order_no}. Share it with the rider.',
    ),
    'RIDER_JOB_OFFERED': (
        'New delivery job',
        'A new Zippzo delivery is waiting at your store.',
    ),
    'RIDER_ASSIGNED': (
        'Delivery assigned',
        'Order {order_no} is assigned to you.',
    ),
    'RIDER_ARRIVED': (
        'Rider arrived',
        'Your rider is at the door with order {order_no}.',
    ),
    'PICK_TASK_ASSIGNED': (
        'Pick task',
        'An order is waiting to be picked at your store.',
    ),
    'PACK_TASK_ASSIGNED': (
        'Pack task',
        'An order is ready to be packed at your store.',
    ),
}

FALLBACK = (
    'Zippzo update',
    'There is an update on your Zippzo order.',
)


def _message(notification):
    """(title, body) for one notification row, never raising on bad payloads."""
    payload = notification.payload_json or {}
    title, body = TEMPLATES.get(notification.type, FALLBACK)
    try:
        text = body.format(
            order_no=payload.get('order_no', ''),
            otp=payload.get('otp', ''),
            grand_total=payload.get('grand_total', ''),
        )
    except (KeyError, IndexError, ValueError):
        text = FALLBACK[1]
    return title, text


# ── transport (module-level so tests can replace it) ────────────────────────

def _post_json(url, payload, headers=None):
    body = json.dumps(payload, separators=(',', ':')).encode()
    request = urllib.request.Request(
        url, data=body,
        headers={'Content-Type': 'application/json', **(headers or {})},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        raw = response.read().decode() or '{}'
        try:
            return response.status, json.loads(raw)
        except ValueError:
            return response.status, {'raw': raw[:200]}


def _post_form(url, fields, headers=None):
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(
        url, data=body,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            **(headers or {}),
        },
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        raw = response.read().decode() or '{}'
        try:
            return response.status, json.loads(raw)
        except ValueError:
            return response.status, {'raw': raw[:200]}


# ── push ────────────────────────────────────────────────────────────────────

def push_tokens(user_id):
    """Active push tokens for one user, newest first, de-duplicated."""
    from bounded.iam.models import Device, User

    tokens = list(
        Device.objects.filter(user_id=user_id, is_active=True)
        .exclude(push_token='')
        .order_by('-last_seen_at')
        .values_list('push_token', flat=True)
    )
    legacy = (
        User.objects.filter(user_id=user_id)
        .values_list('device_token', flat=True)
        .first()
    )
    if legacy:
        tokens.append(legacy)
    seen, unique = set(), []
    for token in tokens:
        token = (token or '').strip()
        if token and token not in seen:
            seen.add(token)
            unique.append(token)
    return unique


def _fcm_configured():
    return bool(getattr(settings, 'FCM_SERVER_KEY', '').strip())


def _send_push(notification, tokens, title, body):
    if not _fcm_configured():
        return 'skipped', 'FCM_SERVER_KEY is not configured'
    headers = {'Authorization': f'key={settings.FCM_SERVER_KEY}'}
    delivered = 0
    for token in tokens:
        try:
            status, reply = _post_json(
                'https://fcm.googleapis.com/fcm/send',
                {
                    'to': token,
                    'priority': 'high',
                    'notification': {'title': title, 'body': body, 'sound': 'default'},
                    'data': {
                        'type': notification.type,
                        'notification_id': str(notification.notification_id),
                        **(notification.payload_json or {}),
                    },
                },
                headers,
            )
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            logger.warning('FCM request failed: %s', type(exc).__name__)
            return 'failed', 'FCM request failed'
        if status >= 300 or int(reply.get('success') or 0) < 1:
            # `NotRegistered` / `InvalidRegistration`: keep the token out of the
            # next broadcast instead of retrying it forever.
            results = reply.get('results') or [{}]
            if results and str(results[0].get('error', '')).startswith(
                    ('NotRegistered', 'InvalidRegistration', 'MismatchSenderId')):
                from bounded.iam.models import Device
                Device.objects.filter(push_token=token).update(is_active=False)
            return 'failed', 'FCM rejected the message'
        delivered += 1
    return 'sent', f'{delivered} device(s)'


# ── SMS ─────────────────────────────────────────────────────────────────────

def sms_configured():
    provider = getattr(settings, 'SMS_PROVIDER', '').strip().lower()
    if provider == 'twilio':
        return bool(settings.SMS_TWILIO_ACCOUNT_SID
                    and settings.SMS_TWILIO_AUTH_TOKEN
                    and settings.SMS_TWILIO_FROM)
    if provider in ('http', 'webhook'):
        return bool(settings.SMS_GATEWAY_URL)
    if provider == 'msg91':
        return bool(settings.SMS_MSG91_AUTHKEY and settings.SMS_MSG91_TEMPLATE_ID)
    return False


def _sms_phone(user_id):
    from bounded.iam.models import User

    raw = User.objects.filter(user_id=user_id).values_list('phone', flat=True).first()
    digits = ''.join(ch for ch in str(raw or '') if ch.isdigit())
    if len(digits) == 10:
        digits = '91' + digits
    return digits or ''


def _send_sms(notification, phone, text):
    provider = getattr(settings, 'SMS_PROVIDER', '').strip().lower()
    if not phone:
        return 'skipped', 'the recipient has no mobile number'
    try:
        if provider == 'twilio':
            sid = settings.SMS_TWILIO_ACCOUNT_SID
            auth = b64encode(
                f'{sid}:{settings.SMS_TWILIO_AUTH_TOKEN}'.encode()).decode()
            status, reply = _post_form(
                f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
                {'To': f'+{phone}', 'From': settings.SMS_TWILIO_FROM, 'Body': text},
                {'Authorization': f'Basic {auth}'},
            )
            if status >= 300:
                return 'failed', 'Twilio rejected the message'
            return 'sent', str(reply.get('sid') or '')
        if provider in ('http', 'webhook'):
            status, reply = _post_json(
                settings.SMS_GATEWAY_URL,
                {
                    'to': phone,
                    'message': text,
                    'sender': settings.SMS_GATEWAY_SENDER,
                },
                {'Authorization': f'Bearer {settings.SMS_GATEWAY_KEY}'}
                if settings.SMS_GATEWAY_KEY else {},
            )
            if status >= 300:
                return 'failed', 'SMS gateway rejected the message'
            return 'sent', str(reply.get('id') or '')
        if provider == 'msg91':
            status, reply = _post_json(
                'https://control.msg91.com/api/v5/flow/',
                {
                    'template_id': settings.SMS_MSG91_TEMPLATE_ID,
                    'recipients': [{
                        'mobiles': phone,
                        'MESSAGE': text,
                        'ORDER_NO': (notification.payload_json or {}).get('order_no', ''),
                        'OTP': (notification.payload_json or {}).get('otp', ''),
                    }],
                },
                {'authkey': settings.SMS_MSG91_AUTHKEY},
            )
            if status >= 300 or str(reply.get('type', '')).lower() == 'error':
                return 'failed', 'MSG91 rejected the message'
            return 'sent', str(reply.get('message') or '')
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning('SMS request failed: %s', type(exc).__name__)
        return 'failed', 'SMS request failed'
    return 'skipped', 'SMS_PROVIDER is not configured'


# ── entry point ─────────────────────────────────────────────────────────────

def dispatch(notification):
    """Try to deliver one PUSH or SMS row. Returns ``(outcome, detail)``.

    ``outcome`` is ``sent``, ``skipped`` (no provider / no address - the row
    stays unsent and can be retried after configuration) or ``failed`` (the
    provider answered and refused, so the row is stamped and counted).
    """
    title, body = _message(notification)

    if notification.channel == 'PUSH':
        tokens = push_tokens(notification.user)
        if not tokens:
            return 'skipped', 'the recipient has no registered device'
        return _send_push(notification, tokens, title, body)

    if notification.channel == 'SMS':
        if not sms_configured():
            return 'skipped', 'SMS_PROVIDER is not configured'
        phone = _sms_phone(notification.user)
        return _send_sms(notification, phone, f'Zippzo: {body}')

    return 'skipped', f'{notification.channel} is not an out-of-app channel'


def deliver(notification_id):
    """Dispatch and stamp one notification row. Safe to call from on_commit."""
    from bounded.notifications.models import Notification

    notification = Notification.objects.filter(pk=notification_id).first()
    if notification is None:
        return None
    outcome, detail = dispatch(notification)
    now = timezone.now()
    if outcome == 'sent':
        notification.sent_at = now
        notification.failed_at = None
        notification.save(update_fields=['sent_at', 'failed_at'])
    elif outcome == 'failed':
        notification.failed_at = now
        notification.retry_count = (notification.retry_count or 0) + 1
        notification.save(update_fields=['failed_at', 'retry_count'])
    return outcome, detail
