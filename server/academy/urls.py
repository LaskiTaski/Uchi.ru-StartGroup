"""Адреса. Настоящие, а не якоря: /m/6/list/7 — это страница."""

from django.urls import path

from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('catalog/', views.catalog_screen, name='catalog'),
    path('m/<int:mod_id>/', views.program, name='program'),
    path('m/<int:mod_id>/<slug:anchor>/', views.step, name='section'),
    path('m/<int:mod_id>/<slug:anchor>/<int:number>/', views.step, name='step'),
]
