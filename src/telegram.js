import {dateLabel} from './rules.js';
const te=new TextEncoder();
export async function sha256hex(s) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function hmac(key,data) { const k=await crypto.subtle.importKey('raw',typeof key==='string'?te.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,te.encode(data)));}
function hex(bytes){return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
function eq(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function verifyInitData(data, token, adminId, nowMs=Date.now()) {
  if(!data || !token || !adminId) return false;
  const params=new URLSearchParams(data), hash=params.get('hash'); if(!hash||!/^[0-9a-f]{64}$/.test(hash)) return false;
  const authTime=Number(params.get('auth_date')); if(!Number.isFinite(authTime) || Math.abs(nowMs/1000-authTime)>3600) return false;
  // For bot-token HMAC validation Telegram signs every field except `hash`.
  // `signature` must remain: it is excluded only by the separate Ed25519 third-party flow.
  params.delete('hash');
  const check=[...params.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=await hmac('WebAppData',token);
  const actual=hex(await hmac(secret,check)); if(!eq(actual,hash)) return false;
  try{return String(JSON.parse(params.get('user')||'{}').id)===String(adminId);}catch{return false;}
}
export function buttons(type,id,version=0,labels=['نعم','لا']){
  const suffix=type==='a'?`:${version}`:'';
  return {inline_keyboard:[[{text:labels[0],callback_data:`${type}:${id}:y${suffix}`},{text:labels[1],callback_data:`${type}:${id}:n${suffix}`}]]};
}
export function ackButton(id,label='اطلعت على الرسالة'){return {inline_keyboard:[[{text:label,callback_data:`m:${id}:k`}]]};}
// Plain chat confirmations keep the patient's experience in Telegram messages, not a web UI.
export function patientReplyReceipt(type,entity,answer,lang='ar'){
 if(type==='m')return lang==='en'?'We recorded that you have read the message.':'تم تسجيل اطلاعك على الرسالة.';
 const choice=answer==='yes'?(lang==='en'?'Yes':'نعم'):(lang==='en'?'No':'لا');
 if(type==='t')return lang==='en'
   ?`Your response was recorded: ${choice}.\nRequirement: ${entity.title}`
   :`تم تسجيل ردك: ${choice}.\nالمتطلب: ${entity.title}`;
 if(type==='a')return lang==='en'
   ?`Your appointment response was recorded: ${choice}.`
   :`تم تسجيل ردك على الموعد: ${choice}.`;
 return '';
}
export function taskText(t,lang='ar') {return lang==='en'?`Requirement: ${t.title}${t.note?'\n'+t.note:''}\nHave you completed it?`:`المتطلب: ${t.title}${t.note?'\n'+t.note:''}\nهل أنجزت هذا المتطلب؟`;}
export function appointmentText(a,lang='ar') {
 const type=a.kind==='surgery'?(lang==='en'?'operation':'العملية'):(lang==='en'?'signing appointment':'الحضور للتوقيع');
 return lang==='en'?`Please confirm your ${type}.\nDate: ${dateLabel(a.starts_at,lang)}\nLocation: ${a.place}${a.instructions?'\nInstructions: '+a.instructions:''}`:`يرجى تأكيد القدرة على الحضور لموعد ${type}.\nالتاريخ: ${dateLabel(a.starts_at,lang)}\nالمكان: ${a.place}${a.instructions?'\nالتعليمات: '+a.instructions:''}`;
}
export async function tg(env,method,payload) {
 if(!env.TELEGRAM_BOT_TOKEN) throw new Error('لم يتم إعداد رمز البوت');
 let response;
 try{response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}catch(e){throw new Error('تعذر الاتصال بخدمة تيليجرام');}
 const out=await response.json(); if(!out.ok) {const ex=new Error(`Telegram ${out.error_code||response.status}: ${out.description||'unknown error'}`);ex.permanent=(out.error_code===403||out.error_code===400);throw ex;}return out.result;
}
