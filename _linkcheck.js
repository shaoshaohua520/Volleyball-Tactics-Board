// 静态自检：DOM id 对应、重复 id、内部死链
// 用法：node _linkcheck.js（在 volleyball-site 目录下）
const fs = require('fs');
const path = require('path');

function ids(js) {
  const a = [...js.matchAll(/getElementById\(\s*'([^']+)'/g)].map(m => m[1]);
  const b = [...js.matchAll(/\$\$?\(\s*'#([A-Za-z0-9_-]+)'/g)].map(m => m[1]);
  return [...new Set([...a, ...b])];
}

// 动态拼接的 id 前缀（'bmi-' + i、'est-' + i + '-' + k 等）不是静态 id
const DYNAMIC = ['bmi-', 'est-', 'slot-'];

function checkPage(page, scriptFile) {
  const html = fs.readFileSync(page, 'utf8');
  const js = fs.readFileSync(scriptFile, 'utf8');
  const all = ids(js);
  const missing = all.filter(id => !DYNAMIC.some(d => id === d) && html.indexOf('id="' + id + '"') === -1);
  console.log('\n[' + page + ' ← ' + path.basename(scriptFile) + '] 引用 id ' + all.length + ' 个');
  console.log('  ' + (missing.length ? '缺少: ' + missing.join(', ') : '全部存在 ✅'));

  const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const seen = {}, dups = [];
  htmlIds.forEach(i => { seen[i] = (seen[i] || 0) + 1; if (seen[i] === 2) dups.push(i); });
  console.log('  ' + (dups.length ? '重复 id: ' + dups.join(', ') : '无重复 id ✅'));

  const links = [...html.matchAll(/(?:href|src)="([^"#?]+\.(?:html|js|css|json|png|jpg|svg))"/g)].map(m => m[1])
    .filter(l => !/^(https?:)?\/\//.test(l) && !l.startsWith('data:'));
  const broken = links.filter(l => {
    const p = l.replace(/^\.\//, '');
    return !fs.existsSync(p) && !fs.existsSync(path.join('guide', p));
  });
  console.log('  ' + (broken.length ? '死链: ' + broken.join(', ') : '内部链接全部有效 ✅'));
}

checkPage('index.html', 'assets/app.js');
checkPage('scoreboard.html', 'assets/score.js');

const guides = fs.readdirSync('guide').filter(f => f.endsWith('.html'));
console.log('\n教程页 ' + guides.length + ' 个: ' + guides.join(', '));
const gj = fs.readFileSync('guide/index.html', 'utf8');
const gLinks = [...gj.matchAll(/href="([^"]+\.html)"/g)].map(m => m[1]);
const gBroken = gLinks.filter(l => !fs.existsSync(path.join('guide', l.replace(/^\.\//, ''))));
console.log('guide/index.html 死链: ' + (gBroken.length ? gBroken.join(', ') : '无 ✅'));
const linked = new Set(gLinks.map(l => l.replace(/^\.\//, '')));
const orphan = guides.filter(f => f !== 'index.html' && !linked.has(f));
console.log(orphan.length ? '目录页没挂上的教程: ' + orphan.join(', ') : '所有教程都在目录里 ✅');

// 根目录必备文件
['robots.txt', 'sitemap.xml', '404.html', 'players.json', 'serve.js', '.gitignore'].forEach(f => {
  if (!fs.existsSync(f)) console.log('⚠ 缺少文件: ' + f);
});