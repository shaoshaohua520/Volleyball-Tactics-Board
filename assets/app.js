/* 排球战术台 app.js — 零依赖
 * 功能：5-1 六轮站位可视化 / 二传插上 / 球队录入 / 阵型与打法推荐 / 世界数据对比
 */
(function () {
  'use strict';

  /* ---------------- 基础数据 ---------------- */

  // 站位坐标（百分比，y=8 靠网，y=92 底线）
  var SLOT_POS = {
    1: { x: 82, y: 72 },
    2: { x: 82, y: 20 },
    3: { x: 50, y: 18 },
    4: { x: 18, y: 20 },
    5: { x: 18, y: 72 },
    6: { x: 50, y: 74 }
  };

  // 轮转规则：顺时针 1→6→5→4→3→2→1，即每轮所有人号位减 1。
  // 具体映射由 slotOf(i, r) 计算（见下方），二传（第 1 个人）从 state.startSlot 号位开始。

  var POS_NAME = { 1: '右后', 2: '右前', 3: '中前', 4: '左前', 5: '左后', 6: '中后' };
  var FRONT = { 2: 1, 3: 1, 4: 1 };
  var ROLE_CLASS = { '二传': 'c-setter', '主攻': 'c-outside', '副攻': 'c-middle', '接应': 'c-opposite', '自由人': 'c-libero' };
  var ROLE_COLOR = { '二传': 'var(--setter)', '主攻': 'var(--outside)', '副攻': 'var(--middle)', '接应': 'var(--opposite)', '自由人': 'var(--libero)' };
  var ROLE_ORDER = ['二传', '主攻', '副攻', '接应', '自由人'];

  var state = {
    round: 1,
    startSlot: 6,   // 二传在第 1 轮站在几号位
    showArrow: true,
    showThreat: true,
    shift: false,  // false=发球前的标准站位；true=接发球时的实际站位（“变化”）
    players: [],   // 球场演示上的 6 人
    roster: [],    // 录入的 6 人（球场就是以它为准，改了体重跑位跟着变）
    world: null,
    worldGender: 'W',
    worldAll: false,   // 世界数据默认只显示前几支，点“展开全部”再全显示
    // 队伍特征（用来推荐打法与战术）：1=弱/差，2=一般，3=强/好
    team: { recv: 2, sett: 2, hit: 2 }
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function num(v) { var n = parseFloat(v); return isNaN(n) ? NaN : n; }
  function fmt(v, d) { return isNaN(v) ? '—' : (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toFixed(d || 0); }
  function avg(arr) { var a = arr.filter(function (x) { return !isNaN(x) && x > 0; }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : NaN; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------- 轮转核心 ---------------- */

  // 把任意整数折回 1..6
  function wrap6(n) { return ((n - 1) % 6 + 6) % 6 + 1; }

  // 第 r 轮、第 i 个球员（0 开始，i=0 是二传）所在号位。
  // 轮转是顺时针 1→6→5→4→3→2→1，也就是号位每轮 -1。
  function slotOf(i, r) { return wrap6(state.startSlot - i - (r - 1)); }

  // 谁是二传：按位置找，找不到就用第 1 个人
  function setterIndex(list) {
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].pos === '二传') return i; }
    return 0;
  }

  /* ---------------- 接发球站位（“变化”）----------------
   * 发球前必须按号位站（否则越位），发球一出手全队就换成接发球阵：
   * 前排压到网前、后排拉开成半圆接一传、二传（在后排时）直接插到 2-3 号位之间的网前。
   * 这里按“位置职责”给一套简化阵型，不按轮次硬编码，所以换二传起始号位也能用。
   */
  var RECEIVE_TARGET = { x: 63, y: 26 };   // 二传插上目标：2、3 号位之间的网前

  /* ---------------- 体重 / BMI / 机动性 ----------------
   * BMI = 体重(kg) ÷ 身高(m)²，按中国成人标准分档（运动员肌肉多会偏高，只作跑动参考）。
   * 机动性 0~1 用来缩放跑位：越"重"跑动越省——站位往中间收、插上距离缩短。
   */
  var BMI_BANDS = [
    { max: 18.5, name: '轻', mob: 1.00, color: '#38bdf8' },
    { max: 24, name: '均衡', mob: 0.85, color: '#22c55e' },
    { max: 28, name: '微胖', mob: 0.62, color: '#f59e0b' },
    { max: 999, name: '胖', mob: 0.42, color: '#ef4444' }
  ];
  var MOB_DEFAULT = 0.85;   // 没填体重时按"均衡"算

  function bmiOf(h, w) {
    h = num(h); w = num(w);
    if (isNaN(h) || isNaN(w) || h < 100 || w <= 0) return NaN;
    var m = h / 100;
    return w / (m * m);
  }
  function bmiBand(bmi) {
    if (isNaN(bmi)) return null;
    for (var i = 0; i < BMI_BANDS.length; i++) { if (bmi < BMI_BANDS[i].max) return BMI_BANDS[i]; }
    return BMI_BANDS[BMI_BANDS.length - 1];
  }
  // 一个球员的体重档位与机动性
  function bodyInfo(p) {
    var bmi = bmiOf(p && p.height, p && p.weight);
    var band = bmiBand(bmi);
    return {
      bmi: bmi,
      band: band ? band.name : '',
      color: band ? band.color : 'var(--muted)',
      mob: band ? band.mob : MOB_DEFAULT,
      known: !!band
    };
  }
  function mobilityOf(p) { return bodyInfo(p).mob; }

  /* 一传阵型的“半边”划分：按号位判断这个人本来归哪一片区 */
  function sideOf(slot) {
    if (slot === 4 || slot === 5) return 'left';
    if (slot === 1 || slot === 2) return 'right';
    return 'mid';
  }
  function sideX(side) { return side === 'left' ? 14 : (side === 'right' ? 86 : 50); }
  var SIDE_NAME = { left: '左后', mid: '中后', right: '右后' };

  /* 谁接一传：自由人 → 后排副攻（没有自由人时）→ 主攻 → 接应（还缺人时）。
     最多 3 个人，和真实业余队的三人接发球一致。 */
  function pickPassers(roster, r) {
    var hasLibero = roster.filter(function (p) { return p.pos === '自由人'; }).length > 0;
    var list = [];
    function add(i, why, rank) {
      if (list.length >= 3) return;
      if (list.some(function (x) { return x.i === i; })) return;
      list.push({ i: i, why: why, rank: rank });
    }
    roster.forEach(function (p, i) { if (p.pos === '自由人') add(i, '自由人', 0); });
    if (!hasLibero) {
      roster.forEach(function (p, i) { if (p.pos === '副攻' && FRONT[slotOf(i, r)] !== 1) add(i, '后排副攻', 1); });
    }
    roster.forEach(function (p, i) { if (p.pos === '主攻') add(i, '主攻', 2); });
    roster.forEach(function (p, i) { if (p.pos === '接应' && FRONT[slotOf(i, r)] !== 1) add(i, '接应', 3); });
    return list;
  }

  /* 接发球阵型：三个一传手拉成半圆，左 / 中 / 右各占一片，保证不留空档、不叠人；
     不接一传的人（二传插上、前排副攻/接应）留在网口准备进攻。 */
  function receiveLayout(roster, r) {
    var out = {};
    var used = { left: false, mid: false, right: false };
    var SIDES = ['mid', 'left', 'right'];
    var passers = pickPassers(roster, r).map(function (ps) {
      var slot = slotOf(ps.i, r);
      return { i: ps.i, why: ps.why, slot: slot, front: FRONT[slot] === 1, want: sideOf(slot), take: null };
    });

    // 后排的人先挑：中后场本来就该由自由人 / 后排副攻守
    var line = passers.filter(function (p) { return !p.front; })
      .concat(passers.filter(function (p) { return p.front; }));
    line.forEach(function (p) {
      var take = p.want;
      if (used[take]) {
        // 这片已经有人了：挑离自己最近、且还没人守的那一片
        var alts = SIDES.filter(function (s) { return !used[s]; });
        alts.sort(function (a, b) { return Math.abs(sideX(a) - sideX(p.want)) - Math.abs(sideX(b) - sideX(p.want)); });
        take = alts[0];
      }
      if (!take) return;
      used[take] = true;
      p.take = take;
    });

    // 中后场被前排的人占了、而后排的人被挤到边线？换过来——中后场交给后排
    line.forEach(function (p) {
      if (p.take !== 'mid' || !p.front) return;
      var backOnSide = line.filter(function (q) { return !q.front && q.take && q.take !== 'mid'; })[0];
      if (!backOnSide) return;
      var side = backOnSide.take;
      p.take = side;
      backOnSide.take = 'mid';
    });

    line.forEach(function (p) {
      if (!p.take) return;
      var pl = roster[p.i];
      var m = mobilityOf(pl);
      var baseY = p.take === 'mid' ? (p.front ? 46 : 74) : (p.front ? 44 : 66);
      // 体重档位影响覆盖范围：越重越难拉开到边线，站位往中间收
      var spread = 0.72 + 0.28 * m;
      var x = 50 + (sideX(p.take) - 50) * spread;
      var y = 50 + (baseY - 50) * (p.front ? 1 : (0.92 + 0.08 * m));
      out[p.i] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, passer: true, side: p.take, why: p.why };
    });

    roster.forEach(function (p, i) {
      if (out[i]) return;
      var slot = slotOf(i, r);
      var m = mobilityOf(p);
      if (p.pos === '二传') {
        // 插上目标随体重变：越重越靠中间，跑动距离越短
        if (FRONT[slot] === 1) out[i] = { x: Math.round((56 + 6 * m) * 10) / 10, y: 22 };
        else out[i] = { x: Math.round((50 + 13 * Math.pow(m, 1.6)) * 10) / 10, y: Math.round((23 + 3.2 * m) * 10) / 10 };
        return;
      }
      var side = sideOf(slot);
      if (FRONT[slot] === 1) {
        // 前排不接一传的人：留在网口等进攻。接应要往 2 号位方向让开，别和二传挤在一起
        var fx;
        if (p.pos === '接应') fx = 72;
        else if (p.pos === '副攻' && slot === 3) fx = 50;
        else fx = sideX(side) < 50 ? sideX(side) + 5 : (sideX(side) > 50 ? sideX(side) - 5 : 50);
        out[i] = { x: Math.round(fx * 10) / 10, y: 17 };
      } else {
        // 后排不接一传的人：站到三米线附近等后排进攻，别堵在一传手身后
        var bx = side === 'mid' ? 62 : (sideX(side) < 50 ? 16 : 84);
        out[i] = { x: bx, y: 56 };
      }
    });
    return out;
  }

  /* ---------------- 球场演示 ---------------- */

  function renderCourt() {
    var markers = $('#markers');
    // 复用 6 个 marker 节点（节点身份绑“人”），换轮次/切接发球时才有 CSS 过渡的滑动效果
    while (markers.children.length > 6) markers.removeChild(markers.lastChild);
    // 二传当前在哪个号位（每个球员的号位都由 slotOf 计算）
    var setterSlotNow = slotOf(setterIndex(state.roster), state.round);
    $('#courtBoard').classList.toggle('shift', state.shift);
    // 接发球阵型整体算一次（要保证六个人不重叠、后排不留空档）
    var layout = state.shift ? receiveLayout(state.roster, state.round) : null;

    state.roster.forEach(function (pl, i) {
      var slot = slotOf(i, state.round);
      var base = (layout && layout[i]) || SLOT_POS[slot];
      var x = pl.x != null ? pl.x : base.x;
      var y = pl.y != null ? pl.y : base.y;

      var el = markers.children[i];
      var isNew = !el;
      if (isNew) {
        el = document.createElement('div');
        el.style.transition = 'none'; // 首帧不要从左上角滑进来
        el.addEventListener('pointerdown', onDragStart);
        var idx = i;
        el.addEventListener('dblclick', function () {
          if (state.roster[idx]) openDialog(state.roster[idx]);
        });
        markers.appendChild(el);
      }

      var threat = state.showThreat && isThreat(pl, slot);
      el.className = 'marker role-' + pl.pos + (threat ? ' threat' : '');
      el.dataset.id = pl.id;
      el.style.left = x + '%';
      el.style.top = y + '%';

      var badge = '';
      if (threat) badge = '<span class="badge">强点</span>';
      if (pl.pos === '二传') badge += '<span class="badge" style="right:auto;left:-14px;background:var(--setter);color:#3b2606">二传</span>';
      if (layout && layout[i] && layout[i].passer) badge += '<span class="badge pass">一传</span>';

      var bd = bodyInfo(pl);
      var mobTxt = bd.known ? '　BMI ' + fmt(bd.bmi, 1) + '（' + bd.band + '，机动性 ' + Math.round(bd.mob * 100) + '%）' : '';
      var roleTxt = (layout && layout[i] && layout[i].passer) ? '　本轮负责' + SIDE_NAME[layout[i].side] + '一传（' + layout[i].why + '）' : '';
      el.title = '起始 P' + (i + 1) + '：' + (pl.name || pl.pos) + '　当前 ' + slot + ' 号位（' + POS_NAME[slot] + '）' + mobTxt + roleTxt;

      el.innerHTML =
        badge +
        '<div class="avatar" style="background:' + ROLE_COLOR[pl.pos] + '">' + (pl.name ? pl.name.charAt(0) : pl.pos.charAt(0)) + '</div>' +
        '<div class="tag">P' + slot + ' · ' + esc(pl.name || pl.pos) +
        (bd.known && bd.band !== '均衡' ? '　<b style="color:' + bd.color + '">' + bd.band + '</b>' : '') + '</div>';

      if (isNew) { void el.offsetWidth; el.style.transition = ''; }
    });

    drawArrows(setterSlotNow, layout);

    var sum = state.roster.map(function (p, i) { return 'P' + slotOf(i, state.round) + ':' + p.pos; }).join('　');
    var setterFront = !!FRONT[setterSlotNow];
    var info = '<div><b>第 ' + state.round + ' 轮</b>　' +
      (state.shift ? '<span class="warn">接发球站位</span>（球发出来之后）' : '起始站位（发球前）') +
      '：' + esc(sum) + '</div>';
    info += '<div>二传当前在 <b>' + setterSlotNow + ' 号位（' + POS_NAME[setterSlotNow] + '）</b>　' +
      (setterFront
        ? '<span class="good">前排</span>，可直接在网前组织，不需要插上。'
        : '<span class="warn">后排</span>，发球后必须从 ' + setterSlotNow + ' 号位插上到 2-3 号位之间。') + '</div>';

    // 反轮：接应轮到 4 号位（和二传同一轮在前排 4 号位）
    var oppSlot = 0;
    state.roster.forEach(function (p, i) { if (p.pos === '接应' && !oppSlot) oppSlot = slotOf(i, state.round); });
    if (oppSlot === 4) {
      info += '<div><span class="warn">反轮</span>：接应轮到 4 号位，跟二传同一侧的前排，这一轮最难组织。要么接应后撤去接一传、二传传到 2 号位给主攻，要么发球后跟二传交换位置再进攻。</div>';
    }

    // 后排副攻在实际比赛里由自由人替换
    var backMid = 0;
    state.roster.forEach(function (p, i) {
      var s = slotOf(i, state.round);
      if (p.pos === '副攻' && !FRONT[s] && !backMid) backMid = s;
    });
    if (backMid) {
      info += '<div>' + backMid + ' 号位的副攻是后排，实际比赛里这个位置由自由人替换下场，前排三人中不会有自由人。</div>';
    }

    if (state.shift) {
      var recvList = [];
      state.roster.forEach(function (p, i) {
        var L = layout && layout[i];
        if (L && L.passer) recvList.push('<b>' + esc(p.name || p.pos) + '</b>（' + SIDE_NAME[L.side] + '，' + L.why + '）');
      });
      info += '<div><b>本轮一传</b>：' + (recvList.length ? recvList.join('　·　') : '没有能接一传的人，检查一下位置填写') + '</div>';
      var hasLibero = state.roster.filter(function (p) { return p.pos === '自由人'; }).length > 0;
      if (!hasLibero) {
        info += '<div>还没填自由人：中后场只能由后排副攻顶着，真实比赛这一轮该换自由人上来接一传。</div>';
      } else if (state.roster.some(function (p, i) { return p.pos === '自由人' && FRONT[slotOf(i, state.round)] === 1; })) {
        info += '<div class="warn">自由人不能在前排：检查一下自由人的起始号位，它的号位应该落在 1 / 5 / 6。</div>';
      }
      info += '<div style="margin-top:6px">接发球时还站在“号位”上就是越位，所以发球一出手全队就换成这张图：三个一传手拉成半圆，<b>左后 / 中后 / 右后各守一片</b>，二传直接站到网前 2-3 号位之间等球。（严格的越位判定只看发球出手那一刻；这张图画的是发球后一瞬间，保证后排不留空档、不叠人）</div>';
      var sHere = state.roster[setterIndex(state.roster)];
      var sBody = bodyInfo(sHere);
      if (sBody.known && sBody.band !== '均衡' && sBody.band !== '轻') {
        info += '<div><span class="warn">按体重调整了跑位</span>：' + esc(sHere.name || '二传') + ' 是「' + sBody.band + '」档（BMI ' + fmt(sBody.bmi, 1) +
          '，机动性 ' + Math.round(sBody.mob * 100) + '%），插上目标已经从 2-3 号位之间往中间收，跑动距离缩短；横向补位改由自由人和后排主攻分担。</div>';
      }
    } else {
      info += '<div style="margin-top:6px">点左边的<b>「变化：接发球站位」</b>看发球后队形怎么变；键盘 ←→ 切轮次；点球员拖动、双击可以改名字和位置。</div>';
    }
    info += '<div style="margin-top:6px;font-size:12.5px">轮转方向：顺时针。每赢下一个对方发球的回合得 1 分并轮转一次；本方发球得分不轮转。</div>';
    $('#roundInfo').innerHTML = info;
    $('#roundBadge').textContent = '第 ' + state.round + ' 轮';
  }

  function isThreat(pl, slot) {
    // 前排的非自由人都是可用的进攻点
    return FRONT[slot] === 1 && pl.pos !== '自由人';
  }

  function drawArrows(setterSlotNow, layout) {
    var svg = $('#arrows');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML =
      '<defs><marker id="arrowhead" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">' +
      '<path d="M0,0 L5,2.5 L0,5 z" fill="#f97316"/></marker>' +
      '<marker id="arrowhead2" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">' +
      '<path d="M0,0 L5,2.5 L0,5 z" fill="#38bdf8"/></marker></defs>';
    if (!state.showArrow) return;
    var sIdx = setterIndex(state.roster);
    var setterSlot = setterSlotNow;
    var from = SLOT_POS[setterSlot];
    // 接发球视角下，箭头要指向这个人“实际站到”的位置（含按体重收窄后的落点）
    var to = (layout && layout[sIdx]) ? { x: layout[sIdx].x, y: layout[sIdx].y } : RECEIVE_TARGET;
    if (FRONT[setterSlot]) {
      to = (layout && layout[sIdx]) ? to : { x: setterSlot === 4 ? 30 : 60, y: 20 };
      svg.insertAdjacentHTML('beforeend', line(from, to, '#38bdf8', '4 3', 'arrowhead2'));
    } else {
      // 后排插上：走弧线从外侧绕，不横穿前排的队友
      var ctrl = { x: from.x < 50 ? from.x - 12 : from.x + 12, y: Math.round((from.y + to.y) / 2) };
      svg.insertAdjacentHTML('beforeend', curve(from, ctrl, to, '#f97316', state.shift ? '1.5 1.5' : '0', 'arrowhead'));
      var mx = from.x + (from.x < to.x ? 6 : -6);
      svg.insertAdjacentHTML('beforeend',
        '<text x="' + mx + '" y="' + (from.y - 5) + '" fill="#f97316" font-size="4.2" text-anchor="middle" font-weight="700">插上</text>');
      if (state.shift) {
        svg.insertAdjacentHTML('beforeend',
          '<circle cx="' + to.x + '" cy="' + to.y + '" r="2.4" fill="none" stroke="#f97316" stroke-width="0.6" stroke-dasharray="1.2 1.2"/>');
      }
    }
  }

  function curve(a, c, b, color, dash, marker) {
    return '<path d="M' + a.x + ',' + a.y + ' Q' + c.x + ',' + c.y + ' ' + b.x + ',' + b.y + '" fill="none" stroke="' + color +
      '" stroke-width="0.9" stroke-dasharray="' + (dash || '0') + '" stroke-linecap="round" marker-end="url(#' + (marker || 'arrowhead') + ')"/>';
  }

  function line(a, b, color, dash, marker) {
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + color +
      '" stroke-width="0.9" stroke-dasharray="' + (dash || '0') + '" stroke-linecap="round" marker-end="url(#' + (marker || 'arrowhead') + ')"/>';
  }

  /* 拖动（纯视觉移动，不改变号码位） */
  var drag = null;
  function onDragStart(e) {
    var el = e.currentTarget;
    var pl = state.roster.filter(function (p) { return p.id === el.dataset.id; })[0];
    if (!pl) return;
    var rect = $('#courtBoard').getBoundingClientRect();
    drag = { pl: pl, el: el, rect: rect };
    el.classList.add('dragging');
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!drag) return;
    var x = clamp((e.clientX - drag.rect.left) / drag.rect.width * 100, 4, 96);
    var y = clamp((e.clientY - drag.rect.top) / drag.rect.height * 100, 6, 94);
    drag.pl.x = x; drag.pl.y = y;
    drag.el.style.left = x + '%';
    drag.el.style.top = y + '%';
  }
  function onDragEnd() {
    if (!drag) return;
    // 松手后回到标准站位，避免拖动造成"位置永久错乱"
    delete drag.pl.x; delete drag.pl.y;
    drag = null;
    renderCourt();
  }
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);

  /* 改名/改位置对话框 */
  var dlgEditing = null;
  function openDialog(pl) {
    dlgEditing = pl;
    $('#dlgName').value = pl.name || '';
    $('#dlgPos').value = pl.pos;
    var d = $('#posDialog');
    if (d.showModal) d.showModal(); else alert('请用现代浏览器打开');
  }
  function bindDialog() {
    var d = $('#posDialog');
    d.addEventListener('close', function () {
      if (d.returnValue === 'ok' && dlgEditing) {
        dlgEditing.name = $('#dlgName').value.trim();
        dlgEditing.pos = $('#dlgPos').value;
        renderCards();
        renderCourt();
      }
      dlgEditing = null;
    });
  }

  /* ---------------- 球队录入 ---------------- */

  var uid = 0;
  function initRoster() {
    uid = 0;
    state.roster = [
      mk('', '二传', '', '', '', '右', ''),
      mk('', '主攻', '', '', '', '右', ''),
      mk('', '副攻', '', '', '', '右', ''),
      mk('', '接应', '', '', '', '右', ''),
      mk('', '主攻', '', '', '', '右', ''),
      mk('', '副攻', '', '', '', '右', '')
    ];
    renderCards();
  }
  function mk(name, pos, h, spike, block, hand, weight) {
    uid++;
    return { id: 'r' + uid, name: name, pos: pos, height: h, spike: spike, block: block, hand: hand || '右', weight: weight == null ? '' : weight };
  }

  function renderCards() {
    var wrap = $('#playerCards');
    wrap.innerHTML = '';
    state.roster.forEach(function (p, i) {
      var d = document.createElement('div');
      d.className = 'pcard';
      d.innerHTML =
        '<div class="pc-head"><div class="idx">' + (i + 1) + '</div>' +
        '<input class="pc-name" data-i="' + i + '" data-k="name" type="text" maxlength="12" placeholder="球员 ' + (i + 1) + ' 姓名（可空）" value="' + esc(p.name) + '">' +
        '<span class="bmi-tag" id="bmi-' + i + '"></span></div>' +
        '<div class="pgrid">' +
        field(i, 'pos', '位置', p.pos, true) +
        field(i, 'height', '身高 cm', p.height) +
        field(i, 'weight', '体重 kg', p.weight) +
        field(i, 'spike', '扣球高度 cm', p.spike) +
        field(i, 'block', '拦网高度 cm', p.block) +
        field(i, 'hand', '惯用手', p.hand, false, ['右', '左']) +
        '</div>';
      wrap.appendChild(d);
    });
    $$('#playerCards input, #playerCards select').forEach(function (el) {
      el.addEventListener('input', onCardChange);
      el.addEventListener('change', onCardChange);
    });
    updateBmiTags();
  }

  function field(i, k, label, val, isSelect, options) {
    if (k === 'pos') {
      return '<div class="field"><label>' + label + '</label><select data-i="' + i + '" data-k="pos">' +
        ROLE_ORDER.map(function (o) { return '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
        '</select></div>';
    }
    if (k === 'hand') {
      return '<div class="field"><label>' + label + '</label><select data-i="' + i + '" data-k="hand">' +
        options.map(function (o) { return '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>' + o + '手</option>'; }).join('') +
        '</select></div>';
    }
    var lim = k === 'weight' ? ' min="25" max="200"' : ' min="120" max="260"';
    return '<div class="field"><label>' + label + '<span class="est" id="est-' + i + '-' + k + '"></span></label>' +
      '<input data-i="' + i + '" data-k="' + k + '" type="number"' + lim + ' step="1" placeholder="—" value="' + esc(val) + '"></div>';
  }

  function onCardChange(e) {
    var el = e.target, i = +el.dataset.i, k = el.dataset.k;
    if (isNaN(i) || !k) return;
    state.roster[i][k] = el.value;
    if (k === 'height' || k === 'spike' || k === 'block') updateEstTags();
    if (k === 'height' || k === 'weight') updateBmiTags();
    // 球场直接跟着录入数据走，所以体重/身高/位置一改，接发球跑位立刻变
    renderCourt();
  }

  // 体重档位（BMI）实时显示在球员卡上
  function updateBmiTags() {
    state.roster.forEach(function (p, i) {
      var el = document.getElementById('bmi-' + i);
      if (!el) return;
      var bd = bodyInfo(p);
      if (!bd.known) { el.textContent = 'BMI —'; el.style.color = ''; return; }
      el.textContent = 'BMI ' + fmt(bd.bmi, 1) + ' · ' + bd.band;
      el.style.color = bd.color;
    });
  }

  function updateEstTags() {
    state.roster.forEach(function (p, i) {
      var h = num(p.height), s = num(p.spike), b = num(p.block);
      setEst(i, 'spike', (!isNaN(h) && isNaN(s)) ? '估' + estimateSpike(h) : '');
      setEst(i, 'block', (!isNaN(h) && isNaN(b)) ? '估' + estimateBlock(h) : '');
    });
  }
  function setEst(i, k, txt) {
    var el = document.getElementById('est-' + i + '-' + k);
    if (el) el.textContent = txt ? '（' + txt + '）' : '';
  }
  // 经验公式：扣球高度 ≈ 身高 + 47（业余/校队水平）；拦网高度 ≈ 扣球高度 - 40
  function estimateSpike(h) { return Math.round(h + 47); }
  function estimateBlock(h) { return Math.round(estimateSpike(h) - 40); }

  /* ---------------- 世界数据 ---------------- */

  function loadWorld() {
    fetch('players.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      state.world = data;
      renderWorld(data);
      renderCourt();
    }).catch(function (err) {
      $('#worldGrid').innerHTML = '<p class="empty">数据加载失败（' + esc(err.message) + '）。<br>常见原因：players.json 里写了注释、最后一个对象后面多了逗号、引号或括号没配对。<br>用浏览器直接打开 index.html 时也会读不到数据，请用本地服务器打开，例如：<code>node serve.js</code> 然后访问 http://localhost:5173 。</p>';
      renderCourt();
    });
  }

  var MIN_SAMPLE = 5;   // 少于 5 人的队伍不计算"平均"，只列个人数据

  function teamStats(list) {
    var n = list.length;
    var spikes = list.map(function (p) { return num(p.spike); }).filter(function (v) { return !isNaN(v); });
    var hs = list.map(function (p) { return num(p.height); }).filter(function (v) { return !isNaN(v); });
    return {
      team: list[0].team,
      gender: list[0].gender,
      n: n,
      reliable: n >= MIN_SAMPLE,
      height: avg(hs),
      spike: avg(list.map(function (p) { return num(p.spike); })),
      block: avg(list.map(function (p) { return num(p.block); })),
      maxHeight: hs.length ? Math.max.apply(null, hs) : null,
      maxSpike: spikes.length ? Math.max.apply(null, spikes) : null,
      players: list
    };
  }

  function buildWorldTable(gender) {
    if (!state.world || !state.world.players) return [];
    var groups = {};
    state.world.players.filter(function (p) { return p.gender === gender; }).forEach(function (p) {
      (groups[p.team] = groups[p.team] || []).push(p);
    });
    return Object.keys(groups).map(function (k) { return teamStats(groups[k]); })
      .sort(function (a, b) {
        // 样本够的排前面，按平均身高比；样本不够的排后面，按队内最高身高比
        if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
        var ka = a.reliable ? (a.height || 0) : (a.maxHeight || 0);
        var kb = b.reliable ? (b.height || 0) : (b.maxHeight || 0);
        return kb - ka;
      });
  }

  function renderWorld(data) {
    var wrap = $('#worldGrid');
    var g = state.worldGender;
    var rows = buildWorldTable(g);
    wrap.innerHTML = '';
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">这一性别还没有数据，去 players.json 里加吧。</p>';
      return;
    }
    var total = 0, reliableCnt = 0;
    rows.forEach(function (t) { total += t.n; if (t.reliable) reliableCnt++; });
    var cnt = $('#worldCount');
    if (cnt) cnt.textContent = '当前：' + (g === 'W' ? '女排' : '男排') + ' · ' + rows.length + ' 支队伍 / ' + total +
      ' 名球员 · 满 ' + MIN_SAMPLE + ' 人才算平均（' + reliableCnt + ' 支达标）';

    var shown = state.worldAll ? rows : rows.slice(0, 8);
    var tg = $('#worldToggle');
    if (tg) {
      tg.textContent = state.worldAll ? '只看前 8 支' : '展开全部 ' + rows.length + ' 支';
      tg.setAttribute('aria-pressed', state.worldAll ? 'true' : 'false');
      tg.hidden = rows.length <= 8;
    }

    shown.forEach(function (t, idx) {
      var card = document.createElement('div');
      card.className = 'wcard';
      var head = '<h4><b class="rk">#' + (idx + 1) + '</b>' + esc(t.team) + '<span>' + t.n + ' 人</span></h4>';
      var body;
      if (t.reliable) {
        body = bar('平均身高', t.height, 210, ' cm') +
          bar('平均扣球高度', t.spike, 370, ' cm') +
          bar('平均拦网高度', t.block, 350, ' cm') +
          '<div class="wmeta">' + t.n + ' 人平均 · 最高扣球 ' + (t.maxSpike ? fmt(t.maxSpike) + ' cm' : '—') + '</div>';
      } else {
        var line = t.players.map(function (p) {
          var bits = [esc(p.name || '未具名')];
          if (!isNaN(num(p.height))) bits.push(fmt(num(p.height)) + ' cm');
          if (!isNaN(num(p.spike))) bits.push('扣 ' + fmt(num(p.spike)));
          if (!isNaN(num(p.block))) bits.push('拦 ' + fmt(num(p.block)));
          return bits.join(' ');
        }).join('　·　');
        body = '<p class="sample-warn">样本只有 ' + t.n + ' 人，<b>不计算平均值</b>。个人数据：</p>' +
          '<div class="wmeta">' + line + '</div>';
      }
      card.innerHTML = head + body + playerList(t.players);
      wrap.appendChild(card);
    });
  }

  var POS_CLASS = { '二传': 'c-setter', '主攻': 'c-outside', '副攻': 'c-middle', '接应': 'c-opposite', '自由人': 'c-libero' };

  // 头像：有 photo 字段就显示真照片（照片盖在首字头像上，加载失败自动移除，不会裂图）
  function avatar(p) {
    var n = (p.name || '?').trim();
    var initial = n.charAt(0);
    if (!/[\u4e00-\u9fa5]/.test(initial)) initial = initial.toUpperCase();
    var fb = '<i class="pa ' + (POS_CLASS[p.pos] || '') + '">' + esc(initial) + '</i>';
    if (!p.photo) return '<span class="pv">' + fb + '</span>';
    return '<span class="pv">' + fb + '<img loading="lazy" src="' + esc(p.photo) + '" alt="' + esc(n) +
      '" onerror="this.remove()"></span>';
  }

  function playerList(list) {
    var rows = list.map(function (p) {
      return '<tr><td class="pc">' + avatar(p) + '<span>' + esc(p.name) + '</span></td><td>' + esc(p.pos) + '</td>' +
        '<td>' + fmt(p.height) + '</td><td>' + fmt(p.spike) + '</td><td>' + fmt(p.block) + '</td></tr>';
    }).join('');
    return '<details class="plist"><summary>展开 ' + list.length + ' 名球员明细</summary>' +
      '<table><thead><tr><th>球员</th><th>位置</th><th>身高</th><th>扣球</th><th>拦网</th></tr></thead><tbody>' +
      rows + '</tbody></table></details>';
  }
  function bar(label, val, max, unit) {
    var pct = isNaN(val) ? 0 : clamp(val / max * 100, 0, 100);
    return '<div class="bar"><div class="bl"><span>' + label + '</span><b>' + fmt(val) + unit + '</b></div>' +
      '<div class="bt"><div class="bf" style="width:' + pct + '%"></div></div></div>';
  }

  /* ---------------- 分析引擎 ---------------- */

  /* ---------------- 战术库 ----------------
   * need 的数字是“这项要几档”：1=弱也能打，2=需要一般，3=需要强。
   * 队伍三项特征由用户在“队伍特征”里选（state.team）。
   */
  var TRAIT_LABEL = { recv: '一传', sett: '二传', hit: '攻手' };
  var TACTICS = [
    { name: '接应 2 号位定点强攻', need: { sett: 2 }, desc: '不靠跑动，球直接给 2 号位接应硬打，最简单也最不容易失误。' },
    { name: '调整攻高举高打', need: {}, desc: '一传不到位时把球立高给最强攻手，靠高度和落点打，别硬拼速度。' },
    { name: '打手出界 / 借手', need: { hit: 1 }, desc: '冲拦网手侧面打，靠界外球得分——攻手硬实力不强的队伍最该练这条。' },
    { name: '吊球与线路变化', need: { hit: 1 }, desc: '轻吊空当、直线斜线交替，用落点换力量。' },
    { name: '主攻平拉开', need: { recv: 3, sett: 2, hit: 2 }, desc: '一传进三米线，二传快手平送到 4 号位，主攻在拦网合拢前下手。' },
    { name: '后排进攻（后三 / pipe）', need: { recv: 2, sett: 2 }, needBackHitter: true, desc: '后排主攻从三米线后起跳，前排被拦死时的第二出口。' },
    { name: '二传二次球突袭', need: { sett: 2 }, desc: '一传到位时二传直接推对方空当，打乱对方防守节奏。' },
    { name: '副攻前快（短平快）', need: { recv: 3, sett: 3 }, desc: '二传送到身前，副攻一步起跳打半高球，专治对方拦网慢。' },
    { name: '背飞 / 背快', need: { recv: 3, sett: 3 }, desc: '副攻绕到二传身后起跳，和二传形成前后两点，最吃二传手感。' },
    { name: '交叉（主攻与副攻换位）', need: { recv: 3, sett: 3, hit: 2 }, desc: '副攻先跑、主攻随后插上，用两个人跑动骗开拦网。' },
    { name: '梯次（时间差）', need: { recv: 3, sett: 3 }, desc: '同一位置两人起跳时间错开半拍，拦网跟不上第二点。' },
    { name: '双快（两名副攻同时快球）', need: { recv: 3, sett: 3 }, needTwoMiddles: true, desc: '两个副攻同时起跳，对方拦网只能猜——前提是队里有两名能打的副攻。' }
  ];

  function evalTactics(L, roster) {
    var middles = roster.filter(function (p) { return p.pos === '副攻'; }).length;
    var backHitter = roster.filter(function (p) { return p.pos === '主攻' || p.pos === '接应'; }).length > 0;
    var order = { '可以打': 0, '可以练': 1, '暂别打': 2 };
    return TACTICS.map(function (t) {
      var gaps = [];
      Object.keys(t.need).forEach(function (k) {
        var d = t.need[k] - L[k];
        if (d > 0) gaps.push(TRAIT_LABEL[k] + (d >= 2 ? '差得多' : '偏弱'));
      });
      if (t.needBackHitter && !backHitter) gaps.push('没有主攻/接应');
      if (t.needTwoMiddles && middles < 2) gaps.push('副攻不足 2 人');
      var status = gaps.length === 0 ? '可以打' : (gaps.length === 1 ? '可以练' : '暂别打');
      return { name: t.name, desc: t.desc, gaps: gaps, status: status, hard: Object.keys(t.need).length };
    }).sort(function (a, b) {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.hard - b.hard;
    });
  }

  function traitWord(v) { return v <= 1 ? '偏弱' : (v === 2 ? '一般' : '强'); }

  function bottleneckTip(k) {
    if (k === '一传') return '一传是所有战术的地基。先练三人接发球配合和“把球送到三米线中间”，一传稳了别的战术才有意义。';
    if (k === '二传') return '二传先练两件事：稳定把球送到 4 号位的平拉开、以及插上到位。这两件稳了再谈背后球。';
    return '攻手先练打手出界和线路变化，比一味加力量见效快。';
  }

  function analyze() {
    var roster = state.roster.map(function (p) {
      var h = num(p.height);
      var sRaw = num(p.spike), bRaw = num(p.block);
      var s = sRaw; if (isNaN(s) && !isNaN(h)) s = estimateSpike(h);
      var b = bRaw; if (isNaN(b) && !isNaN(h)) b = estimateBlock(h);
      var bd = bodyInfo({ height: p.height, weight: p.weight });
      return {
        name: (p.name || '').trim(), pos: p.pos, height: h, spike: s, block: b, hand: p.hand || '右',
        sEst: isNaN(sRaw), bEst: isNaN(bRaw),
        weight: num(p.weight), bmi: bd.bmi, band: bd.band, mob: bd.mob
      };
    });

    if (roster.filter(function (p) { return !isNaN(p.height); }).length < 3) {
      return { err: '至少需要 3 名球员的身高数据才能分析。' };
    }

    var hAvg = avg(roster.filter(function (p) { return p.pos !== '自由人'; }).map(function (p) { return p.height; }));
    var attackersEarly = roster.filter(function (p) { return p.pos === '主攻' || p.pos === '接应' || p.pos === '副攻'; });
    var spikeSample = attackersEarly.length ? attackersEarly : roster;
    var sAvg = avg(spikeSample.map(function (p) { return p.spike; }));
    var bAvg = avg(spikeSample.map(function (p) { return p.block; }));
    var setters = roster.filter(function (p) { return p.pos === '二传'; }).length;
    var liberos = roster.filter(function (p) { return p.pos === '自由人'; }).length;
    var attackers = attackersEarly;
    var rank = attackers.slice().sort(function (a, b) { return (b.spike || 0) - (a.spike || 0); });
    var topAce = rank[0] || null;

    var wAvg = avg(roster.map(function (p) { return p.weight; }));
    var bmiAvg = avg(roster.map(function (p) { return p.bmi; }));
    var heavy = roster.filter(function (p) { return p.band === '微胖' || p.band === '胖'; });
    var light = roster.filter(function (p) { return p.band === '轻'; });
    var noWeight = roster.filter(function (p) { return isNaN(p.bmi); }).length;
    var middles = roster.filter(function (p) { return p.pos === '副攻'; }).length;
    var hasBackHitter = roster.filter(function (p) { return p.pos === '主攻' || p.pos === '接应'; }).length > 0;
    var traits = state.team;

    // 世界标杆（对方梯队：全国顶尖女排 188 身高 / 310 扣球；男排 200 / 350）
    var bench = { W: { height: 188, spike: 310 }, M: { height: 200, spike: 350 } };
    var gender = 'W';
    if (!isNaN(hAvg) && hAvg > 195) gender = 'M';
    var gapH = bench[gender].height - hAvg;
    var gapS = bench[gender].spike - (isNaN(sAvg) ? hAvg + 47 : sAvg);

    /* ---- 阵型推荐 ---- */
    var formation, why;
    if (setters >= 2) {
      formation = '6-2';
      why = '你队有 ' + setters + ' 名二传。<b>6-2 让后排二传负责组织、前排二传参与进攻</b>，任何时候都有 3 名前排攻手，且不用插上，站位更简单、轮次漏洞更少。适合二传和攻手能力接近的队伍。';
    } else if (setters === 1 && hAvg < 175) {
      formation = '5-1（速度型）';
      why = '你队只有 1 名二传，且平均身高 ' + fmt(hAvg) + ' cm 偏低。<b>继续用 5-1 是对的，但要把体系做成"快速多变 + 后排进攻"</b>：靠二传插上组织、用副攻快球和后排冲进撕开拦网，不要和高个子队伍拼高举高打。';
    } else if (setters === 1) {
      formation = '5-1';
      why = '你队只有 1 名二传、平均身高 ' + fmt(hAvg) + ' cm。<b>5-1 是最稳的选择</b>：进攻点固定、二传插上后始终有 3 名前排攻手，战术可持续。代价是二传轮转到前排时没有拦网高度。';
    } else {
      formation = '4-2';
      why = '你队没有报二传（或二传能力不足）。<b>4-2 是"两个二传站在对角"的简化体系</b>，谁轮到后排谁组织，适合入门和教学赛，代价是只有 2 名前排攻手，进攻点少。等有二传人选后尽快转 5-1 或 6-2。';
    }

    /* ---- 逐轮建议：按录入顺序对号入座，与球场演示完全一致 ---- */
    var rounds = [];
    for (var r = 1; r <= 6; r++) {
      var playersAt = {};
      roster.forEach(function (pl, i) { playersAt[slotOf(i, r)] = pl; });

      var sIdx = setterIndex(roster);
      var setterSlotNow = slotOf(sIdx, r);
      var setterHere = roster[sIdx];
      var setterIs = setterHere && setterHere.pos === '二传' ? setterHere : null;

      var front = [2, 3, 4].map(function (s) { return playersAt[s]; }).filter(Boolean);
      var frontSorted = front.slice().sort(function (a, b) { return (b.spike || 0) - (a.spike || 0); });
      var mainAttacker = frontSorted[0] || null;
      var backRow = [1, 5, 6].map(function (s) { return playersAt[s]; }).filter(Boolean);
      var backAttacker = backRow.filter(function (p) { return p.pos === '接应' || p.pos === '主攻'; })
        .sort(function (a, b) { return (b.spike || 0) - (a.spike || 0); })[0] || null;

      var parts = [];
      parts.push('起始站位：' + [1, 2, 3, 4, 5, 6].map(function (s) { return s + '号位=' + (playersAt[s] ? (playersAt[s].name || playersAt[s].pos) : '?'); }).join('，') + '。');
      if (setterSlotNow === 1 || setterSlotNow === 5 || setterSlotNow === 6) {
        parts.push('<b>二传在后排（' + setterSlotNow + '号位）</b>：发球后立刻插上到 2-3 号位之间，队友给中路让出通道。' + (setterIs ? '<b>' + (setterIs.name || '二传') + '</b> 要顶住一传压力，别既接一传又组织。' : ''));
      } else {
        parts.push('<b>二传在前排（' + setterSlotNow + '号位）</b>：直接站网前组织，省掉插上这一步；此时前排拦网会少一个高度点，副攻要补位。');
      }
      if (setterIs && (setterIs.band === '微胖' || setterIs.band === '胖') && (setterSlotNow === 1 || setterSlotNow === 5 || setterSlotNow === 6)) {
        parts.push('<b>' + (setterIs.name || '二传') + ' 的体重档位是「' + setterIs.band + '」（机动性 ' + Math.round(setterIs.mob * 100) + '%）</b>：插上目标要往中间收，大约站到网前 ' + Math.round(50 + 13 * Math.pow(setterIs.mob, 1.6)) + '% 宽度处，别贴着 2 号位边线；一传尽量送到三米线正中间，别让它追着球跑。');
      }
      var heavyHere = [1, 2, 3, 4, 5, 6].map(function (s) { return playersAt[s]; })
        .filter(function (p) { return p && (p.band === '胖' || p.band === '微胖'); });
      if (heavyHere.length) {
        parts.push('本轮体重偏大的是 ' + heavyHere.map(function (p) { return '<b>' + (p.name || p.pos) + '</b>（' + p.band + '）'; }).join('、') + '：接发球站位往场内收，防守只负责自己那一块，别安排跨区补位和长距离跑动。');
      }
      if (mainAttacker) {
        parts.push('前排最强点是 <b>' + (mainAttacker.name || mainAttacker.pos) + '</b>（扣球 ' + fmt(mainAttacker.spike) + ' cm）：一传到位的球优先给它打 4 号位或 2 号位强攻，调整攻也先找它。');
      }
      if (backAttacker) {
        parts.push('后排可以打的点：<b>' + (backAttacker.name || backAttacker.pos) + '</b>，1 号位后排进攻（pipe/后排冲）能形成第二威胁，别让前排被两三人拦网时硬顶。');
      }
      var weakSlot = null;
      [2, 3, 4].forEach(function (s) {
        var p = playersAt[s];
        if (p && !weakSlot && (isNaN(p.block) || p.block < bAvg - 6)) weakSlot = s;
      });
      if (weakSlot) parts.push('拦网短板在 ' + weakSlot + ' 号位（' + (playersAt[weakSlot].name || playersAt[weakSlot].pos) + '），对面对角强攻时提前喊副攻协防。');

      rounds.push({ r: r, setterSlot: setterSlotNow, text: parts.join(' ') });
    }

    /* ---- 总体打法 ---- */
    var style = [];
    if (gapS > 20) {
      style.push('平均扣球高度比国内顶尖女排低约 ' + fmt(gapS) + ' cm，<b>不要以高举高打为主</b>：一传到位就打副攻快球（前快、背快）和接应/主攻的平拉开，用速度换高度。');
    } else if (gapS > 8) {
      style.push('扣球高度接近但不占优，建议<b>快变 + 强攻结合</b>：到位球给副攻快球牵扯拦网，不到位球给最强点打调整攻。');
    } else {
      style.push('扣球高度已接近世界水平，可以<b>以强攻为主、快球为辅</b>，前排两翼拉开形成一打一。');
    }
    if (gapH > 8) {
      style.push('平均身高偏低，拦网不要指望"硬拦"：<b>以拦网手型 + 后排防守</b>为主，盯对方最强攻手的直线/斜线习惯落点。');
    } else {
      style.push('身高不吃亏，拦网要主动压迫：<b>三人拦网</b>对对方最强点，迫使它改打小斜线，后排提前站位。');
    }
    if (liberos === 0) style.push('没有自由人：建议固定一名后排能力最强的队员承担 5 号位主接一传，别让二传接满六轮。');
    if (setters === 1) style.push('只有一个二传，注意轮转到前排时的进攻组织：<b>由副攻代传第二球</b>或简化战术，减少二传在前排的跑动损耗。');

    /* ---- 队伍特征（用户自评：1 弱 / 2 一般 / 3 强）→ 针对性打法 ---- */
    if (traits.recv <= 1) {
      style.push('一传常不到位：<b>别打快变，改打"两点强攻 + 保护"</b>——用 3 人接发球（自由人 + 主攻 + 接应）保证有人兜底，二传把球一律立高到 4 号位或 2 号位，减少二传的判断负担。');
    } else if (traits.recv === 2) {
      style.push('一传一般：<b>到位球打快、不到位球打高</b>，二传要先看一传质量再决定给谁，别每球都硬塞副攻。');
    } else {
      style.push('一传稳：可以<b>放开打快变</b>，副攻前快/背快、主攻平拉开和交叉都能用，主攻不必每球后撤接一传。');
    }
    if (traits.sett <= 1) {
      style.push('二传偏弱：<b>简化战术、减少二传的跑动和决策</b>——固定 4 号位主攻 + 2 号位接应两个点，只传高球、不传背后球；二传在前排时让副攻或接应代传第二球。');
    } else if (traits.sett === 2) {
      style.push('二传一般：<b>把一套固定配合打熟</b>（例如平拉开 + 副攻前快），一局之内别频繁换战术。');
    } else {
      style.push('二传强：可以上<b>背飞、交叉、梯次</b>这类吃手感的配合，用跑动牵扯对方拦网。');
    }
    if (traits.hit <= 1) {
      style.push('攻手硬实力不足：<b>不要硬吃拦网</b>——主练打手出界、吊球、平打小斜线，用落点和速度得分；同时多用副攻快球吸引拦网，把球分给拦网最弱的那一侧。');
    } else if (traits.hit === 2) {
      style.push('攻手实力中等：<b>强攻与变化结合</b>，关键分给最强点，其余分多用落点。');
    } else {
      style.push('攻手硬实力强：<b>以强攻为轴</b>，用一两个强点吸引双人拦网，再给副攻制造单人拦网的机会。');
    }

    /* ---- 体重/机动性 → 跑位与分工 ---- */
    if (heavy.length) {
      style.push('体重档位偏大的 ' + heavy.length + ' 人（' + heavy.map(function (p) { return (p.name || p.pos) + '·' + p.band; }).join('、') + '）：<b>减少长距离跑动</b>——接发球站位往场内收、少安排交叉和换位，插上或补位交给机动性好的队友；他们更适合固定点进攻和拦网。');
    }
    if (light.length) {
      style.push('体重偏轻的 ' + light.length + ' 人（' + light.map(function (p) { return (p.name || p.pos); }).join('、') + '）：跑动余量大，<b>可以多承担交叉、背飞、后排进攻和一传保护</b>。');
    }
    if (isNaN(wAvg)) {
      style.push('还没填体重：<b>填上体重后</b>会自动算出 BMI 档位（轻 / 均衡 / 微胖 / 胖），并据此调整二传插上位置和其它位置的接发球站位。');
    } else if (noWeight) {
      style.push('有 ' + noWeight + ' 人没填体重，跑位按“均衡”默认值算；补齐体重后跑位图会更贴合实际。');
    }

    /* ---- 战术匹配：队伍三项特征 vs 战术库要求 ---- */
    var tactics = evalTactics({ recv: traits.recv, sett: traits.sett, hit: traits.hit }, roster);
    var playable = tactics.filter(function (t) { return t.status === '可以打'; });
    var trainable = tactics.filter(function (t) { return t.status === '可以练'; });
    var traitVals = [['一传', traits.recv], ['二传', traits.sett], ['攻手', traits.hit]];
    traitVals.sort(function (a, b) { return a[1] - b[1]; });
    var bottleneck = traitVals[0][0];

    /* ---- 与世界的差距表：只跟样本 ≥ MIN_SAMPLE 人的队伍比 ---- */
    var worldRows = buildWorldTable(gender).filter(function (t) { return t.reliable; }).slice(0, 6);

    return {
      roster: roster, hAvg: hAvg, sAvg: sAvg, bAvg: bAvg,
      wAvg: wAvg, bmiAvg: bmiAvg, heavy: heavy, light: light, noWeight: noWeight,
      formation: formation, why: why, rounds: rounds, style: style,
      gender: gender, gapH: gapH, gapS: gapS, worldRows: worldRows,
      setters: setters, liberos: liberos, topAce: topAce,
      traits: traits, tactics: tactics, playable: playable, trainable: trainable, bottleneck: bottleneck
    };
  }

  function renderResult(res) {
    var box = $('#resultBody');
    if (res.err) { box.innerHTML = '<p class="empty">' + esc(res.err) + '</p>'; return; }
    var html = '';
    // 一眼能看到的结论（最重要的四个点）
    var ace = res.topAce ? (res.topAce.name || res.topAce.pos) : '—';
    html += '<div class="verdict">' +
      '<div class="v-item"><span>推荐阵型</span><b>' + esc(res.formation) + '</b></div>' +
      '<div class="v-item"><span>最强进攻点</span><b>' + esc(ace) + (res.topAce && !isNaN(res.topAce.spike) ? ' · ' + fmt(res.topAce.spike) + ' cm' : '') + '</b></div>' +
      '<div class="v-item"><span>最先要补</span><b>' + esc(res.bottleneck) + '</b></div>' +
      '<div class="v-item"><span>现在能打</span><b>' + res.playable.length + ' 套战术</b></div>' +
      '</div>';
    html += '<div class="why-box">' + res.why + '</div>';
    html += '<div class="chips">' +
      '<span class="chip">平均身高 <b>' + fmt(res.hAvg) + ' cm</b>（不含自由人）</span>' +
      '<span class="chip">攻手平均扣球 <b>' + fmt(res.sAvg) + ' cm</b></span>' +
      '<span class="chip">攻手平均拦网 <b>' + fmt(res.bAvg) + ' cm</b></span>' +
      '<span class="chip">二传 <b>' + res.setters + ' 人</b></span>' +
      '<span class="chip">自由人 <b>' + res.liberos + ' 人</b></span>' +
      (res.topAce ? '<span class="chip">最强攻手 <b>' + esc(res.topAce.name || res.topAce.pos) + '</b></span>' : '') +
      '</div>';
    if (!isNaN(res.wAvg)) {
      html += '<div class="chips">' +
        '<span class="chip">平均体重 <b>' + fmt(res.wAvg, 1) + ' kg</b></span>' +
        '<span class="chip">平均 BMI <b>' + fmt(res.bmiAvg, 1) + '</b></span>' +
        '<span class="chip">体重偏大 <b>' + res.heavy.length + ' 人</b></span>' +
        (res.noWeight ? '<span class="chip">未填体重 <b>' + res.noWeight + ' 人</b></span>' : '') +
        '</div>';
    }

    html += '<h3 class="rsec">身体条件与跑动能力</h3>';
    html += '<table class="cmp"><thead><tr><th>球员</th><th>位置</th><th>身高</th><th>体重</th><th>BMI</th><th>档位</th><th>机动性</th></tr></thead><tbody>';
    res.roster.forEach(function (p) {
      var bd = bodyInfo({ height: p.height, weight: p.weight });
      html += '<tr><td>' + esc(p.name || '未命名') + '</td><td>' + esc(p.pos) + '</td>' +
        '<td>' + fmt(p.height) + ' cm</td>' +
        '<td>' + (isNaN(p.weight) ? '—' : fmt(p.weight, 0) + ' kg') + '</td>' +
        '<td>' + (bd.known ? fmt(bd.bmi, 1) : '—') + '</td>' +
        '<td' + (bd.known ? ' style="color:' + bd.color + ';font-weight:600"' : '') + '>' + (bd.known ? bd.band : '待填') + '</td>' +
        '<td>' + Math.round(bd.mob * 100) + '%</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="note-line">BMI 分档：轻 &lt;18.5、均衡 18.5–24、微胖 24–28、胖 ≥28。机动性决定接发球时能拉开多远、二传插上能靠多近网：档位越低站位越往场内收，插上点也越靠中间。</p>';

    html += '<h3 class="rsec">你的 6 人在第 1 轮的位置</h3>';
    html += '<table class="cmp"><thead><tr><th>录入顺序</th><th>球员</th><th>位置</th><th>身高</th><th>扣球</th><th>拦网</th></tr></thead><tbody>';
    res.roster.forEach(function (p, i) {
      var slot = slotOf(i, 1);
      html += '<tr><td>第 ' + (i + 1) + ' 个（起始 ' + slot + ' 号位）</td><td>' + esc(p.name || '未命名') + '</td><td>' + esc(p.pos) + '</td>' +
        '<td>' + fmt(p.height) + ' cm</td><td>' + fmt(p.spike) + ' cm' + (p.sEst ? '（估）' : '') + '</td><td>' + fmt(p.block) + ' cm' + (p.bEst ? '（估）' : '') + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<h3 class="rsec">与 ' + (res.gender === 'M' ? '男排' : '女排') + ' 顶尖水平的差距</h3>';
    html += '<table class="cmp"><thead><tr><th>队伍</th><th>平均身高</th><th>平均扣球</th><th>平均拦网</th></tr></thead><tbody>';
    html += '<tr class="mine"><td>你的球队</td><td>' + fmt(res.hAvg) + ' cm</td><td>' + fmt(res.sAvg) + ' cm</td><td>' + fmt(res.bAvg) + ' cm</td></tr>';
    res.worldRows.forEach(function (t) {
      html += '<tr><td>' + esc(t.team) + '</td><td>' + fmt(t.height) + ' cm</td><td>' + fmt(t.spike) + ' cm</td><td>' + fmt(t.block) + ' cm</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="hint">差值：身高 ' + (res.gapH > 0 ? '少 ' : '多 ') + fmt(Math.abs(res.gapH)) + ' cm，扣球高度 ' + (res.gapS > 0 ? '少 ' : '多 ') + fmt(Math.abs(res.gapS)) + ' cm。（你的身高按不含自由人的球员算，扣球/拦网按主攻+接应+副攻算；表格只列样本满 ' + MIN_SAMPLE + ' 人的队伍，顶尖水平取自公开资料，仅作参照）</p>';

    html += '<h3 class="rsec">逐轮跑位与进攻建议</h3><div class="rounds">';
    res.rounds.forEach(function (x) {
      html += '<div class="r-item"><div class="r-no">第 ' + x.r + ' 轮<br><span style="font-weight:500;color:var(--muted);font-size:12px">二传 ' + x.setterSlot + ' 号位</span></div><div class="r-txt">' + x.text + '</div></div>';
    });
    html += '</div>';

    html += '<h3 class="rsec">打法风格建议</h3><ul class="style-list">';
    res.style.forEach(function (s) { html += '<li style="margin:6px 0">' + s + '</li>'; });
    html += '</ul>';

    html += '<h3 class="rsec">你们能配合上的战术</h3>';
    html += '<p class="note-line">按你选的队伍特征算：一传 ' + traitWord(res.traits.recv) + '、二传 ' + traitWord(res.traits.sett) + '、攻手 ' + traitWord(res.traits.hit) + '。判断标准：战术要求的档位你都够 → <b>可以打</b>；只差一项 → <b>可以练</b>；差两项以上 → <b>暂别打</b>。</p>';
    html += '<table class="cmp tactics"><thead><tr><th>战术</th><th>结论</th><th>差在哪 / 注意</th></tr></thead><tbody>';
    res.tactics.forEach(function (t) {
      var cls = t.status === '可以打' ? 'tk-ok' : (t.status === '可以练' ? 'tk-mid' : 'tk-no');
      html += '<tr class="' + cls + '"><td><b>' + esc(t.name) + '</b><br><span class="tk-desc">' + esc(t.desc) + '</span></td>' +
        '<td class="tk-st">' + esc(t.status) + '</td>' +
        '<td>' + (t.gaps.length ? esc(t.gaps.join('、')) : '—') + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="keytip"><b>最该先补的是' + esc(res.bottleneck) + '</b>：' + bottleneckTip(res.bottleneck) + '</p>';
    box.innerHTML = html;
  }

  /* ---------------- 比赛计分（每球得分制） ---------------- */

  var match = {
    a: 0, b: 0,          // 本局比分
    setsA: 0, setsB: 0,  // 局分
    setNo: 1,
    serve: 'a',          // 谁发球
    bestOf: 5,
    over: false,
    log: [],             // 已结束的局
    hist: []             // 撤销用的快照
  };

  function scName(side) {
    var el = $(side === 'a' ? '#scNameA' : '#scNameB');
    var v = el && el.value ? el.value.trim() : '';
    return v || (side === 'a' ? '我方' : '对手');
  }
  function isDecidingSet() {
    return (match.bestOf === 5 && match.setNo === 5) || (match.bestOf === 3 && match.setNo === 3);
  }
  function targetPoints() { return isDecidingSet() ? 15 : 25; }
  function setsToWin() { return match.bestOf === 5 ? 3 : 2; }

  function scSnap() {
    return JSON.stringify({
      a: match.a, b: match.b, setsA: match.setsA, setsB: match.setsB,
      setNo: match.setNo, serve: match.serve, over: match.over, log: match.log
    });
  }
  function scRestore(s) {
    var o = JSON.parse(s);
    match.a = o.a; match.b = o.b; match.setsA = o.setsA; match.setsB = o.setsB;
    match.setNo = o.setNo; match.serve = o.serve; match.over = o.over; match.log = o.log;
  }
  function scPush() {
    match.hist.push(scSnap());
    if (match.hist.length > 100) match.hist.shift();
  }

  function pointTo(side) {
    if (match.over) return;
    scPush();
    var other = side === 'a' ? 'b' : 'a';
    match[side] += 1;

    // 接发球方赢下这一球 → 换发球；我方拿回发球权时跟着轮转一位
    if (side !== match.serve) {
      match.serve = side;
      var auto = $('#scAutoRotate');
      if (side === 'a' && auto && auto.checked) {
        state.round = state.round === 6 ? 1 : state.round + 1;
        resetDragPos();
        renderCourt();
      }
    }

    var tgt = targetPoints();
    if (match[side] >= tgt && match[side] - match[other] >= 2) endSet(side);
    renderScore();
  }

  function endSet(winner) {
    match.log.push({ set: match.setNo, a: match.a, b: match.b, w: winner });
    if (winner === 'a') match.setsA += 1; else match.setsB += 1;
    match.a = 0;
    match.b = 0;
    match.serve = winner;
    if (match.setsA >= setsToWin() || match.setsB >= setsToWin()) match.over = true;
    else match.setNo += 1;
  }

  function resetMatch() {
    match.a = 0; match.b = 0;
    match.setsA = 0; match.setsB = 0;
    match.setNo = 1; match.serve = 'a';
    match.over = false; match.log = []; match.hist = [];
    renderScore();
  }

  function renderScore() {
    if (!$('#scA')) return;
    $('#scA').textContent = match.a;
    $('#scB').textContent = match.b;
    $('#scSetsA').textContent = match.setsA;
    $('#scSetsB').textContent = match.setsB;

    var deciding = isDecidingSet() && !match.over;
    $('#scSetNo').textContent = match.over ? '比赛结束' : ('第 ' + match.setNo + ' 局' + (deciding ? '（决胜局）' : ''));
    $('#scTarget').textContent = match.over ? '' : targetPoints() + ' 分制 · 需领先 2 分';

    var live = !match.over;
    $('#scServeA').classList.toggle('on', live && match.serve === 'a');
    $('#scServeB').classList.toggle('on', live && match.serve === 'b');
    $('#scTeamA').classList.toggle('serving', live && match.serve === 'a');
    $('#scTeamB').classList.toggle('serving', live && match.serve === 'b');
    $('#scBtnA').disabled = match.over;
    $('#scBtnB').disabled = match.over;

    $('#scLog').innerHTML = match.log.map(function (m) {
      return '<span class="sl">第' + m.set + '局 ' + m.a + ':' + m.b + ' <b>' + esc(m.w === 'a' ? scName('a') : scName('b')) + '</b> 胜</span>';
    }).join('');

    var msg = '', cls = '';
    if (match.over) {
      var winA = match.setsA > match.setsB;
      msg = '比赛结束：' + esc(winA ? scName('a') : scName('b')) + ' 以 ' +
        Math.max(match.setsA, match.setsB) + ':' + Math.min(match.setsA, match.setsB) + ' 获胜';
      if (!winA) msg += '　（可以先补短板，再点“重置全场”重来）';
      cls = winA ? 'good' : 'bad';
    } else {
      var tgt = targetPoints(), sp = null;
      ['a', 'b'].forEach(function (s) {
        if (sp) return;
        var o = s === 'a' ? 'b' : 'a';
        if (match[s] + 1 >= tgt && match[s] + 1 - match[o] >= 2) sp = s;
      });
      if (sp) {
        var wouldWin = (sp === 'a' ? match.setsA + 1 : match.setsB + 1) >= setsToWin();
        msg = (wouldWin ? '赛点：' : '局点：') + esc(scName(sp)) + ' 再拿 1 分就' + (wouldWin ? '赢下比赛' : '拿下这一局');
        cls = 'hot';
      } else {
        msg = '发球方：' + esc(scName(match.serve)) + '　·　接发球方赢下这一球就换发球并轮转';
      }
    }
    var mEl = $('#scMsg');
    mEl.className = 'sc-msg ' + cls;
    mEl.innerHTML = msg;
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    $('#prevRound').addEventListener('click', function () { state.round = state.round === 1 ? 6 : state.round - 1; resetDragPos(); renderCourt(); });
    $('#nextRound').addEventListener('click', function () { state.round = state.round === 6 ? 1 : state.round + 1; resetDragPos(); renderCourt(); });
    $('#setterPos').addEventListener('change', function (e) { state.startSlot = +e.target.value; state.round = 1; resetDragPos(); renderCourt(); });
    $('#showArrow').addEventListener('change', function (e) { state.showArrow = e.target.checked; renderCourt(); });
    $('#showThreat').addEventListener('change', function (e) { state.showThreat = e.target.checked; renderCourt(); });
    $('#toggleShift').addEventListener('click', function () {
      state.shift = !state.shift;
      syncShiftBtn();
      resetDragPos();
      renderCourt();
    });

    $('#analyzeBtn').addEventListener('click', function () {
      var res = analyze();
      renderResult(res);
      var resEl = document.getElementById('result');
      if (resEl && resEl.scrollIntoView) resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#loadDemo').addEventListener('click', function () {
      state.roster = [
        mk('队长', '二传', 178, '', '', '右', 78),
        mk('', '主攻', 185, 300, 288, '右', 75),
        mk('', '副攻', 190, 305, 295, '右', 82),
        mk('', '接应', 186, 302, 290, '右', 80),
        mk('', '主攻', 182, 296, 285, '右', 70),
        mk('', '副攻', 188, 300, 292, '右', 95)
      ];
      renderCards(); updateEstTags(); updateBmiTags(); renderCourt();
    });
    $('#resetTeam').addEventListener('click', function () { initRoster(); });
    // 队伍特征（一传 / 二传 / 攻手，1 弱 2 一般 3 强）——直接影响战术推荐
    [['#recvLevel', 'recv'], ['#setterLevel', 'sett'], ['#hitLevel', 'hit']].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      state.team[pair[1]] = +el.value || 2;
      el.addEventListener('change', function () { state.team[pair[1]] = +el.value; });
    });
    $('#genderW').addEventListener('click', function () { setWorldGender('W'); });
    $('#genderM').addEventListener('click', function () { setWorldGender('M'); });
    $('#worldToggle').addEventListener('click', function () {
      state.worldAll = !state.worldAll;
      if (state.world) renderWorld(state.world);
    });

    /* ---- 比赛计分 ---- */
    $('#scBtnA').addEventListener('click', function () { pointTo('a'); });
    $('#scBtnB').addEventListener('click', function () { pointTo('b'); });
    $('#scUndo').addEventListener('click', function () {
      if (!match.hist.length) return;
      scRestore(match.hist.pop());
      renderScore();
    });
    $('#scResetSet').addEventListener('click', function () {
      scPush(); match.a = 0; match.b = 0; renderScore();
    });
    $('#scResetAll').addEventListener('click', function () { resetMatch(); });
    $('#scBestOf').addEventListener('change', function (e) {
      match.bestOf = +e.target.value === 3 ? 3 : 5;
      resetMatch();
    });
    ['#scNameA', '#scNameB'].forEach(function (s) {
      var el = $(s);
      if (el) el.addEventListener('input', renderScore);
    });
    // 键盘左右键切轮次（在输入框里打字时不拦）
    document.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { $('#prevRound').click(); }
      if (e.key === 'ArrowRight') { $('#nextRound').click(); }
    });
    bindDialog();
  }

  function setWorldGender(g) {
    state.worldGender = g;
    var w = $('#genderW'), m = $('#genderM');
    function cls(btn, on) {
      btn.className = 'btn small' + (on ? '' : ' ghost');
    }
    cls(w, g === 'W'); cls(m, g === 'M');
    if (state.world) renderWorld(state.world);
  }

  function resetDragPos() {
    state.roster.forEach(function (p) { delete p.x; delete p.y; });
  }

  // 按钮文案/状态跟着 state.shift 走
  function syncShiftBtn() {
    var btn = $('#toggleShift');
    if (!btn) return;
    btn.setAttribute('aria-pressed', state.shift ? 'true' : 'false');
    btn.textContent = state.shift ? '回到标准站位' : '变化：接发球站位';
  }

  // 支持分享链接直接带状态，例如 ?round=3&shift=1&setter=1
  function applyQuery() {
    var q = {};
    String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) { if (kv) q[kv] = ''; return; }
      q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    var r = parseInt(q.round || q.r, 10);
    if (r >= 1 && r <= 6) state.round = r;
    var s = parseInt(q.setter || q.s, 10);
    if (s >= 1 && s <= 6) { state.startSlot = s; $('#setterPos').value = String(s); }
    if (q.shift === '1' || q.shift === 'true') state.shift = true;
  }

  /* ---------------- 启动 ---------------- */
  initRoster();
  bind();
  applyQuery();
  syncShiftBtn();
  renderCourt();
  renderScore();
  loadWorld();
})();
