import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, timestamp } from './lib/util.mjs';
import { renderJob } from './lib/engine.mjs';
import { screenshot } from './lib/shot.mjs';
import { PLACES } from './lib/places.mjs';
import { composeAccurateMap } from './lib/composite.mjs';
import { trimLettering, trimWhiteBorders } from './lib/lettering.mjs';

const PORT = Number(process.env.PORT || 4173);
const TMP = path.join(ROOT, 'out', '.tmp');
const AI_DIR = path.join(ROOT, 'assets', 'ai');
const UP_DIR = path.join(ROOT, 'assets', 'uploads');
let modelCache = '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const PROVIDER = (process.env.IMAGE_PROVIDER || 'local').toLowerCase();

/** 云端生图：OpenAI / Gemini。都返回落盘后的相对路径 */
async function generateImageRemote({ prompt, size, transparent, quality, refs }) {
  const save = buffer => {
    fs.mkdirSync(AI_DIR, { recursive: true });
    const file = path.join(AI_DIR, `ai-${timestamp()}.png`);
    fs.writeFileSync(file, buffer);
    return { path: `assets/ai/${path.basename(file)}` };
  };
  const absRefs = refs.map(r => path.resolve(ROOT, r)).filter(p => fs.existsSync(p));

  if (PROVIDER === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('缺少 GEMINI_API_KEY');
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
    const parts = [{ text: prompt }];
    for (const p of absRefs) {
      parts.push({ inline_data: { mime_type: 'image/png', data: fs.readFileSync(p).toString('base64') } });
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
    const part = (data.candidates?.[0]?.content?.parts || []).find(x => x.inline_data?.data || x.inlineData?.data);
    const b64 = part?.inline_data?.data || part?.inlineData?.data;
    if (!b64) throw new Error('Gemini 没有返回图片');
    return save(Buffer.from(b64, 'base64'));
  }

  // OpenAI
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('缺少 OPENAI_API_KEY');
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const [w, h] = String(size).split('x').map(Number);
  const oaSize = w === h ? '1024x1024' : (w > h ? '1536x1024' : '1024x1536');

  let res;
  if (absRefs.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', oaSize);
    for (const p of absRefs.slice(0, 5)) {
      form.append('image[]', new Blob([fs.readFileSync(p)], { type: 'image/png' }), path.basename(p));
    }
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: oaSize, n: 1 }),
    });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  const item = data.data?.[0];
  if (item?.b64_json) return save(Buffer.from(item.b64_json, 'base64'));
  if (item?.url) {
    const bin = Buffer.from(await (await fetch(item.url)).arrayBuffer());
    return save(bin);
  }
  throw new Error('OpenAI 没有返回图片');
}

