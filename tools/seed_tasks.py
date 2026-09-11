#!/usr/bin/env python3
"""
Разовый скрипт: пилотная партия заданий с автопроверкой (этап 3).

Держим его в репозитории как образец формата — по нему удобно
дописывать следующие партии, не выдумывая структуру заново.
Запуск повторно безопасен: задание с тем же id не дублируется.

    python3 tools/seed_tasks.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

# Блоки кода, которым включаем кнопку «Запустить»:
#   файл -> якорь раздела -> индексы блоков
RUNNABLE = {
    'notes.json':  {'numbers': [3, 5, 7], 'str': [1, 4]},
    'notes2.json': {'for': [1]},
}

TASKS = {
    'notes.json': {
        'numbers': [
            {
                'type': 'task',
                'id': 'num-read',
                'title': 'Что напечатает программа?',
                'text': 'Не запуская код, определите вывод и напечатайте его — '
                        'три строки, по одной на каждый `print` из примера.',
                'example': 'print(10 // 4)\nprint(10 % 4)\nprint(10 / 4)',
                'starter': '# По строке на каждый print из примера\nprint()\nprint()\nprint()',
                'check': {
                    'mode': 'stdout',
                    'cases': [
                        {'stdin': '', 'expect': '2\n2\n2.5'}
                    ]
                },
                'hint': '`//` отбрасывает дробную часть, `%` даёт остаток, '
                        'а обычное деление всегда возвращает `float` — даже когда делится нацело.',
                'solution': 'print(2)\nprint(2)\nprint(2.5)',
                'explain': '10 // 4 — это 2 (четвёрка помещается в десятку дважды), '
                           'остаток 10 % 4 = 2, а 10 / 4 = 2.5. Последнее — float, '
                           'и это верно даже для 10 / 5: получится 2.0, а не 2.'
            },
            {
                'type': 'task',
                'id': 'num-sum',
                'title': 'Сумма двух чисел',
                'text': 'Программа читает два целых числа — каждое со своей строки — '
                        'и печатает их сумму.',
                'starter': 'a = int(input())\n',
                'check': {
                    'mode': 'stdout',
                    'cases': [
                        {'stdin': '3\n4', 'expect': '7'},
                        {'stdin': '10\n32', 'expect': '42'},
                        {'stdin': '-5\n2', 'expect': '-3',
                         'hidden': True, 'note': 'отрицательные числа'}
                    ]
                },
                'hint': '`input()` всегда возвращает строку. Без `int()` сложение '
                        'двух строк даст «34» вместо 7.',
                'solution': 'a = int(input())\nb = int(input())\nprint(a + b)',
                'explain': 'Ключевое здесь — преобразование типа. `\'3\' + \'4\'` '
                           'для Python совершенно законная операция: он склеит строки '
                           'и не сообщит об ошибке. Программа промолчит и выдаст неверный ответ.'
            }
        ],
        'str': [
            {
                'type': 'task',
                'id': 'str-hello',
                'title': 'Поздоровайтесь',
                'text': 'Программа читает имя и печатает `Привет, Аня!` — '
                        'с запятой и восклицательным знаком.',
                'starter': "name = input()\n",
                'check': {
                    'mode': 'stdout',
                    'cases': [
                        {'stdin': 'Аня', 'expect': 'Привет, Аня!'},
                        {'stdin': 'Тимур', 'expect': 'Привет, Тимур!'},
                        {'stdin': '  Аня  ', 'expect': 'Привет, Аня!',
                         'hidden': True, 'note': 'лишние пробелы по краям имени'}
                    ]
                },
                'hint': 'Пользователь легко промахивается мимо клавиш и вводит '
                        'лишний пробел. У строк для этого есть метод `strip()`.',
                'solution': "name = input().strip()\nprint(f'Привет, {name}!')",
                'explain': 'f-строка подставляет значение прямо в текст. '
                           '`strip()` убирает пробелы по краям — привычка вызывать его '
                           'сразу после `input()` экономит много времени на отладке.'
            },
            {
                'type': 'task',
                'id': 'str-vowels',
                'title': 'Сколько гласных',
                'text': 'Напишите функцию `count_vowels(s)` — она возвращает количество '
                        'русских гласных в строке. Регистр значения не имеет.',
                'starter': 'def count_vowels(s):\n    ',
                'check': {
                    'mode': 'function',
                    'entry': 'count_vowels',
                    'cases': [
                        {'args': ['молоко'], 'expect': 3},
                        {'args': ['ритм'], 'expect': 1},
                        {'args': ['АЛЫЧА'], 'expect': 3,
                         'hidden': True, 'note': 'заглавные буквы — тоже буквы'}
                    ]
                },
                'hint': 'Приведите строку к нижнему регистру один раз в начале — '
                        'и дальше сравнивайте только со строчными гласными.',
                'solution': "VOWELS = 'аеёиоуыэюя'\n\n"
                            "def count_vowels(s):\n"
                            "    total = 0\n"
                            "    for letter in s.lower():\n"
                            "        if letter in VOWELS:\n"
                            "            total += 1\n"
                            "    return total",
                'explain': 'Оператор `in` для строки проверяет вхождение символа — '
                           'перебирать алфавит вручную не нужно. Не забудьте `ё`: '
                           'её пропускают чаще всего.'
            }
        ],
        'list': [
            {
                'type': 'task',
                'id': 'list-longest',
                'title': 'Самое длинное слово',
                'text': 'Напишите функцию `longest(words)` — она возвращает самое длинное '
                        'слово списка. Если таких несколько, возвращается первое встретившееся.',
                'starter': 'def longest(words):\n    ',
                'check': {
                    'mode': 'function',
                    'entry': 'longest',
                    'cases': [
                        {'args': [['кот', 'бегемот', 'пёс']], 'expect': 'бегемот'},
                        {'args': [['ab', 'abcd', 'abc']], 'expect': 'abcd'},
                        {'args': [['кот', 'пёс', 'рак']], 'expect': 'кот',
                         'hidden': True, 'note': 'все слова одной длины'}
                    ]
                },
                'hint': 'Сравнение должно быть строгим: `>`, а не `>=`. '
                        'С нестрогим последнее слово подходящей длины вытеснит первое.',
                'solution': 'def longest(words):\n'
                            '    best = words[0]\n'
                            '    for word in words:\n'
                            '        if len(word) > len(best):\n'
                            '            best = word\n'
                            '    return best',
                'explain': 'Разница между `>` и `>=` здесь — это ровно разница между '
                           '«первое из самых длинных» и «последнее». Скрытый тест ловит '
                           'именно её: на списке с разными длинами обе версии совпадают.'
            }
        ]
    },
    'notes2.json': {
        'for': [
            {
                'type': 'task',
                'id': 'for-sum',
                'title': 'Сумма от 1 до n',
                'text': 'Программа читает число `n` и печатает сумму всех целых чисел от 1 до `n`.',
                'starter': 'n = int(input())\n',
                'check': {
                    'mode': 'stdout',
                    'cases': [
                        {'stdin': '5', 'expect': '15'},
                        {'stdin': '1', 'expect': '1'},
                        {'stdin': '0', 'expect': '0',
                         'hidden': True, 'note': 'ноль: цикл не выполнится ни разу'}
                    ]
                },
                'hint': '`range(1, n + 1)` — правая граница не входит в диапазон, '
                        'поэтому без `+ 1` последнее число потеряется.',
                'solution': 'n = int(input())\n'
                            'total = 0\n'
                            'for i in range(1, n + 1):\n'
                            '    total += i\n'
                            'print(total)',
                'explain': 'Накопитель `total` объявляется до цикла — иначе он будет '
                           'обнуляться на каждом витке. При n = 0 диапазон пуст, '
                           'цикл не делает ни одного шага, и печатается стартовый ноль.'
            }
        ],
        'while': [
            {
                'type': 'task',
                'id': 'while-countdown',
                'title': 'Обратный отсчёт',
                'text': 'Программа читает число и печатает отсчёт до единицы — '
                        'каждое число на своей строке, — а затем `Пуск!`',
                'starter': 'n = int(input())\n',
                'check': {
                    'mode': 'stdout',
                    'cases': [
                        {'stdin': '3', 'expect': '3\n2\n1\nПуск!'},
                        {'stdin': '5', 'expect': '5\n4\n3\n2\n1\nПуск!'},
                        {'stdin': '0', 'expect': 'Пуск!',
                         'hidden': True, 'note': 'считать нечего — сразу пуск'}
                    ]
                },
                'hint': 'Уменьшать `n` нужно внутри цикла. Если забыть — условие '
                        'никогда не станет ложным, и программа зависнет.',
                'solution': "n = int(input())\n"
                            "while n > 0:\n"
                            "    print(n)\n"
                            "    n -= 1\n"
                            "print('Пуск!')",
                'explain': 'Это классическое место для бесконечного цикла. '
                           'Если запуск подвис — песочница остановит его сама через '
                           'пять секунд и скажет об этом.'
            }
        ]
    },
    'notes3.json': {
        'func': [
            {
                'type': 'task',
                'id': 'func-greet',
                'title': 'Функция приветствия',
                'text': 'Напишите функцию `greet(name)` — она возвращает строку '
                        '`Привет, Аня!`. Если имя пустое, возвращается `Привет, мир!`',
                'starter': 'def greet(name):\n    ',
                'check': {
                    'mode': 'function',
                    'entry': 'greet',
                    'cases': [
                        {'args': ['Аня'], 'expect': 'Привет, Аня!'},
                        {'args': ['Тимур'], 'expect': 'Привет, Тимур!'},
                        {'args': [''], 'expect': 'Привет, мир!',
                         'hidden': True, 'note': 'пустое имя'}
                    ]
                },
                'hint': 'Функция должна **возвращать** строку через `return`, '
                        'а не печатать её. Печать и возврат — разные вещи.',
                'solution': "def greet(name):\n"
                            "    if not name:\n"
                            "        return 'Привет, мир!'\n"
                            "    return f'Привет, {name}!'",
                'explain': 'Самая частая ошибка на этом задании — `print` вместо `return`. '
                           'Такая функция напечатает нужное на экран, но вернёт `None`, '
                           'и любая проверка её результата провалится.'
            }
        ],
        'return': [
            {
                'type': 'task',
                'id': 'ret-average',
                'title': 'Среднее значение',
                'text': 'Напишите функцию `average(numbers)` — она возвращает среднее '
                        'арифметическое списка чисел. Для пустого списка возвращается `0`.',
                'starter': 'def average(numbers):\n    ',
                'check': {
                    'mode': 'function',
                    'entry': 'average',
                    'cases': [
                        {'args': [[1, 2, 3]], 'expect': 2},
                        {'args': [[0.1, 0.2]], 'expect': 0.15},
                        {'args': [[]], 'expect': 0,
                         'hidden': True, 'note': 'пустой список — делить не на что'}
                    ]
                },
                'hint': 'Проверку на пустой список делайте **первой строкой** функции — '
                        'до всяких вычислений.',
                'solution': 'def average(numbers):\n'
                            '    if not numbers:\n'
                            '        return 0\n'
                            '    return sum(numbers) / len(numbers)',
                'explain': 'Среднее от [0.1, 0.2] в двоичной арифметике равно '
                           '0.15000000000000002, а не ровно 0.15. Проверка сравнивает '
                           'числа с допуском, поэтому такой ответ засчитывается — '
                           'но помнить об этом стоит.'
            }
        ]
    },
    'notes5.json': {
        'class-basics': [
            {
                'type': 'task',
                'id': 'oop-dog',
                'title': 'Класс Dog',
                'text': 'Создайте класс `Dog`. При создании он принимает кличку и хранит её '
                        'в атрибуте `name`. Метод `bark()` возвращает строку вида `Бим: Гав!`',
                'starter': 'class Dog:\n    ',
                'check': {
                    'mode': 'asserts',
                    'cases': [
                        {'code': "dog = Dog('Бим')\n"
                                 "assert dog.name == 'Бим', 'атрибут name не хранит кличку'",
                         'note': 'кличка сохраняется в name'},
                        {'code': "assert Dog('Бим').bark() == 'Бим: Гав!', "
                                 "'bark() вернул не ту строку'",
                         'note': 'bark() возвращает «Кличка: Гав!»'},
                        {'code': "a, b = Dog('Бим'), Dog('Рекс')\n"
                                 "assert a.name != b.name, 'кличка оказалась общей на всех собак'",
                         'hidden': True, 'note': 'у каждой собаки своя кличка'}
                    ]
                },
                'hint': 'Кличку принимает `__init__(self, name)`, а сохраняет строка '
                        '`self.name = name`. Без `self.` значение исчезнет вместе с вызовом.',
                'solution': "class Dog:\n"
                            "    def __init__(self, name):\n"
                            "        self.name = name\n"
                            "\n"
                            "    def bark(self):\n"
                            "        return f'{self.name}: Гав!'",
                'explain': 'Скрытый тест ловит запись клички в атрибут класса '
                           '(`name = name` вместо `self.name = name`): такая кличка '
                           'станет общей для всех собак сразу.'
            }
        ]
    }
}

# Задание, у которого уже есть текст и разбор, — достраиваем проверку
PATCH = {
    'course1.json': {
        'code': {
            'title': 'Переведите свой план',
            'id': 'plan-to-code',
            'starter': "words = ['кот', 'бегемот', 'пёс', 'крокодил']\n",
            'check': {
                'mode': 'stdout',
                'cases': [{'stdin': '', 'expect': 'крокодил'}]
            }
        }
    }
}


def load(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


def save(name, data):
    (DATA / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def section_of(data, anchor):
    for section in data.get('sections', []):
        if section.get('anchor') == anchor:
            return section
    raise SystemExit(f'нет раздела {anchor}')


def main() -> int:
    added = patched = flagged = 0

    for filename, sections in TASKS.items():
        data = load(filename)
        for anchor, blocks in sections.items():
            section = section_of(data, anchor)
            existing = {b.get('id') for b in section.setdefault('blocks', [])}
            for block in blocks:
                if block['id'] in existing:
                    continue
                section['blocks'].append(block)
                added += 1
        save(filename, data)

    for filename, sections in RUNNABLE.items():
        data = load(filename)
        for anchor, indexes in sections.items():
            section = section_of(data, anchor)
            for i in indexes:
                block = section['blocks'][i]
                if block.get('type') != 'code':
                    raise SystemExit(f'{filename}/{anchor}[{i}] — не блок кода')
                if not block.get('run'):
                    block['run'] = True
                    flagged += 1
        save(filename, data)

    for filename, sections in PATCH.items():
        data = load(filename)
        for anchor, fields in sections.items():
            section = section_of(data, anchor)
            for block in section['blocks']:
                if block.get('type') == 'task' and block.get('title') == fields['title']:
                    for key, value in fields.items():
                        if key != 'title':
                            block[key] = value
                    patched += 1
        save(filename, data)

    print(f'Добавлено заданий: {added}')
    print(f'Дополнено заданий: {patched}')
    print(f'Блоков с кнопкой запуска: {flagged}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
