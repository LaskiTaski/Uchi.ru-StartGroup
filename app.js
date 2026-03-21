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
