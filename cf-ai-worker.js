/**
 * Cloudflare Workers AI 代理（开源博客版）
 * 部署到 Cloudflare Workers 作为前端与 AI 之间的桥接层
 *
 * 🔒 安全策略：靠 CORS Origin 白名单防护
 *    - 浏览器同源策略保证 Origin 无法伪造（其他网站盗用会被拦）
 *    - 不存任何密钥/token（开源仓库安全）
 *    - 配合 Cloudflare Workers 内置 rate limit 防脚本滥用
 *
 * 部署步骤：
 *   1) Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2) Deploy → Quick Edit → 粘贴本文件内容 → Deploy
 *   3) Settings → Bindings → Add Binding → Workers AI → Binding name 填 "AI"
 *   4) 把生成的 Worker URL 填入 assets/js/ai.js 顶部的 WORKER_URL
 *
 * 免费额度：Workers AI 每天 10 万次推理（个人账户）
 */

// ====== 🔒 安全配置：只允许这些域名访问 ======
const ALLOWED_ORIGINS = [
  'https://sunrise150.github.io',     // 你的博客（GitHub Pages）
  'http://localhost:8000',            // 本地开发
  'http://127.0.0.1:8000',
  'http://localhost:5500',            // VSCode Live Server 默认端口
  'http://localhost:8787',            // wrangler dev 默认端口
  'http://127.0.0.1:8787',
];
// =============================================

// ====== 🤖 模型配置（免费模型，想换改这里） ======
// 推荐：
//   '@cf/meta/llama-3.1-8b-instruct-fp8'  — 量化版，更快（推荐）
//   '@cf/meta/llama-3.1-8b-instruct'      — 标准版
//   '@cf/qwen/qwen1.5-7b-chat'            — 中文最好
//   '@cf/meta/llama-3.2-3b-instruct'      — 最快
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const SYSTEM_PROMPT = '你是一个友好、简洁的 AI 助手。请用中文回答，回复尽量精炼。';

export default {
  async fetch(request, env) {
    // ==== CORS + Origin 白名单检查 ====
    const origin = request.headers.get('Origin') || '';
    const isAllowed = ALLOWED_ORIGINS.includes(origin);
    const corsHeaders = {
      // 只对白名单内的 Origin 返回真实 Origin，否则返回 'null'
      'Access-Control-Allow-Origin': isAllowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Content-Type': 'application/json; charset=utf-8',
    };

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 🚫 Origin 不在白名单 → 直接拒绝（包括 curl 无 Origin 的情况）
    if (!isAllowed) {
      return new Response(
        JSON.stringify({ result: -1, error: 'Forbidden: origin not allowed' }),
        { status: 403, headers: corsHeaders }
      );
    }

    // 只允许 POST
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ result: -1, error: 'Method Not Allowed' }),
        { status: 405, headers: corsHeaders }
      );
    }

    // 检查 Workers AI Binding
    if (!env.AI) {
      return new Response(
        JSON.stringify({ result: -1, error: 'Workers AI Binding 未配置，请在 Settings → Bindings 添加 Workers AI binding，名称为 AI' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // ==== 解析请求 ====
    let userMsg, history = [];
    try {
      const body = await request.json();
      userMsg = body.msg || body.prompt || body.message || '';
      if (Array.isArray(body.history)) history = body.history;
    } catch {
      return new Response(
        JSON.stringify({ result: -1, error: 'JSON 解析失败' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!userMsg || !userMsg.trim()) {
      return new Response(
        JSON.stringify({ result: -1, error: '消息不能为空' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // ==== 构造多轮 messages ====
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const h of history.slice(-20)) {
      const role = h.role === 'assistant' ? 'assistant' : 'user';
      const content = String(h.content || h.text || '').slice(0, 2000);
      if (content) messages.push({ role, content });
    }
    messages.push({ role: 'user', content: userMsg.trim().slice(0, 4000) });

    // ==== 调用 Workers AI ====
    try {
      const response = await env.AI.run(DEFAULT_MODEL, { messages });
      const reply = (response && response.response) || (response && response.result) || '';
      if (!reply) {
        return new Response(
          JSON.stringify({ result: -1, error: 'AI 返回空响应' }),
          { status: 502, headers: corsHeaders }
        );
      }
      return new Response(
        JSON.stringify({ result: 0, content: reply }),
        { headers: corsHeaders }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ result: -1, error: 'AI 调用失败：' + (err.message || String(err)) }),
        { status: 502, headers: corsHeaders }
      );
    }
  },
};
