/* ═══════════════════════════════════════════════════════════
   Снимок разметки: сеть безопасности для отрисовки.

       node tools/snapshot.mjs            сличить с эталоном
       node tools/snapshot.mjs --update   записать новый эталон

   Зачем. Две сотни проверок в e2e отвечают на «открылось ли»,
   «записался ли прогресс», «тот ли адрес». Ни одна не отвечает
   на «выглядит ли страница так же». Поэтому правку отрисовки
   нельзя было принять иначе, чем открыв сайт и пролистав его
   глазами, а PR на три тысячи строк — вообще никак.

   Здесь платформа поднимается в jsdom, обходится список экранов,
   и разметка каждого пишется в tools/snapshot.txt. Дальше правка
   отрисовки видна в обычном diff: изменилось ровно то, что
   изменилось. Эталон меняют осознанно, флагом --update, и его
   diff читают так же, как diff кода.
   ═══════════════════════════════════════════════════════════ */
import fs from 'fs';
import { ROOT, createApp } from './dom-harness.mjs';

const FILE = ROOT + 'tools/snapshot.txt';
const update = process.argv.includes('--update');
const NL = String.fromCharCode(10);

/* Экраны подобраны так, чтобы задеть каждую ветку отрисовки:
   шесть видов страниц, четыре вида шага, состояния задания
   «решено» и «пробовал», оба вида старого адреса и промах. */
const SCREENS = [
  ['Моё обучение', '#/'],
  ['Каталог', '#/catalog'],
  ['Программа справочника', '#/m/6'],
  ['Программа видеомодуля с аттестацией', '#/m/1'],
  ['Программа курса', '#/m/9'],
  ['Полотно «Доп. курсов»', '#/m/5'],
  ['Шаг: вступление раздела', '#/m/6/numbers/1'],
  ['Шаг: тема теории', '#/m/6/numbers/4'],
  ['Шаг: задание с песочницей', '#/m/6/numbers/12'],
  ['Шаг: викторина', '#/m/6/map/6'],
  ['Шаг: задание без кода', '#/m/9/understand/4'],
  ['Занятие видеомодуля', '#/m/1/l1-1-1'],
  ['Старый адрес раздела', '#list'],
  ['Старый адрес задания', '#num-sum'],
  ['Несуществующий материал', '#/m/999']
];

/* Прогресс подкладываем заранее: без него не увидеть решённое задание,
   галочки в панели и заполненное «Моё обучение» — а ломаются они молча.
   Даты фиксированные, иначе недельная активность меняла бы снимок сама. */
const STORAGE = {
  pa_progress_v1: JSON.stringify({
    version: 1,
    tasks: {
      'num-read': { status: 'solved', ts: 1758150000, tries: 1 },
      'num-sum': { status: 'tried', ts: 1758150500, tries: 2 },
      'quiz-types-1': { status: 'solved', ts: 1758151000, tries: 1 }
    },
    sections: {},
    drafts: { 'id:num-sum': { code: 'a = int(input())', stdin: '3' } },
    ui: {}
  })
};

const app = createApp({ storage: STORAGE });

const run = async () => {
  await app.wait(700);

  const parts = [];
  for (const [name, hash] of SCREENS) {
    app.go(hash);
    await app.wait(450);
    const rail = app.q('#rail');
    const content = app.q('#content');
    parts.push(
      '═══ ' + name + '  ' + hash + NL +
      '─── адрес после перехода: ' + app.w.location.hash + NL +
      '─── панель' + NL + (rail ? rail.innerHTML : '(нет)') + NL +
      '─── содержимое' + NL + (content ? content.innerHTML : '(нет)') + NL
    );
  }
  const shot = parts.join(NL);

  if (update) {
    fs.writeFileSync(FILE, shot, 'utf8');
    console.log('Эталон записан: ' + SCREENS.length + ' экранов, ' + Math.round(shot.length / 1024) + ' КБ');
    console.log('Прочитайте git diff по tools/snapshot.txt — там видно, что изменилось на экране.');
    return 0;
  }

  if (!fs.existsSync(FILE)) {
    console.log('Эталона нет. Запустите: node tools/snapshot.mjs --update');
    return 1;
  }

  const base = fs.readFileSync(FILE, 'utf8');
  if (base === shot) {
    console.log('Разметка совпадает с эталоном: ' + SCREENS.length + ' экранов.');
    return 0;
  }

  /* Разметка экрана — одна длинная строка, поэтому сравниваем посимвольно
     и показываем окно вокруг самого расхождения: при построчном сравнении
     «было» и «стало» выглядели бы одинаково, а отличие оставалось за краем. */
  let i = 0;
  while (i < base.length && i < shot.length && base[i] === shot[i]) i++;

  const headings = base.slice(0, i).split(NL).filter((line) => line.indexOf('═══ ') === 0);
  const screen = headings.length ? headings[headings.length - 1].slice(4) : '(начало файла)';
  const around = (text) => text.slice(Math.max(0, i - 70), i + 90).split(NL).join('⏎');

  console.log('❌ Разметка разошлась с эталоном.');
  console.log('   Экран: ' + screen);
  console.log('   Расхождение с символа ' + i + ' из ' + base.length);
  console.log('   было:  …' + around(base) + '…');
  console.log('   стало: …' + around(shot) + '…');
  console.log('');
  console.log('   Если изменение намеренное: node tools/snapshot.mjs --update, затем прочитайте git diff.');
  return 1;
};

run().then((code) => process.exit(code));
