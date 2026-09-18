/* ═══════════════════════════════════════════════════════════
   Python Academy — учебная платформа
   Конфигурация живёт в data/manifest.json, контент — в data/*.json.
   Чтобы добавить модуль, править код не нужно.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Настройки поведения ─────────────────────────────── */
  const CONFIG = {
    headerCollapseAt: 150,   // прокрутка, после которой шапка сжимается
    headerExpandAt: 40,      // и на которой возвращается (гистерезис)
    searchDebounce: 120,     // пауза перед поиском, мс
    searchMinLength: 2,
    searchLimit: 8,
    scrollOffset: 14         // зазор под липкой шапкой при переходе по якорю
  };

  // Уважаем системную настройку «меньше анимации» (этап 5): в jsdom
  // matchMedia отсутствует, поэтому проверка через && обязательна
  const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function scrollBehavior() {
    return REDUCED_MOTION ? 'auto' : 'smooth';
  }

  const IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  // Подписи курсов: ключ -> [текст, css-класс]
  const TAG_LABELS = {
    free:     ['Бесплатно', 'tag-free'],       paid:   ['Платный', 'tag-paid'],
    easy:     ['Легко', 'tag-easy'],           medium: ['Нормально', 'tag-medium'],
    hard:     ['Сложно', 'tag-hard'],          heavy:  ['Тяжело', 'tag-heavy'],
    useful:   ['Полезно', 'tag-useful'],       super:  ['Очень полезно', 'tag-super'],
    start:    ['Для старта', 'tag-start'],
    optional: ['Необязательно', 'tag-optional'], unknown: ['Неизвестно', 'tag-unknown']
  };
  const REMEMBER_KEY = 'pa_m5_unlocked';
  const SECRET_PASSWORD = 'NwrBJQF92k&=';

  // Вид материала по-русски — для карточки каталога. Вид однозначно
  // следует из группы, поэтому в манифесте его нет: вся связь здесь
  const KIND_LABELS = {
    video: 'Видеомодуль', my: 'Курс', ref: 'Справочник', extra: 'Внешний курс'
  };

  // Режим проверки задания по-русски — для шага в программе (шаг 3)
  const TASK_KIND_LABELS = { stdout: 'вывод программы', function: 'функция', asserts: 'проверки' };

  const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  /* Пункты верхней части панели — переключают весь экран, а не материал */
  const RAIL_VIEWS = [
    { view: 'home', icon: '🏠', label: 'Моё обучение' },
    { view: 'catalog', icon: '📚', label: 'Каталог' }
  ];

  /* ── Состояние ───────────────────────────────────────── */
  const state = {
    modules: [],          // из манифеста
    groups: [],           // из манифеста
    activeModule: null,
    // 'home' | 'catalog' | 'material' | 'program' | 'section' — какой экран сейчас.
    // 'material' — старое единое полотно, оставлено только для модуля «Доп. курсы»
    // (data.type === 'courses'): у него нет ни секций-с-блоками, ни занятий,
    // делить там нечего на теорию/практику. Всё остальное — 'program'/'section'.
    view: 'home',
    section: null,         // якорь раздела (или занятия) — только для view 'section'
    tab: 'theory',         // 'theory' | 'practice' — вкладка раздела (только для view 'section')
    authToken: localStorage.getItem(REMEMBER_KEY) === '1' ? '1' : null
  };

  /* Любой из экранов конкретного материала. Спрашивают и про текущий
     экран (панель, savePlace), и про сохранённое место: place.view
     хранит те же значения, что и state.view */
  function isModuleScreen(view) {
    return view === 'material' || view === 'program' || view === 'section';
  }

  /* ── Утилиты разметки ────────────────────────────────── */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /* Общая сборка строки атрибутов для h() и hOpen() — один цикл на двоих */
  function attrsHtml(attrs) {
    let out = '';
    if (attrs) {
      for (const key in attrs) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (value === true) { out += ' ' + key; continue; }
        out += ' ' + key + '="' + esc(value) + '"';
      }
    }
    return out;
  }

  /**
   * Сборка элемента. Атрибуты экранируются всегда — забыть esc() нельзя.
   * Содержимое считается готовой разметкой, текст экранируйте сами.
   *   h('div', { class: 'lesson', 'data-mod': 3 }, '<span>...</span>')
   * Когда нужен только открывающий тег (дальше разметка собирается
   * конкатенацией строк) — используйте hOpen() с теми же правилами атрибутов.
   */
  function h(tag, attrs, inner) {
    let out = '<' + tag + attrsHtml(attrs) + '>';
    if (inner !== undefined && inner !== null) out += inner;
    return out + '</' + tag + '>';
  }

  /* Только открывающий тег — замена h(tag, attrs).replace('</tag>', '') */
  function hOpen(tag, attrs) {
    return '<' + tag + attrsHtml(attrs) + '>';
  }

  /* Атрибуты, задающие цвет модуля: раньше на это уходило 48 правил в CSS */
  function modAttrs(modId, extra) {
    const meta = getModuleMeta(modId);
    return Object.assign({
      'data-mod': modId,
      style: meta && meta.color ? '--mod-color: ' + meta.color : null
    }, extra || {});
  }

  const byId = (id) => document.getElementById(id);

  /* Материал, на который указывает элемент разметки (data-mod) */
  const modOf = (el) => parseInt(el.getAttribute('data-mod'), 10);

  /* ── Состояние блоков переживает перерисовку (этап 0.2) ─
     loadModule заменяет весь innerHTML, поэтому введённый
     учеником код обязан жить вне разметки. Реестром служит
     PA.store: он же дублирует данные в localStorage, так что
     код переживает и переключение вкладки, и перезагрузку.   */

  const hasPA = typeof window.PA !== 'undefined';

  function blockKeyOf(ctx, index, block) {
    if (block && block.id) return 'id:' + block.id;
    return (ctx && ctx.anchor ? ctx.anchor : 'x') + ':' + index;
  }

  function draftOf(key) {
    if (!hasPA || !key) return null;
    const saved = window.PA.store.get('drafts', key, null);
    if (typeof saved === 'string') return { code: saved, stdin: '' };
    return saved;
  }

  function saveDraft(key, patch) {
    if (!hasPA || !key) return;
    const prev = draftOf(key) || {};
    window.PA.store.set('drafts', key, Object.assign({}, prev, patch));
  }

  /* Снять состояние со всех живых редакторов перед перерисовкой */
  function captureEditors() {
    if (!hasPA) return;
    document.querySelectorAll('.sandbox[data-block-key]').forEach((box) => {
      const key = box.getAttribute('data-block-key');
      const editor = box.querySelector('.pa-editor');
      const stdin = box.querySelector('.sb-stdin-input');
      if (!editor) return;
      const code = window.PA.editor.value(editor);
      // Нетронутый пример хранить незачем: он и так есть в JSON
      const stdinValue = stdin ? stdin.value : '';
      if (code === box.getAttribute('data-start') && stdinValue === (box.getAttribute('data-stdin') || '')) {
        window.PA.store.set('drafts', key, null);
        return;
      }
      saveDraft(key, { code: code, stdin: stdin ? stdin.value : '' });
    });
    window.PA.store.flush();
  }

  /** Единственная точка замены содержимого страницы. */
  function setContent(html) {
    captureEditors();
    const content = byId('content');
    content.innerHTML = html;
    hydrate(content);
  }

  /* Достроить то, что нельзя выразить строкой разметки */
  function hydrate(root) {
    if (!hasPA) return;
    root.querySelectorAll('.pa-editor').forEach((editor) => {
      window.PA.editor.sync(editor);
    });
  }

  /* ── Где ученик остановился (этап 5, шаг 2; шаг 3 — плюс раздел/вкладка)
     Возврат на сайт не должен стоить четырёх кликов: помним не только
     модуль, но и сам экран — «Моё обучение», каталог, программа или
     конкретный раздел на нужной вкладке. Хранится отдельно от прогресса,
     в экспорт не идёт. Старое поле place.open (список раскрытых секций
     единого полотна) сюда больше не пишется — читать его не нужно:
     аккордеона на весь материал больше нет. */

  function savePlace() {
    if (!hasPA) return;
    const place = { view: state.view };
    if (isModuleScreen(state.view)) {
      if (!state.activeModule) return;
      place.mod = state.activeModule;
      if (state.view === 'section') {
        place.section = state.section;
        place.tab = state.tab;
      }
    }
    window.PA.store.set('ui', 'place', place);
  }

  function savedPlace() {
    return hasPA ? window.PA.store.get('ui', 'place', null) : null;
  }

  /* ── Конфигурация из манифеста ───────────────────────── */

  function getModuleMeta(modId) {
    return state.modules.find((m) => m.id === modId) || null;
  }

  function modulesOfGroup(groupId) {
    return state.modules.filter((m) => m.group === groupId);
  }

  /* Карточка «программы вперёд»: показана, но открыть нечем — файла
     с контентом ещё нет (см. data/manifest.json, status: planned) */
  function isPlanned(meta) {
    return !!meta && meta.status === 'planned';
  }

  /* Модули с оглавлением — справочники и курсы */
  function menuModules() {
    return state.modules.filter((m) => m.menu);
  }

  /* ── Загрузка данных: кэшируем промисы, а не результаты ──
     Повторный вызов возвращает тот же промис, поэтому один
     и тот же файл физически не может загрузиться дважды.    */

  const requests = new Map();

  function fetchModule(modId) {
    if (!requests.has(modId)) {
      const meta = getModuleMeta(modId);
      if (!meta) return Promise.reject(new Error('Нет модуля ' + modId));
      requests.set(modId, fetch(meta.file).then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }).catch((error) => {
        requests.delete(modId);      // не кэшируем неудачу — можно повторить
        throw error;
      }));
    }
    return requests.get(modId);
  }

  /* Данные уже в памяти? Нужно для синхронного рендера без мигания */
  const loaded = new Map();

  function fetchModuleCached(modId) {
    return fetchModule(modId).then((data) => {
      loaded.set(modId, data);
      return data;
    });
  }

  function loadAllModules(modules) {
    return Promise.all(modules.map((m) =>
      fetchModuleCached(m.id).catch(() => null)
    ));
  }

  /* «Моё обучение» и «Каталог» считают счётчики и прогресс только по
     уже загруженным модулям (loaded), чтобы не тянуть все файлы разом
     и не блокировать экран. Но чтобы цифры не пустовали вечно, один раз
     за визит тихо подгружаем всё незащищённое в фоне и перерисовываем
     тот же экран, если ученик всё ещё на нём. Защищённый модуль (пароль)
     не трогаем — его загрузка не дело фонового процесса. */
  let backgroundLoadStarted = false;

  function preloadModulesInBackground() {
    if (backgroundLoadStarted) return;
    backgroundLoadStarted = true;

    const targets = state.modules.filter((m) => !isPlanned(m) && !m.protected && !loaded.has(m.id));
    if (!targets.length) return;

    loadAllModules(targets).then(repaintView);
  }

  /* ── Панель материалов: постоянная левая колонка ───────
     Раньше группа и её модули были двумя лентами вкладок (сначала
     выбираешь группу, потом — модуль внутри неё). Панель показывает
     сразу всё: заголовки групп из манифеста и под каждым — её модули,
     кликнуть можно по любому пункту без промежуточного переключения. */

  /* Аттестация — не занятие: в счётчиках её не показываем */
  function lessonsCount(data) {
    return data.lessons.filter((l) => !l.attestation).length;
  }

  /* Число, которое видно счётчиком справа от пункта: занятия — для
     видеомодулей, разделы — для справочников и курсов. Пока данные
     модуля не загружены (loaded — см. выше), считать нечем: пункт
     просто без счётчика, а не с нулём — ноль выглядел бы как «пусто». */
  function railCount(modId) {
    const data = loaded.get(modId);
    if (!data) return null;
    if (data.lessons) return lessonsCount(data);
    return (data.sections || []).length;
  }

  /* Дерево разделов под активным пунктом — замена выпадающему меню
     вкладки. Есть только у модулей с data.sections (справочники, курсы)
     и только когда данные уже загружены — иначе рисовать нечего. */
  function railSectionsHtml(modId) {
    const data = loaded.get(modId);
    if (!data || !data.sections) return '';

    let items = '';
    data.sections.forEach((section) => {
      if (!section.anchor) return;
      // Активный раздел подсвечивается, только когда открыт именно экран
      // раздела (шаг 3) — на экране программы ни один пункт не выбран
      const active = state.view === 'section' && state.section === section.anchor;
      items += h('button', {
        class: 'rail-sec' + (allSolved(sectionParts(section)) ? ' rail-sec-done' : '') + (active ? ' active' : ''),
        'data-anchor': section.anchor,
        'aria-current': active ? 'page' : 'false'
      },
        h('span', { class: 'rail-sec-num' }, esc(section.num)) +
        h('span', { class: 'rail-sec-title' }, esc(section.title))
      );
    });

    return items ? h('div', { class: 'rail-sec-list' }, items) : '';
  }

  /* Два пункта над деревом материалов: переключают весь экран (шаг 2),
     подсвечиваются так же, как активный материал */
  function railViewsHtml() {
    let items = '';
    RAIL_VIEWS.forEach((v) => {
      const active = state.view === v.view;
      items += h('button', {
        class: 'rail-view' + (active ? ' active' : ''),
        'data-view': v.view,
        'aria-current': active ? 'page' : 'false'
      },
        h('span', { class: 'rail-view-icon' }, esc(v.icon)) +
        h('span', { class: 'rail-view-label' }, esc(v.label))
      );
    });
    return h('div', { class: 'rail-views' }, items);
  }

  function renderRail() {
    let html = '';

    state.groups.forEach((group) => {
      const modules = modulesOfGroup(group.id);
      if (!modules.length) return;   // валидатор допускает пустую группу — рисовать в ней нечего

      html += h('div', { class: 'rail-group' },
        h('span', { class: 'rail-group-icon' }, esc(group.icon)) +
        h('span', { class: 'rail-group-label' }, esc(group.label))
      );

      modules.forEach((meta) => {
        // Активный пункт — на любом из экранов материала (программа,
        // раздел, старое полотно «Доп. курсов»): в «Моём обучении»
        // и каталоге дерево разделов не рисуем (см. ниже), а подсветку
        // текущего экрана берут на себя кнопки .rail-view
        const active = isModuleScreen(state.view) && meta.id === state.activeModule;
        const planned = isPlanned(meta);
        const count = planned ? null : railCount(meta.id);

        html += h('button', modAttrs(meta.id, {
          class: 'rail-item' + (active ? ' active' : '') + (planned ? ' rail-item-planned' : ''),
          'aria-current': active ? 'page' : 'false',
          'aria-disabled': planned ? 'true' : null
        }),
          h('span', { class: 'rail-item-icon' }, esc(meta.icon)) +
          h('span', { class: 'rail-item-text' },
            h('span', { class: 'rail-item-label' }, esc(meta.label)) +
            (meta.sub ? h('span', { class: 'rail-item-sub' }, esc(meta.sub)) : '')
          ) +
          (planned ? h('span', { class: 'rail-item-soon' }, 'скоро')
                   : (count !== null ? h('span', { class: 'rail-item-count' }, count) : ''))
        );

        // Дерево разделов рисуется только в виде 'material' — см. active выше
        if (active) html += railSectionsHtml(meta.id);
      });
    });

    byId('rail').innerHTML = railViewsHtml() +
      h('nav', { class: 'rail-nav', role: 'navigation', 'aria-label': 'Материалы' }, html);
  }

  /* ── Выезжающая на узком экране панель ─────────────────
     Класс open поднимает панель поверх контента, но объявлен он только
     внутри медиа-запроса (см. styles.css): на широком экране класс ни
     на что не влияет, поэтому закрывать панель можно, не спрашивая
     ширину окна — порог остаётся один, в стилях. */

  function setRailOpen(open) {
    byId('rail').classList.toggle('open', open);
    byId('rail-scrim').classList.toggle('open', open);
    byId('rail-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleRail() {
    setRailOpen(!byId('rail').classList.contains('open'));
  }

  /* Материал, на который указывает кликнутый элемент, — или null, если
     открывать нечего. Единственный рубеж для запланированных: карточка
     и пункт панели нарисованы, но файла с контентом у них ещё нет,
     поэтому глубже (switchModule, loadModule) про planned не знают. */
  function openableModule(el) {
    const modId = modOf(el);
    const meta = getModuleMeta(modId);
    return meta && !isPlanned(meta) ? modId : null;
  }

  /* Открыть материал, на который указывает кликнутый элемент: пункт
     панели и карточку каталога ведёт один и тот же путь. Возвращает
     false, если открывать нечего (материал запланирован) — панель
     на узком экране в этом случае остаётся открытой. */
  function openModuleFrom(el) {
    const modId = openableModule(el);
    if (modId === null) return false;
    goAndScrollTop(() => {
      // Тот же материал уже открыт — клик всегда ведёт на экран
      // программы (шаг 3), даже если ученик сейчас глубоко в разделе
      if (modId === state.activeModule) reopenModule(modId);
      else switchModule(modId);
    });
    return true;
  }

  /* ── Экраны и переключение модуля ───────────────────────
     Три вида делит один и тот же контейнер #content: showView рисует
     «Моё обучение»/каталог сразу (данные уже в браузере), а материал —
     дело switchModule/loadModule, у которых своя загрузка и свой кэш. */

  /* Экраны, которым хватает уже загруженных данных: вид → чем рисовать.
     Экранов материала здесь нет — их рисуют switchModule/loadModule,
     дождавшись своей загрузки. Через repaintView() ими пользуются
     и showView, и фоновая догрузка модулей. */
  const VIEW_RENDERERS = { home: renderHome, catalog: renderCatalog };

  function repaintView() {
    const render = VIEW_RENDERERS[state.view];
    if (render) setContent(render());
  }

  function showView(view) {
    state.view = view;
    preloadModulesInBackground();   // цифрам экранов нужны данные модулей — тянем их в фоне
    renderRail();
    repaintView();
    savePlace();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    setRailOpen(false);
  }

  function switchModule(modId) {
    state.activeModule = modId;
    state.view = 'material';   // временная метка на время загрузки — openMaterialTop уточнит экран
    renderRail();

    // Запоминаем уже после отрисовки: до неё в DOM ещё прошлый модуль
    return loadModule(modId).then(function (data) {
      savePlace();
      return data;
    });
  }

  /**
   * Показывает модуль и возвращает промис, который выполнится
   * после отрисовки. Именно это убрало ожидание рендера опросом.
   */
  function loadModule(modId) {
    const meta = getModuleMeta(modId);
    if (meta && meta.protected && !state.authToken) {
      setContent(renderLoginForm());
      return Promise.resolve();
    }

    if (loaded.has(modId)) {
      openMaterialTop(modId, loaded.get(modId));
      return Promise.resolve(loaded.get(modId));
    }

    setContent(h('div', { class: 'empty-state' }, 'Загрузка…'));

    return fetchModuleCached(modId).then((data) => {
      if (state.activeModule === modId) openMaterialTop(modId, data);
      return data;
    }).catch(() => {
      setContent(h('div', { class: 'empty-state' },
        '⚠️ Не удалось загрузить модуль. Проверьте, что файл ' +
        esc(meta ? meta.file : '') + ' на месте.'));
    });
  }

  /* ── Верхний уровень материала: «Программа» или старое полотно ──
     (шаг 3). Модуль «Доп. курсы» (data.type === 'courses') — единственный,
     где нет ни секций-с-блоками, ни занятий; для него ничего не меняем.
     Всё остальное получает экран «Программа» вместо мгновенного полотна. */
  function openMaterialTop(modId, data) {
    state.activeModule = modId;
    state.view = data.type === 'courses' ? 'material' : 'program';
    state.section = null;
    renderRail();   // дерево разделов и счётчик панели ждали именно этих данных
    setContent(state.view === 'material' ? renderCoursesModule(data) : renderProgramScreen(data));
    savePlace();
  }

  /* Открыть уже загруженный материал заново (пункт панели/карточка,
     кнопка «Программа») — без повторной загрузки данных */
  function reopenModule(modId) {
    const data = loaded.get(modId);
    if (data) openMaterialTop(modId, data);
    else switchModule(modId);
  }

  /* ── Экран «Раздел» (шаг 3): один раздел (или занятие видеомодуля)
     на весь экран, на нужной вкладке. Данные уже должны быть загружены —
     до сюда доходят только через уже открытый материал. */
  function openSection(modId, anchor, tab) {
    state.activeModule = modId;
    state.view = 'section';
    state.section = anchor;
    state.tab = tab === 'practice' ? 'practice' : 'theory';
    renderRail();
    const data = loaded.get(modId);
    setContent(data ? renderSectionScreen(data, anchor, state.tab) : h('div', { class: 'empty-state' }, 'Загрузка…'));
    savePlace();
  }

  /* ── Экран «Моё обучение» (шаг 2) ───────────────────────
     Стартовый экран вместо первого видеомодуля: свод того, что уже
     сделано, и подсказка, что делать дальше. Все числа — из PA.store,
     без выдуманных примеров: нет данных — пустое состояние или ноль. */

  /* Раздел экрана: пустое тело — нет и заголовка, иначе «Дальше
     в программе» висело бы над пустотой */
  function homeSection(title, body) {
    return body ? h('div', { class: 'home-section' },
      (title ? h('div', { class: 'home-title' }, title) : '') + body) : '';
  }

  /* Плитка материала — общая часть карточки «Продолжить» и строк
     «Прохожу сейчас» / «Дальше в программе»: цветная иконка, название,
     подпись и то, что идёт под ней (обычно полоса прогресса) */
  function tileHtml(meta, sub, extra) {
    return h('span', { class: 'tile-icon' }, esc(meta.icon)) +
      h('div', { class: 'tile-body' },
        h('div', { class: 'tile-label' }, esc(meta.label)) +
        (sub ? h('div', { class: 'tile-sub' }, esc(sub)) : '') +
        (extra || '')
      );
  }

  /* Одна формула на мини-полосу, полосу модуля и кольцо раздела */
  function percentOf(solved, total) {
    return total ? Math.round(solved / total * 100) : 0;
  }

  /* Общая мини-полоса прогресса: карточка «Продолжить», плитка каталога
     и строка «Прохожу сейчас» показывают одно и то же по одной формуле */
  function renderProgressMini(data) {
    const p = progressOf(data);
    if (!p.total) return '';
    return h('div', { class: 'mini-progress' },
      h('div', { class: 'mini-progress-track' },
        h('div', { class: 'mini-progress-fill', style: 'width:' + percentOf(p.solved, p.total) + '%' })) +
      h('div', { class: 'mini-progress-text' }, 'Решено ' + p.solved + ' из ' + p.total)
    );
  }

  function renderContinueCard() {
    // Куда вести: на сохранённое место, а если ученик ещё ничего не открывал —
    // на первый материал справочника (бесплатный и доступен без пароля)
    const place = savedPlace();
    const savedMeta = place && isModuleScreen(place.view) ? getModuleMeta(place.mod) : null;
    const fromPlace = !!savedMeta && !isPlanned(savedMeta);
    const meta = fromPlace ? savedMeta : modulesOfGroup('ref')[0];
    if (!meta) return '';

    // Раздел известен, только если в прошлый раз ушли именно с экрана
    // раздела — на экране программы «место» не более точное, чем модуль
    const anchor = fromPlace && place.view === 'section' ? place.section : null;

    // Карточке нужны слова, а не якорь: у справочников и курсов заголовок
    // берётся из разделов (data.sections), у видеомодулей — из занятий
    const data = loaded.get(meta.id);
    const item = data && anchor
      ? (data.sections || []).find((s) => s.anchor === anchor) ||
        (data.lessons || []).find((l) => lessonAnchorOf(data.id, l.num) === anchor)
      : null;
    const sub = item
      ? 'вы остановились на разделе «' + item.title + '»'
      : (anchor ? 'вы остановились здесь — открываем раздел' : 'откройте материал, чтобы продолжить');

    return h('div', modAttrs(meta.id, { class: 'continue-card' }),
      tileHtml(meta, sub, data ? renderProgressMini(data) : '') +
      h('button', {
        class: 'home-continue', type: 'button',
        'data-mod': meta.id, 'data-anchor': anchor || ''
      }, 'Продолжить')
    );
  }

  /* ── Недельная активность ───────────────────────────────
     Источник — ts (секунды) у каждой записи в PA.store('tasks'):
     свой таймер платформа не ведёт, день считаем прямо по нему. */

  function dayKeyOf(date) {
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  }

  /* Дней подряд с занятиями, сегодня включительно — считаем назад,
     пока календарный день числится активным */
  function currentStreak(days) {
    let streak = 0;
    const cursor = new Date();
    while (days.has(dayKeyOf(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function renderWeekActivity() {
    const records = hasPA ? window.PA.store.get('tasks', undefined, {}) : {};
    const days = new Set();
    let solved = 0;
    Object.keys(records).forEach((id) => {
      const rec = records[id];
      if (!rec) return;
      if (rec.ts) days.add(dayKeyOf(new Date(rec.ts * 1000)));
      if (rec.status === 'solved') solved++;
    });

    // Пн—Вс текущей недели: getDay() воскресенье — 0, поэтому у него
    // сдвиг особый (-6), у остальных дней — 1 - номер дня
    const now = new Date();
    const shift = now.getDay() === 0 ? -6 : 1 - now.getDay();
    const today = dayKeyOf(now);

    let cells = '';
    WEEKDAY_LABELS.forEach((label, i) => {
      const key = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift + i));
      const active = days.has(key);
      cells += h('div', {
        class: 'week-cell' + (active ? ' week-active' : '') + (key === today ? ' week-today' : '')
      },
        h('span', { class: 'week-day' }, label) +
        h('span', { class: 'week-dot' }, active ? '●' : '')
      );
    });

    return h('div', { class: 'week-activity' },
      h('div', { class: 'week-grid' }, cells) +
      h('div', { class: 'week-stats' },
        h('span', { class: 'week-stat' }, 'Решено заданий: ' + solved) +
        h('span', { class: 'week-stat' }, 'Дней подряд: ' + currentStreak(days))
      )
    );
  }

  /* ── «Прохожу сейчас» и «Дальше в программе» ───────────── */

  /* В работе — то, где есть решённое задание (данные уже должны быть
     загружены, см. preloadModulesInBackground) или само сохранённое
     место: ученик мог открыть материал и ещё не решить в нём ничего.
     Пока такого нет — вместо списка приглашение в каталог. */
  function renderInProgress() {
    const place = savedPlace();
    // Любой экран материала считается «последним открытым»: программа,
    // раздел и полотно «Доп. курсов» — это всё тот же материал
    const placeModId = place && isModuleScreen(place.view) ? place.mod : null;

    let rows = '';
    state.modules.forEach((meta) => {
      if (isPlanned(meta)) return;
      const data = loaded.get(meta.id);
      const solved = data ? progressOf(data).solved : 0;
      if (!solved && meta.id !== placeModId) return;
      rows += h('div', modAttrs(meta.id, { class: 'progress-item' }),
        tileHtml(meta, null, data ? renderProgressMini(data) : '') +
        h('button', { class: 'pi-open', type: 'button', 'data-mod': meta.id }, 'Открыть')
      );
    });

    if (!rows) {
      return h('div', { class: 'home-empty' },
        h('p', { class: 'home-empty-text' }, 'Вы ещё не начали.') +
        h('button', { class: 'home-open-catalog', type: 'button' }, 'Открыть каталог')
      );
    }
    return h('div', { class: 'progress-list' }, rows);
  }

  function renderPlanned() {
    let rows = '';
    state.modules.filter(isPlanned).forEach((meta) => {
      rows += h('div', modAttrs(meta.id, { class: 'planned-item' }),
        tileHtml(meta, meta.sub, '') +
        h('span', { class: 'planned-soon' }, 'скоро')
      );
    });
    return rows ? h('div', { class: 'planned-list' }, rows) : '';
  }

  function renderHome() {
    return h('div', { class: 'home-view' },
      homeSection(null, renderContinueCard()) +
      homeSection('Активность за неделю', renderWeekActivity()) +
      homeSection('Прохожу сейчас', renderInProgress()) +
      homeSection('Дальше в программе', renderPlanned())
    );
  }

  /* ── Экран «Каталог» ────────────────────────────────────
     Все материалы разом, сгруппированные как в манифесте — противовес
     «Моему обучению»: там то, чем занят ученик, здесь — всё, что есть. */

  function renderCatalogCard(meta) {
    const planned = isPlanned(meta);
    const kindLabel = KIND_LABELS[meta.group];

    // Цифры — только по уже загруженным данным (loaded): тянуть все файлы
    // ради сетки карточек не стоит того
    const data = planned ? null : loaded.get(meta.id);
    const progress = data ? progressOf(data) : null;
    const metricsHtml = data ? h('div', { class: 'catalog-card-metrics' },
      h('span', { class: 'catalog-card-metric' },
        railCount(meta.id) + (data.lessons ? ' занятий' : ' разделов')) +
      (progress.total
        ? h('span', { class: 'catalog-card-metric' }, 'заданий ' + progress.solved + '/' + progress.total)
        : '')
    ) : '';

    let badges = '';
    if (planned) badges += h('span', { class: 'catalog-card-badge catalog-card-badge-soon' }, 'скоро');
    if (meta.protected) badges += h('span', { class: 'catalog-card-badge catalog-card-badge-locked' }, 'под паролем');

    return h(planned ? 'div' : 'button', modAttrs(meta.id, {
      class: 'catalog-card' + (planned ? ' catalog-card-planned' : ''),
      type: planned ? null : 'button'
    }),
      h('span', { class: 'tile-icon' }, esc(meta.icon)) +
      h('div', { class: 'tile-body' },
        (kindLabel ? h('div', { class: 'catalog-card-kind' }, esc(kindLabel)) : '') +
        h('div', { class: 'tile-label' }, esc(meta.label)) +
        (meta.sub ? h('div', { class: 'tile-sub' }, esc(meta.sub)) : '') +
        metricsHtml +
        (data ? renderProgressMini(data) : '')
      ) +
      (badges ? h('div', { class: 'catalog-card-badges' }, badges) : '')
    );
  }

  function renderCatalog() {
    let html = '';
    state.groups.forEach((group) => {
      const modules = modulesOfGroup(group.id);
      if (!modules.length) return;

      let cards = '';
      modules.forEach((meta) => { cards += renderCatalogCard(meta); });

      html += h('div', { class: 'catalog-group' },
        h('div', { class: 'catalog-group-head' },
          h('span', { class: 'catalog-group-icon' }, esc(group.icon)) +
          h('span', { class: 'catalog-group-label' }, esc(group.label)) +
          h('span', { class: 'catalog-group-count' }, modules.length)
        ) +
        h('div', { class: 'catalog-grid' }, cards)
      );
    });

    return h('div', { class: 'catalog-view' }, html);
  }

  /* ── Защищённый раздел ───────────────────────────────── */

  function renderLoginForm(errorMsg) {
    return h('div', { class: 'auth-gate' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'auth-icon' }, '🔒') +
        h('div', { class: 'auth-title' }, 'Раздел защищён') +
        h('div', { class: 'auth-text' }, 'Введите пароль, чтобы открыть дополнительные материалы.') +
        (errorMsg ? h('div', { class: 'auth-error' }, esc(errorMsg)) : '') +
        h('input', {
          type: 'password', id: 'cert-input', class: 'auth-input',
          placeholder: 'Пароль', autocomplete: 'off', spellcheck: 'false'
        }) +
        h('label', { class: 'auth-remember' },
          '<input type="checkbox" id="cert-remember"> Запомнить меня') +
        h('button', { class: 'auth-btn', id: 'cert-submit' }, 'Открыть')
      )
    );
  }

  function handleLogin() {
    const input = byId('cert-input');
    const remember = byId('cert-remember');
    if (!input) return;

    if (input.value.trim() !== SECRET_PASSWORD) {
      setContent(renderLoginForm('Неверный пароль. Попробуйте ещё раз.'));
      return;
    }

    state.authToken = '1';
    if (remember && remember.checked) localStorage.setItem(REMEMBER_KEY, '1');
    loadModule(state.activeModule);
  }

  /* ── Якоря ───────────────────────────────────────────── */

  function lessonAnchorOf(modId, num) {
    return 'l' + modId + '-' + String(num).replace(/\./g, '-');
  }

  function headerOffset() {
    const header = document.querySelector('.header');
    return (header ? header.offsetHeight : 0) + CONFIG.scrollOffset;
  }

  /* Прокрутка к элементу с подсветкой-вспышкой: общая часть перехода
     по якорю (goToAnchor) и клика по квадратику полосы шагов */
  function scrollToElement(element) {
    const top = element.getBoundingClientRect().top + window.pageYOffset - headerOffset();
    window.scrollTo({ top: top, behavior: scrollBehavior() });
    element.classList.remove('flash');
    void element.offsetWidth;
    element.classList.add('flash');
  }

  /* В каком модуле живёт якорь — якорь раздела, задания или занятия.
     Сам разбор якоря один на всех, см. resolveAnchorTarget. */
  function findModuleForAnchor(anchor) {
    const lessonMatch = /^l(\d+)-/.exec(anchor);
    if (lessonMatch) return parseInt(lessonMatch[1], 10);

    for (const meta of menuModules()) {
      const data = loaded.get(meta.id);
      if (data && data.sections && resolveAnchorTarget(data, anchor)) return meta.id;
    }
    return null;
  }

  /* Куда именно ведёт якорь внутри уже загруженных данных модуля:
     якорь раздела — сам раздел на вкладке теории; якорь задания —
     раздел, где оно лежит, на вкладке практики; у видеомодулей якорь
     занятия ведёт на экран этого занятия, вкладок там нет вовсе */
  function resolveAnchorTarget(data, anchor) {
    if (!data) return null;
    for (const section of data.sections || []) {
      if (section.anchor === anchor) return { section: section.anchor, tab: 'theory' };
      if ((section.blocks || []).some((b) => b.type === 'task' && b.id === anchor)) {
        return { section: section.anchor, tab: 'practice' };
      }
    }
    return data.lessons ? { section: anchor, tab: null } : null;
  }

  function goToAnchor(anchor, updateHash) {
    setRailOpen(false);   // на узком экране панель закрывает то, к чему прыгаем

    function jump() {
      const element = byId('ref-' + anchor);
      if (!element) return;

      // Ниже порога шапка свернётся — сворачиваем до замера позиции
      const absoluteTop = element.getBoundingClientRect().top + window.pageYOffset;
      if (absoluteTop > CONFIG.headerCollapseAt) {
        document.querySelector('.header').classList.add('compact');
      }

      scrollToElement(element);

      if (updateHash !== false && history.replaceState) {
        history.replaceState(null, '', '#' + anchor);
      }
    }

    // Открыть раздел (или занятие) на нужной вкладке и прыгнуть к якорю —
    // данные модуля к этому моменту уже загружены
    function openAndJump(modId) {
      const target = resolveAnchorTarget(loaded.get(modId), anchor);
      if (target) openSection(modId, target.section, target.tab);
      jump();
    }

    // Загружаем оглавления, находим модуль, переключаемся и только потом прыгаем
    loadAllModules(menuModules()).then(() => {
      renderRail();   // разделы только что загружены — дерево в панели могло быть неполным
      const modId = findModuleForAnchor(anchor);
      if (modId === null) return;
      if (state.activeModule === modId && loaded.has(modId)) { openAndJump(modId); return; }
      return switchModule(modId).then(() => openAndJump(modId));
    });
  }

  /* ── Поиск ───────────────────────────────────────────── */

  /* Нормализация ДЛИНУ СОХРАНЯЕТ: только регистр и ё→е, без схлопывания
     пробелов. Позиции символов в normalize(text) обязаны совпадать
     с позициями в исходном text — на этом держится точная подсветка
     (highlight режет сырой текст по позиции, найденной в normalize). */
  function normalize(text) {
    return String(text).toLowerCase().replace(/ё/g, 'е');
  }

  /* Русские окончания для грубого стемминга — от длинных к коротким,
     чтобы «ами» не срезалось как «и» раньше времени */
  const STEM_ENDINGS = [
    'ами', 'ями', 'ов', 'ев', 'ах', 'ях', 'ой', 'ей', 'ый', 'ий',
    'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ом', 'ем', 'ам', 'ям',
    'у', 'ю', 'а', 'я', 'ы', 'и', 'е', 'о', 'ь'
  ];

  /**
   * Грубый стемминг запроса: отсекаем ОДНО окончание у русского слова,
   * чтобы «циклы» находило «цикл», а «функций» — «функция». Работает
   * только для слов из кириллицы от 5 букв и не даёт основе стать короче
   * 3 букв — иначе слишком много случайных совпадений («то» из «этого»).
   */
  function stem(word) {
    if (word.length < 5 || !/^[а-я]+$/.test(word)) return word;
    for (const ending of STEM_ENDINGS) {
      if (word.endsWith(ending) && word.length - ending.length >= 3) {
        return word.slice(0, word.length - ending.length);
      }
    }
    return word;
  }

  const search = {
    index: null,
    loading: null,
    results: [],
    cursor: -1
  };

  /**
   * Индекс берём готовым из data/search-index.json (его собирает
   * tools/build_search_index.py). Если файла нет — строим на лету
   * из самих модулей, чтобы поиск работал и без сборки.
   */
  function ensureSearchIndex() {
    if (search.index) return Promise.resolve(search.index);
    if (search.loading) return search.loading;

    search.loading = fetch(state.searchIndexFile)
      .then((response) => {
        if (!response.ok) throw new Error('нет предсобранного индекса');
        return response.json();
      })
      .catch(() => loadAllModules(state.modules.filter((m) => !m.protected)).then(buildSearchIndex))
      .then((index) => {
        search.index = index.map((item) => Object.assign({}, item, {
          titleNorm: normalize(item.title + ' ' + (item.chip || '')),
          bodyNorm: normalize(item.body || '')
        }));
        return search.index;
      });

    return search.loading;
  }

  /* Убирает markdown-разметку и схлопывает пробелы — та же логика,
     что clean() в tools/build_search_index.py. Нужна только запасному
     индексу: предсобранный из data/search-index.json уже почищен. */
  function cleanText(text) {
    return String(text)
      .replace(/\[([^\]]+)\]\(#[A-Za-z0-9_-]+\)/g, '$1')
      .replace(/`/g, '').replace(/\*\*/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function buildSearchIndex() {
    const index = [];

    state.modules.forEach((meta) => {
      if (meta.protected) return;
      const data = loaded.get(meta.id);
      if (!data) return;

      (data.sections || []).forEach((section) => {
        index.push({
          mod: meta.id, anchor: section.anchor, icon: section.num,
          title: section.title, chip: section.chip || '', module: meta.label,
          body: collectSectionText(section)
        });
      });

      (data.lessons || []).forEach((lesson) => {
        if (lesson.attestation) return;
        index.push({
          mod: meta.id, anchor: lessonAnchorOf(meta.id, lesson.num), icon: lesson.num,
          title: lesson.title, chip: '', module: meta.label, body: cleanText(lesson.desc || '')
        });
      });
    });

    return index;
  }

  function collectSectionText(section) {
    const parts = [section.desc || ''];
    (section.blocks || []).forEach((block) => {
      parts.push(block.text || '', block.title || '', block.code || '');
      parts.push((block.head || []).join(' '));            // заголовки таблиц
      (block.rows || []).forEach((row) => parts.push(row.join(' ')));
      (block.items || []).forEach((item) => parts.push(item));
      if (block.good) parts.push(block.good.title || '', block.good.code || '');
      if (block.bad) parts.push(block.bad.title || '', block.bad.code || '');
      parts.push(block.hint || '', block.explain || '');    // подсказка и разбор задания
    });
    return cleanText(parts.join(' '));
  }

  /* Заголовок весит больше текста — иначе точное совпадение тонет.
     Каждое слово запроса ищем по ОСНОВЕ (после стемминга) подстрокой,
     как раньше, — так «циклы» находит «цикл». А если находится ещё
     и полное слово запроса — добавляем бонус, чтобы точное совпадение
     поднималось над совпадением только по основе. */
  function runSearch(query) {
    const normalized = normalize(query);
    if (normalized.length < CONFIG.searchMinLength) return [];

    const words = normalized.split(/\s+/).filter(Boolean);
    const stems = words.map(stem);
    const found = [];

    search.index.forEach((item) => {
      let score = 0;
      let allMatched = true;

      words.forEach((word, i) => {
        const needle = stems[i];
        const inTitle = item.titleNorm.indexOf(needle);
        const inBody = item.bodyNorm.indexOf(needle);

        if (inTitle === 0) score += 100;
        else if (inTitle > 0) score += 60;
        else if (inBody >= 0) score += 10;
        else allMatched = false;

        if (inBody >= 0) score += 2;

        // Бонус за точное слово целиком, не только за основу
        if (item.titleNorm.indexOf(word) >= 0 || item.bodyNorm.indexOf(word) >= 0) score += 20;
      });

      // firstFull — исходное (нестемленное) первое слово запроса: если оно
      // само по себе целиком нашлось в тексте, подсветка предпочтёт его
      // основе, чтобы «кавычки» подсвечивалось целиком, а не «кавычк»
      if (allMatched) found.push({ item, score, first: stems[0], firstFull: words[0] });
    });

    found.sort((a, b) => b.score - a.score);
    return found.slice(0, CONFIG.searchLimit);
  }

  function makeSnippet(item, word) {
    const position = item.bodyNorm.indexOf(word);
    const body = item.body || '';
    if (position < 0) return body.slice(0, 90).trim();

    // item.bodyNorm получен из item.body нормализацией, сохраняющей длину,
    // так что позиция совпадает 1-в-1 — срезаем сырой текст без повторного
    // схлопывания пробелов (тело уже подготовлено: build_search_index.py
    // или cleanText() для запасного индекса)
    const start = Math.max(0, position - 40);
    const chunk = body.slice(start, start + 120).trim();
    return (start > 0 ? '…' : '') + chunk + '…';
  }

  function highlight(text, word, fullWord) {
    if (!word) return esc(text);
    // Позицию ищем в normalize(text) — сыром тексте, не экранированном,
    // поэтому индексы совпадают с text и разрезание не попадёт внутрь
    // HTML-сущности вроде &amp;. Экранируем уже отдельные куски.
    const normalized = normalize(text);
    let matchWord = word, position = normalized.indexOf(word);

    // Если в тексте нашлось целиком исходное слово запроса (не основа) —
    // подсвечиваем его целиком: «кавычки» лучше «кавычк» + «и» без подсветки
    if (fullWord && fullWord !== word) {
      const fullPosition = normalized.indexOf(fullWord);
      if (fullPosition >= 0) { position = fullPosition; matchWord = fullWord; }
    }

    if (position < 0) return esc(text);
    const before = text.slice(0, position);
    const match = text.slice(position, position + matchWord.length);
    const after = text.slice(position + matchWord.length);
    return esc(before) + h('mark', null, esc(match)) + esc(after);
  }

  function renderSearchResults(results, query) {
    const box = byId('search-results');
    search.results = results;
    search.cursor = -1;
    // Новая порция результатов — активного пункта ещё нет
    byId('search-input').removeAttribute('aria-activedescendant');

    if (!query || query.length < CONFIG.searchMinLength) {
      box.classList.remove('open');
      box.innerHTML = '';
      byId('search-input').setAttribute('aria-expanded', 'false');
      return;
    }

    if (!results.length) {
      box.innerHTML = h('div', { class: 'sr-empty' }, 'Ничего не найдено по запросу «' + esc(query) + '»');
    } else {
      let html = '';
      results.forEach((result, i) => {
        const meta = getModuleMeta(result.item.mod);
        html += h('button', {
          class: 'sr-item', id: 'sr-opt-' + i, 'data-index': i, role: 'option',
          style: meta ? '--mod-color: ' + meta.color : null
        },
          h('span', { class: 'sr-icon' }, esc(result.item.icon)) +
          h('span', { class: 'sr-text' },
            h('span', { class: 'sr-title' }, highlight(result.item.title, result.first, result.firstFull)) +
            h('span', { class: 'sr-snippet' }, highlight(makeSnippet(result.item, result.first), result.first, result.firstFull))
          ) +
          h('span', { class: 'sr-module' }, esc(result.item.module))
        );
      });
      box.innerHTML = html;
    }

    box.classList.add('open');
    byId('search-input').setAttribute('aria-expanded', 'true');
  }

  function closeSearch() {
    const box = byId('search-results');
    if (box) box.classList.remove('open');
    const input = byId('search-input');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    search.results = [];
    search.cursor = -1;
  }

  function moveSearchCursor(delta) {
    if (!search.results.length) return;
    search.cursor = (search.cursor + delta + search.results.length) % search.results.length;

    const nodes = document.querySelectorAll('.sr-item');
    nodes.forEach((node, i) => node.classList.toggle('active', i === search.cursor));
    const active = nodes[search.cursor];
    if (active) active.scrollIntoView({ block: 'nearest' });

    const input = byId('search-input');
    if (input) {
      if (active) input.setAttribute('aria-activedescendant', active.id);
      else input.removeAttribute('aria-activedescendant');
    }
  }

  function openSearchResult(index) {
    const result = search.results[index];
    if (!result) return;
    const input = byId('search-input');
    if (input) input.blur();
    closeSearch();
    goToAnchor(result.item.anchor);
  }

  /* ── Экран «Программа» (шаг 3) ──────────────────────────
     Раньше выбор материала сразу разворачивал одно длинное полотно —
     все разделы гармошками, внутри вперемешку теория и практика. Теперь
     сначала «Программа»: шапка и список разделов (или занятий — для
     видеомодулей), и только клик по шагу ведёт на экран самого раздела
     (см. renderSectionScreen дальше по файлу). */
  function renderProgramScreen(data) {
    return data.lessons ? renderLessonsProgram(data) : renderSectionsProgram(data);
  }

  /* ── Видеомодули: список занятий вместо гармошки ────────
     Делить видеомодуль на теорию/практику нечем — заданий там нет.
     Занятие целиком показывается на экране раздела (renderLessonSection). */
  function lessonsMetaLine(data) {
    var totalV = 0, totalL = 0, totalS = 0;
    data.lessons.forEach(function (lesson) {
      if (lesson.attestation) return;
      totalV += (lesson.videos || []).length;
      totalL += (lesson.links || []).length;
      totalS += (lesson.screenshots || []).length;
    });
    return lessonsCount(data) + ' занятий • 🎬 ' + totalV + ' • 📄 ' + totalL + ' • 🖼️ ' + totalS;
  }

  function renderExtraBlock(data) {
    if (!data.extra) return '';
    var extraContent = data.extra.text ? esc(data.extra.text) : '';
    if (data.extra.screenshots && data.extra.screenshots.length > 0) {
      extraContent += renderSection('🖼️ Скриншоты с занятий', renderScreenshotsGrid(data.extra.screenshots));
    }
    return '<div class="extra-block">' +
      '<div class="extra-title">📚 Дополнительная информация для этого модуля</div>' +
      '<div class="extra-text">' + extraContent + '</div></div>';
  }

  /* Значки занятия (метки из данных плюс счётчики видео, материалов
     и скриншотов) — общие для списка программы и шапки занятия */
  function lessonBadges(lesson) {
    var html = '';
    (lesson.badges || []).forEach(function (b) { html += '<span class="badge-has">' + esc(b) + '</span>'; });
    return html +
      renderCountBadge('🎬', (lesson.videos || []).length) +
      renderCountBadge('📄', (lesson.links || []).length) +
      renderCountBadge('🖼️', (lesson.screenshots || []).length);
  }

  function renderLessonsProgram(data) {
    var rowsHtml = '';

    data.lessons.forEach(function (lesson) {
      if (lesson.attestation) { rowsHtml += renderAttestation(data.id); return; }

      rowsHtml += hOpen('button', modAttrs(data.id, {
        type: 'button', class: 'prog-lesson', 'data-anchor': lessonAnchorOf(data.id, lesson.num)
      })) +
        '<span class="lesson-num">' + esc(lesson.num) + '</span>' +
        '<span class="lesson-title">' + esc(lesson.title) + '</span>' +
        '<span class="lesson-badges">' + lessonBadges(lesson) + '</span>' +
        '<span class="prog-lesson-arrow">→</span>' +
      '</button>';
    });

    return renderModuleHeader(data) + h('div', { class: 'prog-list' }, rowsHtml) + renderExtraBlock(data);
  }

  /* ── Справочники и курсы: разделы с шагами теории и практики ──
     Разбор блоков на теорию/практику происходит на лету, по типу блока —
     data/*.json не меняется. heading — шаг теории, task — шаг практики,
     остальные блоки (текст, код, таблица…) — тело шага теории.

     Один проход даёт всё, что нужно карточке программы, полосе шагов,
     вкладкам и дереву в панели: шаги (каждый знает, решён ли он), число
     тем теории и «решено из всего» в границах раздела — как progressOf,
     но по одному разделу. Задание без id в счёт не идёт: отмечать негде. */
  function sectionParts(section) {
    var parts = { steps: [], theory: 0, total: 0, solved: 0 };
    (section.blocks || []).forEach(function (block, index) {
      var isTask = block.type === 'task';
      if (!isTask && block.type !== 'heading') return;
      var solved = isTask && !!block.id && hasPA && window.PA.store.isSolved(block.id);
      if (!isTask) parts.theory++;
      else if (block.id) {
        parts.total++;
        if (solved) parts.solved++;
      }
      parts.steps.push({ block: block, index: index, isTask: isTask, solved: solved });
    });
    return parts;
  }

  /* Кольцо прогресса — доля решённых заданий раздела через conic-gradient,
     формула из прототипа: --p передаёт процент прямо в CSS */
  function progressRingHtml(solved, total) {
    return h('span', { class: 'prog-ring', style: '--p: ' + percentOf(solved, total) }, '');
  }

  /* Режим проверки задания по-русски: подпись шага в программе и метка
     у самого задания. Сами режимы живут в tools/validate.py
     и sandbox_runtime.py — здесь только их названия для ученика. */
  function taskKindLabel(block) {
    if (!block.check) return 'без кода';
    return TASK_KIND_LABELS[block.check.mode] || 'проверки';
  }

  function renderProgramStep(modId, section, step) {
    var inner = step.isTask
      ? h('span', { class: 'prog-step-icon' }, step.solved ? '✅' : '📝') +
        h('span', { class: 'prog-step-title' }, esc(step.block.title || 'Задание')) +
        h('span', { class: 'prog-step-kind' }, taskKindLabel(step.block))
      : h('span', { class: 'prog-step-icon' }, '📖') +
        h('span', { class: 'prog-step-title' }, esc(step.block.text)) +
        h('span', { class: 'prog-step-kind' }, 'теория');

    return h('button', {
      class: 'prog-step-btn' + (step.solved ? ' prog-step-done' : ''), type: 'button',
      'data-mod': modId, 'data-anchor': section.anchor, 'data-tab': step.isTask ? 'practice' : 'theory'
    }, h('span', { class: 'prog-step' }, inner));
  }

  function renderProgramSectionCard(modId, section) {
    var parts = sectionParts(section);
    var chip = section.chip ? h('span', { class: 'sec-chip' }, esc(section.chip)) : '';
    var counterHtml = parts.total
      ? h('div', { class: 'prog-card-progress' },
          progressRingHtml(parts.solved, parts.total) +
          h('span', { class: 'prog-card-count' }, parts.solved + ' из ' + parts.total))
      : h('span', { class: 'prog-card-steps-count' }, parts.steps.length + ' шагов');

    var stepsHtml = '';
    parts.steps.forEach(function (step) { stepsHtml += renderProgramStep(modId, section, step); });

    return hOpen('div', modAttrs(modId, {
      class: 'lesson prog-card' + (allSolved(parts) ? ' prog-card-done' : '')
    })) +
      '<button type="button" class="lesson-header prog-card-head" aria-expanded="false">' +
        '<span class="lesson-num">' + esc(section.num) + '</span>' +
        '<span class="lesson-title">' + esc(section.title) + '</span>' +
        chip + counterHtml +
        '<span class="chevron">▾</span>' +
      '</button>' +
      '<div class="lesson-body">' + stepsHtml + '</div>' +
    '</div>';
  }

  function renderAboutCard(data) {
    var metaHtml = '';
    (data.about.meta || []).forEach(function (m) {
      metaHtml += '<div class="about-item">' +
        '<div class="about-label">' + esc(m.label) + '</div>' +
        '<div class="about-value">' + inlineFmt(m.value) + '</div></div>';
    });
    return hOpen('div', modAttrs(data.id, { class: 'course-about' })) +
      (data.about.text ? '<p class="about-text">' + inlineFmt(data.about.text) + '</p>' : '') +
      (metaHtml ? '<div class="about-grid">' + metaHtml + '</div>' : '') +
    '</div>';
  }

  function renderSectionsProgram(data) {
    var aboutHtml = data.about ? renderAboutCard(data) : '';
    var cardsHtml = '';
    (data.sections || []).forEach(function (section) { cardsHtml += renderProgramSectionCard(data.id, section); });
    return renderModuleHeader(data) + renderProgressBar(data) + aboutHtml + h('div', { class: 'prog-list' }, cardsHtml);
  }

  /* ── Модуль 5: курсы ─────────────────────────────────── */
  function renderCoursesModule(data) {
    var sectionsHtml = '';

    data.sections.forEach(function (section) {
      var bodyParts = '<p class="lesson-desc">' + esc(section.desc) + '</p>';

      (section.groups || []).forEach(function (group) {
        if (group.author) {
          bodyParts += '<div class="course-author">' + esc(group.author) + '</div>';
        }
        bodyParts += '<div class="course-list">';
        group.courses.forEach(function (c) {
          bodyParts += '<a class="course-card" href="' + esc(c.url) + '" target="_blank" rel="noopener">' +
            '<div class="course-name">' + esc(c.name) + '</div>' +
            '<div class="course-tags">' +
              renderTag(c.price) + renderTag(c.difficulty) + renderTag(c.value) +
            '</div></a>';
        });
        bodyParts += '</div>';
      });

      var badgesHtml = '';
      (section.badges || []).forEach(function (b) {
        badgesHtml += '<span class="badge-has">' + esc(b) + '</span>';
      });

      sectionsHtml += hOpen('div', modAttrs(data.id, { class: 'lesson' })) +
        '<button type="button" class="lesson-header" aria-expanded="false">' +
          '<span class="lesson-num">' + esc(section.num) + '</span>' +
          '<span class="lesson-title">' + esc(section.title) + '</span>' +
          '<span class="lesson-badges">' + badgesHtml + '</span>' +
          '<span class="chevron">▾</span>' +
        '</button>' +
        '<div class="lesson-body">' + bodyParts + '</div>' +
      '</div>';
    });

    return renderModuleHeader(data) + sectionsHtml;
  }

  /* ── Экран «Раздел» (шаг 3) ──────────────────────────────
     Один раздел (или одно занятие видеомодуля) на весь экран вместо
     аккордеона в общем полотне. У раздела с заданиями — вкладки
     «Теория»/«Практика» (блок task — практика, всё остальное — теория);
     без заданий вкладок нет вовсе, сразу показывается тело раздела. */
  function renderSectionScreen(data, anchor, tab) {
    return data.lessons ? renderLessonSection(data, anchor) : renderNotesSection(data, anchor, tab);
  }

  function renderSectionBack(modId) {
    return h('button', modAttrs(modId, { class: 'sec-back', type: 'button' }), '← Программа');
  }

  /* Строка заголовка в шапке экрана: номер, название и то, что идёт
     следом — чип у раздела, значки у занятия */
  function secTitleRow(num, title, extra) {
    return '<div class="sec-title-row">' +
      '<span class="lesson-num">' + esc(num) + '</span>' +
      '<span class="lesson-title sec-title">' + esc(title) + '</span>' +
      extra + '</div>';
  }

  /* Переходы «Предыдущий/Следующий» — общий рендер для разделов и занятий:
     items — список { anchor, title } в порядке данных, tab — вкладка,
     на которую вести (для видеомодулей не нужна — там передаём null) */
  function renderSectionNav(modId, items, idx, tab) {
    var prev = items[idx - 1], next = items[idx + 1];
    if (!prev && !next) return '';

    function navBtn(item, dir, label) {
      if (!item) return '<span class="sec-nav-empty"></span>';
      return hOpen('button', modAttrs(modId, {
        class: 'sec-nav-btn sec-nav-' + dir, type: 'button',
        'data-anchor': item.anchor, 'data-tab': tab || ''
      })) +
        '<span class="sec-nav-dir">' + label + '</span>' +
        '<span class="sec-nav-title">' + esc(item.title) + '</span>' +
      '</button>';
    }

    return h('div', { class: 'sec-nav' },
      navBtn(prev, 'prev', '← Предыдущий раздел') + navBtn(next, 'next', 'Следующий раздел →')
    );
  }

  /* Полоса шагов раздела: квадратик на каждый шаг (heading/task, см.
     sectionParts). Клик ведёт на нужную вкладку и прокручивает к шагу —
     к самому блоку задания (id="ref-<id>", см. renderTaskBlock) или
     к месту темы теории (id="pa-step-<index>", см. renderTabBody). */
  function renderStepStrip(section) {
    var parts = sectionParts(section);
    if (!parts.steps.length) return '';

    var squares = '';
    parts.steps.forEach(function (step) {
      squares += h('button', {
        class: 'step-sq' + (step.isTask ? (step.solved ? ' step-done' : ' step-task') : ''),
        type: 'button', title: esc(step.block.title || step.block.text || ''),
        'data-tab': step.isTask ? 'practice' : 'theory',
        'data-target': step.isTask ? (step.block.id || '') : ('pa-step-' + step.index)
      }, step.solved ? '✓' : '');
    });

    return h('div', { class: 'step-strip-row' },
      h('div', { class: 'step-strip' }, squares) +
      (parts.total ? h('span', { class: 'step-strip-count' }, 'решено ' + parts.solved + ' из ' + parts.total) : '')
    );
  }

  function renderSectionTabs(section, activeTab) {
    var parts = sectionParts(section);

    function tabBtn(tab, label) {
      var active = activeTab === tab;
      return h('button', {
        class: 'sec-tab' + (active ? ' active' : ''), type: 'button', role: 'tab',
        'data-tab': tab, 'aria-selected': active ? 'true' : 'false'
      }, label);
    }

    return h('div', { class: 'sec-tabs', role: 'tablist' },
      tabBtn('theory', 'Теория' + (parts.theory ? ' (' + parts.theory + ')' : '')) +
      tabBtn('practice', 'Практика (' + parts.total + ')')
    );
  }

  /* Тело вкладки: практика — блоки task, теория — все остальные. Рисует
     их тот же renderNoteBlock, что и раньше (у task внутри он зовёт
     renderTaskBlock — ту же песочницу с автопроверкой). Индекс блока —
     из исходного (не отфильтрованного) массива: так ключи черновиков
     (blockKeyOf) остаются теми же, что были на едином полотне */
  function renderTabBody(section, tab) {
    var practice = tab === 'practice';
    var html = '';
    (section.blocks || []).forEach(function (block, index) {
      if ((block.type === 'task') !== practice) return;
      if (block.type === 'heading') {
        html += '<div id="pa-step-' + index + '" class="section-divider"></div>' +
          '<div class="section-label">' + esc(block.text) + '</div>';
      } else {
        html += renderNoteBlock(block, { anchor: section.anchor }, index);
      }
    });
    return h('div', { class: 'sec-body' }, html);
  }

  function renderNotesSection(data, anchor, tab) {
    var sections = data.sections || [];
    var idx = sections.findIndex(function (s) { return s.anchor === anchor; });
    if (idx === -1) return h('div', { class: 'empty-state' }, 'Раздел не найден.');
    var section = sections[idx];
    var hasTasks = sectionParts(section).total > 0;
    var activeTab = hasTasks && tab === 'practice' ? 'practice' : 'theory';

    var chip = section.chip ? h('span', { class: 'sec-chip' }, esc(section.chip)) : '';

    var headHtml = hOpen('div', modAttrs(data.id, { class: 'sec-head ref-section', id: 'ref-' + section.anchor })) +
      renderStepStrip(section) +
      secTitleRow(section.num, section.title, chip) +
      (section.desc ? '<p class="lesson-desc">' + inlineFmt(section.desc) + '</p>' : '') +
    '</div>';

    var tabsHtml = hasTasks ? renderSectionTabs(section, activeTab) : '';
    var bodyHtml = renderTabBody(section, activeTab);
    var navHtml = renderSectionNav(data.id,
      sections.map(function (s) { return { anchor: s.anchor, title: s.title }; }), idx, 'theory');

    return renderModuleHeader(data) + renderSectionBack(data.id) + headHtml + tabsHtml + bodyHtml + navHtml;
  }

  /* Занятие видеомодуля целиком — как раньше внутри аккордеона, но
     на отдельном экране: без заданий и вкладок делить там нечего */
  function renderLessonSection(data, anchor) {
    var lessons = (data.lessons || []).filter(function (l) { return !l.attestation; });
    var idx = lessons.findIndex(function (l) { return lessonAnchorOf(data.id, l.num) === anchor; });
    if (idx === -1) return h('div', { class: 'empty-state' }, 'Занятие не найдено.');
    var lesson = lessons[idx];

    var nV = (lesson.videos || []).length, nL = (lesson.links || []).length, nS = (lesson.screenshots || []).length;
    var bodyParts = '<p class="lesson-desc">' + esc(lesson.desc) + '</p>';
    if (nV + nL + nS === 0) {
      bodyParts += '<div class="empty-state">🔒 Материалы для этого занятия ещё не добавлены.</div>';
    } else {
      if (nV > 0) bodyParts += renderSection('🎬 Видео', renderVideoGrid(lesson.videos));
      if (nL > 0) bodyParts += renderSection('📄 Материалы', renderLinkList(lesson.links));
      if (nS > 0) bodyParts += renderSection('🖼️ Скриншоты с занятия', renderScreenshotsGrid(lesson.screenshots));
    }

    var headHtml = hOpen('div', modAttrs(data.id, { class: 'sec-head', id: 'ref-' + anchor })) +
      secTitleRow(lesson.num, lesson.title, h('span', { class: 'lesson-badges' }, lessonBadges(lesson))) +
      bodyParts +
    '</div>';

    var navHtml = renderSectionNav(data.id,
      lessons.map(function (l) { return { anchor: lessonAnchorOf(data.id, l.num), title: l.title }; }), idx, null);

    return renderModuleHeader(data) + renderSectionBack(data.id) + headHtml + navHtml;
  }

  /* Раздел считается пройденным, когда решены все его задания (см.
     sectionParts): галочка в дереве панели и карточка программы
     спрашивают об этом одинаково */
  function allSolved(parts) {
    return parts.total > 0 && parts.solved === parts.total;
  }

  function renderNoteBlock(block, ctx, index) {
    switch (block.type) {
      case 'text':
        return '<p class="note-text">' + inlineFmt(block.text) + '</p>';
      case 'heading':
        return '<div class="section-divider"></div><div class="section-label">' + esc(block.text) + '</div>';
      case 'code':
        return renderCodeBlock(block.title, block.code, block.lang, {
          run: block.run === true,
          stdin: block.stdin,
          key: blockKeyOf(ctx, index, block)
        });
      case 'table':
        return renderNoteTable(block);
      case 'compare':
        return '<div class="compare-grid">' +
          renderCompareCard('good', block.good) +
          renderCompareCard('bad', block.bad) +
        '</div>';
      case 'good':
        return renderCompareCard('good', block);
      case 'bad':
        return renderCompareCard('bad', block);
      case 'task':
        return renderTaskBlock(block, ctx, index);
      case 'checklist':
        var items = '';
        (block.items || []).forEach(function (it) {
          items += '<li>' + inlineFmt(it) + '</li>';
        });
        return '<div class="checklist">' +
          (block.title ? '<div class="checklist-title">' + esc(block.title) + '</div>' : '') +
          '<ul>' + items + '</ul></div>';
      case 'note':
        return '<div class="callout callout-note">💡 <span>' + inlineFmt(block.text) + '</span></div>';
      case 'warn':
        return '<div class="callout callout-warn">⚠️ <span>' + inlineFmt(block.text) + '</span></div>';
      default:
        return '';
    }
  }

  /* Практическое задание: условие, песочница с автопроверкой,
     подсказка и разбор под спойлером */
  function renderTaskBlock(block, ctx, index) {
    var key = blockKeyOf(ctx, index, block);
    var solved = hasPA && block.id && window.PA.store.isSolved(block.id);

    // Задание без check делается в голове или на бумаге — проверить его
    // нечем, поэтому ученик отмечает его сам, а не остаётся без отметки
    var manual = !block.check && !!block.id;

    // id="ref-<id задания>" — новый, отдельный от якорей раздела: по нему
    // «Продолжить» (см. progressOf/renderProgressBar) и goToAnchor находят
    // именно это задание и открывают вкладку практики (см. resolveAnchorTarget)
    var html = '<div class="task' + (solved ? ' task-solved' : '') + '"' +
        (block.id ? ' id="ref-' + esc(block.id) + '" data-task-id="' + esc(block.id) + '"' : '') + '>' +
      '<div class="task-head"><span class="task-badge">Задание</span>' +
      (manual ? '<span class="task-kind">' + taskKindLabel(block) + '</span>' : '') +
      (block.title ? '<span class="task-title">' + esc(block.title) + '</span>' : '') +
      '<span class="task-state">' + (solved ? '✅ решено' : '') + '</span></div>' +
      '<div class="task-text">' + inlineFmt(block.text) + '</div>';

    if (block.example) {
      html += renderCodeBlock('Пример работы', block.example);
    }

    // Задание с автопроверкой получает редактор, без неё — прежний вид
    if (block.check && canRun()) {
      var draft = draftOf(key);
      var starter = block.starter || '';
      var current = draft && draft.code !== undefined ? draft.code : starter;
      // Поле «Ввод» только там, где оно нужно: программа зовёт input()
      // или у проверки есть ввод. Иначе ученик принимает его за поле ответа.
      // Заполняем первым открытым кейсом — «Запустить» работает сразу
      var sampleStdin = block.check.stdin || firstStdinOf(block.check);
      html += renderSandbox({
        key: key,
        start: starter,
        code: current,
        stdin: draft && draft.stdin ? draft.stdin : sampleStdin,
        stdinStart: sampleStdin,
        showStdin: usesInput(current) || !!sampleStdin,
        check: block.check,
        taskId: block.id || null
      });
    }

    if (manual && hasPA) {
      html += '<button class="task-done" type="button" aria-pressed="' +
        (solved ? 'true' : 'false') + '">' +
        (solved ? '✓ Выполнено' : 'Отметить выполненным') + '</button>';
    }

    if (block.hint) {
      html += '<div class="callout callout-note">💡 <span>' + inlineFmt(block.hint) + '</span></div>';
    }
    if (block.solution) {
      html += '<div class="solution">' +
        '<button class="solution-toggle" type="button" aria-expanded="false">Показать разбор</button>' +
        '<div class="solution-body">' + renderCodeBlock(null, block.solution) +
        (block.explain ? '<p class="note-text">' + inlineFmt(block.explain) + '</p>' : '') +
        '</div></div>';
    }
    return html + '</div>';
  }

  /**
   * Блок кода. opts.run === true добавляет песочницу.
   * Оригинал кода кладём в data-code: копировать нужно исходник,
   * а не textContent подсвеченного <pre> — иначе на длинных
   * примерах ловим расхождение по пробелам.
   */
  function renderCodeBlock(title, code, lang, opts) {
    opts = opts || {};
    var isPython = !lang || lang === 'python';
    var body = isPython ? highlightPy(code) : esc(code);
    var copyBtn = '<button class="code-copy" type="button" ' +
      'aria-label="Копировать код">Копировать</button>';

    // Терминальным командам кнопка запуска не нужна — исполнять нечем
    var runnable = !!opts.run && isPython && canRun();

    var head = title || runnable
      ? '<div class="code-title"><span class="code-title-text">' +
          esc(title || 'Пример: можно менять и запускать') + '</span>' + copyBtn + '</div>'
      : '<div class="code-actions">' + copyBtn + '</div>';

    var open = hOpen('div', {
      class: 'code-block' + (lang ? ' lang-' + lang : '') +
        (title || runnable ? '' : ' no-title') + (runnable ? ' runnable' : ''),
      'data-code': code
    });

    if (!runnable) return open + head + '<pre><code>' + body + '</code></pre></div>';

    // Исполняемый пример — сразу редактор вместо <pre>, без второй копии
    // кода под ним; «Сбросить» возвращает исходник из data-start
    var draft = draftOf(opts.key);
    var current = draft && draft.code !== undefined ? draft.code : code;
    return open + head + renderSandbox({
      key: opts.key,
      start: code,
      code: current,
      stdin: draft && draft.stdin ? draft.stdin : (opts.stdin || ''),
      stdinStart: opts.stdin || '',
      showStdin: usesInput(current) || !!opts.stdin,
      check: null,
      taskId: null,
      standalone: true
    }) + '</div>';
  }

  function usesInput(code) {
    return /\binput\s*\(/.test(code || '');
  }

  /* Ввод первого открытого кейса — с ним «Запустить» у задания
     с input() работает сразу, без набора данных вручную */
  function firstStdinOf(check) {
    var cases = (check && check.cases) || [];
    for (var i = 0; i < cases.length; i++) {
      if (!cases[i].hidden && cases[i].stdin) return cases[i].stdin;
    }
    return '';
  }

  function canRun() {
    return hasPA && window.PA.sandbox.available();
  }

  /* ── Песочница ───────────────────────────────────────── */

  var SANDBOX_HINT = 'Python выполняется прямо в браузере (Pyodide). ' +
    'Нет доступа в интернет — requests и подобные библиотеки не сработают. ' +
    'Файлы создаются в виртуальной файловой системе и живут только до перезагрузки страницы. ' +
    'pip install работает только для пакетов, собранных под Pyodide.';

  function renderSandbox(opts) {
    var editorHtml =
      '<div class="pa-editor">' +
        '<div class="ed-gutter"><span>1</span></div>' +
        '<div class="ed-area">' +
          '<pre class="ed-view" aria-hidden="true"><code>' + highlightPy(opts.code) + '</code></pre>' +
          '<textarea class="ed-input" spellcheck="false" autocapitalize="off" ' +
            'autocomplete="off" wrap="off" aria-label="Код программы">' +
            esc(opts.code) + '</textarea>' +
        '</div>' +
      '</div>';

    var stdinHtml =
      '<div class="sb-stdin' + (opts.showStdin ? '' : ' hidden') + '">' +
        '<label class="sb-label">Ввод <span>— по строке на каждый <code class="ic">input()</code></span></label>' +
        '<textarea class="sb-stdin-input" spellcheck="false" rows="2" ' +
          'aria-label="Данные для ввода">' + esc(opts.stdin || '') + '</textarea>' +
      '</div>';

    // Кнопки «Нужен ввод» больше нет: поле «Ввод» и так раскрывается само —
    // либо сразу (input() в коде или ввод в кейсах), либо при первом же
    // input() по ходу выполнения (см. askInput/revealStdin)
    var buttons =
      '<button class="sb-btn sb-run" type="button">▶ Запустить</button>' +
      (opts.check ? '<button class="sb-btn sb-check" type="button">Проверить</button>' : '') +
      '<button class="sb-btn sb-ghost sb-reset" type="button">Сбросить</button>';

    return hOpen('div', {
      class: 'sandbox' + (opts.standalone ? ' sandbox-standalone' : ''),
      'data-block-key': opts.key || null,
      'data-start': opts.start || '',
      'data-stdin': opts.stdinStart || '',
      'data-task-id': opts.taskId || null,
      'data-check': opts.check ? JSON.stringify(opts.check) : null
    }) +
      editorHtml +
      stdinHtml +
      '<div class="sb-bar">' + buttons +
        '<span class="sb-status" role="status"></span>' +
        '<span class="sb-hint" title="' + esc(SANDBOX_HINT) + '">?</span>' +
      '</div>' +
      '<div class="sb-output hidden"><div class="sb-out-label">Вывод</div><pre class="sb-out-body"></pre></div>' +
      '<div class="sb-report hidden"></div>' +
    '</div>';
  }

  function renderCompareCard(kind, item) {
    if (!item) return '';
    var icon = kind === 'good' ? '✅' : '❌';
    var inner = '';
    if (item.text) inner += '<div class="compare-text">' + inlineFmt(item.text) + '</div>';
    if (item.code) inner += '<pre><code>' + highlightPy(item.code) + '</code></pre>';
    return '<div class="compare-card compare-' + kind + '">' +
      '<div class="compare-title">' + icon + ' ' + esc(item.title || (kind === 'good' ? 'Можно' : 'Нельзя')) + '</div>' +
      inner + '</div>';
  }

  function renderNoteTable(block) {
    var html = '<div class="note-table-wrap"><table class="note-table">';
    if (block.head) {
      html += '<thead><tr>';
      block.head.forEach(function (h) { html += '<th>' + inlineFmt(h) + '</th>'; });
      html += '</tr></thead>';
    }
    html += '<tbody>';
    (block.rows || []).forEach(function (row) {
      html += '<tr>';
      row.forEach(function (cell) { html += '<td>' + inlineFmt(cell) + '</td>'; });
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }

  /* Мини-разметка: `код` и **жирный** внутри текста */
  function inlineFmt(str) {
    return esc(str)
      .replace(/`([^`]+)`/g, '<code class="ic">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // [текст](#якорь) — переход к разделу справочника
      .replace(/\[([^\]]+)\]\(#([A-Za-z0-9_-]+)\)/g,
               '<a class="ref-link" href="#$2" data-anchor="$2">$1</a>');
  }

  /* ── Простая подсветка Python ────────────────────────── */
  var PY_KEYWORDS = ['False','None','True','and','as','assert','async','await','break','case','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','match','nonlocal','not','or','pass','raise','return','try','while','with','yield'];
  var PY_BUILTINS = ['print','input','len','type','int','float','str','bool','list','tuple','dict','set','frozenset','range','enumerate','zip','sorted','reversed','sum','min','max','abs','round','isinstance','id','repr'];

  function highlightPy(code) {
    var re = /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?""")|([bruf]{0,2}'(?:\\.|[^'\\\n])*'|[bruf]{0,2}"(?:\\.|[^"\\\n])*")|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([\s\S])/g;
    var out = '';
    var m;
    while ((m = re.exec(code)) !== null) {
      if (m[1]) out += '<span class="tok-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tok-str">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tok-str">' + esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="tok-num">' + esc(m[4]) + '</span>';
      else if (m[5]) {
        if (PY_KEYWORDS.indexOf(m[5]) !== -1) out += '<span class="tok-kw">' + esc(m[5]) + '</span>';
        else if (PY_BUILTINS.indexOf(m[5]) !== -1) out += '<span class="tok-fn">' + esc(m[5]) + '</span>';
        else out += esc(m[5]);
      }
      else out += esc(m[6]);
    }
    return out;
  }

  /* ── Компоненты-рендеры ──────────────────────────────── */

  /* Шапка материала — одна и та же на экране программы и на экране
     раздела. Подпись под названием: у видеомодуля строка со счётчиками
     занятий, у остальных — подзаголовок из данных */
  function renderModuleHeader(data) {
    var meta = data.lessons ? lessonsMetaLine(data) : (data.subtitle || '');
    return hOpen('div', modAttrs(data.id, { class: 'module-header' })) +
      '<span class="icon">' + esc(data.icon) + '</span>' +
      '<div><div class="title">' + esc(data.title) + '</div>' +
      '<div class="meta">' + esc(meta) + '</div></div></div>';
  }

  function renderCountBadge(emoji, count) {
    var cls = count > 0 ? 'badge-has' : 'badge-zero';
    return '<span class="' + cls + '">' + emoji + ' ' + count + '</span>';
  }

  function renderSection(label, content) {
    return '<div class="section-divider"></div>' +
      '<div class="section-label">' + label + '</div>' + content;
  }

  function renderVideoGrid(videos) {
    var html = '<div class="video-grid">';
    videos.forEach(function (v) {
      // Фасад вместо iframe: сам плеер (и запрос к YouTube) появляется
      // только по клику — иначе все ролики, включая те, что лежат
      // в свёрнутых уроках, начинают грузиться уже при открытии страницы
      html += '<div class="video-card">' +
        '<button type="button" class="video-facade" data-video-id="' + esc(v.id) + '" ' +
          'data-video-title="' + esc(v.title) + '" aria-label="Смотреть: ' + esc(v.title) + '">' +
          '<img class="video-thumb" src="https://i.ytimg.com/vi/' + esc(v.id) + '/hqdefault.jpg" ' +
            'alt="" loading="lazy">' +
          '<span class="video-play" aria-hidden="true">▶</span>' +
        '</button>' +
        '<div class="v-title">' + esc(v.title) + '</div></div>';
    });
    return html + '</div>';
  }

  function renderLinkList(links) {
    var html = '<div class="link-list">';
    links.forEach(function (l) {
      html += '<a class="link-item" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        '📄 ' + esc(l.title) + '<span class="arrow">↗</span></a>';
    });
    return html + '</div>';
  }

  function renderScreenshotsGrid(screenshots) {
    var html = '<div class="screenshots-grid">';
    screenshots.forEach(function (s) {
      html += '<button type="button" class="screenshot-card">' +
        '<img src="' + esc(s.src) + '" alt="' + esc(s.caption) + '" loading="lazy">' +
        '<div class="s-caption">' + esc(s.caption) + '</div></button>';
    });
    return html + '</div>';
  }

  function renderTag(key) {
    var info = TAG_LABELS[key] || [key, 'tag-unknown'];
    return '<span class="tag ' + info[1] + '">' + esc(info[0]) + '</span>';
  }

  function renderAttestation(modId) {
    return hOpen('div', modAttrs(modId, { class: 'lesson attestation' })) +
      '<button type="button" class="lesson-header" aria-expanded="false">' +
        '<span class="lesson-num">📝</span>' +
        '<span class="lesson-title">Промежуточная аттестация</span>' +
        '<span class="lesson-badges"><span class="badge-attest">⚠️ ГОТОВИМСЯ ⚠️</span></span>' +
        '<span class="chevron">▾</span>' +
      '</button>' +
      '<div class="lesson-body">' +
        '<p class="lesson-desc attest-desc">' +
          '⚠️ Повторите пройденный материал и закройте все долги для сдачи теста! ⚠️<br>' +
          'Информацию по долгам можно уточнить ТОЛЬКО у технической поддержки.' +
        '</p>' +
      '</div></div>';
  }

  /* ── Делегирование событий ───────────────────────────── */

  /* Аккордеон (этап 5): .lesson-header теперь кнопка, поэтому открытие
     раскрывающегося блока держим в одном месте — и класс, и aria-expanded
     синхронно, откуда бы ни пришло открытие (клик или переход по якорю) */
  function setLessonOpen(lessonEl, open) {
    if (!lessonEl) return;
    lessonEl.classList.toggle('open', open);
    const header = lessonEl.querySelector('.lesson-header');
    if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ── Поведение песочницы ─────────────────────────────── */

  function sbStatus(sb, text, kind) {
    var el = sb.querySelector('.sb-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sb-status' + (kind ? ' sb-' + kind : '');
  }

  function sbOutput(sb, text, append) {
    var box = sb.querySelector('.sb-output');
    var body = sb.querySelector('.sb-out-body');
    if (!box || !body) return;
    if (append) body.textContent += text;
    else body.textContent = text;
    body.classList.remove('sb-out-empty');
    box.classList.toggle('hidden', body.textContent === '');
  }

  /* Три пустых print() — это три невидимые строки: без пометки ученик
     решит, что запуск не сработал */
  function sbOutputEmpty(sb) {
    var box = sb.querySelector('.sb-output');
    var body = sb.querySelector('.sb-out-body');
    if (!box || !body) return;
    if (body.textContent.trim() !== '') return;
    body.textContent = '(программа завершилась без видимого вывода)';
    body.classList.add('sb-out-empty');
    box.classList.remove('hidden');
  }

  /* ── input() по ходу выполнения ──────────────────────────
     Синхронного ввода в воркере нет: нужны SharedArrayBuffer и заголовки
     COOP/COEP, которых на GitHub Pages не выставить. Поэтому, когда
     программа просит input(), а строки в поле «Ввод» кончились, показываем
     строку ввода под выводом, дописываем ответ к «Вводу» и запускаем
     программу заново: детерминированный код доходит до того же места
     и идёт дальше — для ученика это выглядит как диалог в консоли. */

  function askInput(sb) {
    var box = sb.querySelector('.sb-output');
    if (!box) return;
    removePrompt(sb);
    box.classList.remove('hidden');
    var form = document.createElement('form');
    form.className = 'sb-prompt';
    form.innerHTML = '<span class="sb-prompt-mark">›</span>' +
      '<input class="sb-prompt-input" type="text" autocomplete="off" spellcheck="false" ' +
        'aria-label="Ввод для input()" ' +
        'placeholder="Программа ждёт ввода — введите строку и нажмите Enter">';
    box.appendChild(form);
    sbStatus(sb, 'Программа ждёт ввода', 'wait');
    form.querySelector('.sb-prompt-input').focus();
  }

  function removePrompt(sb) {
    var prompt = sb.querySelector('.sb-prompt');
    if (prompt) prompt.remove();
  }

  /* Строки ввода разделяем переводом строки, и последняя тоже с ним —
     иначе пустой ответ на input() слился бы с концом ввода */
  function appendStdinLine(sb, line) {
    var stdinEl = sb.querySelector('.sb-stdin-input');
    if (!stdinEl) return;
    var text = stdinEl.value;
    if (text && text.slice(-1) !== '\n') text += '\n';
    stdinEl.value = text + line + '\n';
    revealStdin(sb);
    saveDraft(sb.getAttribute('data-block-key'), { stdin: stdinEl.value });
  }

  function revealStdin(sb) {
    var field = sb.querySelector('.sb-stdin');
    if (field) field.classList.remove('hidden');
  }

  function sbBusy(sb, busy) {
    sb.querySelectorAll('.sb-btn').forEach(function (b) { b.disabled = busy; });
    sb.classList.toggle('running', busy);
  }

  /* Человеческие формулировки вместо трейсбека */
  function describeError(err) {
    if (!err) return 'Что-то пошло не так.';
    if (err.kind === 'PA_NO_INPUT') {
      return 'Программа ждёт ввода, но поле «Ввод» пустое (или строк не хватило).';
    }
    if (err.kind === 'PA_NO_ENTRY') {
      return 'Не нашли функцию «' + err.message + '». Проверьте имя — оно должно совпадать буква в букву.';
    }
    var where = err.line ? ' (строка ' + err.line + ')' : '';
    if (err.kind === 'SyntaxError' || err.kind === 'IndentationError' || err.kind === 'TabError') {
      return 'Python не смог разобрать код' + where + ': ' + err.message;
    }
    return err.kind + where + ': ' + err.message;
  }

  function runSandbox(sb, mode) {
    if (!canRun()) return;
    var editor = sb.querySelector('.pa-editor');
    var stdinEl = sb.querySelector('.sb-stdin-input');
    var code = window.PA.editor.value(editor);
    var stdin = stdinEl ? stdinEl.value : '';
    var check = mode === 'check' ? JSON.parse(sb.getAttribute('data-check') || 'null') : null;

    if (window.PA.sandbox.busy()) {
      sbStatus(sb, 'Другой запуск ещё не закончился', 'warn');
      return;
    }

    sbBusy(sb, true);
    sbOutput(sb, '');
    removePrompt(sb);
    var report = sb.querySelector('.sb-report');
    if (report) { report.classList.add('hidden'); report.innerHTML = ''; }
    sbStatus(sb, window.PA.sandbox.booted
      ? 'Выполняем…'
      : 'Готовим Python, ~10 МБ, только в первый раз…', 'wait');

    window.PA.sandbox.send({
      code: code,
      stdin: stdin,
      check: check,
      onReady: function () { sbStatus(sb, 'Выполняем…', 'wait'); },
      onOut: function (stream, text) { sbOutput(sb, text, true); }
    }).then(function (result) {
      sbBusy(sb, false);

      if (result.timeout === 'boot') {
        sbStatus(sb, 'Не удалось загрузить Python. Проверьте соединение и попробуйте ещё раз.', 'bad');
        return;
      }
      if (result.timeout === 'run') {
        sbStatus(sb, 'Программа выполнялась слишком долго. Возможно, цикл не заканчивается.', 'bad');
        return;
      }
      if (result.fatal) { sbStatus(sb, result.fatal, 'bad'); return; }

      if (mode === 'check') { showReport(sb, result.report); return; }

      if (result.ok) {
        sbOutputEmpty(sb);
        sbStatus(sb, 'Готово', 'good');
      } else if (result.error && result.error.kind === 'PA_NO_INPUT') {
        askInput(sb);
      } else {
        sbStatus(sb, describeError(result.error), 'bad');
      }
    });
  }

  /* Результат проверки: открытые кейсы показываем целиком,
     у скрытых — только пояснение, чтобы не выдать ответ */
  function showReport(sb, report) {
    var box = sb.querySelector('.sb-report');
    if (!box || !report) return;

    if (report.output) sbOutput(sb, report.output);

    if (report.fatal) {
      box.className = 'sb-report bad';
      box.innerHTML = '<div class="rp-line rp-fail">' + esc(describeError(report.fatal)) + '</div>';
      sbStatus(sb, 'Проверка не запустилась', 'bad');
      markTask(sb, false);
      return;
    }

    var results = report.results || [];
    var failed = results.filter(function (r) { return !r.ok; }).length;
    var rows = '';

    results.forEach(function (item) {
      var kase = item.case || {};
      var hidden = kase.hidden === true;
      var label;

      if (hidden) {
        label = 'скрытый тест' + (kase.note ? ': ' + kase.note : '');
      } else if (item.label) {
        label = item.label + (kase.expect !== undefined && item.ok ? ' → ' + item.got : '');
      } else if (kase.stdin !== undefined && kase.stdin !== '') {
        label = 'ввод: ' + String(kase.stdin).replace(/\n/g, ' ⏎ ');
      } else {
        label = kase.note || 'запуск без ввода';
      }

      rows += '<div class="rp-line ' + (item.ok ? 'rp-ok' : 'rp-fail') + '">' +
        (item.ok ? '✅ ' : '❌ ') + esc(label) + '</div>';

      if (!item.ok) {
        var detail = '';
        if (item.error) {
          detail = describeError(item.error);
        } else if (kase.expect !== undefined) {
          detail = 'ожидалось ' + shortValue(kase.expect) + ', получено ' + shortValue(item.got);
        } else if (item.got) {
          detail = item.got;
        }
        if (detail) rows += '<div class="rp-detail">' + esc(detail) + '</div>';
      }
    });

    box.className = 'sb-report ' + (failed ? 'bad' : 'good');
    box.innerHTML = rows;
    box.classList.remove('hidden');

    // Формулировка при провале не приговор, а счёт по ходу дела
    sbStatus(sb, failed
      ? 'Пока не проходит ' + failed + ' из ' + results.length
      : 'Все проверки пройдены', failed ? 'bad' : 'good');

    markTask(sb, failed === 0 && results.length > 0);
  }

  function shortValue(value) {
    var text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === undefined) text = String(value);
    text = text.replace(/\n/g, '⏎');
    return text.length > 120 ? text.slice(0, 117) + '…' : text;
  }

  /* Отметку у задания без кода ставит и снимает сам ученик: случайное
     нажатие не должно остаться навсегда, поэтому снятие тоже разрешено */
  function toggleManualTask(button) {
    var task = button.closest('.task');
    var taskId = task && task.getAttribute('data-task-id');
    if (!taskId || !hasPA) return;

    if (window.PA.store.isSolved(taskId)) window.PA.store.set('tasks', taskId, null);
    else window.PA.store.markTask(taskId, 'solved');

    var solved = window.PA.store.isSolved(taskId);
    task.classList.toggle('task-solved', solved);
    var state = task.querySelector('.task-state');
    if (state) state.textContent = solved ? '✅ решено' : '';
    button.textContent = solved ? '✓ Выполнено' : 'Отметить выполненным';
    button.setAttribute('aria-pressed', solved ? 'true' : 'false');
    refreshProgress();
  }

  /* ── Прогресс ученика (этап 4) ───────────────────────── */

  function markTask(sb, solved) {
    var taskId = sb.getAttribute('data-task-id');
    if (!taskId || !hasPA) return;
    window.PA.store.markTask(taskId, solved ? 'solved' : 'tried');

    var task = sb.closest('.task');
    if (task) {
      task.classList.toggle('task-solved', window.PA.store.isSolved(taskId));
      var state = task.querySelector('.task-state');
      if (state) state.textContent = window.PA.store.isSolved(taskId) ? '✅ решено' : '';
    }
    refreshProgress();
  }

  /* Сколько заданий с автопроверкой в модуле и сколько решено */
  function progressOf(data) {
    var total = 0, solved = 0, first = null;
    (data.sections || []).forEach(function (section) {
      (section.blocks || []).forEach(function (block) {
        // Задание без автопроверки («на бумаге») тоже считается: ученик
        // отмечает его сам, иначе четыре задания курса просто не существуют
        if (block.type !== 'task' || !block.id) return;
        total++;
        if (hasPA && window.PA.store.isSolved(block.id)) solved++;
        // Якорь задания (id="ref-<id>", см. renderTaskBlock) — «Продолжить»
        // ведёт goToAnchor прямо на него, а тот сам откроет вкладку практики
        else if (!first) first = { anchor: section.anchor, id: block.id };
      });
    });
    return { total: total, solved: solved, first: first };
  }

  function renderProgressBar(data) {
    var p = progressOf(data);
    if (!p.total) return '';
    return hOpen('div', modAttrs(data.id, { class: 'progress-bar' })) +
      '<div class="pb-track"><div class="pb-fill" style="width:' + percentOf(p.solved, p.total) + '%"></div></div>' +
      '<div class="pb-text">Решено ' + p.solved + ' из ' + p.total + '</div>' +
      (p.first
        ? '<button class="pb-continue" type="button" data-anchor="' + esc(p.first.id) + '">Продолжить</button>'
        : '<span class="pb-done">Все задания модуля решены</span>') +
      '<button class="pb-io" type="button" data-io="export" title="Скачать прогресс файлом">⭳</button>' +
      '<button class="pb-io" type="button" data-io="import" title="Загрузить прогресс из файла">⭱</button>' +
    '</div>';
  }

  /* Перерисовать только индикаторы, не трогая введённый код и живую
     песочницу — важно после автопроверки/отметки, чтобы работа ученика
     не пропала. Программа и раздел обновляют каждый свою часть, если
     она сейчас на экране; лишнее просто не находится и пропускается. */
  /* Заменить элемент свежей разметкой, если он сейчас на экране */
  function replaceNode(selector, html) {
    var node = document.querySelector(selector);
    if (!node) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    if (wrap.firstChild) node.replaceWith(wrap.firstChild);
  }

  function refreshProgress() {
    var data = loaded.get(state.activeModule);
    if (!data) return;

    replaceNode('.progress-bar', renderProgressBar(data));

    if (state.view === 'section' && data.sections) {
      var section = data.sections.find(function (s) { return s.anchor === state.section; });
      if (section) {
        replaceNode('.step-strip-row', renderStepStrip(section));
        replaceNode('.sec-tabs', renderSectionTabs(section, state.tab));
      }
    }

    renderRail();   // галочка у раздела в дереве панели — тоже часть прогресса
  }

  function exportProgress() {
    var blob = new Blob([window.PA.store.export()], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'python-academy-progress.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function importProgress() {
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'application/json,.json';
    picker.addEventListener('change', function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          window.PA.store.import(text);
          loadModule(state.activeModule);
        } catch (e) {
          alert('Не удалось прочитать файл прогресса: ' + e.message);
        }
      });
    });
    picker.click();
  }

  /* ── Копирование кода ────────────────────────────────── */

  function copyCode(button) {
    var block = button.closest('.code-block');
    if (!block) return;
    // У исполняемого примера копируем то, что сейчас в редакторе
    var editor = block.querySelector('.ed-input');
    var source = editor ? editor.value : block.getAttribute('data-code');
    if (source === null) return;

    var done = function () {
      var was = button.textContent;
      button.textContent = 'Скопировано';
      button.classList.add('copied');
      setTimeout(function () {
        button.textContent = was;
        button.classList.remove('copied');
      }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(source).then(done, function () { fallbackCopy(source, done); });
    } else {
      fallbackCopy(source, done);
    }
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* нечем — молчим */ }
    area.remove();
  }

  function resetSandbox(sb) {
    var editor = sb.querySelector('.pa-editor');
    window.PA.editor.setValue(editor, sb.getAttribute('data-start') || '');
    var stdinEl = sb.querySelector('.sb-stdin-input');
    if (stdinEl) stdinEl.value = sb.getAttribute('data-stdin') || '';
    var key = sb.getAttribute('data-block-key');
    if (key) window.PA.store.set('drafts', key, null);
    sbStatus(sb, '');
    sbOutput(sb, '');
    removePrompt(sb);
    var report = sb.querySelector('.sb-report');
    if (report) { report.classList.add('hidden'); report.innerHTML = ''; }
  }

  /* ── События: таблица маршрутов вместо цепочки if ─────
     Добавить интерактивный элемент = добавить строку сюда. */

  const CLICK_ROUTES = [
    ['.sr-item',          (el) => openSearchResult(parseInt(el.getAttribute('data-index'), 10))],
    ['.code-copy',        (el) => copyCode(el)],
    ['.sb-run',           (el) => runSandbox(el.closest('.sandbox'), 'run')],
    ['.sb-check',         (el) => runSandbox(el.closest('.sandbox'), 'check')],
    ['.sb-reset',         (el) => resetSandbox(el.closest('.sandbox'))],
    ['.task-done',        (el) => toggleManualTask(el)],
    ['.pb-continue',      (el) => goToAnchor(el.getAttribute('data-anchor'))],
    ['.pb-io',            (el) => el.getAttribute('data-io') === 'export' ? exportProgress() : importProgress()],
    ['.solution-toggle',  (el) => toggleSolution(el)],
    ['.ref-link, .rail-sec',
                          (el, e) => { e.preventDefault(); goToAnchor(el.getAttribute('data-anchor')); }],
    ['.rail-item',        (el) => { if (openModuleFrom(el)) setRailOpen(false); }],
    ['.rail-view',        (el) => showView(el.getAttribute('data-view'))],
    ['.catalog-card',     (el) => openModuleFrom(el)],
    ['.home-continue',    (el) => {
      const anchor = el.getAttribute('data-anchor');
      if (anchor) goToAnchor(anchor);
      else switchModule(modOf(el));
    }],
    ['.pi-open',          (el) => switchModule(modOf(el))],
    ['.home-open-catalog', () => showView('catalog')],
    ['#rail-toggle',      () => toggleRail()],
    ['.lesson-header',    (el) => setLessonOpen(el.parentElement, !el.parentElement.classList.contains('open'))],
    // Шаг 3: программа и раздел материала — навигация между экранами.
    // Шаг программы, занятие видеомодуля и «предыдущий/следующий»
    // открывают раздел одинаково — по data-mod/data-anchor/data-tab
    ['.prog-step-btn, .prog-lesson, .sec-nav-btn',
                          (el) => goAndScrollTop(() =>
                            openSection(modOf(el), el.getAttribute('data-anchor'), el.getAttribute('data-tab')))],
    ['.sec-tab',          (el) => goAndScrollTop(() => openSection(state.activeModule, state.section, el.getAttribute('data-tab')))],
    ['.sec-back',         (el) => goAndScrollTop(() => reopenModule(modOf(el)))],
    ['.step-sq',          (el) => stepSquareClick(el)],
    ['#cert-submit',      () => handleLogin()],
    ['.screenshot-card',  (el) => openLightbox(el.querySelector('img').src, el)],
    ['.lightbox',         () => closeLightbox()],
    ['.video-facade',     (el) => openVideo(el)]
  ];

  /* Навигация между экранами материала всегда возвращает к верху страницы —
     общая обвязка вместо повтора window.scrollTo в каждом обработчике */
  function goAndScrollTop(action) {
    action();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }

  /* Клик по квадратику полосы шагов (см. renderStepStrip): переключает
     вкладку, если нужно, и прокручивает к самому шагу */
  function stepSquareClick(el) {
    var tab = el.getAttribute('data-tab') === 'practice' ? 'practice' : 'theory';
    var target = el.getAttribute('data-target');
    if (state.tab !== tab) openSection(state.activeModule, state.section, tab);
    scrollToStepTarget(target);
  }

  function scrollToStepTarget(target) {
    var el = byId(/^pa-step-/.test(target) ? target : 'ref-' + target);
    if (el) scrollToElement(el);
  }

  /* Плеер вставляем вместо фасада только по клику — до этого момента
     страница не делает ни одного запроса к YouTube (см. renderVideoGrid) */
  function openVideo(button) {
    const id = button.getAttribute('data-video-id');
    const title = button.getAttribute('data-video-title') || '';
    const wrap = document.createElement('div');
    wrap.innerHTML = h('iframe', {
      src: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1',
      title: title,
      allow: IFRAME_ALLOW,
      allowfullscreen: true
    });
    const iframe = wrap.firstChild;
    button.replaceWith(iframe);
    iframe.focus();
  }

  function toggleSolution(button) {
    const solution = button.parentElement;
    const open = solution.classList.toggle('open');
    button.textContent = open ? 'Скрыть разбор' : 'Показать разбор';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Элемент, с которого открыт лайтбокс: закрытие возвращает фокус на него
  let lightboxOpener = null;

  function openLightbox(src, opener) {
    if (!src) return;
    const lightbox = byId('lightbox');
    lightbox.querySelector('img').src = src;
    lightbox.classList.add('active');
    lightboxOpener = opener || null;
    const closeBtn = lightbox.querySelector('.lightbox-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    const lightbox = byId('lightbox');
    if (!lightbox.classList.contains('active')) return;
    lightbox.classList.remove('active');
    if (lightboxOpener) lightboxOpener.focus();
    lightboxOpener = null;
  }

  // Ответ на input(): дописываем строку к «Вводу» и перезапускаем программу
  document.addEventListener('submit', function (e) {
    const form = e.target.closest && e.target.closest('.sb-prompt');
    if (!form) return;
    e.preventDefault();
    const sb = form.closest('.sandbox');
    appendStdinLine(sb, form.querySelector('.sb-prompt-input').value);
    runSandbox(sb, 'run');
  });

  /* Черновик пишется по ходу набора: PA.store сам дебаунсит запись */
  document.addEventListener('input', function (e) {
    const sb = e.target.closest && e.target.closest('.sandbox[data-block-key]');
    if (!sb) return;
    const key = sb.getAttribute('data-block-key');
    if (e.target.classList.contains('ed-input')) saveDraft(key, { code: e.target.value });
    if (e.target.classList.contains('sb-stdin-input')) saveDraft(key, { stdin: e.target.value });
  });

  document.addEventListener('click', function (e) {
    for (const [selector, handler] of CLICK_ROUTES) {
      const element = e.target.closest(selector);
      if (element) { handler(element, e); return; }
    }
    // Клик мимо — закрываем всплывающее
    if (!e.target.closest('.search-box')) closeSearch();
    // Клик мимо панели её задвигает; по кнопке-открывашке сюда не дойдёт —
    // такой клик разобран в CLICK_ROUTES выше
    if (!e.target.closest('.rail')) setRailOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeLightbox();
      setRailOpen(false);
    }
    // Ловушка фокуса в лайтбоксе: единственный фокусируемый элемент —
    // кнопка закрытия, поэтому Tab/Shift+Tab просто возвращают фокус на неё
    if (e.key === 'Tab' && byId('lightbox').classList.contains('active')) {
      e.preventDefault();
      byId('lightbox').querySelector('.lightbox-close').focus();
    }
    // «/» ставит курсор в поиск, как в GitHub
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      byId('search-input').focus();
      byId('search-input').select();
    }
    if (e.key === 'Enter' && e.target.id === 'cert-input') handleLogin();

    // Стрелки вверх/вниз на пункте панели переводят фокус на соседний
    // пункт, но не активируют его — Enter/пробел сработают сами, это кнопки
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.classList.contains('rail-item')) {
      e.preventDefault();
      const list = Array.from(document.querySelectorAll('.rail-item'));
      const idx = list.indexOf(e.target);
      if (idx === -1) return;
      const next = list[(idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      next.focus();
    }
  });

  /* ── Поиск ───────────────────────────────────────────── */

  const searchInput = byId('search-input');
  let searchTimer = null;

  searchInput.addEventListener('input', function () {
    const query = searchInput.value.trim();
    byId('search-box').classList.toggle('filled', query.length > 0);

    clearTimeout(searchTimer);
    if (query.length < CONFIG.searchMinLength) { closeSearch(); return; }

    searchTimer = setTimeout(() => {
      ensureSearchIndex().then(() => renderSearchResults(runSearch(query), query));
    }, CONFIG.searchDebounce);
  });

  searchInput.addEventListener('focus', function () {
    ensureSearchIndex().then(() => {
      const query = searchInput.value.trim();
      if (query.length >= CONFIG.searchMinLength) {
        renderSearchResults(runSearch(query), query);
      }
    });
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchCursor(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchCursor(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      openSearchResult(search.cursor >= 0 ? search.cursor : 0);
    } else if (e.key === 'Escape') {
      if (byId('search-results').classList.contains('open')) {
        closeSearch();
      } else {
        searchInput.value = '';
        byId('search-box').classList.remove('filled');
        searchInput.blur();
      }
    }
  });

  /* ── Сворачивание шапки при прокрутке ────────────────── */

  let scrollTicking = false;

  function syncHeaderState() {
    const header = document.querySelector('.header');
    if (!header) return;
    const y = window.pageYOffset || document.documentElement.scrollTop;
    const compact = header.classList.contains('compact');
    // Пороги разные, иначе панель дёргается у границы
    if (!compact && y > CONFIG.headerCollapseAt) header.classList.add('compact');
    else if (compact && y < CONFIG.headerExpandAt) header.classList.remove('compact');
  }

  window.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      syncHeaderState();
      scrollTicking = false;
    });
  }, { passive: true });

  window.addEventListener('hashchange', function () {
    const anchor = (location.hash || '').replace('#', '');
    if (anchor) goToAnchor(anchor, false);
  });

  /* ── Запуск: сначала манифест, потом всё остальное ───── */

  // Подсветка в проекте одна: редактор пользуется той же функцией
  if (hasPA) window.PA.setHighlighter(highlightPy);

  // На file:// воркер не регистрируется (нет http-источника), а ошибку
  // регистрации ученику показывать незачем — без офлайн-кеша страница
  // и так работает как обычно, просто без сети не откроется.
  function registerOffline() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  fetch('data/manifest.json')
    .then((response) => response.json())
    .then((manifest) => {
      state.groups = manifest.groups;
      state.modules = manifest.modules;
      state.searchIndexFile = (manifest.search && manifest.search.index) || 'data/search-index.json';

      const startAnchor = (location.hash || '').replace('#', '');

      if (startAnchor) {
        // Прямая ссылка на раздел важнее сохранённого места — сразу в материал
        state.view = 'material';
        renderRail();
        goToAnchor(startAnchor, false);
        registerOffline();
        return;
      }

      // Без якоря возвращаем туда, где ученик закрыл вкладку: в материал
      // (программу или конкретный раздел — шаг 3), в каталог или на
      // «Моё обучение» (по умолчанию для первого визита). Защищённый без
      // запомненного пароля и запланированный материал пропускаем —
      // открыть их всё равно нечем. place.view === 'material' встречается
      // и у записей до этого шага — такой материал просто откроется на
      // экране программы (или полотном, если это «Доп. курсы»)
      const place = savedPlace();
      const placeMeta = place && isModuleScreen(place.view) ? getModuleMeta(place.mod) : null;
      const canReturnToMaterial = placeMeta && !isPlanned(placeMeta) &&
        !(placeMeta.protected && !state.authToken);

      if (canReturnToMaterial) {
        // sw.js регистрируем после материала: его загрузка важнее
        switchModule(place.mod).then(function (data) {
          if (data && place.view === 'section' && place.section) {
            openSection(place.mod, place.section, place.tab);
          }
          registerOffline();
        });
      } else {
        showView(place && place.view === 'catalog' ? 'catalog' : 'home');
        registerOffline();
      }
    })
    .catch(function (error) {
      byId('content').innerHTML = h('div', { class: 'empty-state' },
        '⚠️ Не удалось загрузить конфигурацию (data/manifest.json). ' + esc(error.message));
    });

})();
