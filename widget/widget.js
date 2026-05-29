// OSHC Olivia Widget — 前端 JS (v2 Flywire Hybrid)
// 用法：<script src="https://chat.oshc.net/widget.js"
//        data-partner="au-unilink" data-site="oshc.net" async></script>
//
// v2 changes:
//   - Only collects 5 fields (no 38-field form)
//   - "立即购买" button → POST /click → gets Flywire referral URL
//     → window.open(url, '_blank') in new tab
//   - Removed purchase_url button-per-provider pattern
//   - Calls POST /quote for 5-provider comparison
//
// 单文件 vanilla JS，IIFE 自启动。不依赖外部库。
// 主题：医疗蓝 #0066CC，Olivia bot 头像

(function () {
  'use strict';

  // ============================================================
  // 配置（从 script 标签 data-* 读）
  // ============================================================
  const scriptEl = document.currentScript || (function () {
    const scripts = document.querySelectorAll('script[src*="/widget.js"]');
    return scripts[scripts.length - 1];
  })();

  const config = {
    partner: scriptEl?.getAttribute('data-partner') || 'au-unilink',
    site: scriptEl?.getAttribute('data-site') || detectSite(),
    lang: scriptEl?.getAttribute('data-lang') || detectLang(),
    channel: scriptEl?.getAttribute('data-channel') || 'organic',
    apiBase: scriptEl?.getAttribute('data-api') || (function () {
      try { return new URL(scriptEl.src).origin; } catch { return ''; }
    })(),
    primaryColor: scriptEl?.getAttribute('data-color') || '#0066CC',
    botName: scriptEl?.getAttribute('data-bot') || 'Olivia',
  };

  function detectSite() {
    try { return window.location.hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
  }
  function detectLang() {
    const h = document.documentElement.lang || navigator.language || '';
    if (h.startsWith('zh')) return 'zh-CN';
    if (h.startsWith('en')) return 'en';
    return 'zh-CN';
  }

  if (!config.apiBase) {
    console.warn('[olivia-widget] cannot infer apiBase from script src');
    return;
  }

  // ============================================================
  // i18n
  // ============================================================
  const isZh = (config.lang || '').startsWith('zh');
  const i18n = isZh ? {
    bubbleTitle: '在线咨询 Olivia',
    headerTitle: 'Olivia · OSHC 助手',
    headerSubtitle: '6 家政府认可 OSHC 对比',
    placeholder: '输入消息，回车发送…',
    sendLabel: '发送',
    closeLabel: '关闭',
    typing: 'Olivia 正在输入…',
    privacy: '对话仅用于 OSHC 报价对比，遵守隐私政策',
    errorReply: '哎呀网络抽风了一下，能再试一次吗？或者直接告诉我签证类型和入学时间～',
    buyNow: '立即购买',
    greeting: null,
  } : {
    bubbleTitle: 'Chat with Olivia',
    headerTitle: 'Olivia · OSHC Assistant',
    headerSubtitle: 'Compare 6 Govt-Approved OSHC',
    placeholder: 'Type a message — press Enter…',
    sendLabel: 'Send',
    closeLabel: 'Close',
    typing: 'Olivia is typing…',
    privacy: 'Conversations for OSHC comparison only · privacy respected',
    errorReply: 'Network hiccup — please try again or share your visa type and dates.',
    buyNow: 'Buy Now',
    greeting: null,
  };

  // ============================================================
  // 状态管理
  // ============================================================
  const state = {
    sessionId: sessionStorage.getItem('olivia-widget-session') || null,
    isOpen: false,
    isLoading: false,
    messages: JSON.parse(sessionStorage.getItem('olivia-widget-messages') || '[]'),
    selectedProvider: null,  // v2: tracked for /click call
    referralUrl: null,       // v2: cached from latest quote response
  };

  function saveState() {
    if (state.sessionId) sessionStorage.setItem('olivia-widget-session', state.sessionId);
    sessionStorage.setItem('olivia-widget-messages', JSON.stringify(state.messages.slice(-30)));
  }

  // ============================================================
  // CSS 注入
  // ============================================================
  const STYLE = `
.ow-bubble{position:fixed;right:22px;bottom:22px;z-index:2147483600;width:56px;height:56px;border-radius:50%;background:${config.primaryColor};cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,102,204,0.35);transition:transform 0.2s,box-shadow 0.2s;user-select:none;}
.ow-bubble:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,102,204,0.45);}
.ow-bubble-icon{width:28px;height:28px;border-radius:50%;background:#fff;color:${config.primaryColor};font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.ow-bubble-dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#10B981;border:2px solid #fff;}
.ow-bubble-close{display:none;width:24px;height:24px;position:relative;}
.ow-bubble-close::before,.ow-bubble-close::after{content:'';position:absolute;top:11px;left:2px;width:20px;height:2px;background:#fff;border-radius:1px;}
.ow-bubble-close::before{transform:rotate(45deg);}
.ow-bubble-close::after{transform:rotate(-45deg);}
.ow-panel{position:fixed;right:22px;bottom:90px;z-index:2147483600;width:380px;height:600px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.5;}
.ow-panel.open{display:flex;}
.ow-header{background:linear-gradient(135deg,${config.primaryColor},#004A9E);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;}
.ow-avatar{width:40px;height:40px;border-radius:50%;background:#fff;color:${config.primaryColor};font-weight:700;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ow-header-text{flex:1;min-width:0;}
.ow-header-name{font-size:15px;font-weight:600;}
.ow-header-sub{font-size:11px;opacity:0.85;}
.ow-header-close{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ow-messages{flex:1;overflow-y:auto;padding:12px 14px;background:#F5F7FA;display:flex;flex-direction:column;gap:10px;}
.ow-msg{max-width:82%;padding:10px 14px;border-radius:14px;word-wrap:break-word;line-height:1.5;font-size:13.5px;animation:owFadeIn 0.25s ease;}
.ow-msg.assistant{background:#fff;color:#1a1a1a;align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,0.06);}
.ow-msg.user{background:${config.primaryColor};color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}
.ow-msg ol,.ow-msg ul{padding-left:18px;margin:4px 0;}
.ow-msg li{margin:2px 0;}
.ow-msg strong{font-weight:600;}
.ow-msg a{color:${config.primaryColor};text-decoration:underline;}
.ow-msg p{margin:2px 0;}
.ow-msg-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.ow-btn{display:inline-flex;align-items:center;padding:7px 14px;border-radius:20px;font-size:12.5px;font-weight:500;cursor:pointer;text-decoration:none;transition:all 0.15s;border:none;}
.ow-btn-primary{background:${config.primaryColor};color:#fff;}
.ow-btn-primary:hover{background:#004A9E;}
.ow-btn-secondary{background:#E8EEF5;color:#333;}
.ow-btn-secondary:hover{background:#D0D7E0;}
.ow-typing{padding:10px 16px;color:#888;font-size:12px;font-style:italic;display:none;}
.ow-typing.active{display:block;}
.ow-typing-dots{display:inline-flex;gap:4px;vertical-align:middle;}
.ow-typing-dots span{width:6px;height:6px;border-radius:50%;background:#aaa;animation:owBounce 1.2s infinite;}
.ow-typing-dots span:nth-child(2){animation-delay:0.15s;}
.ow-typing-dots span:nth-child(3){animation-delay:0.3s;}
@keyframes owBounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-6px);}}
@keyframes owFadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
.ow-input-area{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #E8EEF5;background:#fff;flex-shrink:0;}
.ow-input{flex:1;border:1px solid #D0D7E0;border-radius:20px;padding:8px 14px;font-size:13.5px;outline:none;resize:none;font-family:inherit;background:#F5F7FA;max-height:80px;}
.ow-input:focus{border-color:${config.primaryColor};}
.ow-send{width:36px;height:36px;border-radius:50%;border:none;background:${config.primaryColor};color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;}
.ow-send:hover{background:#004A9E;}
.ow-send:disabled{background:#aaa;cursor:not-allowed;}
.ow-footer{text-align:center;padding:4px 14px 8px;font-size:10px;color:#aaa;flex-shrink:0;background:#fff;}
@media(max-width:480px){.ow-panel{right:0;bottom:0;width:100vw;height:100vh;max-height:100vh;border-radius:0;}.ow-bubble{bottom:16px;right:16px;}}
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ============================================================
  // DOM 构建
  // ============================================================
  function buildUI() {
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'ow-bubble';
    bubble.title = i18n.bubbleTitle;
    bubble.innerHTML = `
      <div class="ow-bubble-icon">O</div>
      <div class="ow-bubble-dot"></div>
      <div class="ow-bubble-close"></div>
    `;
    document.body.appendChild(bubble);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'ow-panel';
    panel.innerHTML = `
      <div class="ow-header">
        <div class="ow-avatar">O</div>
        <div class="ow-header-text">
          <div class="ow-header-name">${i18n.headerTitle}</div>
          <div class="ow-header-sub">${i18n.headerSubtitle}</div>
        </div>
        <button class="ow-header-close" title="${i18n.closeLabel}">✕</button>
      </div>
      <div class="ow-messages"></div>
      <div class="ow-typing"><span class="ow-typing-dots"><span></span><span></span><span></span></span> ${i18n.typing}</div>
      <div class="ow-input-area">
        <textarea class="ow-input" placeholder="${i18n.placeholder}" rows="1"></textarea>
        <button class="ow-send" title="${i18n.sendLabel}" disabled>➤</button>
      </div>
      <div class="ow-footer">${i18n.privacy}</div>
    `;
    document.body.appendChild(panel);

    return { bubble, panel };
  }

  const { bubble, panel } = buildUI();

  // Element refs
  const messagesEl = panel.querySelector('.ow-messages');
  const typingEl = panel.querySelector('.ow-typing');
  const inputEl = panel.querySelector('.ow-input');
  const sendBtn = panel.querySelector('.ow-send');
  const closeBtns = panel.querySelectorAll('.ow-header-close');
  const bubbleIcon = bubble.querySelector('.ow-bubble-icon');
  const bubbleClose = bubble.querySelector('.ow-bubble-close');

  // ============================================================
  // UI 交互
  // ============================================================
  function togglePanel() {
    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      panel.classList.add('open');
      bubbleIcon.style.display = 'none';
      bubbleClose.style.display = 'block';
      inputEl.focus();
    } else {
      panel.classList.remove('open');
      bubbleIcon.style.display = 'flex';
      bubbleClose.style.display = 'none';
    }
  }

  bubble.addEventListener('click', togglePanel);
  closeBtns.forEach(btn => btn.addEventListener('click', () => {
    if (state.isOpen) togglePanel();
  }));

  // Auto-resize input
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
    sendBtn.disabled = !inputEl.value.trim();
  });

  // Send on Enter (not Shift+Enter)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ============================================================
  // 消息渲染
  // ============================================================
  function addMessage(role, content, actions) {
    state.messages.push({ role, content, actions });
    saveState();

    const div = document.createElement('div');
    div.className = `ow-msg ${role}`;

    let html = parseMarkdown(content);
    div.innerHTML = html;

    // Action buttons (v2: single "立即购买" + provider selectors)
    if (actions && actions.length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'ow-msg-actions';
      actions.forEach(a => {
        if (a.type === 'buy-now') {
          // v2: "立即购买" button → POST /click → redirect
          const btn = document.createElement('button');
          btn.className = 'ow-btn ow-btn-primary';
          btn.textContent = a.label;
          btn.addEventListener('click', () => handleBuyNow(a.provider));
          actionsDiv.appendChild(btn);
        } else if (a.type === 'select-provider') {
          // Provider selection button
          const btn = document.createElement('button');
          btn.className = 'ow-btn ow-btn-secondary';
          btn.textContent = a.label;
          btn.addEventListener('click', () => {
            state.selectedProvider = a.provider;
            // Highlight selection
            actionsDiv.querySelectorAll('.ow-btn-secondary').forEach(b => b.style.background = '#E8EEF5');
            btn.style.background = '#C8D8F0';
          });
          actionsDiv.appendChild(btn);
        }
      });
      div.appendChild(actionsDiv);
    }

    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function parseMarkdown(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function scrollToBottom() {
    setTimeout(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 50);
  }

  function setTyping(active) {
    if (active) {
      typingEl.classList.add('active');
    } else {
      typingEl.classList.remove('active');
    }
    scrollToBottom();
  }

  // ============================================================
  // v2: "立即购买" → POST /click → get referral URL → redirect
  // ============================================================
  async function handleBuyNow(provider) {
    if (!state.sessionId || state.isLoading) return;
    state.isLoading = true;
    setTyping(true);

    try {
      // POST /click to record the click + get referral URL
      const resp = await fetch(`${config.apiBase}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          target_provider: provider || state.selectedProvider || null,
        }),
      });

      if (!resp.ok) throw new Error(`Click API ${resp.status}`);
      const data = await resp.json();

      setTyping(false);

      if (data.referral_url) {
        // Open Flywire landing in new tab
        window.open(data.referral_url, '_blank', 'noopener,noreferrer');
        addMessage('assistant',
          isZh
            ? '已为你打开购买页面！在新标签页中，你只需填写信息并支付，Flywire 会把保险证书直接发到你邮箱。如有任何问题，可以回到这里继续问我 👍'
            : 'Purchase page opened! Fill in your details on the Flywire landing page and complete payment. The COE certificate will be emailed to you directly. Feel free to come back here if you have questions 👍'
        );
      } else {
        addMessage('assistant', i18n.errorReply);
      }
    } catch (e) {
      setTyping(false);
      addMessage('assistant', i18n.errorReply);
      console.error('[olivia-widget] buy-now failed', e);
    }

    state.isLoading = false;
  }

  // ============================================================
  // API 交互
  // ============================================================
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || state.isLoading) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    addMessage('user', text);
    setTyping(true);
    state.isLoading = true;

    try {
      if (!state.sessionId) {
        const resp = await fetch(`${config.apiBase}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lang: config.lang,
            site: config.site,
            channel: config.channel,
          }),
        });
        const data = await resp.json();
        state.sessionId = data.session_id;
        saveState();
      }

      const resp = await fetch(`${config.apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          message: text,
          lang: config.lang,
        }),
      });

      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();

      setTyping(false);
      addMessage('assistant', data.reply);

      // v2: If quote present, render with "立即购买" button
      if (data.quote && data.quote.quotes) {
        // Cache referral URL
        if (data.quote.referral_url) {
          state.referralUrl = data.quote.referral_url;
        }

        const quoteLines = data.quote.quotes.map(function(q, i) {
          return (i + 1) + '. **' + q.provider + '** — ' + q.premium_formatted;
        });
        const recommended = data.quote.recommended;
        let quoteText = quoteLines.join('\n');
        if (recommended) {
          quoteText += '\n\n💡 推荐 → **' + recommended + '**';
        }

        // v2: Provider selection buttons + single "立即购买" button
        const actions = [];

        // Provider selection buttons
        data.quote.quotes.forEach(function(q) {
          actions.push({
            label: '选择 ' + q.provider,
            provider: q.provider,
            type: 'select-provider'
          });
        });

        // Single "立即购买" button
        actions.push({
          label: isZh ? '立即购买 ' + (recommended || '') : 'Buy Now ' + (recommended || ''),
          provider: recommended,
          type: 'buy-now'
        });

        addMessage('assistant', quoteText, actions);
      }
    } catch (e) {
      setTyping(false);
      addMessage('assistant', i18n.errorReply);
      console.error('[olivia-widget]', e);
    }

    state.isLoading = false;
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    // Restore existing messages
    state.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `ow-msg ${m.role}`;
      div.innerHTML = parseMarkdown(m.content);
      messagesEl.appendChild(div);
    });

    // If no messages yet, send empty to get greeting
    if (state.messages.length === 0) {
      sendInitialGreeting();
    }
  }

  async function sendInitialGreeting() {
    try {
      const resp = await fetch(`${config.apiBase}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: config.lang, message: '' }),
      });
      const data = await resp.json();
      state.sessionId = data.session_id;
      saveState();
      addMessage('assistant', data.reply);
    } catch {
      const greeting = isZh
        ? '👋 嗨！我是 Olivia，可以帮你 30 秒对比 5 家政府认可的 OSHC 报价。\n\n请问你是哪种签证？\n1. 500 学生签证\n2. 485 毕业生签证\n3. 482 工作签证\n4. 其他'
        : '👋 Hi! I\'m Olivia, I can help you compare 5 government-approved OSHC providers in 30 seconds.\n\nWhat type of visa are you on?\n1. 500 Student Visa\n2. 485 Graduate Visa\n3. 482 Work Visa\n4. Other';
      addMessage('assistant', greeting);
    }
  }

  init();
})();
