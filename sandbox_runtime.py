"""
Python Academy — ядро песочницы.

Один и тот же файл исполняется в двух местах:

  * в браузере — worker.js подтягивает его текст и скармливает Pyodide;
  * на машине автора — tools/validate.py прогоняет эталонные решения
    против их же тестов.

Именно поэтому здесь нет ни одной зависимости от Pyodide и от stdlib
сверх того, что есть в обычном CPython 3.10+. Если правила сравнения
разъедутся между браузером и валидатором, ученик увидит красный тест
на правильном коде — ради этого файл и существует.
"""

import builtins
import io
import json
import math
import re
import sys

MAX_REPR = 200


def _pa_frame_line(exc):
    """Номер строки в коде ученика, а не во внутренней обвязке."""
    line = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == '<program>':
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def _pa_describe(exc):
    """Ошибка в виде, пригодном для показа ученику."""
    if isinstance(exc, SyntaxError):
        return {'kind': type(exc).__name__,
                'message': exc.msg or str(exc),
                'line': exc.lineno}
    if isinstance(exc, EOFError) and 'PA_NO_INPUT' in str(exc):
        return {'kind': 'PA_NO_INPUT', 'message': '', 'line': _pa_frame_line(exc)}
    if isinstance(exc, RecursionError):
        return {'kind': 'RecursionError',
                'message': 'слишком глубокая рекурсия — проверьте условие выхода',
                'line': _pa_frame_line(exc)}
    return {'kind': type(exc).__name__, 'message': str(exc),
            'line': _pa_frame_line(exc)}


class _PaInput:
    """input() поверх заданного текста: одна строка на вызов.

    Эха ввода нет в настоящем терминале, но здесь оно есть: без него
    вывод программы, которая печатает подсказку и читает ответ,
    выглядит оборванным.
    """

    def __init__(self, text, echo=True):
        self.buf = io.StringIO(text or '')
        self.echo = echo

    def __call__(self, prompt=''):
        if prompt:
            print(prompt, end='')
        line = self.buf.readline()
        if line == '':
            raise EOFError('PA_NO_INPUT')
        value = line.rstrip('\n')
        if self.echo:
            print(value)
        return value


def _pa_exec(code, stdin_text, capture=None, echo=True):
    """Выполнить код ученика. Возвращает (namespace, ошибка | None).

    echo=False обязателен при автопроверке: иначе введённые строки
    попадут в захваченный вывод и сравнение с expect не сойдётся.
    """
    real_input, real_stdin, real_stdout = builtins.input, sys.stdin, sys.stdout
    feeder = _PaInput(stdin_text, echo=echo)
    builtins.input = feeder
    sys.stdin = feeder.buf
    if capture is not None:
        sys.stdout = capture

    ns = {'__name__': '__main__'}
    err = None
    try:
        exec(compile(code, '<program>', 'exec'), ns)
    except BaseException as exc:          # noqa: BLE001 — ловим всё, это песочница
        err = _pa_describe(exc)
    finally:
        try:
            sys.stdout.flush()
        except Exception:                 # noqa: BLE001
            pass
        builtins.input = real_input
        sys.stdin = real_stdin
        sys.stdout = real_stdout

    return ns, err


def _pa_run(code, stdin_text):
    """Режим «Запустить»: вывод уходит в настоящий stdout потоком."""
    _ns, err = _pa_exec(code, stdin_text)
    return json.dumps({'ok': err is None, 'error': err}, ensure_ascii=False)


# ── Автопроверка ────────────────────────────────────────────

def _pa_norm(text, rules):
    """Нормализация вывода перед сравнением."""
    text = '\n'.join(line.rstrip() for line in str(text).split('\n')).strip()
    if 'collapse-spaces' in rules:
        text = re.sub(r'[ \t]+', ' ', text)
    if 'case' in rules:
        text = text.lower()
    return text


