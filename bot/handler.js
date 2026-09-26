'use strict';
const {createHash} = require('node:crypto');
// Official MAX Bot API, https://dev.max.ru/docs-api — checked 2026-09-26.
const API = 'https://platform-api2.max.ru';
function welcome(config) {
  return {
    text: 'ДомПульс помогает заметить похожие обращения в доме. Откройте приложение, выберите общую зону и сообщите об отсутствии холодной воды. Это пилот: не указывайте личные данные. Сообщение в этом чате само по себе не создаёт заявку.',
    attachments: [{type:'inline_keyboard',payload:{buttons:[[{type:'open_app',text:'Открыть ДомПульс',web_app:config.botUsername}]]}}]
  };
}
function createBot(config, fetchImpl = fetch) {
  const recent = new Map();
  return async function handle(update) {
    if (!config.botToken || !config.botUsername) throw new Error('Bot not configured');
    let recipient;
    if (update?.update_type === 'bot_started') recipient = update.user?.user_id;
    else if (update?.update_type === 'message_created' && /^\/start(?:\s|$)/.test(update.message?.body?.text || '') && update.message?.sender?.is_bot !== true) recipient = update.message.sender?.user_id;
    else return;
    if (!Number.isSafeInteger(recipient) || recipient <= 0) return;
    const now = Date.now();
    for (const [key, expires] of recent) if (expires < now) recent.delete(key);
    // Only hashed event keys are retained for retries, not raw webhook bodies or user profiles.
    const dedupe = createHash('sha256').update(JSON.stringify([update.update_type,update.timestamp,recipient,update.message?.body?.mid])).digest('hex');
    if (recent.has(dedupe)) return;
    if (recent.size >= 10000) throw new Error('Bot busy');
    recent.set(dedupe,now+8*60*60*1000);
    try {
      const response = await fetchImpl(`${API}/messages?user_id=${recipient}`, {
        method:'POST',headers:{Authorization:config.botToken,'Content-Type':'application/json'},
        body:JSON.stringify(welcome(config)),signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('MAX API request failed');
    } catch (_) {recent.delete(dedupe); throw new Error('MAX API request failed');}
  };
}
module.exports = {createBot,welcome,API};
