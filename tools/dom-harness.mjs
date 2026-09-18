/* ═══════════════════════════════════════════════════════════
   Стенд: платформа, поднятая в jsdom.

   Им пользуются двое — tools/e2e.mjs (проверяет поведение)
   и tools/snapshot.mjs (сличает разметку с эталоном). Раньше
   подмены браузера жили в тесте, и второму инструменту
   пришлось бы их переписать: две копии заглушки исполнителя
   разъехались бы на первой же правке протокола воркера.
   ═══════════════════════════════════════════════════════════ */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + '/';

export const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
export const readJson = (rel) => JSON.parse(read(rel));

const SEARCH_INDEX_FILE = 'data/search-index.json';

/* Запись с амперсандом и кавычками в заголовке: на ней проверяется
   подсветка совпадения, которая когда-то резала HTML-сущности пополам. */
const SYNTHETIC_ENTRY = {
  mod: 6, anchor: 'numbers', step: 1, icon: '🧪',
  title: 'Амперсанд & кавычки "тест" подсветки',
  section: 'Числа: int и float', chip: '', module: 'Тест',
  body: 'служебная запись: амперсанд & и кавычки "тест" в теле'
};

/* Настоящий Pyodide в jsdom не поднять. Питоновскую часть проверяет
   tools/validate.py на 194 эталонных решениях, здесь нужна только
   обвязка интерфейса, поэтому исполнитель — заглушка с тем же
   протоколом сообщений, что у worker.js. */
function makeFakeWorker(w) {
  return class FakeWorker {
    constructor(url) { this.url = url; }
    postMessage(msg) {
      w.__lastRun = msg;
      const reply = (data) => setTimeout(() => this.onmessage({ data }), 0);
      reply({ type: 'ready' });
      if (msg.type === 'boot') return;
      if (msg.type === 'run') {
        // Как настоящий исполнитель: input() без строк ввода — PA_NO_INPUT,
        // одни пустые print() — только переводы строк
        if (/\binput\s*\(/.test(msg.code) && !msg.stdin) {
          reply({ type: 'error', id: msg.id, error: { kind: 'PA_NO_INPUT', message: '', line: 1 } });
          return;
        }
        const onlyEmptyPrints = msg.code.split('\n').every(
          (l) => !l.trim() || l.trim().startsWith('#') || l.trim() === 'print()');
        reply({ type: 'out', id: msg.id, stream: 'stdout', text: onlyEmptyPrints ? '\n' : 'вывод программы\n' });
        reply({ type: 'done', id: msg.id, ok: true });
        return;
      }
      const cases = (msg.check && msg.check.cases) || [];
      reply({ type: 'checked', id: msg.id, report: {
        output: '',
        // case обязателен: по нему интерфейс решает, показывать кейс
        // целиком или только пояснение, если он скрытый
        results: cases.map((c) => ({
          ok: w.__verdict, got: w.__verdict ? String(c.expect) : 'не то',
          label: msg.check.entry ? msg.check.entry + '(...)' : null, case: c
        }))
      }});
    }
    terminate() {}
  };
}

/**
 * Поднимает платформу в новом окне.
 *
 * opts.synthetic — добавить служебную запись в поисковый индекс (нужна
 *   проверкам подсветки, но искажает снимок разметки);
 * opts.storage   — содержимое localStorage до запуска app.js: так
 *   проверяется возврат ученика с накопленным прогрессом;
 * opts.hash      — начальный адрес.
 */
export function createApp(opts = {}) {
  const dom = new JSDOM(read('index.html'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'http://localhost/' + (opts.hash || '')
  });
  const w = dom.window, d = w.document;

  // jsdom не умеет прокрутку, а код её зовёт на каждом переходе
  ['scrollBy', 'scrollTo', 'scrollIntoView'].forEach((m) => { w.Element.prototype[m] = function () {}; });
  w.scrollTo = () => {};

  const reqs = [];
  w.fetch = (file) => {
    reqs.push(file);
    return Promise.resolve({ ok: true, json: () => {
      const data = readJson(file);
      if (opts.synthetic && file === SEARCH_INDEX_FILE) data.push(SYNTHETIC_ENTRY);
      return Promise.resolve(data);
    } });
  };

  w.__verdict = true;      // каким «Python» посчитает следующую проверку
  w.__lastRun = null;      // что ушло в исполнитель последним
  w.Worker = makeFakeWorker(w);

  /* Офлайн-режим снят, но у заходивших раньше service worker остался.
     Проверяем ровно одно: страница снимает регистрацию и чистит наши
     кеши, не трогая чужие. */
  const sw = { unregistered: false, deletedCaches: [] };
  Object.defineProperty(w.navigator, 'serviceWorker', {
    value: {
      getRegistrations: () => Promise.resolve([
        { unregister: () => { sw.unregistered = true; return Promise.resolve(true); } }
      ])
    },
    configurable: true
  });
  w.caches = {
    keys: () => Promise.resolve(['pa-shell-v1', 'pa-data-v1', 'чужой-кеш']),
    delete: (name) => { sw.deletedCaches.push(name); return Promise.resolve(true); }
  };

  if (opts.storage) {
    Object.keys(opts.storage).forEach((k) => w.localStorage.setItem(k, opts.storage[k]));
  }

  w.eval(read('sandbox.js'));
  w.eval(read('app.js'));

  const q = (s) => d.querySelector(s);
  const qa = (s) => [...d.querySelectorAll(s)];
  const clickEl = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  return {
    w, d, sw, reqs,
    resetReqs: () => { reqs.length = 0; },
    q, qa, clickEl,
    click: (s) => clickEl(q(s)),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    /* Перейти по адресу так же, как это делает браузер: app.js слушает
       hashchange, поэтому событие обязательно, если хеш изменился. */
    go: (hash) => {
      const before = w.location.hash;
      w.location.hash = hash;
      if (w.location.hash !== before) w.dispatchEvent(new w.Event('hashchange'));
    }
  };
}
