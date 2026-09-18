"""
Контент: чтение data/*.json и нарезка разделов на шаги.

Главное здесь — то, чего НЕ написано. Правило «где кончается шаг» живёт
в одном месте, tools/build_search_index.py, и импортируется сюда. В
статической версии это правило существовало дважды: sectionSteps в app.js
для отрисовки и section_steps на Python для сборки индекса. Две копии
одного правила на двух языках — это и был остаток долга Д-5.

Модули читаются один раз при старте и держатся в памяти: их полтора
десятка, суммарно меньше мегабайта, и переживать за это нечего.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from tools.build_search_index import section_steps, lesson_anchor   # noqa: E402

DATA = ROOT / 'data'

# Значок и подпись оцениваемого блока — те же, что у сборщика индекса
GRADED = {
    'task': {'icon': '📝', 'title': 'Задание'},
    'quiz': {'icon': '❓', 'title': 'Викторина'},
}


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


class Catalog:
    """Манифест и все модули, прочитанные один раз."""

    def __init__(self):
        manifest = _read(DATA / 'manifest.json')
        self.groups = manifest['groups']
        self.modules = manifest['modules']
        self.by_id = {m['id']: m for m in self.modules}
        self._data = {}

        for meta in self.modules:
            if meta.get('file'):
                self._data[meta['id']] = _read(ROOT / meta['file'])

    def data(self, mod_id: int) -> dict | None:
        return self._data.get(mod_id)

    def meta(self, mod_id: int) -> dict | None:
        return self.by_id.get(mod_id)

    def section(self, mod_id: int, anchor: str) -> dict | None:
        data = self.data(mod_id) or {}
        for section in data.get('sections', []):
            if section['anchor'] == anchor:
                return section
        return None

    def lesson(self, mod_id: int, anchor: str) -> dict | None:
        data = self.data(mod_id) or {}
        for lesson in data.get('lessons', []):
            if lesson_anchor(mod_id, lesson['num']) == anchor:
                return lesson
        return None

    def groups_with_modules(self) -> list[dict]:
        """Каталог: группы с разложенными по ним материалами."""
        out = []
        for group in self.groups:
            mods = [m for m in self.modules if m['group'] == group['id']]
            out.append({**group, 'modules': mods})
        return out


def step_view(section: dict, step: dict, number: int) -> dict:
    """Шаг, приготовленный для шаблона: заголовок, значок, блоки.

    Шаблону не надо знать, чем оцениваемый шаг отличается от шага теории —
    у обоих одинаковый вид: title, icon, blocks. Разбирается это здесь.
    """
    graded = step.get('graded')
    if graded:
        info = GRADED[graded['type']]
        return {
            'num': number,
            'kind': 'graded',
            'title': graded.get('title') or info['title'],
            'icon': info['icon'],
            'blocks': [graded],
            'graded_type': graded['type'],
            'task_id': graded.get('id'),
        }

    heading = step.get('heading')
    return {
        'num': number,
        'kind': 'theory',
        'title': heading['text'] if heading else section.get('title', 'Вступление'),
        'icon': section.get('num', ''),
        'blocks': step['blocks'],
        'graded_type': None,
        'task_id': None,
    }


def steps_of(section: dict) -> list[dict]:
    """Все шаги раздела — тем же правилом, что режет поисковый индекс."""
    return [step_view(section, step, i)
            for i, step in enumerate(section_steps(section), start=1)]


def neighbours(catalog: Catalog, mod_id: int, anchor: str, number: int) -> dict:
    """Соседние шаги для кнопок «Назад» и «Далее».

    Границы раздела переходят в соседний раздел — иначе ученик упирается
    в конец полотна и не понимает, что курс продолжается.
    """
    data = catalog.data(mod_id) or {}
    sections = data.get('sections', [])
    index = next((i for i, s in enumerate(sections) if s['anchor'] == anchor), None)
    if index is None:
        return {'back': None, 'forward': None}

    total = len(steps_of(sections[index]))
    back = forward = None

    if number > 1:
        back = {'anchor': anchor, 'step': number - 1}
    elif index > 0:
        prev = sections[index - 1]
        back = {'anchor': prev['anchor'], 'step': len(steps_of(prev))}

    if number < total:
        forward = {'anchor': anchor, 'step': number + 1}
    elif index + 1 < len(sections):
        forward = {'anchor': sections[index + 1]['anchor'], 'step': 1}

    return {'back': back, 'forward': forward}


catalog = Catalog()
