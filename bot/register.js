'use strict';
const {loadConfig} = require('../server/config');
const {API} = require('./handler');
async function main() {
  const c = loadConfig();
  if (!c.botToken || !c.webhookUrl || !c.webhookSecret || !c.botUsername || !c.miniAppUrl) throw new Error('Заполните настройки MAX в .env.');
  const url = new URL(c.webhookUrl);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw new Error('Webhook должен быть HTTPS на порту 443.');
  const response = await fetch(`${API}/subscriptions`, {method:'POST',headers:{Authorization:c.botToken,'Content-Type':'application/json'},
    body:JSON.stringify({url:c.webhookUrl,update_types:['bot_started','message_created'],secret:c.webhookSecret}),signal:AbortSignal.timeout(15000)});
  if (!response.ok || !(await response.json()).success) throw new Error('MAX не подтвердил подписку. Проверьте настройки и доверенную TLS-цепочку.');
  console.log('Webhook зарегистрирован. Откройте бота в MAX и нажмите Старт.');
}
if (require.main === module) main().catch(() => {console.error('Не удалось зарегистрировать webhook. Проверьте .env, доступность HTTPS:443 и доверенные сертификаты. Секреты и ответ API не выводятся.');process.exitCode=1;});
