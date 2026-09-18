"""
Окружение Jinja2: фильтры, которых в шаблонизаторе нет из коробки.

Django подключён с движком Jinja2, а не со своим: в родном языке шаблонов
нет склейки имени при include, и диспетчер типов блоков пришлось бы писать
ветвлением — ровно тем, от которого мы уходим. В Jinja это одна строка:

    {% include "blocks/" ~ block.type ~ ".html" %}
"""

import json
import re

from django.urls import reverse
from jinja2 import Environment
from markupsafe import Markup, escape


def inline(text) -> Markup:
    """Разметка внутри абзаца: `код`, **жирный**, [ссылка](#якорь).

    Экранирование идёт первым — иначе разметка из данных попала бы
    в HTML как есть. Дальше уже по экранированному тексту ищутся
    наши три формы, и ничего чужого в них не превратится.
    """
    out = str(escape('' if text is None else text))
    out = re.sub(r'`([^`]+)`', r'<code class="ic">\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    out = re.sub(r'\[([^\]]+)\]\(#([A-Za-z0-9_-]+)\)',
                 r'<a class="ref-link" href="#\2" data-anchor="\2">\1</a>', out)
    return Markup(out)


def to_json(value) -> Markup:
    """Данные для клиентского JS в data-атрибуте.

    Внутри атрибута опасна кавычка, поэтому отдаём через escape: Jinja
    подставит &quot; и разметка не развалится на первом же ключе.
    """
    return escape(json.dumps(value, ensure_ascii=False))


def environment(**options) -> Environment:
    env = Environment(**options)
    env.globals.update(url=reverse)
    env.filters.update(inline=inline, tojson_attr=to_json)
    return env
