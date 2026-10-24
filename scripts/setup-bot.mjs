/* Execute once after deploying Worker; no tokens are written to the repository. */
const token=process.env.TELEGRAM_BOT_TOKEN,worker=process.env.WORKER_URL,secret=process.env.TELEGRAM_WEBHOOK_SECRET,admin=process.env.ADMIN_TELEGRAM_ID;
if(!token||!worker||!secret||!admin||!/^https:\/\//.test(worker)){
 console.error('Required: TELEGRAM_BOT_TOKEN, WORKER_URL=https://..., TELEGRAM_WEBHOOK_SECRET, ADMIN_TELEGRAM_ID');process.exit(1);
}
async function telegram(method,body){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!data.ok)throw new Error(`${method}: ${data.description}`);return data.result;}
await telegram('setWebhook',{url:worker.replace(/\/$/,'')+'/webhook',secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false});
// Patients stay in an ordinary Telegram chat; the Mini App menu is only for this administrator.
await telegram('setChatMenuButton',{menu_button:{type:'commands'}});
await telegram('setChatMenuButton',{chat_id:admin,menu_button:{type:'web_app',text:'لوحة إدارة العمليات',web_app:{url:worker}}});
const patientMenu=await telegram('getChatMenuButton',{});
const adminMenu=await telegram('getChatMenuButton',{chat_id:admin});
if(patientMenu.type!=='commands'||adminMenu.type!=='web_app'||adminMenu.web_app?.url!==worker){throw new Error('فشل تأكيد فصل قائمة المريض عن قائمة المدير');}
await telegram('setMyCommands',{commands:[{command:'start',description:'بدء المحادثة وتفعيل الحساب'},{command:'change',description:'طلب تغيير الحساب'},{command:'recover',description:'طلب استعادة الحساب'}]});
console.log('✅ Patients: chat and commands only. Administrator: private Mini App. Webhook registered.');
