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

// Заглушка service worker: jsdom его не умеет. Офлайн-режим убран,
// и проверяем ровно одно — страница снимает регистрацию у тех, кто
// заходил раньше, иначе они навсегда остались бы на старой оболочке.
let swUnregistered = false;
const fakeRegistration = { unregister: () => { swUnregistered = true; return Promise.resolve(true); } };
Object.defineProperty(w.navigator, 'serviceWorker', {
  value: { getRegistrations: () => Promise.resolve([fakeRegistration]) },
  configurable: true
});
let deletedCaches = [];
w.caches = {
  keys: () => Promise.resolve(['pa-shell-v1', 'pa-data-v1', 'чужой-кеш']),
  delete: (name) => { deletedCaches.push(name); return Promise.resolve(true); }
};

w.eval(fs.readFileSync(P + 'sandbox.js', 'utf8'));
w.eval(fs.readFileSync(P + 'app.js', 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
/* Клик: по найденному элементу (clickEl) или сразу по селектору (click).
   Раньше полная форма dispatchEvent(new MouseEvent(...)) была выписана
   в файле семь десятков раз — и одинаковые клики выглядели по-разному. */
const clickEl = el => el.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
const click = s => clickEl(q(s));

/* Раздел — последовательность шагов, у каждого свой адрес (#/m/<id>/<anchor>
   или #/m/<id>/<anchor>/<n>); песочница и блоки кода живут на экране
   конкретного шага, а не всего раздела разом. Два пути туда используются
   почти в каждой проверке ниже, поэтому записаны один раз:
   openSection — клик по дереву разделов панели (открывает первый шаг);
   setHash — прямой переход по адресу (в т.ч. по старому голому якорю
   задания/раздела — так надёжнее всего попасть на шаг с конкретным
   заданием, не пересчитывая номер шага вручную). Если адрес уже такой,
   как нужно, hashchange не случится — на этот случай сначала уходим
   в сторону, чтобы событие гарантированно сработало. */
const openSection = async (anchor) => {
  click('.rail-sec[data-anchor="' + anchor + '"]');
  await wait(400);
};
const setHash = async (hash) => {
  if (w.location.hash === hash) { w.location.hash = '#/'; await wait(50); }
  w.location.hash = hash;
  await wait(500);
};
/* «Перезагрузка страницы»: новое окно с тем же localStorage — единственный
   способ проверить восстановление места и прогресса после закрытия вкладки.
   Обвязка (заглушки прокрутки, fetch из файлов, подменённый исполнитель)
   собрана здесь, чтобы следующая такая проверка стоила одну строку. */
const reloadPage = () => {
  const box = new JSDOM(fs.readFileSync(P + 'index.html', 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const rw = box.window;
  ['scrollBy','scrollTo','scrollIntoView'].forEach(m => rw.Element.prototype[m] = function(){});
  rw.scrollTo = () => {};
  rw.fetch = (f) => Promise.resolve({
    ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(P + f, 'utf8'))) });
  rw.Worker = FakeWorker;
  rw.localStorage.setItem('pa_progress_v1', w.localStorage.getItem('pa_progress_v1'));
  rw.eval(fs.readFileSync(P + 'sandbox.js', 'utf8'));
  rw.eval(fs.readFileSync(P + 'app.js', 'utf8'));
  return rw;
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
  click('.rail-view[data-view="catalog"]');
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
  clickEl(openableCard);
  await wait(400);
  ok('клик по карточке открывает материал', q('.module-header') !== null && q('.catalog-view') === null);
  ok('панель переходит в режим материала — есть активный пункт',
     q('.rail-item.active')?.getAttribute('aria-current') === 'page');

  // Запланированная карточка не открывается: клик по ней ничего не меняет
  click('.rail-view[data-view="catalog"]');
  await wait(200);
  click('.catalog-card-planned');
  await wait(150);
  ok('клик по запланированной карточке ничего не меняет — каталог на месте',
     q('.catalog-view') !== null && q('.module-header') === null);

  // То же для пункта запланированного материала в самой панели
  const plannedRailItem = q('.rail-item-planned');
  ok('в панели есть запланированный пункт', plannedRailItem !== null);
  clickEl(plannedRailItem);
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
  click('.rail-item[data-mod="1"]');
  await wait(400);
  ok('материал открывается и отрисовывает module-header', q('.module-header') !== null);
  ok('активный пункт помечен aria-current="page"', q('.rail-item.active')?.getAttribute('aria-current') === 'page');

  console.log('\nПЕРЕКЛЮЧЕНИЕ ГРУПП');
  // Группы больше не переключаются — панель показывает материалы всех
  // групп одновременно, поэтому проверяем прямой переход между ними
  click('.rail-item[data-mod="11"]');
  await wait(400);
  ok('пункт другой группы стал активным',
     q('.rail-item[data-mod="11"]').classList.contains('active') &&
     q('.rail-item[data-mod="11"]').getAttribute('aria-current') === 'page');
  ok('прежний активный пункт снят', q('.rail-item[data-mod="1"]').getAttribute('aria-current') === 'false');
  ok('содержимое сменилось', q('.module-header') !== null);

  console.log('\nМЕНЮ И ЯКОРЯ');
  // Оглавления вкладки больше нет — дерево разделов активного материала
  // видно в панели сразу, без отдельного открытия
  click('.rail-item[data-mod="6"]');
  await wait(400);
  ok('дерево разделов активного материала показано', q('.rail-sec[data-anchor="refs"]') !== null);
  click('.rail-sec[data-anchor="refs"]');
  await wait(700);
  ok('переход к #refs открывает раздел', d.getElementById('ref-refs') !== null);
  ok('открылся первый шаг раздела (вкладок теории/практики больше нет)',
     q('.sec-tabs') === null && q('.step-strip .step-sq') === q('.step-sq.step-current'));
  ok('адрес обновлён на маршрут раздела', w.location.hash === '#/m/6/refs', w.location.hash);

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
  click('.sr-item');
  await wait(700);
  ok('переход из поиска', w.location.hash.length > 1);

  console.log('\nУРОКИ ВИДЕОМОДУЛЯ');
  inp.value = 'черепаш'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  click('.sr-item');
  await wait(800);
  ok('активный пункт — видеомодуль', ['1','2','3','4'].includes(q('.rail-item.active')?.getAttribute('data-mod')),
     q('.rail-item.active')?.getAttribute('data-mod'));
  ok('занятие открыто на экране раздела', q('.sec-head') !== null && q('.sec-head').id.startsWith('ref-l'),
     q('.sec-head')?.id);

  console.log('\nЗАЩИЩЁННЫЙ РАЗДЕЛ');
  click('.rail-item[data-mod="5"]');
  await wait(400);
  ok('форма пароля показана', d.getElementById('cert-input') !== null);
  d.getElementById('cert-input').value = 'неверный';
  clickEl(d.getElementById('cert-submit'));
  await wait(200);
  ok('неверный пароль отклонён', q('.auth-error') !== null);
  d.getElementById('cert-input').value = 'NwrBJQF92k&=';
  clickEl(d.getElementById('cert-submit'));
  await wait(500);
  ok('верный пароль открывает раздел', q('.course-card') !== null);

  console.log('\nДЕДУПЛИКАЦИЯ ЗАПРОСОВ');
  fetched = [];
  // Модуль 6 уже загружен (см. «МЕНЮ И ЯКОРЯ») — повторный клик не должен
  // ничего запрашивать; переход по разделу дозагрузит только то, что
  // ещё не в кэше, но одно и то же имя файла не встретится дважды
  click('.rail-item[data-mod="6"]');
  await wait(300);
  click('.rail-sec[data-anchor="refs"]');
  await wait(300);
  const dupes = fetched.filter((f,i) => fetched.indexOf(f) !== i);
  ok('повторных запросов нет', dupes.length === 0, dupes.join(',') || 'ни одного');

  console.log('\nКОПИРОВАНИЕ КОДА');
  // Код теперь виден только внутри конкретного шага раздела — на экране
  // программы блоков с кодом нет вовсе (там только шаги-заголовки)
  click('.rail-item[data-mod="6"]');
  await wait(400);
  await openSection('refs');
  const withCode = qa('.code-block[data-code]');
  ok('исходник лежит в data-code', withCode.length > 0, withCode.length + ' блоков');
  const copyBtn = q('.code-copy');
  ok('кнопка копирования есть', copyBtn !== null);
  let copied = null;
  w.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  clickEl(copyBtn);
  await wait(100);
  ok('копируется исходник, а не подсвеченный текст',
     copied === copyBtn.closest('.code-block').getAttribute('data-code'));
  ok('подпись меняется на «Скопировано»', copyBtn.textContent === 'Скопировано');

  console.log('\nПЕСОЧНИЦА');
  // Задания раздела «numbers» — у каждого свой шаг; переходим прямо на
  // него старым адресом задания (id="num-sum") — заодно проверяет, что
  // старые адреса продолжают работать (подробнее — «АДРЕСА И ШАГИ» ниже)
  await setHash('#num-sum');
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

  clickEl(box.querySelector('.sb-run'));
  await wait(200);
  ok('вывод показан', box.querySelector('.sb-out-body').textContent.includes('вывод программы'));
  ok('код ушёл в исполнитель', typeof w.__lastRun.code === 'string');

  console.log('\nАВТОПРОВЕРКА');
  const taskId = box.getAttribute('data-task-id');
  w.__verdict = false;
  clickEl(box.querySelector('.sb-check'));
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
  clickEl(box.querySelector('.sb-check'));
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
  click('.rail-item[data-mod="7"]');
  await wait(400);
  click('.rail-item[data-mod="6"]');
  await wait(400);
  // Клик по пункту материала теперь всегда ведёт на экран программы —
  // до шага с песочницей нужно снова дойти, на этот раз прямым адресом
  await setHash('#num-sum');
  const back = d.querySelector('.sandbox[data-block-key="' + key + '"] .ed-input');
  ok('код вернулся после переключения модуля и возврата', back !== null && back.value === 'print("черновик ученика")',
     JSON.stringify(back && back.value));
  ok('черновик записан в хранилище', w.PA.store.get('drafts', key).code === 'print("черновик ученика")');

  const sb2 = back.closest('.sandbox');
  clickEl(sb2.querySelector('.sb-reset'));
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
  clickEl(d.body);
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
  click('.rail-item[data-mod="6"]');
  await wait(400);
  const firstHeader = q('.lesson-header');
  ok('.lesson-header — BUTTON с aria-expanded', firstHeader.tagName === 'BUTTON' && firstHeader.hasAttribute('aria-expanded'));
  const firstLesson = firstHeader.parentElement;
  const wasOpen = firstLesson.classList.contains('open');
  clickEl(firstHeader);
  await wait(50);
  ok('клик по .lesson-header раскрывает раздел',
     firstLesson.classList.contains('open') === !wasOpen &&
     firstHeader.getAttribute('aria-expanded') === String(!wasOpen));
  clickEl(firstHeader);
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
  clickEl(d.body);   // закрываем результаты поиска
  await wait(100);

  console.log('  Лайтбокс');
  // Скриншоты живут на экране раздела конкретного занятия — программа
  // видеомодуля их не показывает вовсе (см. renderLessonsProgram).
  // У занятия 1.1 модуля 1 точно есть один скриншот (data/module1.json)
  click('.rail-item[data-mod="1"]');
  await wait(400);
  click('.prog-lesson[data-anchor="l1-1-1"]');
  await wait(400);
  const card = q('.screenshot-card');
  ok('карточка скриншота — BUTTON', card !== null && card.tagName === 'BUTTON');

  clickEl(card);
  await wait(100);
  ok('клик по карточке открывает лайтбокс', q('#lightbox').classList.contains('active'));
  ok('фокус переходит на кнопку закрытия', d.activeElement === q('.lightbox-close'));

  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  await wait(100);
  ok('Escape закрывает лайтбокс', !q('#lightbox').classList.contains('active'));
  ok('фокус возвращается на карточку', d.activeElement === card);

  console.log('  Галочки в дереве разделов панели');
  click('.rail-item[data-mod="6"]');
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
  click('.rail-item[data-mod="7"]');
  await wait(300);
  click('.rail-item[data-mod="6"]');
  await wait(400);

  const secItems = qa('.rail-sec');
  const numbersItem = secItems.find(i => i.dataset.anchor === 'numbers');
  const otherItem = secItems.find(i => i.dataset.anchor && i.dataset.anchor !== 'numbers');
  ok('решённый раздел помечен галочкой (rail-sec-done)', !!numbersItem && numbersItem.classList.contains('rail-sec-done'));
  ok('нерешённый раздел галочки не получает', !!otherItem && !otherItem.classList.contains('rail-sec-done'));

  clickEl(numbersItem);
  await wait(700);
  const numbersSectionEl = d.getElementById('ref-numbers');
  ok('переход по дереву разделов открывает раздел', numbersSectionEl !== null);
  ok('открылся именно первый шаг раздела (адрес без номера шага)',
     w.location.hash === '#/m/6/numbers' && q('.step-strip .step-sq') === q('.step-sq.step-current'),
     w.location.hash);

  console.log('  Панель на узком экране');
  ok('кнопка-гамбургер есть в разметке', q('#rail-toggle') !== null);
  // jsdom не считает медиа-запросы для видимости — саму открывашку панели
  // проверяем по её обработчику, а не по вычисленному display
  click('#rail-toggle');
  await wait(50);
  ok('кнопка открывает панель',
     q('#rail').classList.contains('open') && q('#rail-toggle').getAttribute('aria-expanded') === 'true');
  click('.rail-item.active');
  await wait(200);
  ok('панель закрывается после выбора пункта', !q('#rail').classList.contains('open'));

  // Переход по якорю закрывает панель сам (goToAnchor) — маршрут у раздела
  // панели и у ссылки в тексте один и тот же
  click('#rail-toggle');
  click('.rail-sec');
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
  click('.rail-item[data-mod="1"]');
  await wait(400);
  click('.prog-lesson[data-anchor="l1-1-0"]');
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
  clickEl(facades[0]);
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
  // Песочница — на шаге задания «num-sum» раздела «numbers»
  await setHash('#num-sum');
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

  console.log('\nСТАРЫЙ SERVICE WORKER СНИМАЕТСЯ');
  ok('регистрация снята у тех, кто заходил раньше', swUnregistered === true);
  ok('наши кеши удалены, чужие не тронуты',
     deletedCaches.includes('pa-shell-v1') && deletedCaches.includes('pa-data-v1') &&
     !deletedCaches.includes('чужой-кеш'), deletedCaches.join(', '));
  ok('манифеста приложения больше нет', q('link[rel="manifest"]') === null);
  ok('файлов офлайна нет в репозитории',
     !fs.existsSync(P + 'sw.js') && !fs.existsSync(P + 'manifest.webmanifest'));

  console.log('\nВВОД И ВЫВОД');
  // «num-read» и «num-sum» — теперь два разных шага раздела «numbers»,
  // не два блока одной вкладки практики; проверка каждого — на его адресе
  await setHash('#num-read');
  const readBox = q('.sandbox[data-task-id="num-read"]');
  ok('у задания без input() поле «Ввод» скрыто', readBox.querySelector('.sb-stdin').classList.contains('hidden'));
  ok('кнопки «Нужен ввод» нет', readBox.querySelector('.sb-stdin-toggle') === null);

  clickEl(readBox.querySelector('.sb-run'));
  await wait(200);
  ok('пустой вывод помечен', /без видимого вывода/.test(readBox.querySelector('.sb-out-body').textContent),
     JSON.stringify(readBox.querySelector('.sb-out-body').textContent));

  // input() по ходу выполнения: программа просит ввод — появляется строка,
  // ответ дописывается к «Вводу», запуск повторяется
  w.PA.editor.setValue(readBox.querySelector('.pa-editor'), 'name = input()\nprint(name)');
  clickEl(readBox.querySelector('.sb-run'));
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

  clickEl(readBox.querySelector('.sb-reset'));
  await wait(50);
  ok('«Сбросить» возвращает код и ввод',
     w.PA.editor.value(readBox.querySelector('.pa-editor')) === readBox.getAttribute('data-start') &&
     readBox.querySelector('.sb-stdin-input').value === '');

  await setHash('#num-sum');
  const sumBox = q('.sandbox[data-task-id="num-sum"]');
  ok('у задания с input() поле открыто и заполнено первым кейсом',
     !sumBox.querySelector('.sb-stdin').classList.contains('hidden') &&
     sumBox.querySelector('.sb-stdin-input').value === '3\n4',
     JSON.stringify(sumBox.querySelector('.sb-stdin-input').value));

  console.log('\nИСПОЛНЯЕМЫЙ ПРИМЕР БЕЗ ДУБЛЯ');
  // Исполняемые примеры — часть теории; шаг 2 раздела «numbers» («Арифметические
  // операции») содержит сразу несколько — прямой переход по адресу шага
  await setHash('#/m/6/numbers/2');
  const runBlock = q('.code-block.runnable');
  ok('исполняемый пример — сразу редактор', runBlock !== null && runBlock.querySelector('.sandbox .ed-input') !== null);
  ok('статичной копии кода над редактором нет',
     runBlock !== null && ![...runBlock.children].some((c) => c.tagName === 'PRE'));
  ok('заголовок и кнопка копирования на месте',
     runBlock !== null && runBlock.querySelector('.code-title-text') !== null && runBlock.querySelector('.code-copy') !== null);
  ok('редактор заполнен исходником',
     runBlock !== null && runBlock.querySelector('.ed-input').value === runBlock.getAttribute('data-code'));

  console.log('\nВИКТОРИНА');
  // Третий тип оцениваемого блока наравне с task — проверка на узнавание
  // без ввода кода. Раздел «map» модуля 6 (data/notes.json, quiz-types-1) —
  // у викторины, как и у задания, свой шаг; переходим на него старым
  // адресом самой викторины
  await setHash('#quiz-types-1');
  const quizBox = q('.quiz[data-quiz-id="quiz-types-1"]');
  ok('викторина отрисована на своём шаге', quizBox !== null);

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
  clickEl(quizBox.querySelector('.quiz-check'));
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
  click('.sec-back');
  await wait(300);
  const barBefore = (q('.pb-text')?.textContent || '').match(/Решено (\d+) из (\d+)/);

  // Отвечаем верно на все три вопроса
  await setHash('#quiz-types-1');
  const quizBox2 = q('.quiz[data-quiz-id="quiz-types-1"]');
  [...quizBox2.querySelectorAll('.quiz-q')].forEach((fs) => {
    const correctIdx = parseInt(fs.getAttribute('data-answer'), 10);
    fs.querySelectorAll('input[type="radio"]')[correctIdx].checked = true;
  });
  clickEl(quizBox2.querySelector('.quiz-check'));
  await wait(50);

  ok('верные ответы на все вопросы отмечают викторину решённой', w.PA.store.isSolved('quiz-types-1') === true);
  ok('карточка викторины помечена решённой', quizBox2.classList.contains('quiz-solved'));
  ok('статус — «Все ответы верны»', quizBox2.querySelector('.sb-status').textContent === 'Все ответы верны');
  ok('счётчик раздела вырос после решения викторины',
     (q('.step-strip-count')?.textContent || '') !== stripBefore, q('.step-strip-count')?.textContent);

  click('.sec-back');
  await wait(300);
  const barAfter = (q('.pb-text')?.textContent || '').match(/Решено (\d+) из (\d+)/);
  ok('прогресс материала растёт после решения викторины',
     !!barBefore && !!barAfter && parseInt(barAfter[1], 10) === parseInt(barBefore[1], 10) + 1,
     `${barBefore && barBefore[0]} -> ${barAfter && barAfter[0]}`);

  // «Пройти заново» сбрасывает ответы и снимает отметку
  await setHash('#quiz-types-1');
  const quizBox3 = q('.quiz[data-quiz-id="quiz-types-1"]');
  clickEl(quizBox3.querySelector('.quiz-retry'));
  await wait(50);
  ok('«Пройти заново» снимает отметку', w.PA.store.isSolved('quiz-types-1') === false);
  ok('«Пройти заново» сбрасывает выбранные варианты',
     [...quizBox3.querySelectorAll('input[type="radio"]')].every((r) => !r.checked));
  ok('«Пройти заново» убирает подсветку и пояснение',
     quizBox3.querySelector('.quiz-option-correct') === null &&
     quizBox3.querySelector('.quiz-option-wrong') === null &&
     [...quizBox3.querySelectorAll('.quiz-q')].every((fs) => !fs.classList.contains('checked')));

  console.log('\nЗАДАНИЯ БЕЗ КОДА');
  click('.rail-item[data-mod="9"]');
  await wait(400);
  ok('в прогрессе курса все пять заданий', /Решено 0 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  // Задание «plan-understand» — свой шаг раздела «understand»
  await setHash('#plan-understand');
  const paper = q('.task[data-task-id="plan-understand"]');
  ok('задание без автопроверки помечено «без кода»',
     paper !== null && paper.querySelector('.task-kind') !== null);
  ok('у него нет песочницы, но есть отметка',
     paper !== null && paper.querySelector('.sandbox') === null &&
     paper.querySelector('.task-done') !== null);

  const doneBtn = paper.querySelector('.task-done');
  clickEl(doneBtn);
  await wait(100);
  ok('отметка ставится', w.PA.store.isSolved('plan-understand') === true &&
     doneBtn.getAttribute('aria-pressed') === 'true');
  ok('карточка помечена решённой', paper.classList.contains('task-solved'));
  ok('полоса шагов раздела обновилась', /решено 1 из 1/.test(q('.step-strip-count')?.textContent || ''),
     q('.step-strip-count')?.textContent);

  click('.sec-back');
  await wait(300);
  ok('общий прогресс курса пересчитался', /Решено 1 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  await setHash('#plan-understand');
  click('.task[data-task-id="plan-understand"] .task-done');
  await wait(100);
  ok('отметку можно снять — случайный клик не навсегда', w.PA.store.isSolved('plan-understand') === false);

  click('.sec-back');
  await wait(300);
  ok('курс возвращается к «Решено 0 из 5»', /Решено 0 из 5/.test(q('.pb-text')?.textContent || ''),
     q('.pb-text')?.textContent);

  console.log('\n«ПРОДОЛЖИТЬ» ВЕДЁТ НА ПЕРВОЕ НЕРЕШЁННОЕ ЗАДАНИЕ');
  // «Продолжить» ведёт прямо на само задание (якорь id="ref-<id>", см.
  // renderTaskBlock) и сразу открывает его шаг (модуль 10 ещё нигде не
  // трогали в этом прогоне — гарантированно ничего не решено)
  click('.rail-item[data-mod="10"]');
  await wait(400);
  const continueBtn = q('.pb-continue');
  ok('кнопка «Продолжить» есть, пока ничего не решено', continueBtn !== null);
  const firstTaskId = continueBtn.getAttribute('data-anchor');
  clickEl(continueBtn);
  await wait(700);
  ok('«Продолжить» открывает шаг с самим заданием, не теорией',
     q('.sec-body .task') !== null);
  ok('«Продолжить» приводит к тому самому заданию', d.getElementById('ref-' + firstTaskId) !== null,
     firstTaskId);

  console.log('\nЭКРАНЫ: ПРОГРЕСС НА ГЛАВНОЙ');
  // markTask пишет напрямую в хранилище, минуя рендер — «Моё обучение»
  // считает решённые задания по PA.store('tasks') в момент отрисовки,
  // поэтому переход на экран после отметки уже должен видеть счёт
  w.PA.store.markTask('screens-home-progress', 'solved');
  click('.rail-view[data-view="home"]');
  await wait(200);
  ok('«Моё обучение» показывает ненулевой счёт решённых заданий',
     qa('.week-stat').some((el) => /Решено заданий:\s*[1-9]/.test(el.textContent)),
     qa('.week-stat').map((el) => el.textContent).join(' | '));

  console.log('\nВОЗВРАТ НА СТРАНИЦУ');
  click('.rail-item[data-mod="8"]');
  await wait(400);
  const firstSec = q('.rail-sec');
  const openAnchor = firstSec.dataset.anchor;
  clickEl(firstSec);
  await wait(400);
  w.PA.store.flush();
  const place = w.PA.store.get('ui', 'place', null);
  ok('место запомнено как маршрут-строка (модуль и раздел)',
     place === '#/m/8/' + openAnchor, JSON.stringify(place));

  // Настоящая перезагрузка: новое окно, тот же localStorage
  const w2 = reloadPage(), d2 = w2.document;
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
  // Сохранённое место — это не только модуль, но и сам экран: уходим
  // в каталог, перезагружаем страницу тем же приёмом — второе окно с тем
  // же localStorage — и проверяем, что открылся каталог, а не последний
  // открытый материал
  click('.rail-view[data-view="catalog"]');
  await wait(200);
  w.PA.store.flush();
  const catalogPlace = w.PA.store.get('ui', 'place', null);
  ok('вид «каталог» записан в место как маршрут-строка', catalogPlace === '#/catalog',
     JSON.stringify(catalogPlace));

  const w3 = reloadPage(), d3 = w3.document;
  await wait(900);
  ok('после перезагрузки открыт сохранённый вид «каталог»',
     d3.querySelector('.catalog-view') !== null && d3.querySelector('.module-header') === null);
  ok('в панели активен пункт «Каталог», не материал',
     d3.querySelector('.rail-view[data-view="catalog"]')?.classList.contains('active') === true &&
     d3.querySelector('.rail-item.active') === null);

  console.log('\nПРОГРАММА И РАЗДЕЛ');
  // Шаг 3: выбор материала открывает программу (список разделов),
  // а не сразу разворачивает полотно со всеми разделами гармошками
  click('.rail-item[data-mod="7"]');
  await wait(400);
  const notes2Data = JSON.parse(fs.readFileSync(P + 'data/notes2.json', 'utf8'));
  ok('выбор материала открывает программу, а не полотно',
     q('.prog-card') !== null && q('.sec-head') === null);
  ok('в программе столько карточек, сколько разделов',
     qa('.prog-card').length === notes2Data.sections.length,
     qa('.prog-card').length + ' карточек, ' + notes2Data.sections.length + ' разделов');

  // Раскрытие карточки показывает список шагов: теория и оцениваемые
  // блоки вперемешку — data-kind различает их (см. renderProgramStep),
  // вкладок больше нет: раздел стал последовательностью адресуемых шагов
  const cardWithBoth = qa('.prog-card').find((card) => {
    const kinds = [...card.querySelectorAll('.prog-step-btn')].map((b) => b.dataset.kind);
    return kinds.includes('theory') && kinds.includes('graded');
  });
  ok('нашёлся раздел с шагами теории и практики', cardWithBoth !== undefined);
  clickEl(cardWithBoth.querySelector('.prog-card-head'));
  await wait(100);
  ok('раскрытие карточки показывает список шагов', cardWithBoth.classList.contains('open'));
  const steps = [...cardWithBoth.querySelectorAll('.prog-step-btn')];
  ok('среди шагов есть теория', steps.some((b) => b.dataset.kind === 'theory'));
  ok('среди шагов есть задания', steps.some((b) => b.dataset.kind === 'graded'));

  // Клик по шагу-заданию открывает раздел сразу на этом шаге (не на первом)
  const taskStep = steps.find((b) => b.dataset.kind === 'graded' &&
    b.querySelector('.prog-step-kind').textContent !== 'викторина');
  clickEl(taskStep);
  await wait(400);
  ok('клик по шагу-заданию открывает раздел на шаге с самим заданием', q('.sec-body .task') !== null);
  ok('на шаге задания есть песочница', q('.sec-body .sandbox') !== null);
  ok('на шаге задания нет посторонней теории (.section-label)', q('.sec-body .section-label') === null);

  // Первый квадратик полосы шагов — всегда вступление раздела, теория
  click('.step-sq[data-step="1"]');
  await wait(300);
  ok('первый шаг раздела — теория, без блоков-заданий',
     q('.sec-body .task') === null && q('.sec-body .quiz') === null);

  // «Далее» продвигает по шагам того же раздела (полный переход в соседний
  // раздел на границе проверяется прицельно в «АДРЕСА И ШАГИ» ниже)
  const beforeStep = q('.sec-step-count')?.textContent;
  const nextBtn = q('.sec-nav-next');
  ok('кнопка «Далее» есть', nextBtn !== null);
  if (nextBtn) {
    clickEl(nextBtn);
    await wait(300);
    ok('переход «Далее» меняет шаг', q('.sec-step-count')?.textContent !== beforeStep,
       q('.sec-step-count')?.textContent);
  } else {
    ok('переход «Далее» меняет шаг', false, 'кнопки не было');
  }

  // Переход по якорю из поиска ведёт в нужный раздел на первый его шаг —
  // якорь раздела (не задания) приземляется на вступление, не куда-то вглубь
  inp.value = 'наследование'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(500);
  const searchTarget = q('.sr-item');
  ok('есть результат поиска для проверки перехода', searchTarget !== null);
  clickEl(searchTarget);
  await wait(700);
  ok('переход по якорю из поиска открывает раздел',
     q('.sec-head') !== null && w.location.hash.length > 1);
  ok('переход по якорю из поиска ведёт на первый шаг раздела (якорь раздела)',
     q('.step-sq.step-current') === q('.step-strip .step-sq'));

  // Черновик кода на шаге задания переживает уход на другой раздел ТОГО ЖЕ
  // материала (не смену модуля) и возврат
  await setHash('#num-sum');
  const draftBox = q('.sandbox[data-task-id="num-sum"]');
  const draftKey = draftBox.getAttribute('data-block-key');
  const draftEditor = draftBox.querySelector('.ed-input');
  draftEditor.value = 'print("другой раздел и назад")';
  draftEditor.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(50);

  await openSection('refs');
  ok('ушли на другой раздел того же материала', q('.sec-head')?.id === 'ref-refs');

  await setHash('#num-sum');
  const draftBack = q('.sandbox[data-block-key="' + draftKey + '"] .ed-input');
  ok('черновик задания пережил уход на другой раздел и возврат',
     draftBack !== null && draftBack.value === 'print("другой раздел и назад")',
     JSON.stringify(draftBack && draftBack.value));

  console.log('\nАДРЕСА И ШАГИ');

  // Пять видов адреса — каждый получается обычным переходом по интерфейсу
  click('.rail-view[data-view="catalog"]');
  await wait(200);
  ok('адрес «Каталог»', w.location.hash === '#/catalog', w.location.hash);

  click('.rail-view[data-view="home"]');
  await wait(200);
  ok('адрес «Моё обучение»', w.location.hash === '#/', w.location.hash);

  click('.rail-item[data-mod="6"]');
  await wait(400);
  ok('адрес программы материала', w.location.hash === '#/m/6', w.location.hash);

  click('.rail-sec[data-anchor="map"]');
  await wait(400);
  ok('адрес раздела — первый шаг, без номера', w.location.hash === '#/m/6/map', w.location.hash);

  click('.step-sq[data-step="2"]');
  await wait(400);
  ok('адрес конкретного шага', w.location.hash === '#/m/6/map/2', w.location.hash);
  ok('клик по квадратику полосы шагов открыл именно этот шаг',
     q('.sec-body .section-label')?.textContent === 'Простые типы: одно значение',
     q('.sec-body .section-label')?.textContent);

  // Прямой переход по адресу шага (минуя интерфейс) — раздел «numbers», шаг 3
  await setHash('#/m/6/numbers/3');
  ok('прямой переход по адресу шага открывает именно его',
     q('.sec-body .section-label')?.textContent === 'Приоритет операций',
     q('.sec-body .section-label')?.textContent);
  ok('это шаг теории — песочницы на нём нет', q('.sec-body .sandbox') === null);

  // Старый адрес раздела (#list) заменяется на новый маршрут
  await setHash('#list');
  ok('старый адрес раздела открывает его', d.getElementById('ref-list') !== null);
  ok('старый адрес заменён новым маршрутом', w.location.hash === '#/m/6/list', w.location.hash);

  // Старый адрес задания открывает шаг с этим заданием
  await setHash('#num-sum');
  ok('старый адрес задания открывает шаг с этим заданием', q('.sandbox[data-task-id="num-sum"]') !== null);
  ok('шаг с заданием содержит песочницу', q('.sec-body .sandbox') !== null);
  ok('адрес задания заменён маршрутом его шага', w.location.hash === '#/m/6/numbers/11', w.location.hash);

  // «Далее»/«Назад»: в пределах раздела и на его границах
  await setHash('#/m/6/map');
  click('.sec-nav-next');
  await wait(300);
  ok('«Далее» с первого шага ведёт на второй шаг того же раздела',
     w.location.hash === '#/m/6/map/2', w.location.hash);

  click('.sec-nav-prev');
  await wait(300);
  ok('«Назад» со второго шага возвращает на первый', w.location.hash === '#/m/6/map', w.location.hash);

  click('.sec-nav-prev');
  await wait(300);
  ok('«Назад» с первого шага ведёт на программу материала', w.location.hash === '#/m/6', w.location.hash);

  await setHash('#num-time');   // последнее задание раздела «numbers» — последний его шаг
  ok('num-time — действительно последний шаг раздела', w.location.hash === '#/m/6/numbers/12', w.location.hash);
  click('.sec-nav-next');
  await wait(300);
  ok('«Далее» с последнего шага раздела ведёт в первый шаг следующего раздела',
     w.location.hash === '#/m/6/str', w.location.hash);

  // Черновик кода, введённый на шаге с заданием, переживает уход на другой
  // шаг и возврат (сам шаг, не соседний раздел — тот случай уже выше)
  await setHash('#num-sum');
  const stepDraftBox = q('.sandbox[data-task-id="num-sum"]');
  const stepDraftKey = stepDraftBox.getAttribute('data-block-key');
  const stepDraftEditor = stepDraftBox.querySelector('.ed-input');
  stepDraftEditor.value = 'print("черновик на шаге")';
  stepDraftEditor.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(50);

  click('.sec-nav-prev');   // на шаг num-read (шаг 10)
  await wait(300);
  ok('ушли на соседний шаг того же раздела', q('.sandbox[data-task-id="num-sum"]') === null);

  await setHash('#num-sum');
  const stepDraftBack = q('.sandbox[data-block-key="' + stepDraftKey + '"] .ed-input');
  ok('черновик задания пережил уход на другой шаг и возврат',
     stepDraftBack !== null && stepDraftBack.value === 'print("черновик на шаге")',
     JSON.stringify(stepDraftBack && stepDraftBack.value));

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
