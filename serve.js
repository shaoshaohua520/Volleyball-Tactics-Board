/* 本地预览服务器：零依赖，只用 Node 内置模块
 * 用法：
 *   node serve.js            默认 5173，被占用时自动往后找空闲端口
 *   node serve.js 8080       指定端口
 *   set PORT=8080 && node serve.js   （cmd）   $env:PORT=8080; node serve.js （PowerShell）
 * 为什么需要它：直接双击 index.html（file:// 协议）时浏览器会拦截 fetch('players.json')，世界数据会加载失败。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const START_PORT = Number(process.argv[2] || process.env.PORT || 5173);
const MAX_TRIES = 12;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 not found: ' + urlPath);
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

function listen(port, left) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && left > 1) {
      console.log('端口 ' + port + ' 已被占用，换 ' + (port + 1) + ' 试试…');
      listen(port + 1, left - 1);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error('端口 ' + port + ' 到 ' + (port + left - 1) + ' 都被占用了。');
      console.error('先关掉占用的程序，或者换一个端口启动：node serve.js 8080');
    } else {
      console.error('启动失败：' + err.message);
    }
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(port, () => {
    server.removeListener('error', onError);
    console.log('');
    console.log('  排球战术台本地预览： http://localhost:' + port);
    console.log('  按 Ctrl+C 停止');
    console.log('');
  });
}

console.log('正在启动本地服务器（目录：' + ROOT + '）…');
listen(START_PORT, MAX_TRIES);