def _pa_eq(got, expect):
    """Числа сравниваем через isclose: 0.1 + 0.2 не должно валить тест."""
    if isinstance(got, bool) or isinstance(expect, bool):
        return got is expect
    if isinstance(got, (int, float)) and isinstance(expect, (int, float)):
        return math.isclose(got, expect, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(got, (list, tuple)) and isinstance(expect, (list, tuple)):
        return len(got) == len(expect) and all(
            _pa_eq(a, b) for a, b in zip(got, expect))
    if isinstance(got, dict) and isinstance(expect, dict):
        return got.keys() == expect.keys() and all(
            _pa_eq(got[k], expect[k]) for k in got)
    if isinstance(got, set) and isinstance(expect, (set, list, tuple)):
        return got == set(expect)
    return got == expect


def _pa_short(value):
    text = repr(value)
    return text if len(text) <= MAX_REPR else text[:MAX_REPR - 1] + '…'


def _pa_call_label(entry, args):
    return entry + '(' + ', '.join(_pa_short(a) for a in args) + ')'


def _pa_check_stdout(code, cases, rules):
    results = []
    output = ''
    for case in cases:
        cap = io.StringIO()
        _ns, err = _pa_exec(code, case.get('stdin', ''), cap, echo=False)
        got = cap.getvalue()
        if not output:
            output = got
        if err is not None:
            results.append({'ok': False, 'error': err, 'got': got.strip(),
                            'case': case})
            continue
        ok = _pa_norm(got, rules) == _pa_norm(case.get('expect', ''), rules)
        results.append({'ok': ok, 'got': got.strip(), 'case': case})
    return {'results': results, 'output': output}


def _pa_check_function(ns, entry, cases, output):
    fn = ns.get(entry)
    if not callable(fn):
        # Иначе ученик увидит NameError в строке обвязки, которую не писал
        return {'fatal': {'kind': 'PA_NO_ENTRY', 'message': entry, 'line': None},
                'output': output}

    results = []
    for case in cases:
        args = list(case.get('args', []))
        label = _pa_call_label(entry, args)
        try:
            got = fn(*args)
            results.append({'ok': _pa_eq(got, case.get('expect')),
                            'got': _pa_short(got), 'label': label, 'case': case})
        except BaseException as exc:      # noqa: BLE001
            results.append({'ok': False, 'label': label, 'raised': True,
                            'got': type(exc).__name__ + ': ' + str(exc),
                            'case': case})
    return {'results': results, 'output': output}


def _pa_check_asserts(ns, cases, output):
    results = []
    for case in cases:
        local = dict(ns)
        label = case.get('note') or case.get('label') or 'проверка'
        try:
            exec(compile(case.get('code', ''), '<check>', 'exec'), local)
            results.append({'ok': True, 'label': label, 'case': case})
        except AssertionError as exc:
            results.append({'ok': False, 'label': label,
                            'got': str(exc) or 'условие не выполнено',
                            'case': case})
        except BaseException as exc:      # noqa: BLE001
            results.append({'ok': False, 'label': label, 'raised': True,
                            'got': type(exc).__name__ + ': ' + str(exc),
                            'case': case})
    return {'results': results, 'output': output}


def _pa_check(code, spec_json):
    """Прогон кода ученика против описания проверки. Возвращает JSON-строку."""
    spec = json.loads(spec_json) if isinstance(spec_json, str) else spec_json
    mode = spec.get('mode', 'stdout')
    cases = spec.get('cases') or []
    rules = spec.get('normalize') or ['trim']

    if mode == 'stdout':
        report = _pa_check_stdout(code, cases, rules)
    elif mode in ('function', 'asserts'):
        cap = io.StringIO()
        ns, err = _pa_exec(code, spec.get('stdin', ''), cap, echo=False)
        output = cap.getvalue()
        if err is not None:
            report = {'fatal': err, 'output': output}
        elif mode == 'function':
            report = _pa_check_function(ns, spec.get('entry'), cases, output)
        else:
            report = _pa_check_asserts(ns, cases, output)
    else:
        report = {'fatal': {'kind': 'PA_BAD_MODE', 'message': mode, 'line': None}}

    return json.dumps(report, ensure_ascii=False)
