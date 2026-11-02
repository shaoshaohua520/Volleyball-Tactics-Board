/* 排球战术台 · 比赛计分（独立页面，零依赖，纯前端）
   规则：每球得分制；接发球方赢球 → 得分 + 换发球；本方拿回发球权时轮转一位。
   比分存在 localStorage，刷新/切页不丢。 */
(function () {
  'use strict';

  var KEY = 'vb_match_v1';
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var M = {
    a: 0, b: 0,          // 本局比分
    setsA: 0, setsB: 0,  // 局分
    setNo: 1,
    serve: 'a',          // 谁发球
    bestOf: 5,           // 5 = 五局三胜，3 = 三局两胜
    over: false,
    log: [],             // [{set,a,b,w}]
    hist: [],            // 撤销快照
    round: 1             // 我方当前轮次（1-6），用于提示
  };

  /* ---------- 持久化 ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        a: M.a, b: M.b, setsA: M.setsA, setsB: M.setsB, setNo: M.setNo,
        serve: M.serve, bestOf: M.bestOf, over: M.over, log: M.log,
        round: M.round, nameA: nameOf('a'), nameB: nameOf('b')
      }));
    } catch (e) { /* 隐私模式下 localStorage 可能不可用，忽略 */ }
  }
  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return; }
    ['a', 'b', 'setsA', 'setsB', 'setNo', 'bestOf', 'round'].forEach(function (k) {
      if (typeof o[k] === 'number' && isFinite(o[k])) M[k] = o[k];
    });
    if (o.serve === 'a' || o.serve === 'b') M.serve = o.serve;
    M.over = !!o.over;
    M.log = Array.isArray(o.log) ? o.log : [];
    if ($('#scNameA') && o.nameA) $('#scNameA').value = o.nameA;
    if ($('#scNameB') && o.nameB) $('#scNameB').value = o.nameB;
    if ($('#scBestOf')) $('#scBestOf').value = String(M.bestOf);
  }

  /* ---------- 规则 ---------- */
  function nameOf(side) {
    var el = $(side === 'a' ? '#scNameA' : '#scNameB');
    var v = el && el.value ? el.value.trim() : '';
    return v || (side === 'a' ? '我方' : '对手');
  }
  function isDeciding() {
    return (M.bestOf === 5 && M.setNo === 5) || (M.bestOf === 3 && M.setNo === 3);
  }
  function target() { return isDeciding() ? 15 : 25; }
  function setsToWin() { return M.bestOf === 5 ? 3 : 2; }

  /* ---------- 撤销 ---------- */
  function snap() {
    return JSON.stringify({
      a: M.a, b: M.b, setsA: M.setsA, setsB: M.setsB, setNo: M.setNo,
      serve: M.serve, over: M.over, log: M.log, round: M.round
    });
  }
  function restore(s) {
    var o = JSON.parse(s);
    M.a = o.a; M.b = o.b; M.setsA = o.setsA; M.setsB = o.setsB;
    M.setNo = o.setNo; M.serve = o.serve; M.over = o.over; M.log = o.log; M.round = o.round;
  }
  function push() { M.hist.push(snap()); if (M.hist.length > 100) M.hist.shift(); }

  /* ---------- 操作 ---------- */
  function pointTo(side) {
    if (M.over) return;
    push();
    var other = side === 'a' ? 'b' : 'a';
    M[side] += 1;

    // 接发球方赢球 → 换发球；我方拿回发球权时轮转一位
    if (side !== M.serve) {
      M.serve = side;
      var auto = $('#scAutoRotate');
      if (side === 'a' && auto && auto.checked) {
        M.round = M.round === 6 ? 1 : M.round + 1;
      }
    }

    if (M[side] >= target() && M[side] - M[other] >= 2) endSet(side);
    render();
  }

  function endSet(winner) {
    M.log.push({ set: M.setNo, a: M.a, b: M.b, w: winner });
    if (winner === 'a') M.setsA += 1; else M.setsB += 1;
    M.a = 0;
    M.b = 0;
    M.serve = winner;
    if (M.setsA >= setsToWin() || M.setsB >= setsToWin()) M.over = true;
    else M.setNo += 1;
  }

  function resetAll() {
    M.a = 0; M.b = 0; M.setsA = 0; M.setsB = 0;
    M.setNo = 1; M.serve = 'a'; M.over = false;
    M.log = []; M.hist = []; M.round = 1;
    render();
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var tgt = target();
    $('#scA').textContent = M.a;
    $('#scB').textContent = M.b;
    $('#scSetsA').textContent = M.setsA;
    $('#scSetsB').textContent = M.setsB;

    var deciding = isDeciding() && !M.over;
    $('#scSetNo').textContent = M.over ? '比赛结束' : ('第 ' + M.setNo + ' 局' + (deciding ? '（决胜局）' : ''));
    $('#scTarget').textContent = M.over ? '' : tgt + ' 分制 · 需领先 2 分';

    var live = !M.over;
    $('#scServeA').classList.toggle('on', live && M.serve === 'a');
    $('#scServeB').classList.toggle('on', live && M.serve === 'b');
    $('#scTeamA').classList.toggle('serving', live && M.serve === 'a');
    $('#scTeamB').classList.toggle('serving', live && M.serve === 'b');
    $('#scBtnA').disabled = M.over;
    $('#scBtnB').disabled = M.over;

    $('#scRound').textContent = '第 ' + M.round + ' 轮';
    $('#scRotNote').textContent = M.serve === 'a'
      ? '我方发球 · 这一轮按标准站位站好，发球后进接发球阵型'
      : '对方发球 · 我方接发球，接起来之后二传插上组织';

    $('#scLog').innerHTML = M.log.map(function (m) {
      return '<span class="sl">第' + m.set + '局 ' + m.a + ':' + m.b + ' <b>' +
        esc(m.w === 'a' ? nameOf('a') : nameOf('b')) + '</b> 胜</span>';
    }).join('');

    var msg = '', cls = '';
    if (M.over) {
      var winA = M.setsA > M.setsB;
      msg = '比赛结束：' + esc(winA ? nameOf('a') : nameOf('b')) + ' 以 ' +
        Math.max(M.setsA, M.setsB) + ':' + Math.min(M.setsA, M.setsB) + ' 获胜';
      if (!winA) msg += '　（补短板再点“重置全场”重来）';
      cls = winA ? 'good' : 'bad';
    } else {
      var sp = null;
      ['a', 'b'].forEach(function (s) {
        if (sp) return;
        var o = s === 'a' ? 'b' : 'a';
        if (M[s] + 1 >= tgt && M[s] + 1 - M[o] >= 2) sp = s;
      });
      if (sp) {
        var wouldWin = (sp === 'a' ? M.setsA + 1 : M.setsB + 1) >= setsToWin();
        msg = (wouldWin ? '赛点：' : '局点：') + esc(nameOf(sp)) + ' 再拿 1 分就' + (wouldWin ? '赢下比赛' : '拿下这一局');
        cls = 'hot';
      } else {
        var gap = Math.abs(M.a - M.b);
        msg = '发球方：' + esc(nameOf(M.serve)) + '　·　' + (gap >= 5 ? '分差 ' + gap + ' 分，落后一方该喊暂停了' : '接发球方赢下这一球就换发球并轮转');
      }
    }
    var mEl = $('#scMsg');
    mEl.className = 'sc-msg ' + cls;
    mEl.innerHTML = msg;
    save();
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $('#scBtnA').addEventListener('click', function () { pointTo('a'); });
    $('#scBtnB').addEventListener('click', function () { pointTo('b'); });
    $('#scUndo').addEventListener('click', function () {
      if (!M.hist.length) return;
      restore(M.hist.pop());
      render();
    });
    $('#scResetSet').addEventListener('click', function () {
      push(); M.a = 0; M.b = 0; render();
    });
    $('#scResetAll').addEventListener('click', function () { resetAll(); });
    $('#scBestOf').addEventListener('change', function (e) {
      M.bestOf = +e.target.value === 3 ? 3 : 5;
      resetAll();
    });
    ['#scNameA', '#scNameB'].forEach(function (s) {
      var el = $(s);
      if (el) el.addEventListener('input', render);
    });
    $('#scAutoRotate').addEventListener('change', save);

    // 键盘：A / 1 给我方加分，B / 2 给对手加分，U 撤销（在输入框里不拦）
    document.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var k = (e.key || '').toLowerCase();
      if (k === 'a' || k === '1') pointTo('a');
      else if (k === 'b' || k === '2') pointTo('b');
      else if (k === 'u') $('#scUndo').click();
    });

    // 手机上点了加分按钮不要跳回顶部
    document.querySelectorAll('.sc-btn').forEach(function (b) {
      b.addEventListener('touchstart', function () {}, { passive: true });
    });
  }

  load();
  bind();
  render();
  window.__vbScore = { pointTo: pointTo, reset: resetAll, get: function () { return M; } };
})();