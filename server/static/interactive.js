/* ═══════════════════════════════════════════════════════════
   Всё, что остаётся на клиенте, когда страницы собирает сервер.

   Ровно четыре вещи, и ни одна из них не про разметку страницы:

     1. подсветка Python — перерисовывается на каждое нажатие клавиши,
        поэтому уехать на сервер не может в принципе;
     2. песочница — Pyodide работает в браузере ученика, как и работал;
     3. прогресс — живёт в localStorage, сервер про ученика не знает;
     4. викторина — проверяется мгновенно, без сети.

   Здесь нет ни одного места, где строился бы экран. Сравните с app.js,
   где на отрисовку уходило 1039 строк из 2958.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var hasPA = typeof window.PA !== 'undefined';
  var qa = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /* ── Подсветка Python ────────────────────────────────── */
  var PY_KEYWORDS = ['False','None','True','and','as','assert','async','await','break','case','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','match','nonlocal','not','or','pass','raise','return','try','while','with','yield'];
  var PY_BUILTINS = ['print','input','len','type','int','float','str','bool','list','tuple','dict','set','frozenset','range','enumerate','zip','sorted','reversed','sum','min','max','abs','round','isinstance','id','repr'];

  function highlightPy(code) {
    var re = /(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?""")|([bruf]{0,2}'(?:\\.|[^'\\\n])*'|[bruf]{0,2}"(?:\\.|[^"\\\n])*")|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([\s\S])/g;
    var out = '', m;
    while ((m = re.exec(code)) !== null) {
      if (m[1]) out += '<span class="tok-com">' + esc(m[1]) + '</span>';
      else if (m[2] || m[3]) out += '<span class="tok-str">' + esc(m[2] || m[3]) + '</span>';
      else if (m[4]) out += '<span class="tok-num">' + esc(m[4]) + '</span>';
      else if (m[5]) {
        if (PY_KEYWORDS.indexOf(m[5]) !== -1) out += '<span class="tok-kw">' + esc(m[5]) + '</span>';
        else if (PY_BUILTINS.indexOf(m[5]) !== -1) out += '<span class="tok-fn">' + esc(m[5]) + '</span>';
        else out += esc(m[5]);
      } else out += esc(m[6]);
    }
    return out;
  }

  if (hasPA) window.PA.setHighlighter(highlightPy);

  /* Сервер кладёт в <code> голый текст — подсвечиваем его при загрузке */
  function highlightStatic() {
    qa('pre > code.lang-python').forEach(function (code) {
      if (code.getAttribute('data-hl')) return;
      code.setAttribute('data-hl', '1');
      code.innerHTML = highlightPy(code.textContent);
    });
  }

  /* ── Черновики и прогресс ────────────────────────────── */
  function draftOf(key) { return hasPA && key ? window.PA.store.get('drafts', key, null) : null; }

  function saveDraft(key, patch) {
    if (!hasPA || !key) return;
    var prev = draftOf(key) || {};
    window.PA.store.set('drafts', key, Object.assign({}, prev, patch));
  }

  /* Единственная точка «отметить решённым». Разметку не перерисовывает:
     переключает класс и текст — ровно та одна функция, которой хватает
     на всю интерактивность блока. */
  function setBlockSolved(card, id, state) {
    if (!id || !hasPA) return false;
    if (state) window.PA.store.markTask(id, state);
    else window.PA.store.set('tasks', id, null);

    var solved = window.PA.store.isSolved(id);
    if (card) {
      card.classList.toggle((card.classList.contains('quiz') ? 'quiz' : 'task') + '-solved', solved);
      var stateEl = card.querySelector('.task-state');
      if (stateEl) stateEl.textContent = solved ? '✅ решено' : '';
    }
    paintProgress();
    return solved;
  }

  function markTask(sb, solved) {
    var card = sb.closest('.task');
    setBlockSolved(card, sb.getAttribute('data-task-id'), solved ? 'solved' : 'tried');
  }

  /* Решённость приходит из localStorage уже после отрисовки — сервер
     про неё не знает. Проставляем по всем карточкам и квадратикам. */
  function paintProgress() {
    if (!hasPA) return;

    qa('[data-task-id], [data-quiz-id]').forEach(function (card) {
      if (!card.classList.contains('task') && !card.classList.contains('quiz')) return;
      var id = card.getAttribute('data-task-id') || card.getAttribute('data-quiz-id');
      var solved = window.PA.store.isSolved(id);
      card.classList.toggle((card.classList.contains('quiz') ? 'quiz' : 'task') + '-solved', solved);
      var stateEl = card.querySelector('.task-state');
      if (stateEl) stateEl.textContent = solved ? '✅ решено' : '';
    });

    var done = 0, total = 0;
    qa('[data-step-task]').forEach(function (el) {
      total++;
      if (window.PA.store.isSolved(el.getAttribute('data-step-task'))) {
        done++;
        el.classList.add('step-done');
        if (el.classList.contains('step-sq')) el.textContent = '✓';
      }
    });

    var bar = document.querySelector('.progress-bar');
    if (bar && total) {
      bar.querySelector('.pb-fill').style.width = Math.round(done / total * 100) + '%';
      bar.querySelector('.pb-text').textContent = 'Решено ' + done + ' из ' + total;
    }
  }

  /* ── Песочница ───────────────────────────────────────── */
  function sbStatus(sb, text, kind) {
    var el = sb.querySelector('.sb-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sb-status' + (kind ? ' sb-' + kind : '');
  }

  function sbOutput(sb, text, append) {
    var box = sb.querySelector('.sb-output'), body = sb.querySelector('.sb-out-body');
    if (!box || !body) return;
    if (append) body.textContent += text; else body.textContent = text;
    body.classList.remove('sb-out-empty');
    box.classList.toggle('hidden', body.textContent === '');
  }

  function sbOutputEmpty(sb) {
    var box = sb.querySelector('.sb-output'), body = sb.querySelector('.sb-out-body');
    if (!box || !body || body.textContent.trim() !== '') return;
    body.textContent = '(программа завершилась без видимого вывода)';
    body.classList.add('sb-out-empty');
    box.classList.remove('hidden');
  }

  function removePrompt(sb) {
    var prompt = sb.querySelector('.sb-prompt');
    if (prompt) prompt.remove();
  }

  function clearRun(sb) {
    sbOutput(sb, '');
    removePrompt(sb);
    var report = sb.querySelector('.sb-report');
    if (report) { report.classList.add('hidden'); report.innerHTML = ''; }
  }

  /* Синхронного input() в воркере нет, поэтому при нехватке строк ввода
     спрашиваем строку и запускаем программу заново — детерминированный
     код доходит до того же места и идёт дальше. */
  function askInput(sb) {
    var box = sb.querySelector('.sb-output');
    if (!box) return;
    removePrompt(sb);
    box.classList.remove('hidden');
    var form = document.createElement('form');
    form.className = 'sb-prompt';
    form.innerHTML = '<span class="sb-prompt-mark">›</span>' +
      '<input class="sb-prompt-input" type="text" autocomplete="off" spellcheck="false" ' +
      'aria-label="Ввод для input()" placeholder="Программа ждёт ввода — введите строку и нажмите Enter">';
    box.appendChild(form);
    sbStatus(sb, 'Программа ждёт ввода', 'wait');
    form.querySelector('.sb-prompt-input').focus();
  }

  function appendStdinLine(sb, line) {
    var el = sb.querySelector('.sb-stdin-input');
    if (!el) return;
    var text = el.value;
    if (text && text.slice(-1) !== '\n') text += '\n';
    el.value = text + line + '\n';
    var field = sb.querySelector('.sb-stdin');
    if (field) field.classList.remove('hidden');
    saveDraft(sb.getAttribute('data-block-key'), { stdin: el.value });
  }

  function sbBusy(sb, busy) {
    qa('.sb-btn', sb).forEach(function (b) { b.disabled = busy; });
    sb.classList.toggle('running', busy);
  }

  function describeError(err) {
    if (!err) return 'Что-то пошло не так.';
    if (err.kind === 'PA_NO_INPUT') return 'Программа ждёт ввода, но поле «Ввод» пустое (или строк не хватило).';
    if (err.kind === 'PA_NO_ENTRY') return 'Не нашли функцию «' + err.message + '». Проверьте имя — оно должно совпадать буква в букву.';
    var where = err.line ? ' (строка ' + err.line + ')' : '';
    if (err.kind === 'SyntaxError' || err.kind === 'IndentationError' || err.kind === 'TabError') {
      return 'Python не смог разобрать код' + where + ': ' + err.message;
    }
    return err.kind + where + ': ' + err.message;
  }

  function shortValue(v) {
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 120 ? s.slice(0, 120) + '…' : s;
  }

  /* Открытые кейсы показываем целиком, у скрытых — только пояснение */
  function showReport(sb, report) {
    var box = sb.querySelector('.sb-report');
    if (!box || !report) return;
    if (report.output) sbOutput(sb, report.output);

    if (report.fatal) {
      box.className = 'sb-report bad';
      box.innerHTML = '<div class="rp-line rp-fail">' + esc(describeError(report.fatal)) + '</div>';
      box.classList.remove('hidden');
      sbStatus(sb, 'Проверка не запустилась', 'bad');
      markTask(sb, false);
      return;
    }

    var results = report.results || [];
    var failed = results.filter(function (r) { return !r.ok; }).length;
    var rows = '';

    results.forEach(function (item) {
      var kase = item.case || {}, label;
      if (kase.hidden === true) label = 'скрытый тест' + (kase.note ? ': ' + kase.note : '');
      else if (item.label) label = item.label + (kase.expect !== undefined && item.ok ? ' → ' + item.got : '');
      else if (kase.stdin !== undefined && kase.stdin !== '') label = 'ввод: ' + String(kase.stdin).replace(/\n/g, ' ⏎ ');
      else label = kase.note || 'запуск без ввода';

      rows += '<div class="rp-line ' + (item.ok ? 'rp-ok' : 'rp-fail') + '">' +
        (item.ok ? '✅ ' : '❌ ') + esc(label) + '</div>';

      if (!item.ok) {
        var detail = '';
        if (item.error) detail = describeError(item.error);
        else if (kase.expect !== undefined) detail = 'ожидалось ' + shortValue(kase.expect) + ', получено ' + shortValue(item.got);
        else if (item.got) detail = item.got;
        if (detail) rows += '<div class="rp-detail">' + esc(detail) + '</div>';
      }
    });

    box.className = 'sb-report ' + (failed ? 'bad' : 'good');
    box.innerHTML = rows;
    box.classList.remove('hidden');
    sbStatus(sb, failed ? 'Не сошлось: ' + failed : 'Все проверки прошли', failed ? 'bad' : 'good');
    markTask(sb, !failed);
  }

  function runSandbox(sb, mode) {
    if (!hasPA || !window.PA.sandbox.available()) return;
    var editor = sb.querySelector('.pa-editor');
    var stdinEl = sb.querySelector('.sb-stdin-input');
    var check = mode === 'check' ? JSON.parse(sb.getAttribute('data-check') || 'null') : null;

    if (window.PA.sandbox.busy()) { sbStatus(sb, 'Другой запуск ещё не закончился', 'warn'); return; }

    sbBusy(sb, true);
    clearRun(sb);
    sbStatus(sb, window.PA.sandbox.booted ? 'Выполняем…' : 'Готовим Python, ~10 МБ, только в первый раз…', 'wait');

    window.PA.sandbox.send({
      code: window.PA.editor.value(editor),
      stdin: stdinEl ? stdinEl.value : '',
      check: check,
      onReady: function () { sbStatus(sb, 'Выполняем…', 'wait'); },
      onOut: function (stream, text) { sbOutput(sb, text, true); }
    }).then(function (result) {
      sbBusy(sb, false);
      if (result.timeout === 'boot') { sbStatus(sb, 'Не удалось загрузить Python. Проверьте соединение.', 'bad'); return; }
      if (result.timeout === 'run') { sbStatus(sb, 'Программа выполнялась слишком долго. Возможно, цикл не заканчивается.', 'bad'); return; }
      if (result.fatal) { sbStatus(sb, result.fatal, 'bad'); return; }
      if (mode === 'check') { showReport(sb, result.report); return; }

      if (result.ok) { sbOutputEmpty(sb); sbStatus(sb, 'Готово', 'good'); }
      else if (result.error && result.error.kind === 'PA_NO_INPUT') askInput(sb);
      else sbStatus(sb, describeError(result.error), 'bad');
    });
  }

  /* ── Викторина ───────────────────────────────────────── */
  function checkQuiz(quiz) {
    var fieldsets = qa('.quiz-q', quiz), correct = 0;

    fieldsets.forEach(function (fs) {
      var answer = parseInt(fs.getAttribute('data-answer'), 10);
      var picked = fs.querySelector('input[type="radio"]:checked');
      var selected = picked ? parseInt(picked.value, 10) : -1;
      if (selected === answer) correct++;
      qa('.quiz-option', fs).forEach(function (label, oi) {
        label.classList.toggle('quiz-option-correct', oi === answer);
        label.classList.toggle('quiz-option-wrong', oi === selected && oi !== answer);
      });
      fs.classList.add('checked');
    });

    var all = fieldsets.length > 0 && correct === fieldsets.length;
    if (all) setBlockSolved(quiz, quiz.getAttribute('data-quiz-id'), 'solved');
    sbStatus(quiz, all ? 'Все ответы верны' : 'Верно ' + correct + ' из ' + fieldsets.length, all ? 'good' : 'bad');
  }

  function resetQuiz(quiz) {
    setBlockSolved(quiz, quiz.getAttribute('data-quiz-id'), null);
    qa('input[type="radio"]', quiz).forEach(function (i) { i.checked = false; });
    qa('.quiz-q', quiz).forEach(function (fs) {
      fs.classList.remove('checked');
      qa('.quiz-option', fs).forEach(function (l) { l.classList.remove('quiz-option-correct', 'quiz-option-wrong'); });
    });
    sbStatus(quiz, '');
  }

  /* ── События: таблица маршрутов вместо цепочки if ─────── */
  var ROUTES = [
    ['.sb-run',         function (el) { runSandbox(el.closest('.sandbox'), 'run'); }],
    ['.sb-check',       function (el) { runSandbox(el.closest('.sandbox'), 'check'); }],
    ['.sb-reset',       function (el) {
      var sb = el.closest('.sandbox');
      window.PA.editor.setValue(sb.querySelector('.pa-editor'), sb.getAttribute('data-start') || '');
      var stdinEl = sb.querySelector('.sb-stdin-input');
      if (stdinEl) stdinEl.value = sb.getAttribute('data-stdin') || '';
      clearRun(sb);
      sbStatus(sb, '');
      if (hasPA) window.PA.store.set('drafts', sb.getAttribute('data-block-key'), null);
    }],
    ['.quiz-check',     function (el) { checkQuiz(el.closest('.quiz')); }],
    ['.quiz-retry',     function (el) { resetQuiz(el.closest('.quiz')); }],
    ['.task-done',      function (el) {
      var card = el.closest('.task');
      var solved = setBlockSolved(card, card.getAttribute('data-task-id'),
                                  card.classList.contains('task-solved') ? null : 'solved');
      el.setAttribute('aria-pressed', solved ? 'true' : 'false');
      el.textContent = solved ? '✓ Выполнено' : 'Отметить выполненным';
    }],
    ['.solution-toggle', function (el) {
      var open = el.getAttribute('aria-expanded') === 'true';
      el.setAttribute('aria-expanded', open ? 'false' : 'true');
      el.closest('.solution').classList.toggle('open', !open);
      el.textContent = open ? 'Показать разбор' : 'Скрыть разбор';
    }],
    ['.code-copy',      function (el) {
      var code = el.closest('.code-block').querySelector('code');
      navigator.clipboard.writeText(code.textContent).then(function () {
        el.textContent = 'Скопировано';
        setTimeout(function () { el.textContent = 'Копировать'; }, 1500);
      });
    }],
    ['#rail-toggle',    function (el) {
      var open = document.body.classList.toggle('rail-open');
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
    }],
    ['#rail-scrim',     function () { document.body.classList.remove('rail-open'); }]
  ];

  document.addEventListener('click', function (e) {
    for (var i = 0; i < ROUTES.length; i++) {
      var el = e.target.closest(ROUTES[i][0]);
      if (el) { ROUTES[i][1](el); return; }
    }
  });

  /* Ответ на input(): дописать строку ко «Вводу» и запустить заново */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('.sb-prompt');
    if (!form) return;
    e.preventDefault();
    var sb = form.closest('.sandbox');
    appendStdinLine(sb, form.querySelector('.sb-prompt-input').value);
    removePrompt(sb);
    runSandbox(sb, 'run');
  });

  /* Редактор: подсветка, автоотступ и запись черновика */
  document.addEventListener('input', function (e) {
    var input = e.target.closest('.ed-input');
    if (input) {
      var root = input.closest('.pa-editor');
      window.PA.editor.sync(root);
      saveDraft(input.closest('.sandbox').getAttribute('data-block-key'), { code: input.value });
      return;
    }
    var stdin = e.target.closest('.sb-stdin-input');
    if (stdin) saveDraft(stdin.closest('.sandbox').getAttribute('data-block-key'), { stdin: stdin.value });
  });

  document.addEventListener('keydown', function (e) {
    var input = e.target.closest('.ed-input');
    if (input) window.PA.editor.onKeyDown(e, input.closest('.pa-editor'));
  });

  document.addEventListener('scroll', function (e) {
    var view = e.target.closest && e.target.closest('.ed-input');
    if (view) window.PA.editor.scrolled(view.closest('.pa-editor'));
  }, true);

  /* ── Запуск ──────────────────────────────────────────── */
  function restoreDrafts() {
    qa('.sandbox').forEach(function (sb) {
      var draft = draftOf(sb.getAttribute('data-block-key'));
      if (!draft) return;
      if (draft.code) window.PA.editor.setValue(sb.querySelector('.pa-editor'), draft.code);
      var stdinEl = sb.querySelector('.sb-stdin-input');
      if (stdinEl && draft.stdin) {
        stdinEl.value = draft.stdin;
        sb.querySelector('.sb-stdin').classList.remove('hidden');
      }
    });
  }

  highlightStatic();
  if (hasPA) {
    qa('.pa-editor').forEach(function (root) { window.PA.editor.sync(root); });
    restoreDrafts();
    paintProgress();
    window.PA.sandbox.warmup();
  }
})();
