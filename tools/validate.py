#!/usr/bin/env python3
"""
Проверка данных проекта перед коммитом.

    python3 tools/validate.py

Что проверяется:
  * манифест: уникальность id, наличие файлов, ссылки на существующие группы;
  * структура блоков: известный тип, обязательные поля;
  * якоря: уникальность по всем модулям;
  * перекрёстные ссылки [текст](#anchor) ведут на существующий якорь;
  * примеры кода разбираются интерпретатором Python;
  * задания с автопроверкой: схема check, уникальность id;
  * ЭТАЛОННЫЕ РЕШЕНИЯ ПРОГОНЯЮТСЯ ПРОТИВ СВОИХ ЖЕ ТЕСТОВ.

Последнее — единственное, что удержит качество на 150+ заданиях:
опечатка в expect иначе вылезет не у автора, а у ученика, который
будет десять минут искать ошибку в правильном коде.

Код возврата 1, если найдены ошибки, — годится для pre-commit и CI.
"""

import ast
import json
import re
import subprocess
import sys
import tempfile
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

CHECK_MODES = {'stdout', 'function', 'asserts'}
SOLUTION_TIMEOUT = 5      # секунд на одно эталонное решение

# Ключи подписей курсов, для которых в app.js есть русский текст
KNOWN_TAGS = {
    'free', 'paid', 'easy', 'medium', 'hard', 'heavy',
    'useful', 'super', 'start', 'optional', 'unknown',
}
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
    tasks: list[tuple[str, dict]] = []
    task_ids: dict[str, str] = {}

    for module in modules:
        data = json.loads((ROOT / module['file']).read_text(encoding='utf-8'))
        title = data.get('title', module['file'])

        # Карточки внешних курсов — не разделы справочника, у них нет якорей
        if data.get('type') == 'courses':
            check_course_tags(data, title)
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

                if kind == 'task':
                    task_id = block.get('id')
                    if block.get('check'):
                        if not task_id:
                            error(f'{where}, блок {index}: задание с check без id')
                        elif task_id in task_ids:
                            error(f'{where}, блок {index}: id задания «{task_id}» '
                                  f'уже занят в {task_ids[task_id]}')
                        else:
                            task_ids[task_id] = where
                        tasks.append((f'{where}, блок {index}', block))
                    elif task_id and task_id in task_ids:
                        error(f'{where}, блок {index}: повторяющийся id «{task_id}»')
                    elif task_id:
                        task_ids[task_id] = where

                if block.get('run') is True and block.get('lang', 'python') != 'python':
                    error(f'{where}, блок {index}: run: true у блока с lang='
                          f"{block.get('lang')} — запускать нечем")

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
    check_tasks(tasks)
    print(f'  разделов: {len(anchors)}, перекрёстных ссылок: {len(links)}, '
          f'примеров кода: {len(snippets)}')


def check_course_tags(data: dict, title: str) -> None:
    """Подпись без русского текста отрисуется английским ключом."""
    for section in data.get('sections', []):
        for group in section.get('groups', []):
            for course in group.get('courses', []):
                for field in ('price', 'difficulty', 'value'):
                    tag = course.get(field)
                    if tag and tag not in KNOWN_TAGS:
                        error(f"{title} / {course.get('name', '?')[:40]}: "
                              f'подпись «{tag}» не переведена')


# ── Задания с автопроверкой ─────────────────────────────────

# Драйвер запускается отдельным процессом: код заданий — это код,
# и исполнять его в процессе валидатора не стоит.
RUNNER = """
import io, json, sys
sys.path.insert(0, {root!r})
sys.setrecursionlimit(3000)
import sandbox_runtime as rt

payload = json.loads(sys.stdin.read())
buf, real = io.StringIO(), sys.stdout
sys.stdout = buf
try:
    report = rt._pa_check(payload['code'], payload['check'])
finally:
    sys.stdout = real
sys.stdout.write(report)
"""


