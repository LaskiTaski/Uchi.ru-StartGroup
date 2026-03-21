/* ══════════════════════════════════════════════════════════
   Python Academy — App Logic
   Переключение вкладок, аккордеон, лайтбокс,
   автоподсчёт бейджей, автоскрытие пустых секций.
   ══════════════════════════════════════════════════════════ */

// Переключение между модулями (вкладками)
function switchModule(modNum) {
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('active');
  });
  document.querySelector('.tab[data-mod="' + modNum + '"]').classList.add('active');

  document.querySelectorAll('.module-panel').forEach(function(p) {
    p.classList.remove('active');
  });
  document.getElementById('module-' + modNum).classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Открытие/закрытие урока (аккордеон)
function toggleLesson(headerEl) {
  var lesson = headerEl.parentElement;
  lesson.classList.toggle('open');
}

// Лайтбокс для скриншотов
document.addEventListener('click', function(e) {
  var card = e.target.closest('.screenshot-card');
  if (card) {
    var src = card.querySelector('img').src;
    var lightbox = document.getElementById('lightbox');
    lightbox.querySelector('img').src = src;
    lightbox.classList.add('active');
  }
});

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLightbox();
});


// ══════════════════════════════════════════════════════════
// Автоматическая обработка модуля после загрузки:
// 1) Подсчёт и генерация бейджей 🎬 📄 🖼️ в каждом уроке
// 2) Скрытие пустых секций (видео, материалы, скриншоты)
// 3) Скрытие заглушки "🔒" если есть хоть какой-то контент
// 4) Обновление счётчиков в шапке модуля
// ══════════════════════════════════════════════════════════
function processModule(container) {
  var totalVideos = 0;
  var totalLinks = 0;
  var totalScreenshots = 0;

  container.querySelectorAll('.lesson').forEach(function(lesson) {
    var body = lesson.querySelector('.lesson-body');
    if (!body) return;
    if (lesson.classList.contains('attestation')) return;

    // ── 1. Подсчёт реального контента ──
    var numVideos = body.querySelectorAll('.video-grid iframe').length;
    var numLinks = body.querySelectorAll('.link-list .link-item').length;
    var numScreenshots = body.querySelectorAll('.screenshots-grid .screenshot-card').length;

    totalVideos += numVideos;
    totalLinks += numLinks;
    totalScreenshots += numScreenshots;

    // ── 2. Генерируем бейджи ──
    // Удаляем старые числовые бейджи (🎬, 📄, 🖼️), оставляем смысловые (проект, практика)
    var badges = lesson.querySelector('.lesson-badges');
    if (badges) {
      badges.querySelectorAll('span').forEach(function(span) {
        var text = span.textContent.trim();
        if (text.indexOf('🎬') === 0 || text.indexOf('📄') === 0 || text.indexOf('🖼') === 0) {
          span.remove();
        }
      });

      // Добавляем новые с актуальными числами
      var items = [
        { emoji: '🎬', count: numVideos },
        { emoji: '📄', count: numLinks },
        { emoji: '🖼️', count: numScreenshots }
      ];

      items.forEach(function(item) {
        var span = document.createElement('span');
        span.className = item.count > 0 ? 'badge-has' : 'badge-zero';
        span.textContent = item.emoji + ' ' + item.count;
        badges.appendChild(span);
      });
    }

    // ── 3. Скрываем пустые секции и разделители ──
    var hasAnyContent = false;

    body.querySelectorAll('.section-label').forEach(function(label) {
      var next = label.nextElementSibling;
      var prev = label.previousElementSibling;

      var isGrid = next && (
        next.classList.contains('video-grid') ||
        next.classList.contains('link-list') ||
        next.classList.contains('screenshots-grid')
      );

      var isEmpty = !isGrid || (isGrid && next.children.length === 0);

      if (isEmpty) {
        label.style.display = 'none';
        if (isGrid) next.style.display = 'none';
        if (prev && prev.tagName === 'HR') {
          prev.style.display = 'none';
          if (prev.previousElementSibling && prev.previousElementSibling.tagName === 'BR') {
            prev.previousElementSibling.style.display = 'none';
          }
        }
      } else {
        hasAnyContent = true;
      }
    });

    // ── 4. Скрываем заглушку если есть контент ──
    var emptyState = body.querySelector('.empty-state');
    if (emptyState && hasAnyContent) {
      emptyState.style.display = 'none';
    }
  });

  // ── 5. Обновляем счётчики в шапке модуля ──
  var meta = container.querySelector('.module-header .meta');
  if (meta) {
    var lessonsMatch = meta.textContent.match(/(\d+)\s*занятий/);
    var lessonsCount = lessonsMatch ? lessonsMatch[1] : '13';
    meta.textContent = lessonsCount + ' занятий • 🎬 ' + totalVideos + ' • 📄 ' + totalLinks + ' • 🖼️ ' + totalScreenshots;
  }
}