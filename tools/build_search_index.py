#!/usr/bin/env python3
"""
Сборка поискового индекса.

    python3 tools/build_search_index.py
    python3 tools/build_search_index.py --check   # только сверка, без записи

Читает манифест и все незащищённые модули, складывает из них компактный
индекс в data/search-index.json. Браузеру больше не нужно скачивать все
материалы целиком ради поиска.

Единица индекса — ШАГ, а не раздел. Раньше раздел «Списки» весом
в одиннадцать тысяч символов попадал в индекс обрезанным до двух тысяч,
и шесть десятых материала не искались вообще. Теперь у каждого шага свой
адрес (#/m/<id>/<anchor>/<n>), запись получается маленькой, обрезать
нечего, а результат поиска ведёт прямо на нужный шаг, а не в начало
огромного раздела.

Запускать после правки контента — вместе с tools/validate.py.
Режим --check не пишет файл, а сравнивает лежащий в репозитории индекс
с пересобранным и возвращает 1 при расхождении: забытая пересборка иначе
молча оставляет поиск на старых данных.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUTPUT = DATA / 'search-index.json'

# Потолок текста одного шага. Шаг — это кусок раздела до следующего
# подзаголовка, он на порядок короче раздела, поэтому лимит почти никогда
# не срабатывает и стоит здесь страховкой от неожиданно огромного блока.
BODY_LIMIT = 1500

# Значок записи: у шага теории — номер раздела, у оцениваемого блока — свой.
# Тот же порядок в app.js (GRADED_BLOCKS), иначе запасной индекс в браузере
# начнёт показывать не то, что предсобранный.
GRADED_ICONS = {'task': '📝', 'quiz': '❓'}
GRADED_TITLES = {'task': 'Задание', 'quiz': 'Викторина'}


def clean(text: str) -> str:
    """Убираем разметку, оставляем читаемый текст."""
    text = re.sub(r'\[([^\]]+)\]\(#[A-Za-z0-9_-]+\)', r'\1', text)   # ссылки
    text = text.replace('`', '').replace('**', '')
    return re.sub(r'\s+', ' ', text).strip()


def block_text(block: dict) -> list[str]:
    """Всё читаемое из блока — тем же составом, что собирает app.js."""
    parts = [block.get('text', ''), block.get('title', ''), block.get('code', ''),
             ' '.join(block.get('head', []))]
    for row in block.get('rows', []):
        parts.append(' '.join(row))
    parts.extend(block.get('items', []))
    for side in ('good', 'bad'):
        if block.get(side):
            parts.append(block[side].get('title', ''))
            parts.append(block[side].get('code', ''))
    # подсказка и разбор задания — их тоже ищут по ключевым словам
    parts.append(block.get('hint', ''))
    parts.append(block.get('explain', ''))
    for question in block.get('questions', []):
        parts.append(question.get('text', ''))
        parts.extend(question.get('options', []))
        parts.append(question.get('explain', ''))
    return parts


def section_steps(section: dict) -> list[dict]:
    """Разрез раздела на шаги — то же правило, что sectionSteps в app.js.

    Блоки до первого подзаголовка — шаг вступления; каждый подзаголовок
    начинает новый шаг; оцениваемый блок (задание, викторина) — шаг сам
    по себе. Пустое вступление отбрасывается: раздел может начинаться
    сразу с подзаголовка, и читать там нечего.
    """
    steps: list[dict] = []
    theory: dict | None = {'heading': None, 'blocks': []}
    steps.append(theory)

    for block in section.get('blocks', []):
        kind = block.get('type')
        if kind in GRADED_ICONS:
            steps.append({'graded': block})
            theory = None
            continue
        if kind == 'heading':
            theory = {'heading': block, 'blocks': []}
            steps.append(theory)
            continue
        if theory is None:
            theory = {'heading': None, 'blocks': []}
            steps.append(theory)
        theory['blocks'].append(block)

    first = steps[0]
    if len(steps) > 1 and not first.get('graded') and not first['heading'] and not first['blocks']:
        steps.pop(0)
    return steps


def step_entry(module: dict, section: dict, step: dict, number: int, is_first: bool) -> dict:
    graded = step.get('graded')
    if graded:
        title = graded.get('title') or GRADED_TITLES[graded['type']]
        icon = GRADED_ICONS[graded['type']]
        parts = block_text(graded)
    else:
        title = step['heading']['text'] if step['heading'] else section.get('title', '')
        icon = section.get('num', '')
        parts = []
        for block in step['blocks']:
            parts.extend(block_text(block))

    # Описание раздела относится ко всему разделу, но искать его логично
    # на первом шаге — туда ученик и попадёт
    if is_first:
        parts.insert(0, section.get('desc', ''))

    return {
        'mod': module['id'],
        'anchor': section['anchor'],
        'step': number,
        'icon': icon,
        'title': title,
        'section': section.get('title', ''),
        'chip': section.get('chip', ''),
        'module': module['label'],
        'body': clean(' '.join(p for p in parts if p))[:BODY_LIMIT],
    }


def lesson_anchor(module_id: int, num) -> str:
    return f"l{module_id}-{str(num).replace('.', '-')}"


def build() -> list[dict]:
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    index = []

    for module in manifest['modules']:
        if module.get('protected') or not module.get('file'):
            continue        # защищённый раздел и карточка-заглушка без
                            # файла (status: planned) в поиск не попадают

        data = json.loads((ROOT / module['file']).read_text(encoding='utf-8'))

        for section in data.get('sections', []):
            steps = section_steps(section)
            for number, step in enumerate(steps, start=1):
                index.append(step_entry(module, section, step, number, number == 1))

        for lesson in data.get('lessons', []):
            if lesson.get('attestation'):
                continue
            index.append({
                'mod': module['id'],
                'anchor': lesson_anchor(module['id'], lesson['num']),
                'step': 1,
                'icon': lesson['num'],
                'title': lesson['title'],
                'section': lesson['title'],
                'chip': '',
                'module': module['label'],
                'body': clean(lesson.get('desc', ''))[:BODY_LIMIT],
            })

    return index


def serialize(index: list[dict]) -> str:
    return json.dumps(index, ensure_ascii=False, separators=(',', ':'))


def main() -> int:
    index = build()
    payload = serialize(index)

    if '--check' in sys.argv:
        current = OUTPUT.read_text(encoding='utf-8') if OUTPUT.exists() else ''
        if current == payload:
            print(f'Индекс актуален: {len(index)} записей.')
            return 0
        print('❌ data/search-index.json не совпадает с пересобранным.')
        print('   Запустите: python3 tools/build_search_index.py')
        return 1

    OUTPUT.write_text(payload, encoding='utf-8')

    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    source_size = sum((ROOT / m['file']).stat().st_size
                      for m in manifest['modules'] if not m.get('protected') and m.get('file'))
    index_size = OUTPUT.stat().st_size
    cut = sum(1 for e in index if len(e['body']) == BODY_LIMIT)

    print(f'Записей в индексе: {len(index)}')
    print(f'Обрезано по лимиту: {cut}')
    print(f'Размер индекса:    {index_size / 1024:.0f} КБ')
    print(f'Было бы загружено: {source_size / 1024:.0f} КБ')
    print(f'Экономия:          {100 - index_size / source_size * 100:.0f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
