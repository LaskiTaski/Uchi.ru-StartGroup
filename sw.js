/* ═══════════════════════════════════════════════════════════
   Python Academy — service worker: офлайн-кеш

   Контент статический и целиком ложится в кеш, включая Pyodide, —
   ученик в дороге открывает справочник без сети. Сайт опубликован
   в подпапке (GitHub Pages), поэтому все пути ниже — относительные:
   абсолютные вида `/app.js` увели бы запрос на корень домена.

   Защищённый раздел (`data/module5.json`, `protected: true`) в
   precache не кладём — он открывается по паролю, тащить его в кеш
   заранее незачем.
   ═══════════════════════════════════════════════════════════ */
'use strict';

// Поднимать при любом изменении PRECACHE_SHELL или состава файлов —
// иначе браузер продолжит отдавать старую оболочку из кеша, пока
// ученик вручную его не очистит.
var CACHE_VERSION = 'v1';

var SHELL_CACHE = 'pa-shell-' + CACHE_VERSION;
var DATA_CACHE = 'pa-data-' + CACHE_VERSION;
var PYODIDE_CACHE = 'pa-pyodide-' + CACHE_VERSION;
var FONTS_CACHE = 'pa-fonts-' + CACHE_VERSION;

var CURRENT_CACHES = [SHELL_CACHE, DATA_CACHE, PYODIDE_CACHE, FONTS_CACHE];

/* Минимум, без которого интерфейс не отрисуется: разметка, скрипты,
   стили, исполнитель Python и сам манифест с предсобранным поисковым
   индексом (без него не работает поиск). */
var PRECACHE_SHELL = [
  './',
  'index.html',
  'app.js',
  'sandbox.js',
  'styles.css',
  'worker.js',
  'sandbox_runtime.py',
  'manifest.webmanifest',
  'icons/icon.svg',
  'data/manifest.json',
  'data/search-index.json'
];

/* ── Установка: прогреваем оболочку и файлы открытых модулей ─── */

// Один неудачный запрос (сеть моргнула, файла нет) не должен ронять
// всю установку — просто не кешируем именно его.
function precacheFile(cache, path) {
  return fetch(path).then(function (response) {
    if (response.ok) return cache.put(path, response);
  }).catch(function () {});
}

self.addEventListener('install', function (event) {
  // Новый воркер подхватывается сразу на следующей загрузке страницы —
  // версии контента нет, ждать закрытия всех вкладок незачем.
  self.skipWaiting();

  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(PRECACHE_SHELL.map(function (path) {
        return precacheFile(cache, path);
      }));
    }).then(function () {
      // Список модулей известен только из манифеста — читаем его и
      // добавляем file каждого модуля без protected. Сам манифест уже
      // в SHELL_CACHE, но этот fetch независим от кеша установки.
      return fetch('data/manifest.json').then(function (response) {
        return response.json();
      }).then(function (manifest) {
        var files = (manifest.modules || [])
          .filter(function (module) { return !module.protected; })
          .map(function (module) { return module.file; });

        return caches.open(DATA_CACHE).then(function (cache) {
          return Promise.all(files.map(function (path) {
            return precacheFile(cache, path);
          }));
        });
      }).catch(function () {});
    })
  );
});

/* ── Активация: подчиняем открытые вкладки, чистим старые кеши ── */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function (names) {
        return Promise.all(names.map(function (name) {
          // Чужие кеши (не наши, без префикса pa-) не трогаем —
          // удаляем только устаревшие версии своих.
          if (name.indexOf('pa-') === 0 && CURRENT_CACHES.indexOf(name) === -1) {
            return caches.delete(name);
          }
        }));
      })
    ])
  );
});

/* ── Свои запросы: network-first, кеш — резерв на случай офлайна ─ */

function isDataRequest(url) {
  return /\/data\//.test(url.pathname);
}

function handleSameOrigin(request, url) {
  var cacheName = isDataRequest(url) ? DATA_CACHE : SHELL_CACHE;

  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      if (cached) return cached;
      // Промах кеша при навигации (адрес открыт впервые офлайн) —
      // отдаём оболочку, дальше приложение само разберёт хэш в URL.
      if (request.mode === 'navigate') return caches.match('index.html');
      return undefined;
    });
  });
}

/* ── Pyodide с jsDelivr: cache-first, кешируем даже opaque-ответы ─
   importScripts в worker.js грузит его в режиме no-cors — такой
   ответ непрозрачен (opaque, статус 0), тело недоступно для чтения,
   но закешировать его всё равно нужно: иначе Pyodide офлайн вообще
   не поднимется. */

function isPyodideRequest(url) {
  return /^\/pyodide\//.test(url.pathname);
}

function handlePyodide(request) {
  return caches.open(PYODIDE_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}

/* ── Шрифты: stale-while-revalidate — отдаём из кеша, обновляем фоном ── */

function handleFonts(request) {
  return caches.open(FONTS_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () { return cached; });

      return cached || network;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;   // POST не кешируем — оставляем сети как есть

  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(handleSameOrigin(request, url));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' && isPyodideRequest(url)) {
    event.respondWith(handlePyodide(request));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleFonts(request));
    return;
  }

  // YouTube и прочие сторонние запросы не перехватываем — пусть идут в сеть как обычно
});