/** 调内置 cxb 生图（免费 gpt-image-2.5-flare），返回落盘后的相对路径 */
function generateImageLocal({ prompt, size = '1024x1536', transparent = false, quality, refs = [] }) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(AI_DIR, { recursive: true });
  const promptFile = path.join(TMP, `prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const args = ['image', 'generate', '--prompt-file', promptFile, '--model', 'gpt-image-2.5-flare',
    '--param', `size=${size}`];
  if (quality) args.push('--param', `quality=${quality}`);
  if (transparent) args.push('--param', 'background=transparent', '--param', 'output_format=png');
  for (const ref of refs.slice(0, 5)) {
    const abs = path.resolve(ROOT, ref);
    if (fs.existsSync(abs)) args.push('--ref-image', abs);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('cxb', args, { shell: true });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('生图超时')); }, 280000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('exit', code => {
      clearTimeout(timer);
      const match = out.match(/FINAL\s+(.+\.(?:png|jpg|jpeg|webp))/i);
      if (code !== 0 || !match) {
        return reject(new Error(`生图失败（退出码 ${code}）：${out.slice(-400)}`));
      }
      const src = match[1].trim();
      const target = path.join(AI_DIR, `ai-${timestamp()}.png`);
      try {
        fs.copyFileSync(src, target);
      } catch {
        return reject(new Error(`找不到生成结果：${src}`));
      }
      resolve({ path: `assets/ai/${path.basename(target)}`, raw: src });
    });
  });
}

function generateImage(opts) {
  return PROVIDER === 'local' ? generateImageLocal(opts) : generateImageRemote(opts);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, provider: PROVIDER, version: '1.0.0' });
    }

    if (req.method === 'GET' && url.pathname === '/api/model') {
      if (PROVIDER !== 'local') {
        const m = PROVIDER === 'gemini'
          ? (process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview')
          : (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
        return json(res, 200, { model: `provider=${PROVIDER}
model=${m}` });
      }
      if (modelCache) return json(res, 200, { model: modelCache });
      return new Promise(resolve => {
        const child = spawn('cxb', ['image', 'generate', '--show-model'], { shell: true });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.on('exit', () => {
          modelCache = out.trim();
          json(res, 200, { model: modelCache });
          resolve();
        });
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/places') {
      return json(res, 200, PLACES);
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const body = JSON.parse(await readBody(req));
      const ext = (body.name || '').toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)?.[0] || '.png';
      fs.mkdirSync(UP_DIR, { recursive: true });
      const file = path.join(UP_DIR, `up-${timestamp()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
      fs.writeFileSync(file, Buffer.from(String(body.data).split(',')[1] || body.data, 'base64'));
      return json(res, 200, { path: `assets/uploads/${path.basename(file)}` });
    }

    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const job = JSON.parse(await readBody(req));
      const { html } = renderJob(job);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'POST' && url.pathname === '/api/render') {
      const body = JSON.parse(await readBody(req));
      const job = body.job || body;
      const { html, width, height, warnings = [] } = renderJob(job);
      const name = `poster-t${job.type || 1}-${timestamp()}.png`;
      const out = await screenshot({ html, width, height, scale: Number(body.scale) || 2,
        outPath: path.join(ROOT, 'out', name) });
      return json(res, 200, { path: out, url: `/out/${name}`, width: width * (Number(body.scale) || 2),
        height: height * (Number(body.scale) || 2), warnings });
    }

    if (req.method === 'POST' && url.pathname === '/api/trimwhite') {
      const body = JSON.parse(await readBody(req));
      if (!body.image) return json(res, 400, { error: '缺少图片' });
      const result = await trimWhiteBorders(body.image);
      return json(res, 200, result || { path: body.image, cropped: false });
    }

    if (req.method === 'POST' && url.pathname === '/api/chroma') {
      const body = JSON.parse(await readBody(req));
      if (!body.image) return json(res, 400, { error: '缺少图片' });
      fs.mkdirSync(AI_DIR, { recursive: true });
      const target = path.join(AI_DIR, `cut-${timestamp()}.png`);
      const src = path.resolve(ROOT, body.image);
      const ok = await new Promise(resolve => {
        const child = spawn('cxb', ['image', 'remove-chroma-key', '--input', src, '--out', target,
          '--auto-key', 'border', '--soft-matte', '--transparent-threshold', '60',
          '--opaque-threshold', '160', '--despill'], { shell: true });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('exit', code => resolve(code === 0 && fs.existsSync(target)));
      });
      if (!ok) return json(res, 200, { path: body.image, keyed: false });
      return json(res, 200, { path: `assets/ai/${path.basename(target)}`, keyed: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/trim') {
      const body = JSON.parse(await readBody(req));
      if (!body.image) return json(res, 400, { error: '缺少图片' });
      const result = await trimLettering(body.image);
      return json(res, 200, result || { error: '没有找到笔画' });
    }

    if (req.method === 'POST' && url.pathname === '/api/compose') {
      const body = JSON.parse(await readBody(req));
      if (!body.base) return json(res, 400, { error: '缺少底图' });
      const points = [];
      const unmatched = [];
      for (const name of body.names || []) {
        const clean = String(name).replace(/[（(].*?[)）]/g, '');
        const hit = PLACES.find(p => clean.includes(p.name) || p.name.includes(clean));
        if (hit) points.push({ name: hit.name, label: hit.name, lon: hit.lon, lat: hit.lat });
        else unmatched.push(name);
      }
      if (!points.length) return json(res, 200, { path: '', points: 0, unmatched });
      const name = `poster-map-${timestamp()}.png`;
      const out = await composeAccurateMap({
        baseImage: body.base,
        points,
        width: Number(body.width) || 1152,
        height: Number(body.height) || 1536,
        scope: body.scope || '中国',
        tone: body.tone || 'cool',
        outPath: path.join(ROOT, 'out', name),
      });
      return json(res, 200, { path: `out/${name}`, local: out, points: points.length, unmatched });
    }

    if (req.method === 'POST' && url.pathname === '/api/calibrate') {
      const body = JSON.parse(await readBody(req));
      if (!body.image || !body.count) return json(res, 400, { error: '缺少图片或数量' });
      const names = (body.names || []).join('、');
      const prompt = `这是刚生成的海报（Image 1）。原始资料里一共只有 ${body.count} 个地点${names ? `：${names}` : ''}。

请核对并只做必要修正：
1) 画面中任何表示数量的文字（主标题、副标题、角标）必须写「${body.count}」，如果写成了别的数字（比如 10）请改成 ${body.count}；
2) 卡片和地图点位只能出现上面这些地点，多出来的删掉、写错的改正；
3) 除上述修正外，构图、配色、字体、装饰、其他文字一律保持原样，不要重新设计，不要增删卡片。

只输出修正后的图片。`;
      const result = await generateImage({
        prompt,
        size: body.size || '1152x1536',
        quality: 'high',
        refs: [body.image],
      });
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/ai-data') {
      const body = JSON.parse(await readBody(req));
      if (!body.prompt) return json(res, 400, { error: '缺少 prompt' });
      fs.mkdirSync(TMP, { recursive: true });
      const refs = [];
      for (const [i, dataUrl] of (body.refsData || []).slice(0, 5).entries()) {
        const b64 = String(dataUrl).split(',')[1];
        if (!b64) continue;
        const file = path.join(TMP, `ref-${Date.now()}-${i}.jpg`);
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        refs.push(path.relative(ROOT, file));
      }
      const result = await generateImage({
        prompt: body.prompt, size: body.size || '1152x1536', quality: body.quality || 'high', refs,
      }).catch(err => {
        const msg = String(err.message || err);
        if (/缺少 (OPENAI|GEMINI)_API_KEY/.test(msg)) {
          throw new Error('服务器还没配置生图 Key：在托管平台的环境变量里填 GEMINI_API_KEY（或 OPENAI_API_KEY）');
        }
        throw err;
      });
      return json(res, 200, { url: `http://127.0.0.1:${PORT}/${result.path}`, path: result.path });
    }

    if (req.method === 'POST' && url.pathname === '/api/ai') {
      const body = JSON.parse(await readBody(req));
      if (!body.prompt) return json(res, 400, { error: '缺少 prompt' });
      const result = await generateImage(body);
      return json(res, 200, result);
    }

    if (url.pathname.startsWith('/out/')) return serveFile(res, path.join(ROOT, url.pathname.slice(1)));
    if (url.pathname.startsWith('/assets/')) return serveFile(res, path.join(ROOT, url.pathname.slice(1)));
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveFile(res, path.join(ROOT, 'public', 'index.html'));
    }
    return serveFile(res, path.join(ROOT, 'public', url.pathname.replace(/^\/+/, '')));
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err.message || err) });
  }
});

const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`旅游图工坊已启动： http://127.0.0.1:${PORT}`);
});
