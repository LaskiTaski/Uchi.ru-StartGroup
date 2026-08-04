#!/usr/bin/env python3
"""
Сборка поискового индекса.

    python3 tools/build_search_index.py

Читает манифест и все незащищённые модули, складывает из них
компактный индекс в data/search-index.json. Браузеру больше не нужно
скачивать все материалы целиком ради поиска.

Запускать после правки контента — вместе с tools/validate.py.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUTPUT = DATA / 'search-index.json'

# Сколько символов текста раздела класть в индекс: хватает для сниппета,
# но не тащит в браузер весь справочник
BODY_LIMIT = 600


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
        for row in block.get('rows', []):
            parts.append(' '.join(row))
        parts.extend(block.get('items', []))
        for side in ('good', 'bad'):
            if block.get(side):
                parts.append(block[side].get('title', ''))
                parts.append(block[side].get('code', ''))

    return clean(' '.join(p for p in parts if p))[:BODY_LIMIT]


def lesson_anchor(module_id: int, num) -> str:
    return f"l{module_id}-{str(num).replace('.', '-')}"


def main() -> int:
    manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    index = []

    for module in manifest['modules']:
        if module.get('protected'):
            continue        # защищённый раздел в поиск не попадает

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

    OUTPUT.write_text(
        json.dumps(index, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8'
    )

    source_size = sum((ROOT / m['file']).stat().st_size
                      for m in manifest['modules'] if not m.get('protected'))
    index_size = OUTPUT.stat().st_size

    print(f'Записей в индексе: {len(index)}')
    print(f'Размер индекса:    {index_size / 1024:.0f} КБ')
    print(f'Было бы загружено: {source_size / 1024:.0f} КБ')
    print(f'Экономия:          {100 - index_size / source_size * 100:.0f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
