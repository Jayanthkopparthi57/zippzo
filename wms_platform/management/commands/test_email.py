from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Send a test email using the configured SMTP settings.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--to',
            default=settings.EMAIL_HOST_USER or 'test@example.com',
            help='Recipient email address (defaults to EMAIL_USER)',
        )

    def handle(self, *args, **options):
        recipient = options['to']
        self.stdout.write(f'Backend: {settings.EMAIL_BACKEND}')
        self.stdout.write(f'From:    {settings.DEFAULT_FROM_EMAIL}')
        self.stdout.write(f'To:      {recipient}')

        if not getattr(settings, 'EMAIL_CONFIGURED', False):
            self.stderr.write(self.style.WARNING(
                'EMAIL_USER / EMAIL_PASS not set — using console backend.'
            ))

        try:
            sent = send_mail(
                subject='Zippzo WMS - Email Test',
                message='If you received this, SMTP is configured correctly.',
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient],
                fail_silently=False,
            )
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'Failed: {exc}'))
            self.stderr.write(
                'Generate a new Gmail App Password at '
                'https://myaccount.google.com/apppasswords and update .env'
            )
            return

        if sent:
            self.stdout.write(self.style.SUCCESS(f'Sent {sent} message(s) successfully.'))
        else:
            self.stderr.write(self.style.ERROR('No messages were sent.'))
