"""
Настройки прототипа. Ровно столько, сколько нужно, чтобы отрисовать
страницы: ни базы, ни сессий, ни аутентификации — их время не пришло.

Движок шаблонов — Jinja2, а не родной Django: в родном нет склейки имени
при include, и диспетчер типов блоков пришлось бы писать ветвлением.
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

DEBUG = True
SECRET_KEY = 'прототип-не-для-продакшена'
ALLOWED_HOSTS = ['*']
ROOT_URLCONF = 'config.urls'

INSTALLED_APPS = [
    'django.contrib.staticfiles',
    'academy',
]

MIDDLEWARE = [
    'django.middleware.common.CommonMiddleware',
]

TEMPLATES = [{
    'BACKEND': 'django.template.backends.jinja2.Jinja2',
    'DIRS': [BASE_DIR / 'templates'],
    'APP_DIRS': False,
    'OPTIONS': {
        'environment': 'academy.jinja2env.environment',
        # Автоэкранирование — то самое, ради чего всё затевалось:
        # девяносто семь ручных esc() из app.js здесь просто не нужны
        'autoescape': True,
    },
}]

STATIC_URL = '/static/'
# Песочница, стили и рантайм лежат в корне проекта и не переезжали:
# Pyodide как работал в браузере, так и работает
STATICFILES_DIRS = [
    BASE_DIR / 'static',
    PROJECT_ROOT,
]

USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
