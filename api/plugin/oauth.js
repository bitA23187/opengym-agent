import { InvalidClientError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError, InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { hash, random } from './store.js';
export const SCOPES = ['plan:read', 'plan:write', 'training:read', 'training:write', 'body:read', 'body:write', 'nutrition:read', 'nutrition:write', 'health:read'];
export const PREFIX = '/api/plugin';
export const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const scopeLabel = s => ({
  'plan:read':'读取训练方案、动作和每周安排',
  'plan:write':'新增训练模板、修改动作方案和安排',
  'training:write':'新增、纠正或删除训练记录，维护训练备注',
  'nutrition:read':'读取本账号的餐次、营养摄入与每日汇总',
  'nutrition:write':'记录、修改或删除本账号的饮食摄入',
  'health:read':'读取本账号的睡眠、静息心率与 HRV 趋势',
  'body:read':'读取本账号的体重、围度与目标体重',
  'body:write':'记录、修改或删除本账号的体重、围度和目标体重',
  'training:read':'读取训练历史、逐组记录、训练备注与统计汇总（不含体重）',
})[s] || s;
export function html(res, title, content, status = 200, head = '', scriptNonce = null) {
  res.status(status).set({ 'Cache-Control':'no-store', 'Referrer-Policy':'strict-origin',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'"+(scriptNonce?"; script-src 'nonce-"+scriptNonce+"'":""),
    'X-Content-Type-Options':'nosniff' }).type('html').send(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<title>${esc(title)}</title><style>body{font:17px/1.7 system-ui;max-width:600px;margin:8vh auto;padding:24px;background:#f7f8f5;color:#19231d}button,a{font:inherit}button{padding:10px 20px;margin:8px 0;cursor:pointer}small{color:#59645d}code{overflow-wrap:anywhere}</style><h1>${esc(title)}</h1>${content}</html>`);
}
export function createOAuth({ origin, store, userById, readSession }) {
  const resource = origin + PREFIX + '/mcp';
  const pending = new Map(), codes = new Map(), management = new Map();
  const validRedirect = raw => { try {
    const u = new URL(raw);
    return u.origin === 'https://chatgpt.com' && !u.hash && !u.search &&
      (u.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname));
  } catch { return false; } };
  const prune = () => { for (const map of [pending, codes, management]) for (const [id, v] of map) if (v.exp <= Date.now()) map.delete(id); };
  const scopesOf = requested => {
    const scopes = requested?.length ? [...new Set(requested)] : [...SCOPES];
    if (!scopes.length || scopes.some(s => !SCOPES.includes(s))) throw new InvalidScopeError('Only '+SCOPES.join(', ')+' are supported');
    return scopes;
  };
  const target = value => { if (!value || String(value) !== resource) throw new InvalidTargetError('The resource must be ' + resource); };
  const activeGrants = user => Object.entries(store.data.grants).filter(([,g])=>g.uid===user.id&&!g.revoked&&g.exp>Date.now()&&g.sv===(user.sv||0));
  const connectionLimit = (user, client) => new Set(activeGrants(user).map(([,g])=>g.client).filter(id=>id!==client)).size >= 10;
  function grantFor(id) {
    const g = store.data.grants[id], user = g && userById(g.uid);
    if (!g || g.revoked || g.exp <= Date.now() || !user || user.disabled || (user.sv || 0) !== g.sv) throw new InvalidTokenError('Authorization expired or revoked');
    return { g, user };
  }
  function issue(grantId, clientId, scopes) {
    const access = random(), refresh = random(), { g } = grantFor(grantId);
    if (Object.values(store.data.tokens).filter(t=>t.grant===grantId&&t.exp>Date.now()).length >= 2000) throw new InvalidGrantError('Refresh limit reached; reconnect openGym');
    store.data.tokens[hash(access)] = { type:'access', grant:grantId, client:clientId, scopes, exp:Math.min(Date.now()+3600000,g.exp) };
    store.data.tokens[hash(refresh)] = { type:'refresh', grant:grantId, client:clientId, scopes, exp:g.exp };
    store.save();
    return { access_token:access, token_type:'Bearer', expires_in:Math.max(1,Math.floor((Math.min(Date.now()+3600000,g.exp)-Date.now())/1000)), refresh_token:refresh, scope:scopes.join(' ') };
  }
  const provider = {
    // Validate PKCE here as well as binding code, client, callback and resource.
    skipLocalPkceValidation: true,
    clientsStore: {
      getClient(id) {
        if (id === 'https://chatgpt.com/oauth/client.json') return { client_id:id, client_name:'ChatGPT',
          redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method:'none',
          grant_types:['authorization_code','refresh_token'], response_types:['code'] };
        return Object.hasOwn(store.data.clients,id) ? store.data.clients[id] : undefined;
      },
      registerClient(client) {
        if (!client.redirect_uris?.length || client.redirect_uris.length > 3 || !client.redirect_uris.every(validRedirect)) throw new InvalidClientError('Only ChatGPT callback URLs are allowed');
        if (!['none','client_secret_post'].includes(client.token_endpoint_auth_method || 'client_secret_post')) throw new InvalidClientError('Unsupported client authentication');
        const entries = Object.entries(store.data.clients);
        if (entries.length >= 100) {
          const unlinked = entries.find(([id]) => !Object.values(store.data.grants).some(g => g.client === id && !g.revoked));
          if (!unlinked) throw new InvalidClientError('Client limit reached');
          delete store.data.clients[unlinked[0]];
        }
        const full = { ...client, client_id:random(), client_id_issued_at:Math.floor(Date.now()/1000) };
        store.data.clients[full.client_id] = full; store.save(); return full;
      },
    },
    async authorize(client, params, res) {
      prune(); target(params.resource);
      if (!validRedirect(params.redirectUri) || !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('Invalid callback or PKCE challenge');
      if (pending.size >= 200) throw new InvalidRequestError('Too many pending authorizations');
      const request = random();
      pending.set(request, { client:client.client_id, ...params, resource, scopes:scopesOf(params.scopes), nonce:random(), uid:null, exp:Date.now()+600000 });
      res.redirect(PREFIX + '/consent?request=' + request);
    },
    async challengeForAuthorizationCode(client, code) {
      prune(); const c = codes.get(hash(code));
      if (!c || c.client !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
      return c.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, verifier, redirectUri, requestedResource) {
      prune(); const c = codes.get(hash(code)); target(requestedResource);
      if (!c || c.client !== client.client_id || redirectUri !== c.redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier || '') ||
        Buffer.from(hash(verifier),'hex').toString('base64url') !== c.codeChallenge) throw new InvalidGrantError('Invalid authorization code or PKCE');
      const user = userById(c.uid);
      if (!user || user.disabled || (user.sv||0)!==c.sv) throw new InvalidGrantError('Authorization expired or revoked');
      if (connectionLimit(user, client.client_id)) throw new InvalidGrantError('Connection limit reached; revoke an old connection');
      codes.delete(hash(code));
      // Consent alone is not a connection. Replace only after a valid PKCE
      // exchange, so an abandoned callback cannot fill slots or break old tokens.
      const grant = random(), now = Date.now();
      const previousGrants = { ...store.data.grants }, previousTokens = { ...store.data.tokens };
      for (const [id,g] of activeGrants(user)) if (g.client===client.client_id) store.data.grants[id]={...g,revoked:true};
      store.data.grants[grant]={uid:user.id,sv:user.sv||0,client:client.client_id,scopes:c.scopes,created:now,exp:now+30*86400000,revoked:false};
      try {
        const tokens=issue(grant, client.client_id, c.scopes);
        const receipt=pending.get(c.request)?.result;
        if (receipt?.codeHash===hash(code)) { receipt.exchanged=true;delete receipt.redirect; }
        return tokens;
      }
      catch (error) { store.data.grants=previousGrants;store.data.tokens=previousTokens;throw error; }
    },
    async exchangeRefreshToken(client, refresh, requestedScopes, requestedResource) {
      target(requestedResource);
      const t = store.data.tokens[hash(refresh)];
      if (!t || t.type !== 'refresh' || t.client !== client.client_id || t.exp <= Date.now()) throw new InvalidGrantError('Invalid refresh token');
      if (t.used) { if (store.data.grants[t.grant]) store.data.grants[t.grant].revoked = true; store.save(); throw new InvalidGrantError('Refresh token reuse; authorization revoked'); }
      const scopes = requestedScopes?.length ? scopesOf(requestedScopes) : t.scopes;
      if (scopes.some(s => !t.scopes.includes(s))) throw new InvalidScopeError('Cannot expand scopes');
      grantFor(t.grant); t.used = true;
      return issue(t.grant, client.client_id, scopes);
    },
    async verifyAccessToken(token) {
      const t = store.data.tokens[hash(token)];
      if (!t || t.type !== 'access' || t.exp <= Date.now()) throw new InvalidTokenError('Invalid access token');
      const { user } = grantFor(t.grant);
      return { token, clientId:t.client, scopes:t.scopes, expiresAt:Math.floor(t.exp/1000), resource,
        extra:{ uid:user.id, grant:t.grant } };
    },
    async revokeToken(client, request) {
      const t = store.data.tokens[hash(request.token)];
      if (t?.client === client.client_id && store.data.grants[t.grant]) { if (store.data.grants[t.grant]) store.data.grants[t.grant].revoked = true; store.save(); }
    },
  };
  function session(req) { return req.headers.cookie ? readSession({ ...req, headers: { ...req.headers, authorization: undefined } }) : null; }
  function sameOrigin(req) { return req.headers.origin === origin; }
  function mount(app) {
    app.get(PREFIX+'/connect',(req,res)=> {
      return html(res,'用 ChatGPT 管理你的训练',`
        <style>
          h1{font-size:1.8em;line-height:1.3}h2{font-size:1.15em;margin:32px 0 10px}
          a{color:#285e40;text-underline-offset:3px}p{margin:12px 0}
          table{width:100%;border-collapse:collapse;margin:16px 0;background:#fff;font-size:16px}
          th,td{padding:12px;text-align:left;vertical-align:top;border:1px solid #dce3da}
          thead{background:#eaf0e7}tbody th{width:30%;font-weight:500}td{overflow-wrap:anywhere}
          blockquote{margin:16px 0;padding:14px 18px;background:#eaf0e7;border-left:3px solid #52785b}
          details{margin:24px 0}summary{cursor:pointer;font-weight:600}
          @media(max-width:480px){body{margin:24px auto;padding:20px}h1{font-size:1.6em}th,td{padding:10px 8px}}
        </style>
        <p>连接 OpenGym 后，就能在 ChatGPT 里查看训练计划、回顾训练记录，或一起调整接下来的安排。</p>
        <p>第一次设置建议用电脑浏览器完成。无需下载插件压缩包，也不用安装额外的软件。</p>
        <h2>1. 先登录 OpenGym</h2>
        <p>已有账号？直接<a href="/" target="_blank" rel="noopener noreferrer">打开 OpenGym 登录</a>。还没有账号？向邀请你的人索取注册链接，用它创建账号。</p>
        <p>如果你已经在安卓 App 里使用 OpenGym，请在浏览器中登录同一个账号，不用重新注册。</p>
        <h2>2. 在 ChatGPT 中添加 OpenGym</h2>
        <p>登录你自己的 ChatGPT，打开 <a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">Plugins（插件）页面</a>，点击 <strong>＋ → 添加自定义 MCP 服务器（Add custom MCP server）</strong>，按下表填写：</p>
        <table aria-label="OpenGym 插件填写说明">
          <thead><tr><th scope="col">项目</th><th scope="col">填写内容</th></tr></thead>
          <tbody>
            <tr><th scope="row">名称</th><td>OpenGym</td></tr>
            <tr><th scope="row">描述（如需）</th><td>管理我的训练计划和训练记录</td></tr>
            <tr><th scope="row">连接方式（如需）</th><td>公共 HTTPS / URL</td></tr>
            <tr><th scope="row">MCP 服务器地址</th><td><code>${esc(resource)}</code></td></tr>
            <tr><th scope="row">身份验证</th><td><strong>OAuth</strong></td></tr>
          </tbody>
        </table>
        <p>查看页面提示，勾选“我理解并希望继续”（I understand and want to continue），再点击<strong>创建为插件（Create as a plugin）</strong>。</p>
        <p><small>如果没有“添加自定义 MCP 服务器”选项，可能是当前 ChatGPT 账号或工作区尚未开放此功能。可以把当前页面截图发给邀请你的人，协助确认。</small></p>
        <h2>3. 登录并同意连接</h2>
        <p>在弹出的 OpenGym 页面中登录，确认显示的是你的账号，再点击<strong>同意授权</strong>。如果提示先登录，就按页面指引完成登录，再返回继续。</p>
        <h2>4. 开始聊天</h2>
        <p>回到 ChatGPT，安装刚创建的 OpenGym 插件。开启一个新聊天，在输入框输入 <strong>@</strong> 并选择 OpenGym，然后发送：</p>
        <blockquote>先检查当前连接的 OpenGym 账号，再读取我的训练计划。</blockquote>
        <p>确认账号和计划正确后，就可以试着问：</p>
        <ul><li>我今天该练什么？</li><li>帮我回顾最近一个月的训练。</li><li>我每周能练三天，帮我调整训练安排，先给我看修改内容。</li></ul>
        <p>修改计划或记录时，先查看预览，确认后再保存。</p>
        <details><summary>我还想在安卓 OpenGym App 中同步使用</summary>
          <p>在 App 中选择“连接到我的服务器”，服务器地址填写：</p>
          <p><code>${esc(origin)}</code></p>
          <p>在 OpenGym 网页中找到“配对手机”，生成配对码，再填到 App 里。配对码请从你自己的账号生成。</p>
          <p>如果训练数据还只保存在手机上，请先同步，再让 ChatGPT 读取。</p>
        </details>
        <p><a href="/">打开 OpenGym</a> · <a href="${PREFIX}/connections">管理或断开连接</a></p>`);
    });
    app.get(PREFIX+'/consent', (req,res) => {
      prune(); const p = pending.get(String(req.query.request)), user = session(req);
      if (!p) return html(res,'授权请求已过期','请返回 ChatGPT 重新连接。',400);
      if (!user) return html(res,'请先登录 openGym',`<p>请在同一浏览器登录你自己的 OpenGym 账号，完成后返回此页继续。</p><p>安卓 App 和浏览器的登录状态独立。已有手机账号请登录原账号，不要重复注册；不要使用别人账号的设备配对码。</p><p><a href="/" target="_blank" rel="noopener">打开 openGym 登录</a></p><p><a href="${PREFIX}/consent?request=${esc(req.query.request)}">我已登录，继续</a></p><p><a href="${PREFIX}/connect">查看完整接入说明</a></p>`);
      if (p.result) {
        if (p.uid!==user.id || p.sv!==(user.sv||0)) return html(res,'无法查看授权结果','账号已切换，请返回 ChatGPT 重新连接。',403);
        return res.redirect(303,PREFIX+'/consent/result?request='+encodeURIComponent(req.query.request));
      }
      p.uid = user.id; p.sv = user.sv || 0;
      // A page rendered before switching browser accounts must not approve the
      // newly displayed identity, even if an old form is submitted afterwards.
      p.nonce = random();
      return html(res,'授权 ChatGPT 连接 openGym',`<p>当前账户：<strong>${esc(user.name)}</strong></p><p>仅允许 ChatGPT 访问这个账号；不会授权其他用户的账号。如果名称不对，请先在 OpenGym 退出并登录自己的账号，再返回刷新。通过私人 Plugin：</p><ul>${p.scopes.map(s=>`<li>${scopeLabel(s)}</li>`).join('')}</ul><p>仅授予上面列出的权限，不包括账户或管理员权限。默认在写入前展示具体内容并要求确认；账号已明确开启训练记录直接保存时，普通训练记录无需再回复确认。</p><small>授权最多有效 30 天，可随时撤销。退出全部设备也会使授权失效。</small><p>重新连接成功后，会替换当前 OpenGym 账号在同一 ChatGPT 客户端的旧授权，权限以上面列表为准。使用旧授权的其他连接也需重新连接；尚未保存的修改需重新预览。只打开授权页或点击同意，不会立即替换原连接。</p><form method="post" action="${PREFIX}/consent"><input type="hidden" name="request" value="${esc(req.query.request)}"><input type="hidden" name="nonce" value="${p.nonce}"><button name="decision" value="allow">同意授权</button> <button name="decision" value="deny">取消</button></form><p id="consent-status" role="status" aria-live="polite"></p><p><a href="${PREFIX}/connections">管理已授权连接</a></p><script nonce="${p.nonce}">
        const form=document.querySelector('form');let submitted=false;
        form.addEventListener('submit',event=>{
          if(submitted){event.preventDefault();return;}
          submitted=true;
          const decision=document.createElement('input');decision.type='hidden';decision.name='decision';decision.value=event.submitter?.value||'deny';form.append(decision);
          for(const button of form.querySelectorAll('button'))button.disabled=true;
          document.getElementById('consent-status').textContent='正在处理，请稍候…无需重复点击。';
        });
      </script>`,200,'',p.nonce);
    });
    app.post(PREFIX+'/consent', (req,res) => {
      prune(); const p=pending.get(req.body.request), user=session(req);
      if (!sameOrigin(req) || !p || !user || p.uid!==user.id || p.sv!==(user.sv||0) || req.body.nonce!==p.nonce) return html(res,'无法授权','登录或授权请求已失效，请重新连接。',403);
      if (p.result) return res.redirect(303,PREFIX+'/consent/result?request='+encodeURIComponent(req.body.request));
      const redirect = new URL(p.redirectUri); redirect.searchParams.set('iss',origin);
      if (p.state) redirect.searchParams.set('state',p.state);
      if (req.body.decision !== 'allow') redirect.searchParams.set('error','access_denied');
      else {
        if (connectionLimit(user,p.client)) return html(res,'连接数已达上限',`请先<a href="${PREFIX}/connections">撤销旧授权</a>。`,400);
        if (codes.size>=200) return html(res,'授权请求过多','请稍后返回 ChatGPT 重新连接。',429);
        const code=random();
        codes.set(hash(code),{...p,request:req.body.request,exp:Date.now()+60000}); redirect.searchParams.set('code',code);
      }
      p.result={redirect:redirect.href,decision:req.body.decision,codeHash:redirect.searchParams.has('code')?hash(redirect.searchParams.get('code')):null};
      // End the form navigation on our own origin. Chromium can apply form-action
      // to every redirect in ChatGPT's callback chain, leaving the old form visible.
      res.redirect(303,PREFIX+'/consent/result?request='+encodeURIComponent(req.body.request));
    });
    app.get(PREFIX+'/consent/result',(req,res)=> {
      prune(); const p=pending.get(String(req.query.request)),user=session(req),r=p?.result;
      if (!r || !user || p.uid!==user.id || p.sv!==(user.sv||0)) return html(res,'无法查看授权结果','登录或授权请求已失效，请返回 ChatGPT 重新连接。',403);
      if (r.exchanged) return html(res,'连接已完成','<p>ChatGPT 已领取新凭证。请回到 ChatGPT 继续。</p>');
      if (r.codeHash && !codes.has(r.codeHash)) return html(res,'返回链接已过期','<p>本站已收到你的同意，但 ChatGPT 未在有效时间内领取新凭证。请返回 ChatGPT 发起新的 Reconnect。</p>',400);
      const allowed=r.decision==='allow';
      return html(res,allowed?'已同意，正在返回 ChatGPT':'已取消授权',`<p>${allowed?'本站已收到你的同意，接下来由 ChatGPT 完成连接。':'此次请求未授予权限，正在返回 ChatGPT。'}</p><p>如果没有自动跳转，请点击：</p><p><a id="return-to-chatgpt" href="${esc(r.redirect)}" style="display:inline-block;padding:12px 20px;background:#285e40;color:white;border-radius:6px;text-decoration:none">返回 ChatGPT</a></p><p><small>无需重复授权。若 ChatGPT 仍未完成连接，请返回原聊天查看提示。</small></p>`,200,`<meta http-equiv="refresh" content="1;url=${esc(r.redirect)}">`);
    });
    app.get(PREFIX+'/connections',(req,res)=> {
      prune(); const user=session(req);
      if (!user) return html(res,'请先登录 openGym','<a href="/">打开登录页面</a>',401);
      const nonce=random(); if(management.size>=200)management.delete(management.keys().next().value);
      management.set(nonce,{uid:user.id,sv:user.sv||0,exp:Date.now()+600000});
      const entries=activeGrants(user).sort(([,a],[,b])=>b.created-a.created);
      const date = value => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(value));
      html(res,'ChatGPT 连接管理',`<p>账户：${esc(user.name)}</p><p>仅列出本站已批准的授权，不能判断 ChatGPT 是否已完成连接，也不能识别具体手机。重新连接成功后，会自动替换同一客户端的旧授权。</p><p>时间均为 UTC+8，最新授权排在前面。</p>${entries.length?entries.map(([id,g])=>`<form method="post" action="${PREFIX}/connections"><p><strong>ChatGPT</strong> · 授权 ${esc(id.slice(0,8))}<br>客户端：<code>${esc(g.client=== 'https://chatgpt.com/oauth/client.json'?'ChatGPT 官方客户端':g.client.slice(0,12))}</code><br>授权时间：${esc(date(g.created))}<br>有效至：${esc(date(g.exp))}</p><ul>${SCOPES.filter(s=>g.scopes.includes(s)).map(s=>`<li>${esc(scopeLabel(s))}</li>`).join('')}</ul><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="grant" value="${id}"><button>撤销此连接</button></form>`).join(''):'<p>没有有效的 Plugin 授权。</p>'}<p><a href="/">返回 openGym</a></p>`);
    });
    app.post(PREFIX+'/connections',(req,res)=> {
      prune(); const user=session(req), proof=management.get(req.body.nonce), g=store.data.grants[req.body.grant];
      if(!sameOrigin(req)||!user||!proof||proof.uid!==user.id||proof.sv!==(user.sv||0)||!g||g.uid!==user.id)return html(res,'无法撤销','请求已失效。',403);
      management.delete(req.body.nonce); g.revoked=true; store.save(); res.redirect(PREFIX+'/connections');
    });
  }
  return { provider, resource, mount };
}
