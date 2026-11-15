"""Push and SMS are real edges now, tested without calling a provider.

The in-app inbox was always delivered - the row is the message. Push and SMS
are different: a provider must accept the message before the row can claim it
was sent. These cases pin the three outcomes that matter:

  * no credentials is ``skipped`` and leaves ``sent_at`` NULL, so the message
    can be replayed after configuration instead of being lost;
  * a provider acceptance stamps ``sent_at``;
  * a provider refusal stamps ``failed_at``, counts a retry, and dead FCM
    tokens are deactivated rather than retried forever.
"""
import uuid
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings

from bounded.iam.models import Device, User
from bounded.notifications import channels
from bounded.notifications.models import Notification
from bounded.notifications.publish import publish_event
from bounded.outbox.models import OutboxEvent


class ChannelBase(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(
            email='push@zippzo.in', password_hash=make_password('Push123!'),
            role='CUSTOMER', status='ACTIVE', phone='9876543210')
        cls.device = Device.objects.create(
            user=cls.user, device_token='device-1', platform='ANDROID',
            push_token='fcm-token-1')

    def notification(self, channel, **overrides):
        values = {
            'user': self.user.user_id, 'type': 'ORDER_PACKED',
            'channel': channel, 'idempotency_key': str(uuid.uuid4()),
            'payload_json': {'order_no': 'ZP-1001'},
        }
        values.update(overrides)
        return Notification.objects.create(**values)


class PushChannelTests(ChannelBase):

    @override_settings(FCM_SERVER_KEY='')
    def test_push_without_credentials_is_skipped_and_replayable(self):
        row = self.notification('PUSH')

        outcome, detail = channels.deliver(row.notification_id)

        self.assertEqual('skipped', outcome)
        self.assertIn('FCM_SERVER_KEY', detail)
        row.refresh_from_db()
        self.assertIsNone(row.sent_at)
        self.assertIsNone(row.failed_at)

    @override_settings(FCM_SERVER_KEY='server-key')
    @patch('bounded.notifications.channels._post_json')
    def test_push_is_stamped_when_fcm_accepts(self, post):
        post.return_value = (200, {'success': 1, 'results': [{'message_id': 'm-1'}]})
        row = self.notification('PUSH')

        outcome, detail = channels.deliver(row.notification_id)

        self.assertEqual('sent', outcome)
        row.refresh_from_db()
        self.assertIsNotNone(row.sent_at)
        url, body = post.call_args.args[0], post.call_args.args[1]
        self.assertIn('fcm.googleapis.com', url)
        self.assertEqual('fcm-token-1', body['to'])
        self.assertIn('ZP-1001', body['notification']['body'])
        headers = post.call_args.args[2]
        self.assertEqual('key=server-key', headers['Authorization'])

    @override_settings(FCM_SERVER_KEY='server-key')
    @patch('bounded.notifications.channels._post_json')
    def test_a_dead_token_is_deactivated_not_retried_forever(self, post):
        post.return_value = (
            200, {'success': 0, 'results': [{'error': 'NotRegistered'}]})
        row = self.notification('PUSH')

        outcome, _ = channels.deliver(row.notification_id)

        self.assertEqual('failed', outcome)
        row.refresh_from_db()
        self.assertIsNotNone(row.failed_at)
        self.assertEqual(1, row.retry_count)
        self.device.refresh_from_db()
        self.assertFalse(self.device.is_active)

    def test_a_recipient_with_no_device_is_skipped(self):
        other = User.objects.create(
            email='nodevice@zippzo.in', password_hash=make_password('Push123!'),
            role='CUSTOMER', status='ACTIVE')
        row = self.notification('PUSH', user=other.user_id)

        self.assertEqual('skipped', channels.dispatch(row)[0])


class SmsChannelTests(ChannelBase):

    @override_settings(SMS_PROVIDER='')
    def test_sms_without_a_provider_is_skipped(self):
        row = self.notification('SMS')
        outcome, detail = channels.dispatch(row)
        self.assertEqual('skipped', outcome)
        self.assertIn('SMS_PROVIDER', detail)

    @override_settings(
        SMS_PROVIDER='twilio', SMS_TWILIO_ACCOUNT_SID='AC123',
        SMS_TWILIO_AUTH_TOKEN='token', SMS_TWILIO_FROM='+919999999999')
    @patch('bounded.notifications.channels._post_form')
    def test_twilio_receives_a_country_code_prefixed_number(self, post):
        post.return_value = (201, {'sid': 'SM123'})
        row = self.notification('SMS')

        outcome, detail = channels.deliver(row.notification_id)

        self.assertEqual('sent', outcome)
        self.assertEqual('SM123', detail)
        fields = post.call_args.args[1]
        self.assertEqual('+919876543210', fields['To'])
        self.assertIn('ZP-1001', fields['Body'])

    @override_settings(
        SMS_PROVIDER='http', SMS_GATEWAY_URL='https://sms.example/send',
        SMS_GATEWAY_KEY='gateway-key')
    @patch('bounded.notifications.channels._post_json')
    def test_a_generic_http_gateway_is_supported(self, post):
        post.return_value = (200, {'id': 'gw-1'})
        row = self.notification('SMS')

        outcome, detail = channels.deliver(row.notification_id)

        self.assertEqual('sent', outcome)
        self.assertEqual('gw-1', detail)
        payload = post.call_args.args[1]
        self.assertEqual('919876543210', payload['to'])
        self.assertEqual('Bearer gateway-key',
                         post.call_args.args[2]['Authorization'])

    def test_a_recipient_with_no_phone_is_skipped(self):
        other = User.objects.create(
            email='nophone@zippzo.in', password_hash=make_password('Push123!'),
            role='CUSTOMER', status='ACTIVE')
        row = self.notification('SMS', user=other.user_id)
        with override_settings(
                SMS_PROVIDER='twilio', SMS_TWILIO_ACCOUNT_SID='AC123',
                SMS_TWILIO_AUTH_TOKEN='token', SMS_TWILIO_FROM='+919999999999'):
            outcome, detail = channels.dispatch(row)
        self.assertEqual('skipped', outcome)
        self.assertIn('mobile number', detail)


class PublisherWiringTests(ChannelBase):
    """Publishing an event schedules the provider edge after commit."""

    @override_settings(FCM_SERVER_KEY='server-key')
    @patch('bounded.notifications.channels._post_json')
    def test_an_otp_event_sends_push_after_the_row_commits(self, post):
        post.return_value = (200, {'success': 1, 'results': [{}]})
        event = OutboxEvent.objects.create(
            aggregate_type='DeliveryTask',
            aggregate_id=uuid.uuid4(),
            event_type='delivery.pod_requested',
            payload_json={
                'customer_user_id': str(self.user.user_id),
                'order_no': 'ZP-1001', 'otp': '4321',
            },
        )

        with self.captureOnCommitCallbacks(execute=True):
            publish_event(event)

        push = Notification.objects.get(
            user=self.user.user_id, channel='PUSH', type='DELIVERY_OTP')
        self.assertIsNotNone(push.sent_at)
        sms = Notification.objects.get(
            user=self.user.user_id, channel='SMS', type='DELIVERY_OTP')
        # No SMS provider is configured in this case, so the row exists and can
        # still be replayed - it is not marked sent on the strength of a DB
        # insert.
        self.assertIsNone(sms.sent_at)
        self.assertIn('4321', push.payload_json['otp'])
