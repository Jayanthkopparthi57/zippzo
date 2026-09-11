import hmac
import hashlib
import json
import requests
from celery import shared_task
from django.utils import timezone
from .models import OutgoingWebhook

@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def trigger_outgoing_webhook_async(self, event_type, payload):
    """
    Dispatches asynchronous webhooks to registered endpoints with HMAC-SHA256 signatures,
    idempotency headers, and exponential backoff retries.
    """
    webhooks = OutgoingWebhook.objects.filter(event_type=event_type, is_active=True)
    results = []

    for hook in webhooks:
        try:
            payload_str = json.dumps(payload, sort_keys=True)
            signature = hmac.new(
                hook.secret_token.encode('utf-8'),
                payload_str.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()

            headers = {
                'Content-Type': 'application/json',
                'X-Zippzo-Event': event_type,
                'X-Zippzo-Signature': signature,
                'X-Zippzo-Webhook-ID': str(hook.webhook_id),
                'X-Zippzo-Idempotency-Key': f"{hook.webhook_id}_{event_type}_{timezone.now().strftime('%Y%m%d%H%M')}"
            }

            response = requests.post(
                hook.target_url,
                data=payload_str,
                headers=headers,
                timeout=10
            )

            hook.last_triggered_at = timezone.now()
            hook.last_response_code = response.status_code
            hook.last_error_message = None
            hook.save()

            results.append({'webhook_id': str(hook.id), 'status': response.status_code})
            response.raise_for_status()

        except Exception as exc:
            hook.retry_count += 1
            hook.last_error_message = str(exc)
            hook.save()
            results.append({'webhook_id': str(hook.id), 'error': str(exc)})
            
            # Retry with exponential backoff: 60s, 120s, 240s, 480s...
            if self.request.retries < hook.max_retries:
                raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))

    return results
