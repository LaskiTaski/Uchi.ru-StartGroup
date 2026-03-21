/* ══════════════════════════════════════════════════════════
   Python Academy — App Logic
   Этот файл отвечает за переключение вкладок и
   открытие/закрытие уроков.
   ══════════════════════════════════════════════════════════ */

// Переключение между модулями (вкладками)
function switchModule(modNum) {
  // Обновляем вкладки
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('active');
  });
  document.querySelector('.tab[data-mod="' + modNum + '"]').classList.add('active');

  // Обновляем панели
  document.querySelectorAll('.module-panel').forEach(function(p) {
    p.classList.remove('active');
  });
  document.getElementById('module-' + modNum).classList.add('active');

  // Прокрутка наверх
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

// Закрытие лайтбокса по Esc
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeLightbox();
  }
});