def check_task_shape(where: str, task: dict) -> bool:
    """Схема задания. False — прогонять решение бессмысленно."""
    spec = task['check']
    mode = spec.get('mode')
    ok = True

    if mode not in CHECK_MODES:
        error(f'{where}: режим проверки «{mode}» неизвестен, '
              f"ожидается один из {sorted(CHECK_MODES)}")
        return False

    cases = spec.get('cases')
    if not cases:
        error(f'{where}: пустой список cases')
        return False

    # Ученик должен видеть хотя бы один кейс целиком, иначе непонятно,
    # на чём он упал
    if not any(not case.get('hidden') for case in cases):
        error(f'{where}: все кейсы скрытые — нужен хотя бы один открытый')
        ok = False

    if mode == 'function' and not spec.get('entry'):
        error(f'{where}: режим function без entry')
        ok = False

    for i, case in enumerate(cases):
        if mode == 'function':
            if not isinstance(case.get('args'), list):
                error(f'{where}, кейс {i}: args должен быть списком')
                ok = False
            if 'expect' not in case:
                error(f'{where}, кейс {i}: нет ожидаемого значения expect')
                ok = False
        elif mode == 'stdout':
            if 'expect' not in case:
                error(f'{where}, кейс {i}: нет ожидаемого вывода expect')
                ok = False
            if 'stdin' not in case:
                warn(f'{where}, кейс {i}: нет поля stdin — программа '
                     f'получит пустой ввод')
        elif mode == 'asserts':
            if not case.get('code'):
                error(f'{where}, кейс {i}: режим asserts без кода проверки')
                ok = False
        if case.get('hidden') and not case.get('note'):
            warn(f'{where}, кейс {i}: скрытый кейс без note — ученик '
                 f'увидит «скрытый тест» без единой подсказки')

    if not task.get('solution'):
        error(f'{where}: задание с автопроверкой без solution — '
              f'нечем проверить сами тесты')
        ok = False

    return ok


def run_reference(where: str, task: dict) -> None:
    """Эталонное решение обязано проходить собственные тесты."""
    payload = json.dumps({'code': task['solution'], 'check': task['check']},
                         ensure_ascii=False)
    with tempfile.TemporaryDirectory() as workdir:
        try:
            done = subprocess.run(
                [sys.executable, '-c', RUNNER.format(root=str(ROOT))],
                input=payload, capture_output=True, text=True,
                timeout=SOLUTION_TIMEOUT, cwd=workdir,
            )
        except subprocess.TimeoutExpired:
            error(f'{where}: эталонное решение не уложилось в '
                  f'{SOLUTION_TIMEOUT} с — вероятно, бесконечный цикл')
            return

    if done.returncode != 0:
        tail = (done.stderr or '').strip().splitlines()
        error(f'{where}: проверка не запустилась — '
              f"{tail[-1] if tail else 'код ' + str(done.returncode)}")
        return

    try:
        report = json.loads(done.stdout)
    except json.JSONDecodeError:
        error(f'{where}: непонятный ответ проверки: {done.stdout[:120]!r}')
        return

    if report.get('fatal'):
        fatal = report['fatal']
        if fatal.get('kind') == 'PA_NO_ENTRY':
            error(f"{where}: в solution нет функции «{fatal['message']}», "
                  f'заявленной в check.entry')
        else:
            error(f"{where}: solution падает — {fatal.get('kind')}: "
                  f"{fatal.get('message')}")
        return

    for i, item in enumerate(report.get('results', [])):
        if item.get('ok'):
            continue
        case = item.get('case', {})
        expect = case.get('expect')
        detail = item.get('got', '')
        error(f'{where}, кейс {i}: эталонное решение НЕ проходит '
              f'({item.get("label") or case.get("note") or "кейс"}): '
              f'ожидалось {expect!r}, получено {detail!r}')


def check_tasks(tasks: list[tuple[str, dict]]) -> None:
    if not tasks:
        return
    good = 0
    for where, task in tasks:
        if check_task_shape(where, task):
            before = len(errors)
            run_reference(where, task)
            if len(errors) == before:
                good += 1
    print(f'  заданий с автопроверкой: {len(tasks)}, '
          f'эталонные решения проходят: {good}')


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
