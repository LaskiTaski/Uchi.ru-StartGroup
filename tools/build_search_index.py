#!/usr/bin/env python3
"""
Сборка поискового индекса.

    python3 tools/build_search_index.py
    python3 tools/build_search_index.py --check   # только сверка, без записи

Читает манифест и все незащищённые модули, складывает из них
компактный индекс в data/search-index.json. Браузеру больше не нужно
скачивать все материалы целиком ради поиска.

Запускать после правки контента — вместе с tools/validate.py.
Режим --check не пишет файл, а сравнивает лежащий в репозитории
индекс с пересобранным и возвращает 1 при расхождении: забытая
пересборка иначе молча оставляет поиск на старых данных.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUTPUT = DATA / 'search-index.json'

# Сколько символов текста раздела класть в индекс. Раньше хватало только
# на сниппет (600), но всё, что не влезло, не участвовало в поиске вообще —
# подняли лимит, чтобы находились и подсказки/разборы заданий в конце
# длинных разделов, а размер индекса всё равно остаётся некритичным
BODY_LIMIT = 2000


def clean(text: str) -> str:
    """Убираем разметку, оставляем читаемый текст."""
    text = re.sub(r'\[([^\]]+)\]\(#[A-Za-z0-9_-]+\)', r'\1', text)   # ссылки
    text = text.replace('`', '').replace('**', '')
    return re.sub(r'\s+', ' ', text).strip()


def section_text(section: dict) -> str:
    parts = [section.get('desc', '')]

    for block in section.get('blocks', []):
        parts.append(block.get('text', ''))
        parts.append(block.get('title', ''))
        parts.append(block.get('code', ''))
        parts.append(' '.join(block.get('head', [])))   # заголовки таблиц
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
        # викторина: вопрос, варианты и пояснение — тоже часть текста раздела
        for question in block.get('questions', []):
            parts.append(question.get('text', ''))
            parts.extend(question.get('options', []))
            parts.append(question.get('explain', ''))

    return clean(' '.join(p for p in parts if p))[:BODY_LIMIT]


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
            index.append({
                'mod': module['id'],
                'anchor': section['anchor'],
                'icon': section['num'],
                'title': section['title'],
                'chip': section.get('chip', ''),
                'module': module['label'],
                'body': section_text(section),
            })

        for lesson in data.get('lessons', []):
            if lesson.get('attestation'):
                continue
            index.append({
                'mod': module['id'],
                'anchor': lesson_anchor(module['id'], lesson['num']),
                'icon': lesson['num'],
                'title': lesson['title'],
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

    print(f'Записей в индексе: {len(index)}')
    print(f'Размер индекса:    {index_size / 1024:.0f} КБ')
    print(f'Было бы загружено: {source_size / 1024:.0f} КБ')
    print(f'Экономия:          {100 - index_size / source_size * 100:.0f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
