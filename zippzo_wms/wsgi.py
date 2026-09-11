import os
import logging
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'zippzo_wms.settings')
application = get_wsgi_application()


def ensure_seed_data():
	"""Populate a new deployment once so the console has master data to use."""
	try:
		from django.core.management import call_command
		from wms_master.models import Site

		if not Site.objects.exists():
			call_command('seed_data', verbosity=0)
	except Exception:
		logging.getLogger(__name__).exception('Unable to seed initial WMS data')


ensure_seed_data()
