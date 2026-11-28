"""Shared helpers for starting and syncing Cashfree payouts."""
from decimal import Decimal

from django.utils import timezone

from . import cashfree_payouts


def start_payout(record, *, beneficiary_id, amount, reference_id, purpose,
                 name, email='', phone='', account='', ifsc='', address='',
                 upi_id='', mode='IMPS'):
    """Register the beneficiary and send a transfer; return fields to persist.

    A UPI beneficiary needs only a VPA, so staff without a bank account can
    still be paid through Cashfree.
    """
    cashfree_payouts.add_beneficiary(
        beneficiary_id=beneficiary_id, name=name, email=email, phone=phone,
        account=account, ifsc=ifsc, address=address, upi_id=upi_id)
    result = cashfree_payouts.request_transfer(
        beneficiary_id=beneficiary_id, amount=amount, reference_id=reference_id,
        purpose=purpose, mode=mode)
    status = result['status']
    settled = status in ('SUCCESS', 'COMPLETED')
    failed = status in ('FAILED', 'CANCELLED', 'REVERSED')
    values = {
        'payout_channel': 'CASHFREE',
        'payout_status': 'SUCCESS' if settled else ('FAILED' if failed else 'PENDING'),
        'beneficiary_id': beneficiary_id,
        'transfer_id': result['transfer_id'],
        'payout_reference': reference_id,
        'payout_error': '' if not failed else result.get('raw_status', ''),
        'payout_initiated_at': timezone.now(),
        'payout_completed_at': timezone.now() if (settled or failed) else None,
    }
    if settled:
        values['status'] = 'COMPLETE' if hasattr(record, 'payment_date') else 'PAID'
    return values


def sync_payout(record):
    if record.payout_channel != 'CASHFREE' or not record.transfer_id:
        return None
    result = cashfree_payouts.transfer_status(
        transfer_id=record.transfer_id, reference_id=record.payout_reference)
    status = result['status']
    settled = status in ('SUCCESS', 'COMPLETED')
    failed = status in ('FAILED', 'CANCELLED', 'REVERSED')
    values = {
        'payout_status': 'SUCCESS' if settled else ('FAILED' if failed else 'PENDING'),
        'payout_error': result.get('failure_reason', '')[:240],
        'payout_completed_at': timezone.now() if (settled or failed) else None,
    }
    if settled:
        values['status'] = 'COMPLETE' if hasattr(record, 'payment_date') else 'PAID'
    return values
