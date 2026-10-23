const token=process.env.TELEGRAM_BOT_TOKEN;if(!token){console.error('Set TELEGRAM_BOT_TOKEN first');process.exit(1);}
const r=await fetch(`https://api.telegram.org/bot${token}/getUpdates`),data=await r.json();if(!data.ok)throw new Error(data.description);
const users=[...new Map(data.result.map(u=>{const m=u.message?.from||u.callback_query?.from;return m&&[m.id,m];}).filter(Boolean)).values()];
if(!users.length)console.log('No messages yet. Send /start to your new bot, then run again.');
else console.log('Telegram IDs from received messages:',users.map(p=>({id:p.id,username:p.username||'',name:p.first_name||''})));
