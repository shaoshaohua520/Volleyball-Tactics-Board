// 一次性自检脚本（不属于网站，可删）：无 Node 时请在能跑 node 的机器上执行
// 用法：node _selfcheck.js
const fs = require('fs');
const path = require('path');
const root = __dirname;

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

let ok = true;
try {
  const d = readJson(path.join(root, 'players.json'));
  const pl = d.players;
  const ids = new Map();
  const dups = [];
  const bad = [];
  pl.forEach((x, i) => {
    if (ids.has(x.id)) dups.push(x.id + '(#' + i + ')');
    ids.set(x.id, 1);
    ['id', 'name', 'team', 'country', 'gender', 'pos'].forEach(k => {
      if (!x[k]) bad.push('player#' + i + ' 缺 ' + k);
    });
    if (x.gender !== 'W' && x.gender !== 'M') bad.push('player#' + i + ' gender 非法: ' + x.gender);
    if (!['二传', '主攻', '副攻', '接应', '自由人'].includes(x.pos)) bad.push('player#' + i + ' pos 非法: ' + x.pos);
  });
  const W = pl.filter(x => x.gender === 'W').length;
  const M = pl.filter(x => x.gender === 'M').length;
  const teams = new Set(pl.map(x => x.team)).size;
  console.log('[players.json] 通过。总人数 ' + pl.length + '（女排 ' + W + ' / 男排 ' + M + '），队伍 ' + teams + ' 支。');
  if (dups.length) { ok = false; console.log('  ! 重复 id: ' + dups.join(', ')); }
  if (bad.length) { ok = false; console.log('  ! 字段问题:\n   ' + bad.join('\n   ')); }
} catch (e) {
  ok = false;
  console.log('[players.json] 解析失败：' + e.message);
}

// JS 语法检查：交给 node 自己的解析器，比手写括号扫描可靠（正则字面量/转义会把粗糙扫描器带偏）
const { execFileSync } = require('child_process');
['assets/app.js', 'serve.js'].forEach(rel => {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
    console.log('[' + rel + '] 语法通过');
  } catch (e) {
    ok = false;
    console.log('[' + rel + '] 语法错误：\n' + String(e.stderr || e.message).trim());
  }
});

console.log(ok ? '\n全部通过 ✅' : '\n有问题 ❌');
process.exit(ok ? 0 : 1);
