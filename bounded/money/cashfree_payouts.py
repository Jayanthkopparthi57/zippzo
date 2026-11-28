"""Cashfree Payouts (money movement to vendors and staff).

This is deliberately separate from ``bounded.orders.payments`` (customer
collections): payouts use the Payouts product, its own credentials and its own
API host. Credentials are server-only and never returned to clients.

All endpoint paths come from settings so a Cashfree API revision can be adopted
through environment variables without a code deploy.
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

TOKEN_CACHE_KEY = 'cashfree_payout_token_v1'
TOKEN_TTL_SECONDS = 50 * 60


class CashfreePayoutError(Exception):
    """Safe, operator-readable payout error."""


def configured():
    app_id = getattr(settings, 'CASHFREE_PAYOUT_APP_ID', '') or getattr(settings, 'CASHFREE_APP_ID', '')
    secret = getattr(settings, 'CASHFREE_PAYOUT_SECRET_KEY', '') or getattr(settings, 'CASHFREE_SECRET_KEY', '')
    return bool(app_id and secret)


def _credentials():
    app_id = getattr(settings, 'CASHFREE_PAYOUT_APP_ID', '') or getattr(settings, 'CASHFREE_APP_ID', '')
    secret = getattr(settings, 'CASHFREE_PAYOUT_SECRET_KEY', '') or getattr(settings, 'CASHFREE_SECRET_KEY', '')
    return app_id, secret


def _api_root():
    override = getattr(settings, 'CASHFREE_PAYOUT_BASE_URL', '')
    if override:
        return override.rstrip('/')
    mode = getattr(settings, 'CASHFREE_ENV', 'sandbox').lower()
    return ('https://payout-api.cashfree.com' if mode == 'production'
            else 'https://payout-gamma.cashfree.com')


def _request(method, path, payload=None, *, token=None, idempotency_key=None):
    if not configured():
        raise CashfreePayoutError('Cashfree payouts are not configured.')
    app_id, secret = _credentials()
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-client-id': app_id,
        'x-client-secret': secret,
        'x-api-version': getattr(settings, 'CASHFREE_PAYOUT_API_VERSION', '2021-05-25'),
    }
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if idempotency_key:
        headers['x-idempotency-key'] = idempotency_key
    data = json.dumps(payload, separators=(',', ':')).encode() if payload is not None else None
    request = urllib.request.Request(
        f'{_api_root()}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        # Never log provider bodies or headers — they can contain account data.
        logger.warning('Cashfree payout HTTP %s for %s', exc.code, path)
        raise CashfreePayoutError('Cashfree could not process this payout. Please retry.') from None
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning('Cashfree payout request failed for %s: %s', path, type(exc).__name__)
        raise CashfreePayoutError('Cashfree payouts are temporarily unavailable. Please retry.') from None


def get_token():
    """Authorize with Cashfree Payouts. Token is cached briefly per process."""
    cached = cache.get(TOKEN_CACHE_KEY)
    if cached:
        return cached
    response = _request('POST', getattr(settings, 'CASHFREE_PAYOUT_TOKEN_PATH', '/payout/v1/authorize'))
    payload = response.get('data') or response
    token = payload.get('token') if isinstance(payload, dict) else None
    if not token:
        raise CashfreePayoutError('Cashfree payout authorization failed.')
    cache.set(TOKEN_CACHE_KEY, token, TOKEN_TTL_SECONDS)
    return token


def _ok(response):
    return isinstance(response, dict) and str(response.get('status', 'SUCCESS')).upper() in ('SUCCESS', 'OK')


def add_beneficiary(*, beneficiary_id, name, email='', phone='', account='', ifsc='', address='', upi_id=''):
    """Register a beneficiary. Bank account or UPI VPA, idempotent by id."""
    payload = {
        'beneficiary_id': beneficiary_id,
        'name': name,
        'email': email or '',
        'phone': phone or '',
        'address': address or '',
    }
    if upi_id:
        # Cashfree UPI beneficiaries are addressed by VPA, not account/IFSC.
        payload['upi_id'] = upi_id
    else:
        payload['bank_account'] = account
        payload['ifsc'] = ifsc
    response = _request(
        'POST', getattr(settings, 'CASHFREE_PAYOUT_BENEFICIARY_PATH', '/payout/v1/addBeneficiary'),
        payload, token=get_token(), idempotency_key=beneficiary_id)
    if not _ok(response):
        raise CashfreePayoutError('Cashfree rejected the beneficiary details.')
    data = response.get('data') or {}
    return data.get('beneficiary_id') or beneficiary_id


def request_transfer(*, beneficiary_id, amount, reference_id, purpose, mode='IMPS', sender_name='Zippzo'):
    """Send money to a registered beneficiary; reference_id is idempotency safe."""
    payload = {
        'beneficiary_id': beneficiary_id,
        'amount': str(amount),
        'transfer_mode': mode,
        'reference_id': reference_id,
        'purpose': purpose,
        'sender_name': sender_name,
    }
    response = _request(
        'POST', getattr(settings, 'CASHFREE_PAYOUT_TRANSFER_PATH', '/payout/v1/requestTransfer'),
        payload, token=get_token(), idempotency_key=reference_id)
    if not _ok(response):
        raise CashfreePayoutError('Cashfree rejected the transfer.')
    data = response.get('data') or {}
    return {
        'transfer_id': data.get('transfer_id') or data.get('cf_transfer_id') or '',
        'status': str(data.get('status') or response.get('status') or 'PENDING').upper(),
        'raw_status': data.get('status') or response.get('status') or '',
    }


def transfer_status(*, transfer_id='', reference_id=''):
    params = {}
    if transfer_id:
        params['transferId'] = transfer_id
    if reference_id:
        params['referenceId'] = reference_id
    path = getattr(settings, 'CASHFREE_PAYOUT_STATUS_PATH', '/payout/v1/getTransferStatus')
    if params:
        path = f'{path}?{urllib.parse.urlencode(params)}'
    response = _request('GET', path, token=get_token())
    if not _ok(response):
        raise CashfreePayoutError('Cashfree could not check this transfer.')
    data = response.get('data') or {}
    return {
        'transfer_id': data.get('transfer_id') or data.get('cf_transfer_id') or transfer_id,
        'status': str(data.get('status') or 'PENDING').upper(),
        'raw_status': data.get('status') or '',
        'failure_reason': data.get('failure_reason') or data.get('error') or '',
    }
