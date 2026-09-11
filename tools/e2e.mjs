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
let fetched = [];
w.fetch = (f) => { fetched.push(f); return Promise.resolve({
  ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(P + f, 'utf8'))) }); };

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

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
