import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

_env_path = BASE_DIR / '.env'
if _env_path.exists():
    for line in _env_path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def _env_bool(name, default=False):
    """Parse a boolean env var. Anything unset falls back to `default`."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_list(name):
    """Comma-separated env var -> trimmed list, blanks dropped."""
    return [item.strip() for item in os.environ.get(name, '').split(',') if item.strip()]


# `development` (default) is a laptop or the Playwright suite; `production` is
# Render. The two differ only in how much this file is willing to forgive:
# production refuses to boot with a placeholder secret or a wildcard host
# instead of silently shipping it.
DJANGO_ENV = os.environ.get('DJANGO_ENV', 'development').strip().lower()
IS_PRODUCTION = DJANGO_ENV == 'production'

# Secrets that have ever been committed to this repository, or handed out by a
# template. Booting production with one of these would let anyone on GitHub
# forge sessions, so they are rejected outright rather than merely warned about.
_INSECURE_SECRET_KEYS = {
    'zippzo-dev-secret-key-change-in-production',
    'change-me-in-production',
    'django-insecure-change-me',
}

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY or SECRET_KEY in _INSECURE_SECRET_KEYS:
    if IS_PRODUCTION:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY is missing or is a known placeholder. Generate one with: '
            'python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"'
        )
    # Development only: a throwaway key that is never valid outside this machine.
    SECRET_KEY = SECRET_KEY or 'zippzo-dev-secret-key-local-only-not-for-production'

DEBUG = _env_bool('DEBUG', True)

if IS_PRODUCTION:
    ALLOWED_HOSTS = _env_list('ALLOWED_HOSTS')
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured(
            'ALLOWED_HOSTS must list the real hostnames when DJANGO_ENV=production.'
        )
else:
    # Playwright and the Django test client hit localhost/127.0.0.1 directly.
    ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
    'django_extensions',
    # Platform Core (19 bounded contexts)
    'bounded.iam',
    'bounded.audit',
    'bounded.outbox',
    'bounded.notifications',
    'bounded.holds',
    'bounded.network',
    'bounded.catalog',
    'bounded.supply',
    'bounded.inventory',
    'bounded.routing',
    'bounded.ds_ops',
    'bounded.fulfilment',
    'bounded.orders',
    'bounded.delivery',
    'bounded.lastmile',
    'bounded.money',
    'bounded.reverse',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Directly after SecurityMiddleware, per the WhiteNoise docs: it serves
    # STATIC_ROOT and WHITENOISE_ROOT without touching the URLconf.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'zippzo_wms.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'frontend' / 'dist', BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'zippzo_wms.wsgi.application'
ASGI_APPLICATION = 'zippzo_wms.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': os.environ.get('DB_ENGINE', 'django.db.backends.postgresql'),
        'NAME': os.environ.get('DB_NAME', 'neondb'),
        'USER': os.environ.get('DB_USER', 'neondb_owner'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', ''),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'OPTIONS': {
            'sslmode': os.environ.get('DB_SSLMODE', 'require'),
            # Passed straight through to libpq. Without it a connect that
            # never completes blocks indefinitely - a stalled Neon connect sat
            # for two hours mid-suite and had to be killed, which is worse
            # than a failure you can see and rerun.
            'connect_timeout': int(os.environ.get('DB_CONNECT_TIMEOUT', '10')),
            # Applied as libpq start-up parameters, alongside `sslmode` rather
            # than on top of it. This used to be a second assignment of a fresh
            # dict over the whole OPTIONS block, which silently threw the
            # `sslmode` above away and left every connection on libpq's `prefer`.
            'options': '-c timezone=Asia/Kolkata',
        },
        # Neon's pooled endpoint drops connections without warning. Django
        # would keep handing the dead one back, so a single blip failed every
        # query that followed it - in the test suite, every later setUpClass.
        # Check the connection before borrowing it and reconnect instead.
        'CONN_HEALTH_CHECKS': True,
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
# collectstatic output (Django admin / app assets). WHITENOISE_ROOT below is
# what serves the built SPA.
STATIC_ROOT = BASE_DIR / 'staticfiles'
_static_dirs = [BASE_DIR / 'frontend' / 'dist', BASE_DIR / 'static']
# Only declare dirs that actually exist: Django raises SuspiciousFileOperation
# at collectstatic for a missing entry, and a fresh clone has no frontend/dist.
STATICFILES_DIRS = [path for path in _static_dirs if path.exists()]
# Built Vite output. WhiteNoise serves index.html and /assets/* from here
# regardless of DEBUG, which django.conf.urls.static.static() does not — those
# helpers return an empty list when DEBUG is False, so the deployed SPA used to
# 404 on every JavaScript and stylesheet request.
WHITENOISE_ROOT = BASE_DIR / 'frontend' / 'dist'
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        # Compresses at collectstatic time; deliberately not the manifest
        # variant, which 500s the whole site if any single asset name drifts.
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# HTTPS
# ---------------------------------------------------------------------------
# Render terminates TLS in front of the app and forwards X-Forwarded-Proto, so
# Django must be told to trust that header or it will redirect every request
# into an infinite loop. `DJANGO_BEHIND_SSL` defaults to the environment, and
# is set explicitly in render.yaml so the behaviour is declared rather than
# inferred. Off by default in development so Playwright keeps talking plain
# HTTP to 127.0.0.1.
BEHIND_SSL = _env_bool('DJANGO_BEHIND_SSL', IS_PRODUCTION)
SECURE_SSL_REDIRECT = BEHIND_SSL
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https') if BEHIND_SSL else None
SESSION_COOKIE_SECURE = BEHIND_SSL
CSRF_COOKIE_SECURE = BEHIND_SSL
SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_HSTS_SECONDS', '31536000' if BEHIND_SSL else '0'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = BEHIND_SSL
# HSTS preload is a one-way trip for every subdomain of the domain, so it stays
# opt-in rather than following the rest of the HTTPS block.
SECURE_HSTS_PRELOAD = _env_bool('DJANGO_HSTS_PRELOAD', False)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# The web SPA is served same-origin by Django and proxied by Vite in
# development, so neither needs CORS. The only cross-origin client is the
# Capacitor shell, whose WebView origin is one of the three below; production
# refuses the wildcard rather than defaulting to it.
if IS_PRODUCTION:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = _env_list('CORS_ALLOWED_ORIGINS') or [
        'capacitor://localhost',
        'https://localhost',
        'http://localhost',
    ]
else:
    CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

REST_FRAMEWORK = {
    # Honours ?page_size= (default still 50). The scan-first screens resolve
    # barcodes against the whole catalog/location set, and a hard 50-row cap
    # made a real SKU look like an unknown barcode.
    'DEFAULT_PAGINATION_CLASS': 'bounded.pagination.ZippzoPageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'bounded.iam.authentication.jwt.JWTAuthentication',
    ],
    # Deny-by-default. Without this, every DRF view/viewset that omits
    # `permission_classes` falls back to AllowAny, which left customer PII,
    # order, payment, refund and rider-earnings data readable by an anonymous
    # HTTP client. Views that must stay public (login, schema) opt out
    # explicitly with `authentication_classes = []` + `permission_classes = []`,
    # so a new view is secure unless somebody deliberately opens it.
    # Enforced by bounded.tests.test_auth_defaults.
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Zippzo Quick-Commerce Platform API',
    'DESCRIPTION': 'Full quick-commerce platform: MH→DS→Rider network',
    'VERSION': '3.7.0',
}

# Redis
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [REDIS_URL],
        },
    },
}

# Celery
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL

# Email
EMAIL_USER = os.environ.get('EMAIL_USER', '').strip()
EMAIL_PASS = os.environ.get('EMAIL_PASS', '').replace(' ', '')
if EMAIL_USER and EMAIL_PASS:
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
    EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'true').lower() == 'true'
    EMAIL_HOST_USER = EMAIL_USER
    EMAIL_HOST_PASSWORD = EMAIL_PASS
    EMAIL_TIMEOUT = 30
    DEFAULT_FROM_EMAIL = EMAIL_USER
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
    DEFAULT_FROM_EMAIL = 'auth@zippzo.com'
