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
const click = s => q(s).dispatchEvent(new w.MouseEvent('click', {bubbles:true}));

/* Шаг 3: песочница, задания и блоки кода живут только на экране раздела,
   поэтому путь «дерево разделов в панели → вкладка» повторяется почти
   в каждой проверке ниже. Здесь он записан один раз. */
const goSection = async (anchor, tab) => {
  click('.rail-sec[data-anchor="' + anchor + '"]');
  await wait(400);
  if (!tab) return;
  click('.sec-tab[data-tab="' + tab + '"]');
  await wait(200);
};
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? pass++ : fail++; console.log(`${cond?'  ✓':'  ✗'} ${name}${extra?' — '+extra:''}`); };

(async () => {
  await wait(600);

  console.log('ЭКРАНЫ');
  // Шаг 2: сайт больше не открывается сразу первым видеомодулем —
  // стартовый экран «Моё обучение», модуль показывается только по выбору
  ok('стартовый экран — «Моё обучение»', q('.home-view') !== null && q('.module-header') === null);
  ok('в панели есть оба пункта вида', qa('.rail-view').length === 2);
  ok('при старте активен пункт «Моё обучение»',
     q('.rail-view[data-view="home"]')?.classList.contains('active') &&
     q('.rail-view[data-view="home"]')?.getAttribute('aria-current') === 'page');
  ok('пункт «Каталог» пока не активен',
     q('.rail-view[data-view="catalog"]')?.getAttribute('aria-current') === 'false');

  // Клик по «Каталогу» показывает карточки всех материалов манифеста,
  // включая три запланированные — с меткой «скоро»
  q('.rail-view[data-view="catalog"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('каталог показан, «Моё обучение» скрыто', q('.catalog-view') !== null && q('.home-view') === null);
  ok('пункт «Каталог» стал активным', q('.rail-view[data-view="catalog"]')?.classList.contains('active'));
  ok('в каталоге карточки всех 15 материалов манифеста',
     qa('.catalog-card').length === 15, qa('.catalog-card').length+'');
  const plannedCards = qa('.catalog-card-planned');
  ok('запланированных карточек три', plannedCards.length === 3, plannedCards.length+'');
  ok('у каждой запланированной карточки метка «скоро»',
     plannedCards.every((c) => /скоро/.test(c.textContent)));

  // Клик по обычной (не запланированной) карточке открывает материал
  // и переводит панель в режим материала
  const openableCard = qa('.catalog-card').find((c) => !c.classList.contains('catalog-card-planned'));
  openableCard.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('клик по карточке открывает материал', q('.module-header') !== null && q('.catalog-view') === null);
  ok('панель переходит в режим материала — есть активный пункт',
     q('.rail-item.active')?.getAttribute('aria-current') === 'page');

  // Запланированная карточка не открывается: клик по ней ничего не меняет
  q('.rail-view[data-view="catalog"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  q('.catalog-card-planned').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(150);
  ok('клик по запланированной карточке ничего не меняет — каталог на месте',
     q('.catalog-view') !== null && q('.module-header') === null);

  // То же для пункта запланированного материала в самой панели
  const plannedRailItem = q('.rail-item-planned');
  ok('в панели есть запланированный пункт', plannedRailItem !== null);
  plannedRailItem.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(150);
  ok('клик по запланированному пункту панели ничего не меняет',
     q('.catalog-view') !== null && q('.module-header') === null);

  console.log('\nНАВИГАЦИЯ');
  ok('манифест загружен первым', fetched[0] === 'data/manifest.json');
  // Панель — не лента: все группы и их материалы видны в ней сразу,
  // без промежуточного клика по группе
  ok('заголовков групп в панели: 4', qa('.rail-group').length === 4);
  ok('пунктов материалов в панели: 15', qa('.rail-item').length === 15, qa('.rail-item').length+'');
  ok('цвет из манифеста инлайном', q('.rail-item').getAttribute('style').includes('--mod-color'));
  // «Модуль 1 отрисован при старте» раньше проверялось буквально при
  // загрузке страницы — теперь старт «Моё обучение» (см. раздел ЭКРАНЫ),
  // а материал открывается по выбору; открываем его здесь явно
  q('.rail-item[data-mod="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('материал открывается и отрисовывает module-header', q('.module-header') !== null);
  ok('активный пункт помечен aria-current="page"', q('.rail-item.active')?.getAttribute('aria-current') === 'page');

  console.log('\nПЕРЕКЛЮЧЕНИЕ ГРУПП');
  // Группы больше не переключаются — панель показывает материалы всех
  // групп одновременно, поэтому проверяем прямой переход между ними
  q('.rail-item[data-mod="11"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('пункт другой группы стал активным',
     q('.rail-item[data-mod="11"]').classList.contains('active') &&
     q('.rail-item[data-mod="11"]').getAttribute('aria-current') === 'page');
  ok('прежний активный пункт снят', q('.rail-item[data-mod="1"]').getAttribute('aria-current') === 'false');
  ok('содержимое сменилось', q('.module-header') !== null);

  console.log('\nМЕНЮ И ЯКОРЯ');
  // Оглавления вкладки больше нет — дерево разделов активного материала
  // видно в панели сразу, без отдельного открытия
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('дерево разделов активного материала показано', q('.rail-sec[data-anchor="refs"]') !== null);
  q('.rail-sec[data-anchor="refs"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  ok('переход к #refs открывает раздел', d.getElementById('ref-refs') !== null);
  ok('открылась вкладка теории (якорь раздела, не задания)',
     q('.sec-tab[data-tab="theory"]')?.classList.contains('active'));
  ok('адрес обновлён', w.location.hash === '#refs');

  console.log('\nКРОСС-МОДУЛЬНАЯ ССЫЛКА');
  const cross = qa('.ref-link').find(a => a.dataset.anchor && a.dataset.anchor !== 'refs');
  const target = cross.dataset.anchor;
  cross.dispatchEvent(new w.MouseEvent('click', {bubbles:true, cancelable:true}));
  await wait(900);
  ok('переход по ссылке в тексте (#' + target + ') открывает раздел', d.getElementById('ref-' + target) !== null);

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
  ok('активный пункт — видеомодуль', ['1','2','3','4'].includes(q('.rail-item.active')?.getAttribute('data-mod')),
     q('.rail-item.active')?.getAttribute('data-mod'));
  ok('занятие открыто на экране раздела', q('.sec-head') !== null && q('.sec-head').id.startsWith('ref-l'),
     q('.sec-head')?.id);

  console.log('\nЗАЩИЩЁННЫЙ РАЗДЕЛ');
  q('.rail-item[data-mod="5"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
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
  // Модуль 6 уже загружен (см. «МЕНЮ И ЯКОРЯ») — повторный клик не должен
  // ничего запрашивать; переход по разделу дозагрузит только то, что
  // ещё не в кэше, но одно и то же имя файла не встретится дважды
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.rail-sec[data-anchor="refs"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  const dupes = fetched.filter((f,i) => fetched.indexOf(f) !== i);
  ok('повторных запросов нет', dupes.length === 0, dupes.join(',') || 'ни одного');

  console.log('\nКОПИРОВАНИЕ КОДА');
  // Код теперь виден только внутри конкретного раздела на вкладке теории —
  // на экране программы блоков с кодом нет вовсе (там только шаги-заголовки)
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  await goSection('refs');
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
  // Задания — на вкладке практики того же раздела «numbers»
  await goSection('numbers', 'practice');
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
  // На экране раздела нет .pb-text (это только программа) — прогресс
  // раздела виден в счётчике полосы шагов
  ok('полоса шагов раздела обновилась', /решено [1-9]/.test(q('.step-strip-count')?.textContent || ''),
     q('.step-strip-count')?.textContent);

  console.log('\nСОСТОЯНИЕ ПЕРЕЖИВАЕТ ПЕРЕРИСОВКУ');
  const key = box.getAttribute('data-block-key');
  const ed = box.querySelector('.ed-input');
  ed.value = 'print("черновик ученика")';
  ed.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(50);
  q('.rail-item[data-mod="7"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  // Клик по пункту материала теперь всегда ведёт на экран программы —
  // до раздела с песочницей нужно снова дойти через дерево разделов
  await goSection('numbers', 'practice');
  const back = d.querySelector('.sandbox[data-block-key="' + key + '"] .ed-input');
  ok('код вернулся после переключения модуля и возврата', back !== null && back.value === 'print("черновик ученика")',
     JSON.stringify(back && back.value));
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

  console.log('  Панель материалов');
  ok('.rail-nav — role="navigation"', q('.rail-nav').getAttribute('role') === 'navigation');
  const activeItem = q('.rail-item.active');
  ok('активный пункт — aria-current="page"', !!activeItem && activeItem.getAttribute('aria-current') === 'page');
  const inactiveItems = qa('.rail-item:not(.active)');
  ok('неактивные пункты — aria-current="false"',
     inactiveItems.length > 0 && inactiveItems.every(t => t.getAttribute('aria-current') === 'false'),
     inactiveItems.length + ' шт');

  console.log('  Аккордеон');
  // .lesson-header живёт и на экране программы — карточки разделов
  // раскрываются той же кнопкой; на экране раздела аккордеона уже нет
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
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
  // Скриншоты живут на экране раздела конкретного занятия — программа
  // видеомодуля их не показывает вовсе (см. renderLessonsProgram).
  // У занятия 1.1 модуля 1 точно есть один скриншот (data/module1.json)
  q('.rail-item[data-mod="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.prog-lesson[data-anchor="l1-1-1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const card = q('.screenshot-card');
  ok('карточка скриншота — BUTTON', card !== null && card.tagName === 'BUTTON');

  card.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('клик по карточке открывает лайтбокс', q('#lightbox').classList.contains('active'));
  ok('фокус переходит на кнопку закрытия', d.activeElement === q('.lightbox-close'));

  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  await wait(100);
  ok('Escape закрывает лайтбокс', !q('#lightbox').classList.contains('active'));
  ok('фокус возвращается на карточку', d.activeElement === card);

  console.log('  Галочки в дереве разделов панели');
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);

  const notesData = JSON.parse(fs.readFileSync(P + 'data/notes.json', 'utf8'));
  const numbersSection = (notesData.sections || []).find(s => s.anchor === 'numbers');
  const taskIds = ((numbersSection && numbersSection.blocks) || [])
    .filter(b => b.type === 'task' && b.check && b.id)
    .map(b => b.id);
  ok('в разделе «numbers» есть задания с проверкой', taskIds.length > 0, taskIds.join(','));
  taskIds.forEach(id => w.PA.store.markTask(id, 'solved'));

  // w.PA.store.markTask пишет напрямую в хранилище, минуя рендер — панель
  // ещё не знает об отметке. Переключение модуля туда-обратно и есть
  // штатный путь её перерисовки (см. renderRail() в switchModule)
  q('.rail-item[data-mod="7"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);

  const secItems = qa('.rail-sec');
  const numbersItem = secItems.find(i => i.dataset.anchor === 'numbers');
  const otherItem = secItems.find(i => i.dataset.anchor && i.dataset.anchor !== 'numbers');
  ok('решённый раздел помечен галочкой (rail-sec-done)', !!numbersItem && numbersItem.classList.contains('rail-sec-done'));
  ok('нерешённый раздел галочки не получает', !!otherItem && !otherItem.classList.contains('rail-sec-done'));

  numbersItem.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  const numbersSectionEl = d.getElementById('ref-numbers');
  ok('переход по дереву разделов открывает раздел', numbersSectionEl !== null);
  ok('вкладка теории выбрана после перехода по дереву разделов (aria-selected)',
     q('.sec-tab[data-tab="theory"]')?.getAttribute('aria-selected') === 'true');

  console.log('  Панель на узком экране');
  ok('кнопка-гамбургер есть в разметке', q('#rail-toggle') !== null);
  // jsdom не считает медиа-запросы для видимости — саму открывашку панели
  // проверяем по её обработчику, а не по вычисленному display
  q('#rail-toggle').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('кнопка открывает панель',
     q('#rail').classList.contains('open') && q('#rail-toggle').getAttribute('aria-expanded') === 'true');
  q('.rail-item.active').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('панель закрывается после выбора пункта', !q('#rail').classList.contains('open'));

  // Переход по якорю закрывает панель сам (goToAnchor) — маршрут у раздела
  // панели и у ссылки в тексте один и тот же
  q('#rail-toggle').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  q('.rail-sec').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  ok('панель закрывается после перехода по разделу', !q('#rail').classList.contains('open'));

  console.log('\nHEAD, ВИДЕО И ПОДСКАЗКА');

  const metaDesc = q('meta[name="description"]');
  ok('meta description есть и не пустое', !!metaDesc && metaDesc.getAttribute('content').trim().length > 0);
  const iconLink = q('link[rel="icon"]');
  ok('фавикон — inline SVG data-URI',
     !!iconLink && (iconLink.getAttribute('href') || '').startsWith('data:image/svg+xml'));
  ok('meta og:title есть', q('meta[property="og:title"]') !== null);

  // Плеер появляется только по клику: до этого страница не делает
  // ни одного запроса к YouTube. Видео — на экране раздела занятия
  // (у занятия 1.0 модуля 1 их два, см. data/module1.json)
  q('.rail-item[data-mod="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  q('.prog-lesson[data-anchor="l1-1-0"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const facades = qa('.video-facade');
  ok('до клика ни одного iframe нет', qa('iframe').length === 0, qa('iframe').length + ' шт');
  ok('вместо плееров — фасады', facades.length > 0, facades.length + ' шт');
  ok('у каждого фасада id ролика и ленивое превью с i.ytimg.com',
     facades.every(f => {
       const id = f.getAttribute('data-video-id') || '';
       const img = f.querySelector('img.video-thumb');
       return /^[\w-]{11}$/.test(id) && img &&
         img.getAttribute('loading') === 'lazy' &&
         (img.getAttribute('src') || '').includes('i.ytimg.com/vi/' + id + '/');
     }),
     facades.map(f => f.getAttribute('data-video-id')).join(' | '));

  const firstId = facades[0].getAttribute('data-video-id');
  const firstCard = facades[0].closest('.video-card');
  facades[0].dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  const player = firstCard.querySelector('iframe');
  ok('клик подставляет плеер youtube-nocookie с автозапуском',
     player !== null &&
     player.getAttribute('src') === 'https://www.youtube-nocookie.com/embed/' + firstId + '?autoplay=1',
     player ? player.getAttribute('src') : 'нет iframe');
  ok('фасад заменён, а не продублирован',
     firstCard.querySelector('.video-facade') === null && qa('iframe').length === 1,
     qa('iframe').length + ' iframe');
  ok('ни один плеер не ведёт на www.youtube.com/embed/',
     !qa('iframe').some(f => (f.getAttribute('src') || '').includes('www.youtube.com/embed/')));

  // Честная подсказка песочницы: упоминает интернет/сеть и pip.
  // Песочница — на вкладке практики раздела «numbers»
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  await goSection('numbers', 'practice');
  const hintEl = q('.sb-hint');
  const hintTitle = hintEl ? hintEl.getAttribute('title') || '' : '';
  ok('подсказка песочницы упоминает pip', hintEl !== null && hintTitle.includes('pip'), hintTitle);
  ok('подсказка песочницы упоминает интернет/сеть',
     hintEl !== null && /интернет|сеть/.test(hintTitle), hintTitle);

  // Адаптив и печать — проверяем сами правила в файле стилей
  const cssText = fs.readFileSync(P + 'styles.css', 'utf8');
  ok('есть медиа-блок max-width: 1024px', /@media \(max-width:\s*1024px\)/.test(cssText));
  ok('есть медиа-блок max-width: 900px (выезжающая панель)', /@media \(max-width:\s*900px\)/.test(cssText));
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

  console.log('\nВВОД И ВЫВОД');
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  await goSection('numbers', 'practice');
  const readBox = q('.sandbox[data-task-id="num-read"]');
  const sumBox = q('.sandbox[data-task-id="num-sum"]');
  ok('у задания без input() поле «Ввод» скрыто', readBox.querySelector('.sb-stdin').classList.contains('hidden'));
  ok('кнопки «Нужен ввод» нет', readBox.querySelector('.sb-stdin-toggle') === null);
  ok('у задания с input() поле открыто и заполнено первым кейсом',
     !sumBox.querySelector('.sb-stdin').classList.contains('hidden') &&
     sumBox.querySelector('.sb-stdin-input').value === '3\n4',
     JSON.stringify(sumBox.querySelector('.sb-stdin-input').value));

  readBox.querySelector('.sb-run').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('пустой вывод помечен', /без видимого вывода/.test(readBox.querySelector('.sb-out-body').textContent),
     JSON.stringify(readBox.querySelector('.sb-out-body').textContent));

  // input() по ходу выполнения: программа просит ввод — появляется строка,
  // ответ дописывается к «Вводу», запуск повторяется
  w.PA.editor.setValue(readBox.querySelector('.pa-editor'), 'name = input()\nprint(name)');
  readBox.querySelector('.sb-run').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  const promptForm = readBox.querySelector('.sb-prompt');
  ok('программа ждёт ввода — показана строка ввода',
     promptForm !== null && /ждёт ввода/.test(readBox.querySelector('.sb-status').textContent),
     readBox.querySelector('.sb-status').textContent);
  promptForm.querySelector('.sb-prompt-input').value = 'Тим';
  promptForm.dispatchEvent(new w.Event('submit', {bubbles:true, cancelable:true}));
  await wait(200);
  ok('ответ дописан к «Вводу» и программа перезапущена',
     w.__lastRun.stdin === 'Тим\n' && readBox.querySelector('.sb-prompt') === null,
     JSON.stringify(w.__lastRun.stdin));
  ok('поле «Ввод» раскрылось с накопленным вводом',
     !readBox.querySelector('.sb-stdin').classList.contains('hidden') &&
     readBox.querySelector('.sb-stdin-input').value === 'Тим\n');
  ok('после перезапуска — Готово', readBox.querySelector('.sb-status').textContent === 'Готово');

  readBox.querySelector('.sb-reset').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('«Сбросить» возвращает код и ввод',
     w.PA.editor.value(readBox.querySelector('.pa-editor')) === readBox.getAttribute('data-start') &&
     readBox.querySelector('.sb-stdin-input').value === '');

  console.log('\nИСПОЛНЯЕМЫЙ ПРИМЕР БЕЗ ДУБЛЯ');
  // Исполняемые примеры — часть теории; переключаемся на вкладку теории
  // того же раздела «numbers» (сейчас открыта вкладка практики)
  q('.sec-tab[data-tab="theory"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  const runBlock = q('.code-block.runnable');
  ok('исполняемый пример — сразу редактор', runBlock !== null && runBlock.querySelector('.sandbox .ed-input') !== null);
  ok('статичной копии кода над редактором нет',
     runBlock !== null && ![...runBlock.children].some((c) => c.tagName === 'PRE'));
  ok('заголовок и кнопка копирования на месте',
     runBlock !== null && runBlock.querySelector('.code-title-text') !== null && runBlock.querySelector('.code-copy') !== null);
  ok('редактор заполнен исходником',
     runBlock !== null && runBlock.querySelector('.ed-input').value === runBlock.getAttribute('data-code'));

  console.log('\nВИКТОРИНА');
  // Третий тип блока практики наравне с task — проверка на узнавание без
  // ввода кода. Раздел «map» модуля 6 (data/notes.json, quiz-types-1)
  await goSection('map', 'practice');
  const quizBox = q('.quiz[data-quiz-id="quiz-types-1"]');
  ok('викторина отрисована на вкладке практики', quizBox !== null);

  const quizQuestions = quizBox ? [...quizBox.querySelectorAll('.quiz-q')] : [];
  ok('в викторине три вопроса', quizQuestions.length === 3, quizQuestions.length + '');
  const quizRadios = quizBox ? [...quizBox.querySelectorAll('input[type="radio"]')] : [];
  ok('варианты — радиокнопки', quizRadios.length > 0 && quizRadios.every((r) => r.type === 'radio'));
  ok('в полосе шагов викторина отличается видом от задания',
     q('.step-sq.step-quiz') !== null && q('.step-sq.step-task') !== null &&
     q('.step-sq.step-quiz') !== q('.step-sq.step-task'));

  // Отвечаем неверно на первый вопрос, на остальные — верно: викторина
  // решённой быть не должна, но пояснения должны появиться у всех
  quizQuestions.forEach((fs, i) => {
    const correctIdx = parseInt(fs.getAttribute('data-answer'), 10);
    const wrongIdx = correctIdx === 0 ? 1 : 0;
    const pick = i === 0 ? wrongIdx : correctIdx;
    fs.querySelectorAll('input[type="radio"]')[pick].checked = true;
  });
  quizBox.querySelector('.quiz-check').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);

  ok('неверный вариант подсвечен красным', quizBox.querySelector('.quiz-option-wrong') !== null);
  ok('правильный вариант подсвечен зелёным', quizBox.querySelector('.quiz-option-correct') !== null);
  ok('под вопросом появилось пояснение',
     quizQuestions[0].classList.contains('checked') &&
     quizQuestions[0].querySelector('.quiz-explain').textContent.trim().length > 0);
  ok('счёт «Верно 2 из 3»', quizBox.querySelector('.sb-status').textContent === 'Верно 2 из 3',
     quizBox.querySelector('.sb-status').textContent);
  ok('викторина с ошибкой не отмечена решённой',
     w.PA.store.isSolved('quiz-types-1') === false && !quizBox.classList.contains('quiz-solved'));

  // Прогресс раздела и материала до полного прохождения — точка отсчёта
  const stripBefore = q('.step-strip-count')?.textContent || '';
  q('.sec-back').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  const barBefore = (q('.pb-text')?.textContent || '').match(/Решено (\d+) из (\d+)/);

  // Отвечаем верно на все три вопроса
  await goSection('map', 'practice');
  const quizBox2 = q('.quiz[data-quiz-id="quiz-types-1"]');
  [...quizBox2.querySelectorAll('.quiz-q')].forEach((fs) => {
    const correctIdx = parseInt(fs.getAttribute('data-answer'), 10);
    fs.querySelectorAll('input[type="radio"]')[correctIdx].checked = true;
  });
  quizBox2.querySelector('.quiz-check').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);

  ok('верные ответы на все вопросы отмечают викторину решённой', w.PA.store.isSolved('quiz-types-1') === true);
  ok('карточка викторины помечена решённой', quizBox2.classList.contains('quiz-solved'));
  ok('статус — «Все ответы верны»', quizBox2.querySelector('.sb-status').textContent === 'Все ответы верны');
  ok('счётчик раздела вырос после решения викторины',
     (q('.step-strip-count')?.textContent || '') !== stripBefore, q('.step-strip-count')?.textContent);

  q('.sec-back').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  const barAfter = (q('.pb-text')?.textContent || '').match(/Решено (\d+) из (\d+)/);
  ok('прогресс материала растёт после решения викторины',
     !!barBefore && !!barAfter && parseInt(barAfter[1], 10) === parseInt(barBefore[1], 10) + 1,
     `${barBefore && barBefore[0]} -> ${barAfter && barAfter[0]}`);

  // «Пройти заново» сбрасывает ответы и снимает отметку
  await goSection('map', 'practice');
  const quizBox3 = q('.quiz[data-quiz-id="quiz-types-1"]');
  quizBox3.querySelector('.quiz-retry').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(50);
  ok('«Пройти заново» снимает отметку', w.PA.store.isSolved('quiz-types-1') === false);
  ok('«Пройти заново» сбрасывает выбранные варианты',
     [...quizBox3.querySelectorAll('input[type="radio"]')].every((r) => !r.checked));
  ok('«Пройти заново» убирает подсветку и пояснение',
     quizBox3.querySelector('.quiz-option-correct') === null &&
     quizBox3.querySelector('.quiz-option-wrong') === null &&
     [...quizBox3.querySelectorAll('.quiz-q')].every((fs) => !fs.classList.contains('checked')));

  console.log('\nЗАДАНИЯ БЕЗ КОДА');
  q('.rail-item[data-mod="9"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('в прогрессе курса все пять заданий', /Решено 0 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  // Задание «plan-understand» — на вкладке практики раздела «understand»
  await goSection('understand', 'practice');
  const paper = q('.task[data-task-id="plan-understand"]');
  ok('задание без автопроверки помечено «без кода»',
     paper !== null && paper.querySelector('.task-kind') !== null);
  ok('у него нет песочницы, но есть отметка',
     paper !== null && paper.querySelector('.sandbox') === null &&
     paper.querySelector('.task-done') !== null);

  const doneBtn = paper.querySelector('.task-done');
  doneBtn.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('отметка ставится', w.PA.store.isSolved('plan-understand') === true &&
     doneBtn.getAttribute('aria-pressed') === 'true');
  ok('карточка помечена решённой', paper.classList.contains('task-solved'));
  ok('полоса шагов раздела обновилась', /решено 1 из 1/.test(q('.step-strip-count')?.textContent || ''),
     q('.step-strip-count')?.textContent);

  q('.sec-back').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  ok('общий прогресс курса пересчитался', /Решено 1 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  await goSection('understand', 'practice');
  q('.task[data-task-id="plan-understand"] .task-done')
    .dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('отметку можно снять — случайный клик не навсегда', w.PA.store.isSolved('plan-understand') === false);

  q('.sec-back').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(300);
  ok('курс возвращается к «Решено 0 из 5»', /Решено 0 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  console.log('\n«ПРОДОЛЖИТЬ» ВЕДЁТ НА ПЕРВОЕ НЕРЕШЁННОЕ ЗАДАНИЕ');
  // Раньше «Продолжить» вело на раздел с первым нерешённым заданием —
  // теперь ведёт прямо на само задание (якорь id="ref-<id>", см.
  // renderTaskBlock) и сразу открывает вкладку практики (модуль 10
  // ещё нигде не трогали в этом прогоне — гарантированно ничего не решено)
  q('.rail-item[data-mod="10"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const continueBtn = q('.pb-continue');
  ok('кнопка «Продолжить» есть, пока ничего не решено', continueBtn !== null);
  const firstTaskId = continueBtn.getAttribute('data-anchor');
  continueBtn.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  ok('«Продолжить» открывает вкладку практики',
     q('.sec-tab[data-tab="practice"]')?.classList.contains('active'));
  ok('«Продолжить» приводит к тому самому заданию', d.getElementById('ref-' + firstTaskId) !== null,
     firstTaskId);

  console.log('\nЭКРАНЫ: ПРОГРЕСС НА ГЛАВНОЙ');
  // markTask пишет напрямую в хранилище, минуя рендер — «Моё обучение»
  // считает решённые задания по PA.store('tasks') в момент отрисовки,
  // поэтому переход на экран после отметки уже должен видеть счёт
  w.PA.store.markTask('screens-home-progress', 'solved');
  q('.rail-view[data-view="home"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  ok('«Моё обучение» показывает ненулевой счёт решённых заданий',
     qa('.week-stat').some((el) => /Решено заданий:\s*[1-9]/.test(el.textContent)),
     qa('.week-stat').map((el) => el.textContent).join(' | '));

  console.log('\nВОЗВРАТ НА СТРАНИЦУ');
  q('.rail-item[data-mod="8"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const firstSec = q('.rail-sec');
  const openAnchor = firstSec.dataset.anchor;
  firstSec.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  w.PA.store.flush();
  const place = w.PA.store.get('ui', 'place', null);
  ok('место запомнено: модуль, раздел и вкладка',
     !!place && place.mod === 8 && place.view === 'section' && place.section === openAnchor && place.tab === 'theory',
     JSON.stringify(place));

  // Настоящая перезагрузка: новое окно, тот же localStorage
  const dom2 = new JSDOM(fs.readFileSync(P + 'index.html', 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w2 = dom2.window, d2 = w2.document;
  ['scrollBy','scrollTo','scrollIntoView'].forEach(m => w2.Element.prototype[m] = function(){});
  w2.scrollTo = () => {};
  w2.fetch = (f) => Promise.resolve({
    ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(P + f, 'utf8'))) });
  w2.Worker = FakeWorker;
  w2.localStorage.setItem('pa_progress_v1', w.localStorage.getItem('pa_progress_v1'));
  w2.eval(fs.readFileSync(P + 'sandbox.js', 'utf8'));
  w2.eval(fs.readFileSync(P + 'app.js', 'utf8'));
  await wait(900);
  const activeAfterReload = d2.querySelector('.rail-item.active');
  ok('после перезагрузки открыт тот же модуль',
     !!activeAfterReload && activeAfterReload.dataset.mod === '8',
     activeAfterReload ? activeAfterReload.dataset.mod : 'нет активного пункта');

  // Пункты идут внутри панели плоским списком — заголовок его группы
  // ищем ближайшим .rail-group перед активным пунктом по разметке
  let groupHeading = activeAfterReload && activeAfterReload.previousElementSibling;
  while (groupHeading && !groupHeading.classList.contains('rail-group')) {
    groupHeading = groupHeading.previousElementSibling;
  }
  ok('пункт остался в группе «Справочник»',
     !!groupHeading && groupHeading.textContent.includes('Справочник'),
     groupHeading ? groupHeading.textContent : 'нет заголовка группы');

  ok('после перезагрузки открыт тот же раздел', d2.getElementById('ref-' + openAnchor) !== null);

  console.log('\nЭКРАНЫ: ВОЗВРАТ НА СОХРАНЁННЫЙ ВИД');
  // Сохранённое место — это не только модуль, но и сам экран (шаг 2):
  // уходим в каталог, перезагружаем страницу тем же приёмом — второе
  // окно с тем же localStorage — и проверяем, что открылся каталог,
  // а не последний открытый материал
  q('.rail-view[data-view="catalog"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(200);
  w.PA.store.flush();
  const catalogPlace = w.PA.store.get('ui', 'place', null);
  ok('вид «каталог» записан в место', !!catalogPlace && catalogPlace.view === 'catalog',
     JSON.stringify(catalogPlace));

  const dom3 = new JSDOM(fs.readFileSync(P + 'index.html', 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w3 = dom3.window, d3 = w3.document;
  ['scrollBy','scrollTo','scrollIntoView'].forEach(m => w3.Element.prototype[m] = function(){});
  w3.scrollTo = () => {};
  w3.fetch = (f) => Promise.resolve({
    ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(P + f, 'utf8'))) });
  w3.Worker = FakeWorker;
  w3.localStorage.setItem('pa_progress_v1', w.localStorage.getItem('pa_progress_v1'));
  w3.eval(fs.readFileSync(P + 'sandbox.js', 'utf8'));
  w3.eval(fs.readFileSync(P + 'app.js', 'utf8'));
  await wait(900);
  ok('после перезагрузки открыт сохранённый вид «каталог»',
     d3.querySelector('.catalog-view') !== null && d3.querySelector('.module-header') === null);
  ok('в панели активен пункт «Каталог», не материал',
     d3.querySelector('.rail-view[data-view="catalog"]')?.classList.contains('active') === true &&
     d3.querySelector('.rail-item.active') === null);

  console.log('\nПРОГРАММА И РАЗДЕЛ');
  // Шаг 3: выбор материала открывает программу (список разделов),
  // а не сразу разворачивает полотно со всеми разделами гармошками
  q('.rail-item[data-mod="7"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  const notes2Data = JSON.parse(fs.readFileSync(P + 'data/notes2.json', 'utf8'));
  ok('выбор материала открывает программу, а не полотно',
     q('.prog-card') !== null && q('.sec-head') === null);
  ok('в программе столько карточек, сколько разделов',
     qa('.prog-card').length === notes2Data.sections.length,
     qa('.prog-card').length + ' карточек, ' + notes2Data.sections.length + ' разделов');

  // Раскрытие карточки показывает список шагов: теория и практика вперемешку
  const cardWithBoth = qa('.prog-card').find((card) => {
    const kinds = [...card.querySelectorAll('.prog-step-btn')].map((b) => b.dataset.tab);
    return kinds.includes('theory') && kinds.includes('practice');
  });
  ok('нашёлся раздел с шагами теории и практики', cardWithBoth !== undefined);
  cardWithBoth.querySelector('.prog-card-head').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(100);
  ok('раскрытие карточки показывает список шагов', cardWithBoth.classList.contains('open'));
  const steps = [...cardWithBoth.querySelectorAll('.prog-step-btn')];
  ok('среди шагов есть теория', steps.some((b) => b.dataset.tab === 'theory'));
  ok('среди шагов есть задания', steps.some((b) => b.dataset.tab === 'practice'));

  // Клик по шагу-заданию открывает раздел сразу на вкладке практики
  const taskStep = steps.find((b) => b.dataset.tab === 'practice');
  taskStep.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  ok('клик по шагу-заданию открывает раздел на вкладке практики',
     q('.sec-tab[data-tab="practice"]')?.classList.contains('active'));
  ok('на вкладке практики есть песочница', q('.sec-body .sandbox') !== null);
  ok('на вкладке практики нет блоков теории (.section-label)', q('.sec-body .section-label') === null);

  q('.sec-tab[data-tab="theory"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(150);
  ok('на вкладке теории нет блоков-заданий (.task)', q('.sec-body .task') === null);

  // «Следующий раздел» переключает раздел, оставаясь в том же материале
  const beforeNav = q('.sec-head').id;
  const nextBtn = q('.sec-nav-next');
  ok('кнопка «Следующий раздел» есть', nextBtn !== null);
  if (nextBtn) {
    nextBtn.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    await wait(300);
    ok('переход «Следующий раздел» меняет раздел', q('.sec-head').id !== beforeNav);
  } else {
    ok('переход «Следующий раздел» меняет раздел', false, 'кнопки не было');
  }

  // Переход по якорю из поиска ведёт в нужный раздел на нужную вкладку —
  // якорь раздела (не задания) приземляется на вкладку теории
  inp.value = 'наследование'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  const searchTarget = q('.sr-item');
  ok('есть результат поиска для проверки перехода', searchTarget !== null);
  searchTarget.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(700);
  ok('переход по якорю из поиска открывает раздел',
     q('.sec-head') !== null && w.location.hash.length > 1);
  ok('переход по якорю из поиска ведёт на вкладку теории (якорь раздела)',
     !q('.sec-tabs') || q('.sec-tab[data-tab="theory"]')?.classList.contains('active'));

  // Черновик кода на вкладке практики переживает уход на другой раздел
  // ТОГО ЖЕ материала (не смену модуля) и возврат
  q('.rail-item[data-mod="6"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
  await wait(400);
  await goSection('numbers', 'practice');
  const draftBox = q('.sandbox[data-task-id="num-sum"]');
  const draftKey = draftBox.getAttribute('data-block-key');
  const draftEditor = draftBox.querySelector('.ed-input');
  draftEditor.value = 'print("другой раздел и назад")';
  draftEditor.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(50);

  await goSection('refs');
  ok('ушли на другой раздел того же материала', q('.sec-head')?.id === 'ref-refs');

  await goSection('numbers', 'practice');
  const draftBack = q('.sandbox[data-block-key="' + draftKey + '"] .ed-input');
  ok('черновик практики пережил уход на другой раздел и возврат',
     draftBack !== null && draftBack.value === 'print("другой раздел и назад")',
     JSON.stringify(draftBack && draftBack.value));

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
