#!/usr/bin/env python3
"""
Проверка данных проекта перед коммитом.

    python3 tools/validate.py

Что проверяется:
  * манифест: уникальность id, наличие файлов, ссылки на существующие группы;
  * структура блоков: известный тип, обязательные поля;
  * якоря: уникальность по всем модулям;
  * перекрёстные ссылки [текст](#anchor) ведут на существующий якорь;
  * примеры кода разбираются интерпретатором Python.

Код возврата 1, если найдены ошибки, — годится для pre-commit и CI.
"""

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

# Типы блоков, которые умеет рисовать app.js, и их обязательные поля
BLOCK_SCHEMA = {
    'text':      ['text'],
    'heading':   ['text'],
    'code':      ['code'],
    'table':     ['rows'],
    'compare':   [],
    'good':      [],
    'bad':       [],
    'note':      ['text'],
    'warn':      ['text'],
    'task':      ['text'],
    'checklist': ['items'],
}

CODE_FIELDS = {'code', 'example', 'solution'}
LINK_RE = re.compile(r'\]\(#([A-Za-z0-9_-]+)\)')

errors: list[str] = []
warnings: list[str] = []


def error(message: str) -> None:
    errors.append(message)


def warn(message: str) -> None:
    warnings.append(message)


def check_manifest() -> list[dict]:
    path = DATA / 'manifest.json'
    if not path.exists():
        error('нет data/manifest.json')
        return []

    manifest = json.loads(path.read_text(encoding='utf-8'))
    group_ids = {g['id'] for g in manifest['groups']}
    seen_ids: set[int] = set()

    for module in manifest['modules']:
        where = f"модуль {module.get('id')}"
        if module['id'] in seen_ids:
            error(f'{where}: повторяющийся id')
        seen_ids.add(module['id'])

        if module['group'] not in group_ids:
            error(f"{where}: неизвестная группа {module['group']}")
        if not (ROOT / module['file']).exists():
            error(f"{where}: файл {module['file']} не найден")
        if not re.fullmatch(r'#[0-9A-Fa-f]{6}', module.get('color', '')):
            error(f'{where}: цвет должен быть в формате #RRGGBB')

    for group in manifest['groups']:
        if not any(m['group'] == group['id'] for m in manifest['modules']):
            warn(f"группа {group['id']} пуста")

    return manifest['modules']


def iter_blocks(section: dict):
    for index, block in enumerate(section.get('blocks', [])):
        yield index, block


def check_content(modules: list[dict]) -> None:
    anchors: dict[str, str] = {}
    links: dict[str, str] = {}
    snippets: list[tuple[str, str]] = []

    for module in modules:
        data = json.loads((ROOT / module['file']).read_text(encoding='utf-8'))
        title = data.get('title', module['file'])

        # Карточки внешних курсов — не разделы справочника, у них нет якорей
        if data.get('type') == 'courses':
            continue

        for section in data.get('sections', []):
            where = f"{title} / {section.get('title', '?')}"

            anchor = section.get('anchor')
            if not anchor:
                error(f'{where}: у раздела нет anchor')
            elif anchor in anchors:
                error(f'{where}: якорь «{anchor}» уже занят разделом {anchors[anchor]}')
            else:
                anchors[anchor] = where

            for field in ('num', 'title'):
                if not section.get(field):
                    error(f'{where}: не заполнено поле {field}')

            for index, block in iter_blocks(section):
                kind = block.get('type')
                if kind not in BLOCK_SCHEMA:
                    error(f'{where}, блок {index}: неизвестный тип «{kind}»')
                    continue
                for field in BLOCK_SCHEMA[kind]:
                    if field not in block:
                        error(f'{where}, блок {index} ({kind}): нет поля {field}')

                if kind == 'compare' and not (block.get('good') or block.get('bad')):
                    error(f'{where}, блок {index}: compare без good и bad')

                if kind == 'table':
                    head = block.get('head')
                    if head:
                        for row in block['rows']:
                            if len(row) != len(head):
                                error(f'{where}, блок {index}: строка таблицы '
                                      f'из {len(row)} ячеек при {len(head)} колонках')

                if block.get('lang', 'python') == 'python':
                    for field in CODE_FIELDS & block.keys():
                        snippets.append((f'{where}, блок {index}', block[field]))

            for link in LINK_RE.findall(json.dumps(section, ensure_ascii=False)):
                links.setdefault(link, where)

        # Занятия видеомодулей
        for lesson in data.get('lessons', []):
            if not lesson.get('attestation') and not lesson.get('title'):
                error(f'{title}: занятие без названия')

    for link, where in links.items():
        if link not in anchors:
            error(f'{where}: ссылка на несуществующий якорь #{link}')

    check_snippets(snippets)
    print(f'  разделов: {len(anchors)}, перекрёстных ссылок: {len(links)}, '
          f'примеров кода: {len(snippets)}')


def check_snippets(snippets: list[tuple[str, str]]) -> None:
    """Примеры должны разбираться интерпретатором.

    Исключение — намеренно сломанный код: такие примеры содержат
    в комментарии название ошибки (SyntaxError, IndentationError, TabError).
    """
    intentional = ('SyntaxError', 'IndentationError', 'TabError', 'Traceback')
    broken = 0

    for where, code in snippets:
        if any(word in code for word in intentional):
            continue
        try:
            ast.parse(code)
        except SyntaxError as exc:
            broken += 1
            error(f'{where}: пример не разбирается ({exc.msg})')

    if broken == 0:
        print('  все примеры кода синтаксически корректны')


def main() -> int:
    print('Проверка данных Python Academy\n')
    modules = check_manifest()
    if modules:
        check_content(modules)

    print()
    for message in warnings:
        print(f'  ⚠️  {message}')
    for message in errors:
        print(f'  ❌ {message}')

    if errors:
        print(f'\nОшибок: {len(errors)}')
        return 1

    print('Ошибок нет.' + (f' Предупреждений: {len(warnings)}.' if warnings else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
