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
    { id: 5, file: 'data/module5.json', icon: '📚', label: 'Дополнительные курсы', sub: '' }
  ];

  var IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';

  var TAG_LABELS = {
    free: ['Бесплатно', 'tag-free'],    paid: ['Платный', 'tag-paid'],
    easy: ['Легко', 'tag-easy'],         medium: ['Нормально', 'tag-medium'],
    hard: ['Сложно', 'tag-hard'],        heavy: ['Тяжело', 'tag-heavy'],
    useful: ['Полезно', 'tag-useful'],   super: ['Очень полезно', 'tag-super'],
    optional: ['Необязательно', 'tag-optional'], unknown: ['Неизвестно', 'tag-unknown']
  };

  // ── URL бэкенда (поменяй на свой после деплоя) ─────────
  var API_URL = 'http://localhost:8000';

  var activeModule = 1;
  var cache = {};
  var authToken = localStorage.getItem('pa_token') || null;

  /* ── Утилиты ─────────────────────────────────────────── */
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Рендеринг вкладок ───────────────────────────────── */
  function renderTabs() {
    var html = '';
    MODULES.forEach(function (m) {
      var active = m.id === activeModule ? ' active' : '';
      var sub = m.sub ? '<span class="tab-label-sub">' + esc(m.sub) + '</span>' : '';
      html += '<button class="tab' + active + '" data-mod="' + m.id + '">' +
        '<span class="tab-icon">' + m.icon + '</span> ' + esc(m.label) + sub +
        '</button>';
    });
    document.getElementById('tabs').innerHTML = html;
  }

  /* ── Переключение модуля ─────────────────────────────── */
  function switchModule(modId) {
    activeModule = modId;
    renderTabs();
    loadModule(modId);
  }

  /* ── Загрузка данных модуля ──────────────────────────── */
  function loadModule(modId) {
    var content = document.getElementById('content');

    // Модуль 5 требует авторизации
    if (modId === 5) {
      if (!authToken) {
        content.innerHTML = renderLoginForm();
        content.className = 'content fade-up';
        return;
      }
      // Проверяем токен на сервере
      fetch(API_URL + '/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authToken }),
      })
        .then(function (r) {
          if (!r.ok) {
            authToken = null;
            localStorage.removeItem('pa_token');
            content.innerHTML = renderLoginForm('Сессия истекла. Войдите заново.');
            content.className = 'content fade-up';
            return;
          }
          return r.json();
        })
        .then(function (data) {
          if (data) loadModuleData(modId);
        })
        .catch(function () {
          content.innerHTML = renderLoginForm('Сервер недоступен. Попробуйте позже.');
          content.className = 'content fade-up';
        });
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

    var meta = MODULES[modId - 1];
    content.innerHTML = '<div class="empty-state">Загрузка...</div>';

    fetch(meta.file)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        cache[modId] = data;
        content.innerHTML = renderModule(data);
        content.className = 'content fade-up';
      })
      .catch(function () {
        content.innerHTML = '<div class="empty-state">⚠️ Не удалось загрузить модуль. Проверьте что файл ' +
          esc(meta.file) + ' доступен.</div>';
      });
  }

  /* ── Device ID (fingerprint) ─────────────────────────── */
  function getDeviceId() {
    var stored = localStorage.getItem('pa_device_id');
    if (stored) return stored;

    // Генерируем уникальный ID устройства
    var raw = [
      navigator.userAgent,
      screen.width + 'x' + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      new Date().getTimezoneOffset(),
    ].join('|');

    // Простой hash
    var hash = 0;
    for (var i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash = hash & hash;
    }
    var deviceId = 'dev_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
    localStorage.setItem('pa_device_id', deviceId);
    return deviceId;
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
        '<p class="auth-desc">Этот раздел доступен только выпускникам.<br>Введите номер вашего сертификата для входа.</p>' +
        errorHtml +
        '<div class="auth-field">' +
          '<input type="text" id="cert-input" class="auth-input" placeholder="Например: PA-2026-001" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<button class="auth-btn" id="auth-submit">Войти</button>' +
        '<p class="auth-hint">Номер указан на вашем сертификате об окончании курса.</p>' +
      '</div>' +
    '</div>';
  }

  /* ── Обработка входа ─────────────────────────────────── */
  function handleLogin() {
    var input = document.getElementById('cert-input');
    var btn = document.getElementById('auth-submit');
    if (!input || !btn) return;

    var certNumber = input.value.trim();
    if (!certNumber) {
      input.classList.add('shake');
      setTimeout(function () { input.classList.remove('shake'); }, 500);
      return;
    }

    btn.textContent = 'Проверяем...';
    btn.disabled = true;

    fetch(API_URL + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cert_number: certNumber,
        device_id: getDeviceId(),
      }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail); });
        return r.json();
      })
      .then(function (data) {
        authToken = data.token;
        localStorage.setItem('pa_token', authToken);
        loadModuleData(5);
      })
      .catch(function (err) {
        var content = document.getElementById('content');
        content.innerHTML = renderLoginForm(err.message || 'Ошибка подключения к серверу');
        content.className = 'content fade-up';
      });
  }

  /* ── Рендер модуля ───────────────────────────────────── */
  function renderModule(data) {
    if (data.type === 'courses') return renderCoursesModule(data);
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

      section.groups.forEach(function (group) {
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
    // Переключение вкладок
    var tab = e.target.closest('.tab');
    if (tab) {
      var modId = parseInt(tab.getAttribute('data-mod'), 10);
      switchModule(modId);
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
    }
    // Enter в поле ввода сертификата
    if (e.key === 'Enter' && e.target.id === 'cert-input') {
      handleLogin();
    }
  });

  /* ── Инициализация ───────────────────────────────────── */
  renderTabs();
  loadModule(1);
})();
