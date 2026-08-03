/* ══════════════════════════════════════════════════════════
   Python Academy — App Logic (Refactored)
   Data-driven рендеринг, делегирование событий,
   автоматический подсчёт статистики.
   ══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Конфигурация модулей ────────────────────────────── */
  var MODULES = [
    { id: 1, file: 'data/module1.json', icon: '🐍', label: 'Модуль 1', sub: '• Основы Python' },
    { id: 2, file: 'data/module2.json', icon: '📦', label: 'Модуль 2', sub: '• Строки, функции, циклы' },
    { id: 3, file: 'data/module3.json', icon: '⚙️', label: 'Модуль 3', sub: '• Коллекции' },
    { id: 4, file: 'data/module4.json', icon: '🚀', label: 'Модуль 4', sub: '• ООП и проекты' },
    { id: 6, file: 'data/notes.json',   icon: '📖', label: 'Основы Python',     sub: '• Типы данных',       menu: true },
    { id: 7, file: 'data/notes2.json',  icon: '🔀', label: 'Ветвление и циклы', sub: '• Условия, for, while', menu: true },
    { id: 8, file: 'data/notes3.json',  icon: '🧩', label: 'Функции',           sub: '• Аргументы, return',  menu: true },
    { id: 10, file: 'data/notes4.json', icon: '🧯', label: 'Ошибки',            sub: '• try / except',       menu: true },
    { id: 11, file: 'data/notes5.json', icon: '🏛️', label: 'ООП',               sub: '• классы и объекты',   menu: true },
    { id: 9, file: 'data/course1.json', icon: '🎯', label: 'Как решать задачи', sub: '• Алгоритмическое мышление', menu: true },
    { id: 5, file: 'data/module5.json', icon: '📚', label: 'Доп. курсы', sub: '' }
  ];

  function getModuleMeta(modId) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === modId) return MODULES[i];
    }
    return null;
  }

  var IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';

  var TAG_LABELS = {
    free: ['Бесплатно', 'tag-free'],    paid: ['Платный', 'tag-paid'],
    easy: ['Легко', 'tag-easy'],         medium: ['Нормально', 'tag-medium'],
    hard: ['Сложно', 'tag-hard'],        heavy: ['Тяжело', 'tag-heavy'],
    useful: ['Полезно', 'tag-useful'],   super: ['Очень полезно', 'tag-super'],
    optional: ['Необязательно', 'tag-optional'], unknown: ['Неизвестно', 'tag-unknown']
  };

  // ── Простой пароль для 5-го раздела ────────────────────
  var SECRET_PASSWORD = 'NwrBJQF92k&=';
  var REMEMBER_KEY    = 'pa_m5_unlocked';

  var activeModule = 1;
  var cache = {};
  var authToken = localStorage.getItem(REMEMBER_KEY) === '1' ? '1' : null;

  /* ── Утилиты ─────────────────────────────────────────── */
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Рендеринг вкладок ───────────────────────────────── */
  /* ── Группы: верхний уровень навигации ───────────────── */
  var GROUPS = [
    { id: 'video', icon: '🎬', label: 'Видеоматериалы', unit: 'модуль',  mods: [1, 2, 3, 4] },
    { id: 'my',    icon: '🎓', label: 'Мои курсы',      unit: 'курс',    mods: [9] },
    { id: 'ref',   icon: '📚', label: 'Справочник',     unit: 'раздел',  mods: [6, 7, 8, 10, 11] },
    { id: 'extra', icon: '⭐', label: 'Доп. материалы', note: 'внешние курсы', mods: [5] }
  ];

  var activeGroup = 'video';
  /* Запоминаем, на каком модуле человек был в каждой группе */
  var lastModuleInGroup = { video: 1, ref: 6, extra: 5 };

  /* Склонение: 1 модуль, 2 модуля, 5 модулей */
  function plural(n, one) {
    var forms = {
      'модуль': ['модуль', 'модуля', 'модулей'],
      'раздел': ['раздел', 'раздела', 'разделов'],
      'курс':   ['курс',   'курса',   'курсов']
    }[one] || [one, one, one];
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return forms[0];
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return forms[1];
    return forms[2];
  }

  function getGroup(gid) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].id === gid) return GROUPS[i];
    }
    return GROUPS[0];
  }

  function groupOfModule(modId) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].mods.indexOf(modId) !== -1) return GROUPS[i].id;
    }
    return GROUPS[0].id;
  }

  function renderGroups() {
    var html = '';
    GROUPS.forEach(function (g) {
      var active = g.id === activeGroup ? ' active' : '';
      var note = g.note ? g.note : g.mods.length + ' ' + plural(g.mods.length, g.unit);
      html += '<button class="group-tab' + active + '" data-group="' + g.id + '">' +
        '<span class="group-icon">' + g.icon + '</span>' +
        '<span class="group-text">' +
          '<span class="group-label">' + esc(g.label) + '</span>' +
          '<span class="group-note">' + esc(note) + '</span>' +
        '</span>' +
      '</button>';
    });
    document.getElementById('groups').innerHTML = html;
  }

  /* Нижний уровень: только модули активной группы */
  function renderTabs() {
    var group = getGroup(activeGroup);
    var html = '';

    group.mods.forEach(function (modId) {
      var m = getModuleMeta(modId);
      if (!m) return;
      var active = m.id === activeModule ? ' active' : '';
      var sub = m.sub ? '<span class="tab-label-sub">' + esc(m.sub) + '</span>' : '';
      var caret = m.menu ? '<span class="tab-caret" data-menu="' + m.id + '">▾</span>' : '';
      html += '<button class="tab' + active + '" data-mod="' + m.id + '">' +
        '<span class="tab-icon">' + m.icon + '</span> ' + esc(m.label) + sub + caret +
        '</button>';
    });

    document.getElementById('tabs').innerHTML = html;
    // Если в группе один раздел, второй ряд не нужен
    document.getElementById('tabs-wrap').classList.toggle('single', group.mods.length < 2);
    fitTabs();
  }

  function renderNav() {
    renderGroups();
    renderTabs();
  }

  /* Переключение группы: возвращаемся туда, где были в прошлый раз */
  function switchGroup(gid) {
    if (gid === activeGroup) return;
    activeGroup = gid;
    var target = lastModuleInGroup[gid] || getGroup(gid).mods[0];
    switchModule(target);
  }

  /* ── Прокрутка вкладок: авто-компакт, стрелки, колесо ── */
  function fitTabs() {
    var tabs = document.getElementById('tabs');
    var wrap = document.getElementById('tabs-wrap');
    if (!tabs || !wrap) return;

    // Меряем естественную ширину вкладок без растягивания
    tabs.classList.remove('stretch');
    var fits = tabs.scrollWidth <= tabs.clientWidth + 1;

    // Влезли — растягиваем на всю колонку; не влезли — включаем прокрутку
    tabs.classList.toggle('stretch', fits);
    wrap.classList.toggle('no-overflow', fits);
    updateTabFades();
  }

  function updateTabFades() {
    var tabs = document.getElementById('tabs');
    var wrap = document.getElementById('tabs-wrap');
    if (!tabs || !wrap) return;
    var maxScroll = tabs.scrollWidth - tabs.clientWidth;
    wrap.classList.toggle('fade-left',  maxScroll > 1 && tabs.scrollLeft > 4);
    wrap.classList.toggle('fade-right', maxScroll > 1 && tabs.scrollLeft < maxScroll - 4);
  }

  function scrollTabs(direction) {
    var tabs = document.getElementById('tabs');
    if (!tabs) return;
    tabs.scrollBy({ left: direction * Math.max(160, tabs.clientWidth * 0.6), behavior: 'smooth' });
  }

  /* Активная вкладка выезжает в центр ленты — так по бокам от неё
     всегда видно соседние разделы, а не обрезанный край */
  function scrollActiveTabIntoView(smooth) {
    var tabs = document.getElementById('tabs');
    var active = document.querySelector('.tab.active');
    if (!tabs || !active) return;

    var maxScroll = tabs.scrollWidth - tabs.clientWidth;
    if (maxScroll <= 1) { updateTabFades(); return; }

    // Целимся в центр, но не даём уехать за края ленты
    var target = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;

    // Гарантируем «подглядывание» соседей у краёв: если вкладка первая
    // или последняя, всё равно оставляем видимым кусок соседней
    var PEEK = 64;
    if (target < PEEK) target = 0;
    if (target > maxScroll - PEEK) target = maxScroll;
    target = Math.max(0, Math.min(target, maxScroll));

    if (smooth && tabs.scrollTo) {
      tabs.scrollTo({ left: target, behavior: 'smooth' });
    } else {
      tabs.classList.add('no-anim');
      tabs.scrollLeft = target;
      // форсируем пересчёт, чтобы анимация не подхватила это значение
      void tabs.offsetWidth;
      tabs.classList.remove('no-anim');
    }
    setTimeout(updateTabFades, 350);
  }

  /* ── Переключение модуля ─────────────────────────────── */
  function switchModule(modId) {
    var tabs = document.getElementById('tabs');
    var savedScroll = tabs ? tabs.scrollLeft : 0;
    activeModule = modId;
    activeGroup = groupOfModule(modId);
    lastModuleInGroup[activeGroup] = modId;
    renderNav();
    // renderTabs() перерисовывает ленту и сбрасывает прокрутку в 0 —
    // возвращаем позицию, чтобы плавный доезд шёл от текущего места
    if (tabs) {
      tabs.classList.add('no-anim');
      tabs.scrollLeft = savedScroll;
      void tabs.offsetWidth;
      tabs.classList.remove('no-anim');
    }
    loadModule(modId);
  }

  /* ── Загрузка данных модуля ──────────────────────────── */
  function loadModule(modId) {
    var content = document.getElementById('content');

    // Модуль 5 требует пароля
    if (modId === 5 && !authToken) {
      content.innerHTML = renderLoginForm();
      content.className = 'content fade-up';
      return;
    }

    loadModuleData(modId);
  }

  function loadModuleData(modId) {
    var content = document.getElementById('content');

    if (cache[modId]) {
      content.innerHTML = renderModule(cache[modId]);
      content.className = 'content fade-up';
      return;
    }

    var meta = getModuleMeta(modId);
    content.innerHTML = '<div class="empty-state">Загрузка...</div>';

    fetch(meta.file)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (activeModule !== modId) return; // устарело — пользователь уже ушёл
        cache[modId] = data;
        content.innerHTML = renderModule(data);
        content.className = 'content fade-up';
      })
      .catch(function () {
        content.innerHTML = '<div class="empty-state">⚠️ Не удалось загрузить модуль. Проверьте что файл ' +
          esc(meta.file) + ' доступен.</div>';
      });
  }


  /* ── Форма входа ─────────────────────────────────────── */
  function renderLoginForm(errorMsg) {
    var errorHtml = errorMsg
      ? '<div class="auth-error">' + esc(errorMsg) + '</div>'
      : '';

    return '<div class="auth-gate">' +
      '<div class="auth-card">' +
        '<div class="auth-icon">🔐</div>' +
        '<h2 class="auth-title">Дополнительные курсы</h2>' +
        '<p class="auth-desc">Этот раздел доступен только выпускникам.<br>Введите пароль для входа.</p>' +
        errorHtml +
        '<div class="auth-field">' +
          '<input type="password" id="cert-input" class="auth-input" placeholder="Пароль" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<label class="auth-remember">' +
          '<input type="checkbox" id="remember-check"> Запомнить на этом устройстве' +
        '</label>' +
        '<button class="auth-btn" id="auth-submit">Войти</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Обработка входа ─────────────────────────────────── */
  function handleLogin() {
    var input = document.getElementById('cert-input');
    var btn   = document.getElementById('auth-submit');
    var remember = document.getElementById('remember-check');
    if (!input || !btn) return;

    var password = input.value.trim();
    if (!password) {
      input.classList.add('shake');
      setTimeout(function () { input.classList.remove('shake'); }, 500);
      return;
    }

    if (password !== SECRET_PASSWORD) {
      var content = document.getElementById('content');
      content.innerHTML = renderLoginForm('Неверный пароль. Попробуйте ещё раз.');
      content.className = 'content fade-up';
      return;
    }

    // Пароль верный
    authToken = '1';
    if (remember && remember.checked) {
      localStorage.setItem(REMEMBER_KEY, '1');
    }
    loadModuleData(5);
  }

  /* ── Якоря справочников ──────────────────────────────── */

  /* Все модули-справочники (у них есть выпадающее меню) */
  function notesModules() {
    return MODULES.filter(function (m) { return m.menu; });
  }

  /* Гарантируем, что данные всех справочников загружены */
  function ensureNotesLoaded(callback) {
    var mods = notesModules();
    var pending = 0;
    var done = false;

    function finish() {
      if (!done && pending === 0) { done = true; callback(); }
    }

    mods.forEach(function (m) {
      if (cache[m.id]) return;
      pending++;
      fetch(m.file)
        .then(function (r) { return r.json(); })
        .then(function (data) { cache[m.id] = data; })
        .catch(function () {})
        .then(function () { pending--; finish(); });
    });

    finish();
  }

  /* В каком справочнике живёт этот якорь */
  function findModuleForAnchor(anchor) {
    var mods = notesModules();
    for (var i = 0; i < mods.length; i++) {
      var data = cache[mods[i].id];
      if (!data || !data.sections) continue;
      for (var j = 0; j < data.sections.length; j++) {
        if (data.sections[j].anchor === anchor) return mods[i].id;
      }
    }
    return null;
  }

  function headerOffset() {
    var h = document.querySelector('.header');
    return (h ? h.offsetHeight : 0) + 14;
  }

  /* Переход к разделу по якорю: открыть, подсветить, доскроллить */
  function goToAnchor(anchor, updateHash) {
    closeTabMenu();

    function jump() {
      var el = document.getElementById('ref-' + anchor);
      if (!el) return;
      el.classList.add('open');

      // Прыгаем вниз — шапка там будет свёрнутой, поэтому сворачиваем
      // её заранее и меряем позицию уже по итоговой геометрии
      var absTop = el.getBoundingClientRect().top + window.pageYOffset;
      if (absTop > COLLAPSE_AT) {
        document.querySelector('.header').classList.add('compact');
      }

      var top = el.getBoundingClientRect().top + window.pageYOffset - headerOffset();
      window.scrollTo({ top: top, behavior: 'smooth' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      if (updateHash !== false && history.replaceState) {
        history.replaceState(null, '', '#' + anchor);
      }
    }

    ensureNotesLoaded(function () {
      var modId = findModuleForAnchor(anchor);
      if (modId === null) return;

      if (activeModule !== modId) {
        switchModule(modId);
        // ждём, пока раздел появится в разметке
        var tries = 0;
        var timer = setInterval(function () {
          if (document.getElementById('ref-' + anchor) || ++tries > 40) {
            clearInterval(timer);
            jump();
          }
        }, 25);
      } else {
        jump();
      }
    });
  }

  /* ── Выпадающее меню вкладки «Справочник» ────────────── */
  function closeTabMenu() {
    var menu = document.getElementById('tab-menu');
    if (menu) menu.remove();
    var open = document.querySelector('.tab-caret.open');
    if (open) open.classList.remove('open');
  }

  function toggleTabMenu(caretEl) {
    var wasOpen = !!document.getElementById('tab-menu');
    var modId = parseInt(caretEl.getAttribute('data-menu'), 10);
    var sameTab = wasOpen &&
      document.getElementById('tab-menu').getAttribute('data-mod') === String(modId);
    if (sameTab) { closeTabMenu(); return; }

    var meta = getModuleMeta(modId);

    function build(data) {
      closeTabMenu();
      caretEl.classList.add('open');

      var items = '';
      (data.sections || []).forEach(function (sec) {
        if (!sec.anchor) return;
        items += '<button class="tab-menu-item" data-anchor="' + esc(sec.anchor) + '">' +
          '<span class="tmi-num">' + esc(sec.num) + '</span>' +
          '<span class="tmi-title">' + esc(sec.title) + '</span></button>';
      });

      var menu = document.createElement('div');
      menu.id = 'tab-menu';
      menu.className = 'tab-menu';
      menu.setAttribute('data-mod', modId);
      menu.innerHTML = '<div class="tab-menu-head">' + esc(data.title || 'Перейти к разделу') + '</div>' + items;
      document.getElementById('tabs-wrap').appendChild(menu);

      // Позиционируем под вкладкой, не давая вылезти за колонку
      var wrapRect = document.getElementById('tabs-wrap').getBoundingClientRect();
      var tabRect  = caretEl.closest('.tab').getBoundingClientRect();
      var left = tabRect.left - wrapRect.left;
      var maxLeft = wrapRect.width - menu.offsetWidth;
      menu.style.left = Math.max(0, Math.min(left, maxLeft)) + 'px';
    }

    if (cache[modId]) {
      build(cache[modId]);
    } else {
      fetch(meta.file)
        .then(function (r) { return r.json(); })
        .then(function (data) { cache[modId] = data; build(data); })
        .catch(function () {});
    }
  }

  /* ── Рендер модуля ───────────────────────────────────── */
  function renderModule(data) {
    if (data.type === 'courses') return renderCoursesModule(data);
    if (data.type === 'notes' || data.type === 'course') return renderNotesModule(data);
    return renderLessonsModule(data);
  }

  /* ── Модули 1-4: уроки ───────────────────────────────── */
  function renderLessonsModule(data) {
    var totalV = 0, totalL = 0, totalS = 0;
    var lessonsHtml = '';

    data.lessons.forEach(function (lesson) {
      if (lesson.attestation) {
        lessonsHtml += renderAttestation(data.id);
        return;
      }

      var nV = (lesson.videos || []).length;
      var nL = (lesson.links || []).length;
      var nS = (lesson.screenshots || []).length;
      totalV += nV; totalL += nL; totalS += nS;

      var hasContent = nV + nL + nS > 0;

      // Бейджи
      var badgesHtml = '';
      (lesson.badges || []).forEach(function (b) {
        badgesHtml += '<span class="badge-has">' + esc(b) + '</span>';
      });
      if (!lesson.attestation) {
        badgesHtml += renderCountBadge('🎬', nV);
        badgesHtml += renderCountBadge('📄', nL);
        badgesHtml += renderCountBadge('🖼️', nS);
      }

      // Тело урока
      var bodyParts = '<p class="lesson-desc">' + esc(lesson.desc) + '</p>';

      if (!hasContent) {
        bodyParts += '<div class="empty-state">🔒 Материалы для этого занятия ещё не добавлены.</div>';
      } else {
        if (nV > 0) bodyParts += renderSection('🎬 Видео', renderVideoGrid(lesson.videos));
        if (nL > 0) bodyParts += renderSection('📄 Материалы', renderLinkList(lesson.links));
        if (nS > 0) bodyParts += renderSection('🖼️ Скриншоты с занятия', renderScreenshotsGrid(lesson.screenshots));
      }

      lessonsHtml += '<div class="lesson" data-mod="' + data.id + '">' +
        '<div class="lesson-header">' +
          '<span class="lesson-num">' + esc(lesson.num) + '</span>' +
          '<span class="lesson-title">' + esc(lesson.title) + '</span>' +
          '<span class="lesson-badges">' + badgesHtml + '</span>' +
          '<span class="chevron">▾</span>' +
        '</div>' +
        '<div class="lesson-body">' + bodyParts + '</div>' +
      '</div>';
    });

    // Extra block
    var extraHtml = '';
    if (data.extra) {
      var extraContent = '';
      if (data.extra.text) {
        extraContent = esc(data.extra.text);
      }
      if (data.extra.screenshots && data.extra.screenshots.length > 0) {
        extraContent += renderSection('🖼️ Скриншоты с занятий', renderScreenshotsGrid(data.extra.screenshots));
      }
      extraHtml = '<div class="extra-block">' +
        '<div class="extra-title">📚 Дополнительная информация для этого модуля</div>' +
        '<div class="extra-text">' + extraContent + '</div></div>';
    }

    var lessonsCount = data.lessons.filter(function (l) { return !l.attestation; }).length;
    var headerHtml = renderModuleHeader(data.id, data.icon, data.title,
      lessonsCount + ' занятий • 🎬 ' + totalV + ' • 📄 ' + totalL + ' • 🖼️ ' + totalS);

    return headerHtml + lessonsHtml + extraHtml;
  }

  /* ── Модуль 5: курсы ─────────────────────────────────── */
  function renderCoursesModule(data) {
    var headerHtml = renderModuleHeader(data.id, data.icon, data.title, data.subtitle);
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

      sectionsHtml += '<div class="lesson" data-mod="5">' +
        '<div class="lesson-header">' +
          '<span class="lesson-num">' + esc(section.num) + '</span>' +
          '<span class="lesson-title">' + esc(section.title) + '</span>' +
          '<span class="lesson-badges">' + badgesHtml + '</span>' +
          '<span class="chevron">▾</span>' +
        '</div>' +
        '<div class="lesson-body">' + bodyParts + '</div>' +
      '</div>';
    });

    return headerHtml + sectionsHtml;
  }

  /* ── Модуль «Конспект»: справочные секции ────────────── */
  function renderNotesModule(data) {
    var headerHtml = renderModuleHeader(data.id, data.icon, data.title, data.subtitle);

    // Быстрая навигация: плитки-ссылки на разделы
    var navHtml = '';
    var chips = '';
    (data.sections || []).forEach(function (sec) {
      if (!sec.anchor || !sec.chip) return;
      chips += '<button class="qn-chip" data-anchor="' + esc(sec.anchor) + '">' +
        '<span class="qn-code">' + esc(sec.chip) + '</span>' +
        (sec.chipNote ? '<span class="qn-note">' + esc(sec.chipNote) + '</span>' : '') +
        '</button>';
    });
    if (chips) {
      navHtml = '<div class="quick-nav" data-mod="' + data.id + '">' +
        '<div class="qn-title">Быстрый переход</div>' +
        '<div class="qn-grid">' + chips + '</div></div>';
    }

    // Вводная карточка курса: для кого, сколько, что получит
    var aboutHtml = '';
    if (data.about) {
      var metaHtml = '';
      (data.about.meta || []).forEach(function (m) {
        metaHtml += '<div class="about-item">' +
          '<div class="about-label">' + esc(m.label) + '</div>' +
          '<div class="about-value">' + inlineFmt(m.value) + '</div></div>';
      });
      aboutHtml = '<div class="course-about" data-mod="' + data.id + '">' +
        (data.about.text ? '<p class="about-text">' + inlineFmt(data.about.text) + '</p>' : '') +
        (metaHtml ? '<div class="about-grid">' + metaHtml + '</div>' : '') +
      '</div>';
    }

    // Дорожная карта курса
    var roadHtml = '';
    if (data.roadmap && data.roadmap.length) {
      var steps = '';
      data.roadmap.forEach(function (st, i) {
        steps += '<button class="rm-step" data-anchor="' + esc(st.anchor || '') + '">' +
          '<span class="rm-num">' + (i + 1) + '</span>' +
          '<span class="rm-body">' +
            '<span class="rm-title">' + esc(st.title) + '</span>' +
            (st.note ? '<span class="rm-note">' + esc(st.note) + '</span>' : '') +
          '</span></button>';
      });
      roadHtml = '<div class="roadmap" data-mod="' + data.id + '">' +
        '<div class="qn-title">Программа курса</div>' +
        '<div class="rm-track">' + steps + '</div></div>';
    }

    var sectionsHtml = '';
    (data.sections || []).forEach(function (section) {
      var bodyParts = '';
      if (section.desc) {
        bodyParts += '<p class="lesson-desc">' + inlineFmt(section.desc) + '</p>';
      }
      (section.blocks || []).forEach(function (block) {
        bodyParts += renderNoteBlock(block);
      });

      var idAttr = section.anchor ? ' id="ref-' + esc(section.anchor) + '"' : '';
      var chipBadge = section.chip
        ? '<span class="lesson-badges"><span class="sec-chip">' + esc(section.chip) + '</span></span>'
        : '';

      sectionsHtml += '<div class="lesson ref-section"' + idAttr + ' data-mod="' + data.id + '">' +
        '<div class="lesson-header">' +
          '<span class="lesson-num">' + esc(section.num) + '</span>' +
          '<span class="lesson-title">' + esc(section.title) + '</span>' +
          chipBadge +
          '<span class="chevron">\u25be</span>' +
        '</div>' +
        '<div class="lesson-body">' + bodyParts + '</div>' +
      '</div>';
    });

    return headerHtml + aboutHtml + roadHtml + navHtml + sectionsHtml;
  }

  function renderNoteBlock(block) {
    switch (block.type) {
      case 'text':
        return '<p class="note-text">' + inlineFmt(block.text) + '</p>';
      case 'heading':
        return '<div class="section-divider"></div><div class="section-label">' + esc(block.text) + '</div>';
      case 'code':
        return renderCodeBlock(block.title, block.code);
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
        return renderTaskBlock(block);
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

  /* Практическое задание: условие, подсказка и разбор под спойлером */
  function renderTaskBlock(block) {
    var html = '<div class="task">' +
      '<div class="task-head"><span class="task-badge">Задание</span>' +
      (block.title ? '<span class="task-title">' + esc(block.title) + '</span>' : '') + '</div>' +
      '<div class="task-text">' + inlineFmt(block.text) + '</div>';

    if (block.example) {
      html += renderCodeBlock('Пример работы', block.example);
    }
    if (block.hint) {
      html += '<div class="callout callout-note">💡 <span>' + inlineFmt(block.hint) + '</span></div>';
    }
    if (block.solution) {
      html += '<div class="solution">' +
        '<button class="solution-toggle" type="button">Показать разбор</button>' +
        '<div class="solution-body">' + renderCodeBlock(null, block.solution) +
        (block.explain ? '<p class="note-text">' + inlineFmt(block.explain) + '</p>' : '') +
        '</div></div>';
    }
    return html + '</div>';
  }

  function renderCodeBlock(title, code) {
    var titleHtml = title
      ? '<div class="code-title">' + esc(title) + '</div>'
      : '';
    return '<div class="code-block">' + titleHtml +
      '<pre><code>' + highlightPy(code) + '</code></pre></div>';
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
  function renderModuleHeader(modId, icon, title, meta) {
    return '<div class="module-header" data-mod="' + modId + '">' +
      '<span class="icon">' + icon + '</span>' +
      '<div><div class="title">' + esc(title) + '</div>' +
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
      html += '<div class="video-card">' +
        '<iframe src="https://www.youtube.com/embed/' + esc(v.id) + '" title="' + esc(v.title) + '" ' +
        'allow="' + IFRAME_ALLOW + '" allowfullscreen loading="lazy"></iframe>' +
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
      html += '<div class="screenshot-card">' +
        '<img src="' + esc(s.src) + '" alt="' + esc(s.caption) + '" loading="lazy">' +
        '<div class="s-caption">' + esc(s.caption) + '</div></div>';
    });
    return html + '</div>';
  }

  function renderTag(key) {
    var info = TAG_LABELS[key] || [key, 'tag-unknown'];
    return '<span class="tag ' + info[1] + '">' + esc(info[0]) + '</span>';
  }

  function renderAttestation(modId) {
    return '<div class="lesson attestation" data-mod="' + modId + '">' +
      '<div class="lesson-header">' +
        '<span class="lesson-num">📝</span>' +
        '<span class="lesson-title">Промежуточная аттестация</span>' +
        '<span class="lesson-badges"><span class="badge-attest">⚠️ ГОТОВИМСЯ ⚠️</span></span>' +
        '<span class="chevron">▾</span>' +
      '</div>' +
      '<div class="lesson-body">' +
        '<p class="lesson-desc attest-desc">' +
          '⚠️ Повторите пройденный материал и закройте все долги для сдачи теста! ⚠️<br>' +
          'Информацию по долгам можно уточнить ТОЛЬКО у технической поддержки.' +
        '</p>' +
      '</div></div>';
  }

  /* ── Делегирование событий ───────────────────────────── */
  document.addEventListener('click', function (e) {
    // Верхний уровень навигации — группы
    var groupBtn = e.target.closest('.group-tab');
    if (groupBtn) {
      closeTabMenu();
      switchGroup(groupBtn.getAttribute('data-group'));
      return;
    }

    // Каретка «Справочника» — выпадающее меню разделов
    var caret = e.target.closest('.tab-caret');
    if (caret) {
      e.stopPropagation();
      toggleTabMenu(caret);
      return;
    }

    // Пункт выпадающего меню
    var menuItem = e.target.closest('.tab-menu-item');
    if (menuItem) {
      goToAnchor(menuItem.getAttribute('data-anchor'));
      return;
    }

    // Плитка быстрой навигации или ссылка-якорь в тексте
    // Разбор задания — раскрывающийся блок
    var solBtn = e.target.closest('.solution-toggle');
    if (solBtn) {
      var sol = solBtn.parentElement;
      sol.classList.toggle('open');
      solBtn.textContent = sol.classList.contains('open') ? 'Скрыть разбор' : 'Показать разбор';
      return;
    }

    var jumper = e.target.closest('.qn-chip, .ref-link, .rm-step[data-anchor]:not([data-anchor=""])');
    if (jumper) {
      e.preventDefault();   // переход обрабатываем сами, без перезагрузки
      goToAnchor(jumper.getAttribute('data-anchor'));
      return;
    }

    // Клик мимо меню — закрываем его
    if (!e.target.closest('.tab-menu')) closeTabMenu();

    // Переключение вкладок
    var tab = e.target.closest('.tab');
    if (tab) {
      var modId = parseInt(tab.getAttribute('data-mod'), 10);
      switchModule(modId);
      scrollActiveTabIntoView(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Аккордеон уроков
    var header = e.target.closest('.lesson-header');
    if (header) {
      header.parentElement.classList.toggle('open');
      return;
    }

    // Лайтбокс — открытие
    var card = e.target.closest('.screenshot-card');
    if (card) {
      var img = card.querySelector('img');
      var lightbox = document.getElementById('lightbox');
      lightbox.querySelector('img').src = img.src;
      lightbox.classList.add('active');
      return;
    }

    // Лайтбокс — закрытие
    if (e.target.closest('.lightbox-close') || e.target.closest('.lightbox')) {
      document.getElementById('lightbox').classList.remove('active');
    }

    // Кнопка входа
    if (e.target.closest('#auth-submit')) {
      handleLogin();
    }
  });

  // Не закрывать лайтбокс при клике на картинку внутри
  document.getElementById('lightbox').querySelector('img').addEventListener('click', function (e) {
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.getElementById('lightbox').classList.remove('active');
      closeTabMenu();
    }
    // Enter в поле ввода сертификата
    if (e.key === 'Enter' && e.target.id === 'cert-input') {
      handleLogin();
    }
  });

  var tabsEl = document.getElementById('tabs');
  tabsEl.addEventListener('scroll', updateTabFades, { passive: true });
  window.addEventListener('resize', fitTabs);

  // Вертикальное колесо мыши прокручивает ленту вкладок по горизонтали
  tabsEl.addEventListener('wheel', function (e) {
    var maxScroll = tabsEl.scrollWidth - tabsEl.clientWidth;
    if (maxScroll <= 1) return;
    var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    // Не перехватываем, если лента уже упёрлась в край — отдаём скролл странице
    if ((delta < 0 && tabsEl.scrollLeft <= 0) ||
        (delta > 0 && tabsEl.scrollLeft >= maxScroll - 1)) return;
    e.preventDefault();
    tabsEl.scrollLeft += delta;
  }, { passive: false });

  // Перетаскивание ленты мышью (как в современных таб-барах)
  var dragActive = false, dragMoved = false, dragStartX = 0, dragStartScroll = 0;

  tabsEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (tabsEl.scrollWidth <= tabsEl.clientWidth + 1) return;
    dragActive = true; dragMoved = false;
    dragStartX = e.clientX;
    dragStartScroll = tabsEl.scrollLeft;
  });

  tabsEl.addEventListener('pointermove', function (e) {
    if (!dragActive) return;
    var dx = e.clientX - dragStartX;
    if (!dragMoved && Math.abs(dx) < 5) return;   // отличаем клик от перетаскивания
    if (!dragMoved) {
      dragMoved = true;
      tabsEl.classList.add('dragging');
      tabsEl.setPointerCapture(e.pointerId);
    }
    tabsEl.scrollLeft = dragStartScroll - dx;
  });

  function endDrag() {
    if (!dragActive) return;
    dragActive = false;
    tabsEl.classList.remove('dragging');
  }
  tabsEl.addEventListener('pointerup', endDrag);
  tabsEl.addEventListener('pointercancel', endDrag);
  tabsEl.addEventListener('pointerleave', endDrag);

  // Стрелки
  /* ── Сворачивание верхней панели при прокрутке ───────── */
  var COLLAPSE_AT = 150;   // ушли ниже — панель уезжает
  var EXPAND_AT   = 40;    // вернулись наверх — выкатывается обратно
  var scrollTicking = false;

  function syncHeaderState() {
    var header = document.querySelector('.header');
    if (!header) return;
    var y = window.pageYOffset || document.documentElement.scrollTop;
    var compact = header.classList.contains('compact');
    // Порог на вход и на выход разный — иначе панель дёргается у границы
    if (!compact && y > COLLAPSE_AT) header.classList.add('compact');
    else if (compact && y < EXPAND_AT) header.classList.remove('compact');
  }

  window.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      syncHeaderState();
      scrollTicking = false;
    });
  }, { passive: true });

  document.getElementById('tabs-prev').addEventListener('click', function () { scrollTabs(-1); });
  document.getElementById('tabs-next').addEventListener('click', function () { scrollTabs(1); });

  // Шрифты грузятся асинхронно и меняют ширину вкладок — пересчитываем
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitTabs);
  }

  /* ── Инициализация ───────────────────────────────────── */
  renderNav();

  var startAnchor = (location.hash || '').replace('#', '');
  loadModule(1);
  if (startAnchor) goToAnchor(startAnchor, false);

  fitTabs();
  scrollActiveTabIntoView(false);

  // Переход по якорю при смене адреса (кнопки «назад/вперёд», ручной ввод)
  window.addEventListener('hashchange', function () {
    var a = (location.hash || '').replace('#', '');
    if (a) goToAnchor(a, false);
  });
})();
