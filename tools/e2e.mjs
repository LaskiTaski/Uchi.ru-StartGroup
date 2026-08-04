import { JSDOM } from 'jsdom';
import fs from 'fs';
const P = 'PythonAcademy/PythonAcademy/';
const dom = new JSDOM(fs.readFileSync(P + 'index.html', 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, d = w.document;
['scrollBy','scrollTo','scrollIntoView'].forEach(m => w.Element.prototype[m] = function(){});
w.scrollTo = () => {};
let fetched = [];
w.fetch = (f) => { fetched.push(f); return Promise.resolve({
  ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(P + f, 'utf8'))) }); };
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

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
