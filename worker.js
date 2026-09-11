/* ═══════════════════════════════════════════════════════════
   Python Academy — исполнитель Python (Web Worker)

   Отдельный поток нужен не ради скорости: Pyodide на главном
   потоке невозможно остановить, и любой `while True:` в коде
   ученика намертво вешает вкладку. Здесь же зависший запуск
   гасится через worker.terminate() из главного потока.

   Протокол сообщений — см. README и plan-dorabotok.md §1.2.
   ═══════════════════════════════════════════════════════════ */
'use strict';

var PYODIDE_VERSION = '0.26.4';
var PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/';

var pyodide = null;
var booting = null;

function post(message) { self.postMessage(message); }

/* ── Python-часть исполнителя ─────────────────────────────
   Живёт в sandbox_runtime.py и подтягивается как текст. Файл
   один на проект: тот же код прогоняет tools/validate.py на
   эталонных решениях, поэтому правила сравнения в браузере и
   в проверке автора не могут разъехаться.

   Код ученика передаётся через globals, а не конкатенацией
   строк, — кавычки и тройные кавычки в нём безопасны.        */

var RUNTIME_URL = 'sandbox_runtime.py';

/* ── Подъём движка ────────────────────────────────────── */

function boot() {
  if (booting) return booting;

  booting = new Promise(function (resolve, reject) {
    try {
      importScripts(PYODIDE_BASE + 'pyodide.js');
    } catch (e) {
      reject(new Error('Не удалось загрузить Pyodide: ' + e.message));
      return;
    }
    Promise.all([
      self.loadPyodide({ indexURL: PYODIDE_BASE }),
      fetch(RUNTIME_URL).then(function (r) {
        if (!r.ok) throw new Error('нет ' + RUNTIME_URL);
        return r.text();
      })
    ]).then(function (parts) {
      var py = parts[0];
      pyodide = py;
      // Вывод отдаём порциями по строкам, а не одним куском в конце
      py.setStdout({ batched: function (text) { emit('stdout', text + '\n'); } });
      py.setStderr({ batched: function (text) { emit('stderr', text + '\n'); } });
      py.runPython(parts[1]);
      resolve(py);
    }).catch(reject);
  });

  return booting;
}

var currentId = null;

function emit(stream, text) {
  if (currentId === null) return;
  post({ type: 'out', id: currentId, stream: stream, text: text });
}

/* ── Обработка сообщений ──────────────────────────────── */

self.onmessage = function (event) {
  var msg = event.data || {};

  if (msg.type === 'boot') {
    boot().then(function () { post({ type: 'ready' }); })
          .catch(function (e) { post({ type: 'fatal', message: e.message }); });
    return;
  }

  if (msg.type !== 'run' && msg.type !== 'check') return;

  currentId = msg.id;

  boot().then(function (py) {
    post({ type: 'ready' });
    py.globals.set('_pa_code', msg.code || '');

    var raw;
    if (msg.type === 'run') {
      py.globals.set('_pa_stdin', msg.stdin || '');
      raw = py.runPython('_pa_run(_pa_code, _pa_stdin)');
      var res = JSON.parse(raw);
      if (res.ok) post({ type: 'done', id: msg.id, ok: true });
      else post({ type: 'error', id: msg.id, error: res.error });
    } else {
      py.globals.set('_pa_spec', JSON.stringify(msg.check || {}));
      raw = py.runPython('_pa_check(_pa_code, _pa_spec)');
      post({ type: 'checked', id: msg.id, report: JSON.parse(raw) });
    }
  }).catch(function (e) {
    post({ type: 'fatal', id: msg.id, message: e.message });
  }).then(function () { currentId = null; });
};
