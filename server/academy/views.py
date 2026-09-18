"""
Экраны. Каждый — «достать данные, отдать шаблону», без сборки разметки.

Прогресс ученика сюда не приходит: он по-прежнему живёт в localStorage,
и проставляет его клиентский JS после отрисовки. Решение «без ЛК и без
базы» этим прототипом не отменяется — он про отрисовку, а не про учёт.
"""

from django.http import Http404
from django.shortcuts import render

from .content import catalog, neighbours, steps_of


def _rail(active_mod=None, active_view=None):
    """Левая панель — она одна на всех экранах, собирается в одном месте."""
    return {
        'groups': catalog.groups_with_modules(),
        'active_mod': active_mod,
        'active_view': active_view,
    }


def home(request):
    return render(request, 'home.html', {
        'rail': _rail(active_view='home'),
        'groups': catalog.groups_with_modules(),
    })


def catalog_screen(request):
    return render(request, 'catalog.html', {
        'rail': _rail(active_view='catalog'),
        'groups': catalog.groups_with_modules(),
    })


def program(request, mod_id: int):
    meta = catalog.meta(mod_id)
    data = catalog.data(mod_id)
    if not meta or not data:
        raise Http404('материала нет')

    sections = [
        {**section, 'steps': steps_of(section)}
        for section in data.get('sections', [])
    ]
    return render(request, 'program.html', {
        'rail': _rail(active_mod=mod_id),
        'meta': meta, 'data': data,
        'sections': sections,
        'lessons': data.get('lessons', []),
    })


def step(request, mod_id: int, anchor: str, number: int = 1):
    meta = catalog.meta(mod_id)
    section = catalog.section(mod_id, anchor)
    if not meta or not section:
        raise Http404('раздела нет')

    steps = steps_of(section)
    if not 1 <= number <= len(steps):
        raise Http404('шага нет')

    return render(request, 'section.html', {
        'rail': _rail(active_mod=mod_id),
        'meta': meta, 'data': catalog.data(mod_id),
        'section': section,
        'steps': steps,
        'step': steps[number - 1],
        'nav': neighbours(catalog, mod_id, anchor, number),
    })
