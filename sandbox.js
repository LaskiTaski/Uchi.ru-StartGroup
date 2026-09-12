/* ═══════════════════════════════════════════════════════════
   Python Academy — песочница: клиентская часть

   Три независимых куска, ничего не знающих о разметке страницы:
     PA.store   — прогресс и черновики (интерфейс get/set/flush);
     PA.sandbox — общение с worker.js: запуск и автопроверка;
     PA.editor  — редактор кода поверх подсветки.

   Разметку рисует app.js, здесь только поведение.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PA = {};
  global.PA = PA;

  /* Подсветку задаёт app.js — единственная реализация на проект */
  var highlight = function (code) {
    return String(code)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  PA.setHighlighter = function (fn) { if (typeof fn === 'function') highlight = fn; };

  /* ── Хранилище (этап 4) ─────────────────────────────────
     Интерфейс намеренно узкий: get / set / flush. Если позже
     прогресс понадобится на сервере, меняется только это место. */

  var STORE_KEY = 'pa_progress_v1';
  var FLUSH_DELAY = 1000;

  var store = {
    // ui — где ученик остановился (модуль и раскрытые разделы);
    // в экспорт/импорт прогресса не идёт: чужое «место» бессмысленно
    data: { version: 1, tasks: {}, sections: {}, drafts: {}, ui: {} },
    timer: null,

    load: function () {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1) {
            this.data = {
              version: 1,
              tasks: parsed.tasks || {},
              sections: parsed.sections || {},
              drafts: parsed.drafts || {},
              ui: parsed.ui || {}
            };
          }
        }
      } catch (e) { /* повреждённое хранилище — начинаем с чистого */ }
      return this.data;
    },

    get: function (bucket, key, fallback) {
      var box = this.data[bucket];
      if (!box) return fallback;
      if (key === undefined) return box;
      return Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
    },

    set: function (bucket, key, value) {
      if (!this.data[bucket]) this.data[bucket] = {};
      if (value === undefined || value === null || value === '') {
        delete this.data[bucket][key];
      } else {
        this.data[bucket][key] = value;
      }
      this.schedule();
      return value;
    },

    /* Запись с дебаунсом: набор кода не должен дёргать localStorage
       на каждый символ */
    schedule: function () {
      var self = this;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.flush(); }, FLUSH_DELAY);
    },

    flush: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
      } catch (e) { /* квота или приватный режим — молча продолжаем */ }
    },

    /* Экспорт/импорт: localStorage живёт до первой чистки браузера */
    export: function () {
      this.flush();
      return JSON.stringify(this.data, null, 2);
    },

    import: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || parsed.version !== 1) throw new Error('чужой формат файла');
      ['tasks', 'sections', 'drafts'].forEach(function (bucket) {
        var incoming = parsed[bucket] || {};
        for (var key in incoming) {
          if (Object.prototype.hasOwnProperty.call(incoming, key)) {
            store.data[bucket][key] = incoming[key];
          }
        }
      });
      this.flush();
      return this.data;
    },

    clear: function () {
      this.data = { version: 1, tasks: {}, sections: {}, drafts: {}, ui: {} };
      this.flush();
    },

    /* Отметки о заданиях */
    markTask: function (taskId, status) {
      var prev = this.get('tasks', taskId, null);
      var tries = (prev && prev.tries ? prev.tries : 0) + 1;
      // Решённое задание не «разрешается» обратно неудачной попыткой
      var solved = status === 'solved' || (prev && prev.status === 'solved');
      return this.set('tasks', taskId, {
        status: solved ? 'solved' : 'tried',
        ts: Math.floor(Date.now() / 1000),
        tries: tries
      });
    },

    isSolved: function (taskId) {
      var record = this.get('tasks', taskId, null);
      return !!(record && record.status === 'solved');
    }
  };

  store.load();
  PA.store = store;
  global.addEventListener('beforeunload', function () { store.flush(); });

  /* ── Связь с исполнителем ───────────────────────────────
     Один воркер на страницу. Зависший запуск гасим terminate()
     и сразу поднимаем новый — следующий клик не должен ждать. */

  var TIMEOUT_MS = 5000;
  var BOOT_TIMEOUT_MS = 90000;   // первая загрузка тянет ~10 МБ

  var sandbox = {
    worker: null,
    booted: false,
    seq: 0,
    active: null,
    workerUrl: 'worker.js',

    available: function () {
      return typeof global.Worker === 'function';
    },

    spawn: function () {
      if (this.worker) return this.worker;
      this.worker = new global.Worker(this.workerUrl);
      this.worker.onmessage = this.onMessage.bind(this);
      this.worker.onerror = this.onError.bind(this);
      return this.worker;
    },

    /* Предзагрузка: вызывается на первом фокусе редактора,
       чтобы к моменту клика «Запустить» движок уже ехал */
    warmup: function () {
      if (!this.available() || this.booted) return;
      this.spawn().postMessage({ type: 'boot' });
    },

    onMessage: function (event) {
      var msg = event.data || {};
      var job = this.active;

      if (msg.type === 'ready') { this.booted = true; if (job && job.onReady) job.onReady(); return; }
      if (!job || (msg.id !== undefined && msg.id !== job.id)) return;

      if (msg.type === 'out') {
        if (job.onOut) job.onOut(msg.stream, msg.text);
        return;
      }
      if (msg.type === 'done')    { this.finish(job, { ok: true }); return; }
      if (msg.type === 'error')   { this.finish(job, { ok: false, error: msg.error }); return; }
      if (msg.type === 'checked') { this.finish(job, { ok: true, report: msg.report }); return; }
      if (msg.type === 'fatal')   { this.finish(job, { ok: false, fatal: msg.message }); return; }
    },

    onError: function (event) {
      if (this.active) {
        this.finish(this.active, { ok: false, fatal: (event && event.message) || 'сбой исполнителя' });
      }
      this.restart();
    },

    finish: function (job, result) {
      if (job.timer) clearTimeout(job.timer);
      if (this.active === job) this.active = null;
      job.resolve(result);
    },

    restart: function () {
      if (this.worker) { try { this.worker.terminate(); } catch (e) {} }
      this.worker = null;
      this.booted = false;
      this.active = null;
    },

    busy: function () { return this.active !== null; },

    /**
     * options: { code, stdin, check, onOut, onReady, timeout }
     * Возвращает промис, который всегда выполняется (не отклоняется):
     * ошибка ученика — это нормальный результат, а не исключение.
     */
    send: function (options) {
      var self = this;
      if (!this.available()) {
        return Promise.resolve({ ok: false, fatal: 'браузер не поддерживает Web Worker' });
      }
      if (this.active) {
        return Promise.resolve({ ok: false, fatal: 'другой запуск ещё не закончился' });
      }

      var id = ++this.seq;
      var kind = options.check ? 'check' : 'run';
      var limit = options.timeout || TIMEOUT_MS;

      return new Promise(function (resolve) {
        var job = {
          id: id, resolve: resolve,
          onOut: options.onOut, onReady: options.onReady, timer: null
        };
        self.active = job;

        // До первой готовности отсчёт длиннее: движок ещё качается
        var deadline = self.booted ? limit : BOOT_TIMEOUT_MS;
        job.timer = setTimeout(function () {
          var wasBooted = self.booted;
          self.restart();
          // Движок уже был в кеше — поднимаем новый воркер в фоне, чтобы
          // следующий клик не ждал. После провала загрузки не пробуем: сети нет.
          if (wasBooted) self.warmup();
          resolve({ ok: false, timeout: wasBooted ? 'run' : 'boot' });
        }, deadline);

        // Как только пришёл ready — переключаем таймер на боевой
        var wrappedReady = job.onReady;
        job.onReady = function () {
          if (job.timer) clearTimeout(job.timer);
          job.timer = setTimeout(function () {
            self.restart();
            self.warmup();
            resolve({ ok: false, timeout: 'run' });
          }, limit);
          if (wrappedReady) wrappedReady();
        };

        self.spawn().postMessage({
          type: kind, id: id,
          code: options.code || '',
          stdin: options.stdin || '',
          check: options.check || null
        });
      });
    }
  };

  PA.sandbox = sandbox;

  /* ── Редактор кода ──────────────────────────────────────
     textarea с прозрачным текстом поверх подсвеченного <pre>:
     подсветка видна во время набора, поведение — родное для
     поля ввода (выделение, отмена, мобильная клавиатура).     */

  var INDENT = '    ';

  var editor = {
    /* Перерисовать подсветку и номера строк */
    sync: function (root) {
      var input = root.querySelector('.ed-input');
      var view = root.querySelector('.ed-view code');
      var gutter = root.querySelector('.ed-gutter');
      if (!input || !view) return;

      var code = input.value;
      // Хвостовой перевод строки схлопывается в <pre> — добавляем пробел
      view.innerHTML = highlight(code) + (code.slice(-1) === '\n' ? ' ' : '');

      if (gutter) {
        var lines = code.split('\n').length;
        if (gutter.childElementCount !== lines) {
          var html = '';
          for (var i = 1; i <= lines; i++) html += '<span>' + i + '</span>';
          gutter.innerHTML = html;
        }
      }
      this.autoGrow(root, input);
    },

    /* Высота — числом строк через rows, а не замером scrollHeight:
       редактор отрисовывается внутри свёрнутого урока (display: none),
       где замер даёт 0, и он навсегда оставался высотой в одну строку
       с обрезанным кодом. rows считается от того же шрифта и line-height,
       что и слой подсветки, поэтому слои совпадают без раскладки. */
    autoGrow: function (root, input) {
      var lines = input.value.split('\n').length;
      input.rows = Math.max(lines, 1);
      input.style.height = '';
      var view = root.querySelector('.ed-view');
      if (view) view.style.height = '';
    },

    scrolled: function (root) {
      var input = root.querySelector('.ed-input');
      var view = root.querySelector('.ed-view');
      if (input && view) view.scrollLeft = input.scrollLeft;
    },

    value: function (root) {
      var input = root.querySelector('.ed-input');
      return input ? input.value : '';
    },

    setValue: function (root, code) {
      var input = root.querySelector('.ed-input');
      if (!input) return;
      input.value = code;
      this.sync(root);
    },

    /* Tab, Shift+Tab и автоотступ после «:» — тот самый класс
       ошибок, которому в курсе посвящён отдельный раздел */
    onKeyDown: function (event, root) {
      var input = event.target;

      if (event.key === 'Tab') {
        event.preventDefault();
        var start = input.selectionStart, end = input.selectionEnd;
        var value = input.value;

        if (start !== end || event.shiftKey) {
          var from = value.lastIndexOf('\n', start - 1) + 1;
          var block = value.slice(from, end);
          var changed;
          if (event.shiftKey) {
            changed = block.replace(/^ {1,4}/gm, '');
          } else {
            changed = block.replace(/^/gm, INDENT);
          }
          input.value = value.slice(0, from) + changed + value.slice(end);
          input.selectionStart = from;
          input.selectionEnd = from + changed.length;
        } else {
          input.value = value.slice(0, start) + INDENT + value.slice(end);
          input.selectionStart = input.selectionEnd = start + INDENT.length;
        }
        this.sync(root);
        return true;
      }

      if (event.key === 'Enter') {
        var pos = input.selectionStart;
        if (pos !== input.selectionEnd) return false;
        var text = input.value;
        var lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        var line = text.slice(lineStart, pos);
        var indent = (line.match(/^[ \t]*/) || [''])[0];
        if (/:\s*$/.test(line)) indent += INDENT;
        if (!indent) return false;

        event.preventDefault();
        var insert = '\n' + indent;
        input.value = text.slice(0, pos) + insert + text.slice(input.selectionEnd);
        input.selectionStart = input.selectionEnd = pos + insert.length;
        this.sync(root);
        return true;
      }

      return false;
    }
  };

  PA.editor = editor;

  /* Делегирование: разметка перерисовывается целиком, вешать
     обработчики на каждый редактор после каждого рендера нельзя */
  if (global.document) {
    document.addEventListener('input', function (e) {
      var root = e.target.closest && e.target.closest('.pa-editor');
      if (root && e.target.classList.contains('ed-input')) editor.sync(root);
    });

    document.addEventListener('keydown', function (e) {
      if (!e.target.classList || !e.target.classList.contains('ed-input')) return;
      var root = e.target.closest('.pa-editor');
      if (root) editor.onKeyDown(e, root);
    });

    document.addEventListener('scroll', function (e) {
      if (e.target.classList && e.target.classList.contains('ed-input')) {
        editor.scrolled(e.target.closest('.pa-editor'));
      }
    }, true);

    document.addEventListener('focusin', function (e) {
      if (e.target.classList && e.target.classList.contains('ed-input')) {
        sandbox.warmup();
      }
    });
  }
})(typeof window !== 'undefined' ? window : this);
