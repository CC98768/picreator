const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';

export default async (request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: '只支持 POST' }, 405, cors);

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json({ error: '服务器没配 GEMINI_API_KEY' }, 500, cors);

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体不是 JSON' }, 400, cors); }
  if (!body?.prompt) return json({ error: '缺少 prompt' }, 400, cors);

  const parts = [{ text: body.prompt }];
  for (const dataUrl of (body.refsData || []).slice(0, 3)) {
    const b64 = String(dataUrl).split(',')[1];
    if (b64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) },
  );
  const data = await res.json();
  if (!res.ok) return json({ error: data?.error?.message || `Gemini HTTP ${res.status}` }, 502, cors);

  const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
  const b64 = part?.inlineData?.data || part?.inline_data?.data;
  if (!b64) return json({ error: '模型没有返回图片' }, 502, cors);
  return json({ image: `data:image/png;base64,${b64}` }, 200, cors);
};

const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { ...headers, 'Content-Type': 'application/json' },
});
