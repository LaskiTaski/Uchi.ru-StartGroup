import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Корень проекта — от расположения скрипта, а не от текущего каталога
const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + '/';
const dom = new JSDOM(fs.readFileSync(P + 'index.html', 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, d = w.document;
['scrollBy','scrollTo','scrollIntoView'].forEach(m => w.Element.prototype[m] = function(){});
w.scrollTo = () => {};
// Синтетическая запись для проверки подсветки: слово в кавычках и амперсанд
// в заголовке — раньше некорректное экранирование резало <mark> не там
// (см. tools/e2e.mjs → «ПОИСК: СТЕММИНГ И ПОДСВЕТКА»)
const SEARCH_INDEX_FILE = 'data/search-index.json';
const SYNTHETIC_ENTRY = {
  mod: 6, anchor: 'numbers', icon: '🧪',
  title: 'Амперсанд & кавычки "тест" подсветки', chip: '', module: 'Тест',
  body: 'служебная запись: амперсанд & и кавычки "тест" в теле'
};
let fetched = [];
w.fetch = (f) => { fetched.push(f); return Promise.resolve({
  ok: true, json: () => {
    const data = JSON.parse(fs.readFileSync(P + f, 'utf8'));
    if (f === SEARCH_INDEX_FILE) data.push(SYNTHETIC_ENTRY);
    return Promise.resolve(data);
  } }); };

/* Настоящий Pyodide в jsdom не поднять — подменяем исполнитель заглушкой.
   Питоновскую часть проверяет tools/validate.py на эталонных решениях,
   здесь нас интересует только обвязка интерфейса. */
w.__verdict = true;      // каким «Python» посчитает следующий запуск
w.__lastRun = null;
class FakeWorker {
  constructor(url) { this.url = url; }
  postMessage(msg) {
    w.__lastRun = msg;
    const reply = (data) => setTimeout(() => this.onmessage({ data }), 0);
    reply({ type: 'ready' });
    if (msg.type === 'boot') return;
    if (msg.type === 'run') {
      reply({ type: 'out', id: msg.id, stream: 'stdout', text: 'вывод программы\n' });
      reply({ type: 'done', id: msg.id, ok: true });
      return;
    }
    const cases = (msg.check && msg.check.cases) || [];
    reply({ type: 'checked', id: msg.id, report: {
      output: '',
      results: cases.map((c, i) => ({
        ok: w.__verdict, got: w.__verdict ? String(c.expect) : 'не то',
        label: msg.check.entry ? msg.check.entry + '(...)' : null, case: c
      }))
    }});
  }
  terminate() {}
}
w.Worker = FakeWorker;

// Заглушка service worker: jsdom его не умеет, а проверить нужно только
// то, что app.js вызывает register() с правильным относительным путём.
// Окно создано с url: 'http://localhost/' (см. выше) — протокол http,
// поэтому регистрация в registerOffline() должна отработать.
let registeredSw = null;
Object.defineProperty(w.navigator, 'serviceWorker', {
  value: { register: (url) => { registeredSw = url; return Promise.resolve({}); } },
  configurable: true
});

w.eval(fs.readFileSync(P + 'sandbox.js', 'utf8'));
w.eval(fs.readFileSync(P + 'app.js', 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? pass++ : fail++; console.log(`${cond?'  ✓':'  ✗'} ${name}${extra?' — '+extra:''}`); };

(async () => {
  await wait(600);
  console.log('НАВИГАЦИЯ');
  ok('манифест загружен первым', fetched[0] === 'data/manifest.json');
  ok('групп: 4', qa('.group-tab').length === 4);
  ok('вкладок видео: 4', qa('.tab').length === 4);
  ok('цвет из манифеста инлайном', q('.tab').getAttribute('style').includes('--mod-color'));
  ok('модуль 1 отрисован', q('.module-header') !== null);

  console.log('\nПЕРЕКЛЮЧЕНИЕ ГРУПП');
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('группа ref активна', q('.group-tab.active').dataset.group === 'ref');
  ok('вкладок справочника: 6', qa('.tab').length === 6, qa('.tab').length+'');
  q('.tab[data-mod="11"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('[data-group="video"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('память последнего модуля группы', q('.tab.active').dataset.mod === '11');

  console.log('\nМЕНЮ И ЯКОРЯ');
  q('.tab-caret').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  ok('меню открылось', d.getElementById('tab-menu') !== null);
  ok('цвет меню задан', d.getElementById('tab-menu').style.getPropertyValue('--mod-color') !== '');
  const item = qa('.tab-menu-item').find(i => i.dataset.anchor === 'refs');
  item.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  ok('переход к #refs', d.getElementById('ref-refs')?.classList.contains('open'));
  ok('адрес обновлён', w.location.hash === '#refs');
  ok('меню закрылось', d.getElementById('tab-menu') === null);

  console.log('\nКРОСС-МОДУЛЬНАЯ ССЫЛКА');
  const cross = qa('.ref-link').find(a => a.dataset.anchor && a.dataset.anchor !== 'refs');
  const target = cross.dataset.anchor;
  cross.dispatchEvent(new w.MouseEvent('click', {bubbles:true, cancelable:true}));
  await wait(900);
  ok('переход по ссылке в тексте (#' + target + ')', d.getElementById('ref-' + target)?.classList.contains('open'));

  console.log('\nПОИСК');
  const inp = d.getElementById('search-input');
  fetched = [];
  inp.dispatchEvent(new w.Event('focus', {bubbles:true}));
  await wait(400);
  ok('индекс берётся предсобранный', fetched.includes('data/search-index.json'));
  ok('модули ради поиска не грузятся', !fetched.some(f => f.includes('notes')), fetched.join(','));
  inp.value = 'наследование'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  ok('результаты найдены', qa('.sr-item').length > 0, qa('.sr-item').length+' шт');
  ok('подсветка совпадения', q('.sr-item mark') !== null);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
  ok('стрелка выделяет', q('.sr-item.active') !== null);
  q('.sr-item').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  ok('переход из поиска', w.location.hash.length > 1);

  console.log('\nУРОКИ ВИДЕОМОДУЛЯ');
  inp.value = 'черепаш'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  q('.sr-item').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(800);
  ok('группа переключилась на видео', q('.group-tab.active').dataset.group === 'video');
  ok('урок раскрыт', q('.lesson.open') !== null);

  console.log('\nЗАЩИЩЁННЫЙ РАЗДЕЛ');
  q('[data-group="extra"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('форма пароля показана', d.getElementById('cert-input') !== null);
  d.getElementById('cert-input').value = 'неверный';
  d.getElementById('cert-submit').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('неверный пароль отклонён', q('.auth-error') !== null);
  d.getElementById('cert-input').value = 'NwrBJQF92k&=';
  d.getElementById('cert-submit').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(500);
  ok('верный пароль открывает раздел', q('.course-card') !== null);

  console.log('\nДЕДУПЛИКАЦИЯ ЗАПРОСОВ');
  fetched = [];
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.tab-caret').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  const dupes = fetched.filter((f,i) => fetched.indexOf(f) !== i);
  ok('повторных запросов нет', dupes.length === 0, dupes.join(',') || 'ни одного');

  console.log('\nКОПИРОВАНИЕ КОДА');
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.tab[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(500);
  const withCode = qa('.code-block[data-code]');
  ok('исходник лежит в data-code', withCode.length > 0, withCode.length + ' блоков');
  const copyBtn = q('.code-copy');
  ok('кнопка копирования есть', copyBtn !== null);
  let copied = null;
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  copyBtn.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('копируется исходник, а не подсвеченный текст',
     copied === copyBtn.closest('.code-block').getAttribute('data-code'));
  ok('подпись меняется на «Скопировано»', copyBtn.textContent === 'Скопировано');

  console.log('\nПЕСОЧНИЦА');
  const runnable = qa('.sandbox');
  ok('песочницы отрисованы', runnable.length > 0, runnable.length + ' шт');
  // Берём задание со скрытым кейсом: на нём проверяется и это тоже
  const box = q('.sandbox[data-task-id="num-sum"]');
  ok('у задания с check есть песочница', box !== null);
  ok('редактор на месте', box.querySelector('.ed-input') !== null);
  ok('поле ввода на месте', box.querySelector('.sb-stdin-input') !== null);
  ok('кнопка «Проверить» только у заданий',
     box.querySelector('.sb-check') !== null &&
     q('.sandbox-standalone .sb-check') === null);

  box.querySelector('.sb-run').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('вывод показан', box.querySelector('.sb-out-body').textContent.includes('вывод программы'));
  ok('код ушёл в исполнитель', typeof w.__lastRun.code === 'string');

  console.log('\nАВТОПРОВЕРКА');
  const taskId = box.getAttribute('data-task-id');
  w.__verdict = false;
  box.querySelector('.sb-check').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('неверное решение — красный результат', box.querySelector('.sb-report').classList.contains('bad'));
  ok('счёт вместо приговора', /Пока не проходит 3 из 3/.test(box.querySelector('.sb-status').textContent),
     box.querySelector('.sb-status').textContent);
  const lines = [...box.querySelectorAll('.rp-line')].map(l => l.textContent);
  ok('скрытый кейс показан только пояснением',
     lines.some(l => l.includes('скрытый тест: отрицательные числа')) &&
     !lines.some(l => l.includes('-5')), lines.join(' | '));
  ok('задание пока не решено', w.PA.store.isSolved(taskId) === false);

  w.__verdict = true;
  box.querySelector('.sb-check').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('верное решение — зелёный результат', box.querySelector('.sb-report').classList.contains('good'));
  ok('задание отмечено решённым', w.PA.store.isSolved(taskId) === true);
  ok('карточка задания помечена', box.closest('.task').classList.contains('task-solved'));
  ok('полоса прогресса обновилась', /Решено [1-9]/.test(q('.pb-text').textContent),
     q('.pb-text').textContent);

  console.log('\nСОСТОЯНИЕ ПЕРЕЖИВАЕТ ПЕРЕРИСОВКУ');
  const key = box.getAttribute('data-block-key');
  const ed = box.querySelector('.ed-input');
  ed.value = 'print("черновик ученика")';
  ed.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(50);
  q('.tab[data-mod="7"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.tab[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const back = d.querySelector('.sandbox[data-block-key="' + key + '"] .ed-input');
  ok('код вернулся после переключения вкладки', back.value === 'print("черновик ученика")',
     JSON.stringify(back.value));
  ok('черновик записан в хранилище', w.PA.store.get('drafts', key).code === 'print("черновик ученика")');

  const sb2 = back.closest('.sandbox');
  sb2.querySelector('.sb-reset').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('«Сбросить» возвращает исходный пример',
     back.value === sb2.getAttribute('data-start'));
  ok('черновик удалён', w.PA.store.get('drafts', key, null) === null);

  console.log('\nПРОГРЕСС ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ');
  w.PA.store.flush();
  const dump = JSON.parse(w.localStorage.getItem('pa_progress_v1'));
  ok('решённое задание в localStorage', dump.tasks[taskId].status === 'solved');
  ok('версия схемы записана', dump.version === 1);

  console.log('\nПОИСК: СТЕММИНГ И ПОДСВЕТКА');
  // «циклы» должно находить «цикл» через грубый стемминг запроса
  inp.value = 'циклы'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  let titles = qa('.sr-title').map(t => t.textContent.toLowerCase());
  ok('стемминг: «циклы» находит «цикл»', titles.some(t => t.includes('цикл')), titles.join(' | '));

  // «функций» должно находить раздел из справочника «Функции»
  inp.value = 'функций'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  let modules = qa('.sr-item .sr-module').map(m => m.textContent);
  ok('стемминг: «функций» находит модуль «Функции»', modules.includes('Функции'), modules.join(' | '));

  // Синтетическая запись с амперсандом и кавычками в заголовке — раньше
  // highlight() резал экранированную строку не по тем позициям
  inp.value = 'кавычки'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  const items = qa('.sr-item');
  const testItem = items.find(it => it.querySelector('.sr-module')?.textContent === 'Тест');
  ok('синтетическая запись найдена', testItem !== undefined,
     items.map(it => it.querySelector('.sr-module')?.textContent).join(' | '));

  // Битая сущность — это либо двойное экранирование (&amp;amp;), либо '&',
  // за которым сразу без ';' идёт открывающий тег (&am<mark> — старый баг
  // резал экранированную строку не по тем позициям и рвал сущность)
  const broken = /&amp;(amp|lt|gt|quot|#0?39);|&[a-zA-Z#0-9]*</;
  const titleHtml = testItem ? testItem.querySelector('.sr-title').innerHTML : '';
  const snippetHtml = testItem ? testItem.querySelector('.sr-snippet').innerHTML : '';
  ok('амперсанд экранирован ровно один раз', titleHtml.includes('&amp;'), titleHtml);
  ok('слово подсвечено целиком', titleHtml.includes('<mark>кавычки</mark>'), titleHtml);
  ok('в заголовке нет разорванных сущностей', titleHtml !== '' && !broken.test(titleHtml), titleHtml);
  ok('в сниппете нет разорванных сущностей', snippetHtml !== '' && !broken.test(snippetHtml), snippetHtml);

  // Точное совпадение слова должно ранжироваться выше совпадения по основе
  inp.value = 'цикл'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  const firstTitle = q('.sr-item .sr-title')?.textContent.toLowerCase() || '';
  ok('точное слово впереди', firstTitle.includes('цикл'), firstTitle || 'нет результатов');

  console.log('\nДОСТУПНОСТЬ');

  // Предыдущие блоки могли оставить открытым оглавление вкладки или
  // результаты поиска — клик мимо всего закрывает оба поповера
  d.body.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);

  console.log('  Табы');
  ok('#tabs — role="tablist"', q('#tabs').getAttribute('role') === 'tablist');
  ok('#groups — role="tablist"', q('#groups').getAttribute('role') === 'tablist');
  const activeGroupTab = q('.group-tab.active');
  ok('активная группа — aria-selected="true"', !!activeGroupTab && activeGroupTab.getAttribute('aria-selected') === 'true');
  const activeTab = q('.tab.active');
  ok('активная вкладка — aria-selected="true"', !!activeTab && activeTab.getAttribute('aria-selected') === 'true');
  const inactiveTabs = qa('.tab:not(.active)');
  ok('неактивные вкладки — aria-selected="false"',
     inactiveTabs.length > 0 && inactiveTabs.every(t => t.getAttribute('aria-selected') === 'false'),
     inactiveTabs.length + ' шт');

  console.log('  Аккордеон');
  const firstHeader = q('.lesson-header');
  ok('.lesson-header — BUTTON с aria-expanded', firstHeader.tagName === 'BUTTON' && firstHeader.hasAttribute('aria-expanded'));
  const firstLesson = firstHeader.parentElement;
  const wasOpen = firstLesson.classList.contains('open');
  firstHeader.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('клик по .lesson-header раскрывает раздел',
     firstLesson.classList.contains('open') === !wasOpen &&
     firstHeader.getAttribute('aria-expanded') === String(!wasOpen));
  firstHeader.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('повторный клик сворачивает раздел',
     firstLesson.classList.contains('open') === wasOpen &&
     firstHeader.getAttribute('aria-expanded') === String(wasOpen));

  console.log('  Skip-link');
  const skipLink = q('.skip-link');
  ok('skip-link есть и ведёт на #content', skipLink !== null && skipLink.getAttribute('href') === '#content');
  ok('#content — tabindex="-1"', q('#content').getAttribute('tabindex') === '-1');

  console.log('  Поиск: комбобокс');
  ok('#search-input — role="combobox"', inp.getAttribute('role') === 'combobox');
  inp.value = 'функция'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
  const activeOption = q('.sr-item.active');
  ok('aria-activedescendant указывает на активный пункт',
     activeOption !== null && inp.getAttribute('aria-activedescendant') === activeOption.id,
     inp.getAttribute('aria-activedescendant') + ' / ' + (activeOption && activeOption.id));
  d.body.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));   // закрываем результаты поиска
  await wait(100);

  console.log('  Лайтбокс');
  q('[data-group="video"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.tab[data-mod="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);

  // Скриншоты лежат внутри свёрнутых уроков — раскрываем по очереди,
  // пока не найдём карточку (номер урока со скриншотами не хотим хардкодить)
  let card = q('.screenshot-card');
  for (const header of qa('.lesson-header')) {
    if (card) break;
    header.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(30);
    card = q('.screenshot-card');
  }
  ok('карточка скриншота — BUTTON', card !== null && card.tagName === 'BUTTON');

  card.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('клик по карточке открывает лайтбокс', q('#lightbox').classList.contains('active'));
  ok('фокус переходит на кнопку закрытия', d.activeElement === q('.lightbox-close'));

  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  await wait(100);
  ok('Escape закрывает лайтбокс', !q('#lightbox').classList.contains('active'));
  ok('фокус возвращается на карточку', d.activeElement === card);

  console.log('  Галочки в оглавлении вкладки');
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.tab[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);

  const notesData = JSON.parse(fs.readFileSync(P + 'data/notes.json', 'utf8'));
  const numbersSection = (notesData.sections || []).find(s => s.anchor === 'numbers');
  const taskIds = ((numbersSection && numbersSection.blocks) || [])
    .filter(b => b.type === 'task' && b.check && b.id)
    .map(b => b.id);
  ok('в разделе «numbers» есть задания с проверкой', taskIds.length > 0, taskIds.join(','));
  taskIds.forEach(id => w.PA.store.markTask(id, 'solved'));

  d.body.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));   // закрыть возможное старое меню
  await wait(100);
  q('.tab-caret[data-menu="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);

  const menuItems = qa('.tab-menu-item');
  const numbersItem = menuItems.find(i => i.dataset.anchor === 'numbers');
  const otherItem = menuItems.find(i => i.dataset.anchor && i.dataset.anchor !== 'numbers');
  ok('решённый раздел помечен галочкой (tmi-solved)', !!numbersItem && numbersItem.classList.contains('tmi-solved'));
  ok('нерешённый раздел галочки не получает', !!otherItem && !otherItem.classList.contains('tmi-solved'));

  numbersItem.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  const numbersLesson = d.getElementById('ref-numbers');
  ok('переход по оглавлению раскрывает раздел', !!numbersLesson && numbersLesson.classList.contains('open'));
  const numbersHeader = numbersLesson && numbersLesson.querySelector('.lesson-header');
  ok('aria-expanded синхронизирован после перехода по якорю',
     !!numbersHeader && numbersHeader.getAttribute('aria-expanded') === 'true');

  console.log('\nHEAD, ВИДЕО И ПОДСКАЗКА');

  const metaDesc = q('meta[name="description"]');
  ok('meta description есть и не пустое', !!metaDesc && metaDesc.getAttribute('content').trim().length > 0);
  const iconLink = q('link[rel="icon"]');
  ok('фавикон — inline SVG data-URI',
     !!iconLink && (iconLink.getAttribute('href') || '').startsWith('data:image/svg+xml'));
  ok('meta og:title есть', q('meta[property="og:title"]') !== null);

  // Видео должно грузиться с youtube-nocookie.com — без сторонних cookie до клика
  q('[data-group="video"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.tab[data-mod="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const iframes = qa('iframe');
  ok('в DOM есть хотя бы один iframe видео', iframes.length > 0, iframes.length + ' шт');
  ok('все iframe — с youtube-nocookie.com/embed/',
     iframes.length > 0 && iframes.every(f => (f.getAttribute('src') || '').includes('youtube-nocookie.com/embed/')),
     iframes.map(f => f.getAttribute('src')).join(' | '));
  ok('ни один iframe не ведёт на www.youtube.com/embed/',
     !iframes.some(f => (f.getAttribute('src') || '').includes('www.youtube.com/embed/')));

  // Честная подсказка песочницы: упоминает интернет/сеть и pip
  q('[data-group="ref"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.tab[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const hintEl = q('.sb-hint');
  const hintTitle = hintEl ? hintEl.getAttribute('title') || '' : '';
  ok('подсказка песочницы упоминает pip', hintEl !== null && hintTitle.includes('pip'), hintTitle);
  ok('подсказка песочницы упоминает интернет/сеть',
     hintEl !== null && /интернет|сеть/.test(hintTitle), hintTitle);

  // Адаптив и печать — проверяем сами правила в файле стилей
  const cssText = fs.readFileSync(P + 'styles.css', 'utf8');
  ok('есть медиа-блок max-width: 1024px', /@media \(max-width:\s*1024px\)/.test(cssText));
  ok('есть медиа-блок max-width: 820px', /@media \(max-width:\s*820px\)/.test(cssText));
  ok('есть блок @media print', /@media print/.test(cssText));
  ok('в print-блоке .lesson-body раскрывается (display: block)',
     /\.lesson-body\s*\{\s*display:\s*block/.test(cssText));

  console.log('\nОФЛАЙН');
  ok('service worker регистрируется с ./sw.js', registeredSw === './sw.js', String(registeredSw));

  const manifestLink = q('link[rel="manifest"]');
  ok('link rel="manifest" указывает на manifest.webmanifest',
     !!manifestLink && manifestLink.getAttribute('href') === 'manifest.webmanifest');

  let webmanifest = null;
  try { webmanifest = JSON.parse(fs.readFileSync(P + 'manifest.webmanifest', 'utf8')); } catch (e) { webmanifest = null; }
  ok('manifest.webmanifest — валидный JSON', webmanifest !== null);
  ok('start_url — "."', !!webmanifest && webmanifest.start_url === '.');
  const manifestIcon = webmanifest && Array.isArray(webmanifest.icons) ? webmanifest.icons[0] : null;
  ok('иконка указана в манифесте', !!manifestIcon && !!manifestIcon.src);
  ok('файл иконки существует', !!manifestIcon && fs.existsSync(P + manifestIcon.src));

  const swText = fs.readFileSync(P + 'sw.js', 'utf8');
  let swSyntaxOk = true;
  try { new w.Function(swText); } catch (e) { swSyntaxOk = false; }
  ok('sw.js синтаксически корректен', swSyntaxOk);
  ok('в sw.js нет абсолютных путей от корня', !/["']\/(?!\/)/.test(swText), swText.match(/["']\/(?!\/)[^"']*/)?.[0] || '');
  ok('sw.js кеширует Pyodide с cdn.jsdelivr.net', swText.includes('cdn.jsdelivr.net') && swText.includes('pyodide'));

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
