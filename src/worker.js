import {reminderOffsets, dueAt, DAY} from './rules.js';
import {verifyInitData,sha256hex,tg,buttons,ackButton,taskText,appointmentText,patientReplyReceipt} from './telegram.js';
const now=()=>Date.now(),uid=()=>crypto.randomUUID(),j=x=>JSON.stringify(x), parse=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
const rows=async(q)=> (await q.all()).results||[];
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bad=(message,status=400)=>json({error:message},status);
const safeText=(v,max=400)=>String(v??'').trim().slice(0,max);
async function audit(env,pid,actor,action,details={}){await env.DB.prepare('INSERT INTO activity(id,patient_id,actor,action,details_json,at) VALUES (?,?,?,?,?,?)').bind(uid(),pid,actor,action,j(details),now()).run();}
async function enqueue(env,pid,kind,entityId,payload={},due=now()){const id=uid();await env.DB.prepare('INSERT INTO jobs(id,patient_id,kind,entity_id,payload_json,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,pid,kind,entityId,j(payload),due,now(),now()).run();return id;}
async function getPatient(env,id){return env.DB.prepare('SELECT * FROM patients WHERE id=?').bind(id).first();}
async function mustPatient(env,id,requireActive=false){const p=await getPatient(env,id);if(!p)throw Object.assign(new Error('المريض غير موجود'),{status:404});if(requireActive&&p.state!=='active')throw Object.assign(new Error('الحالة مؤرشفة'),{status:409});return p;}
async function cancelJobs(env,pid,entityId){await env.DB.prepare("UPDATE jobs SET state='cancelled',updated_at=? WHERE patient_id=? AND entity_id=? AND state='queued'").bind(now(),pid,entityId).run();}
function health(p){return {id:p.id,code:p.code,name:p.name,procedure_name:p.procedure_name,lang:p.lang,phone:p.phone,custom_json:parse(p.custom_json),telegram_id:p.telegram_id,telegram_username:p.telegram_username,pending_telegram_id:p.pending_telegram_id,pending_username:p.pending_username,state:p.state,created_at:p.created_at,archived_at:p.archived_at,updated_at:p.updated_at};}
function previewTime(epoch){return new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short'}).format(new Date(epoch));}
async function adminNotify(env,body){if(env.ADMIN_TELEGRAM_ID){try{await tg(env,'sendMessage',{chat_id:env.ADMIN_TELEGRAM_ID,text:body});}catch(e){console.error('admin notification unavailable',e.message);}}}
async function userCall(env,request,url){
 if(!await verifyInitData(request.headers.get('X-Telegram-Init-Data'),env.TELEGRAM_BOT_TOKEN,env.ADMIN_TELEGRAM_ID))return bad('افتح لوحة الإدارة من حساب المدير داخل تيليجرام',401);
 const method=request.method, path=url.pathname, x=path.split('/').filter(Boolean), body=['POST','PATCH','PUT'].includes(method)?await request.json().catch(()=>({})):{};
 try{
  if(path==='/api/overview'&&method==='GET'){
   const all=await rows(env.DB.prepare('SELECT id,code,name,procedure_name,state,lang,telegram_id,pending_telegram_id,created_at,updated_at,archived_at FROM patients ORDER BY updated_at DESC'));
   const app=await rows(env.DB.prepare("SELECT patient_id,kind,starts_at,answer,status FROM appointments WHERE status IN ('sent','draft','queued')"));
   const tasks=await rows(env.DB.prepare("SELECT patient_id,answer,status,reviewed FROM tasks"));
   const trouble=await rows(env.DB.prepare("SELECT patient_id,COUNT(*) n FROM jobs WHERE state='failed' GROUP BY patient_id"));
   return json({patients:all.map(p=>({...p,appointments:app.filter(a=>a.patient_id===p.id),tasks:tasks.filter(t=>t.patient_id===p.id),failed_jobs:trouble.find(t=>t.patient_id===p.id)?.n||0}))});
  }
  if(path==='/api/templates'&&method==='GET')return json({templates:await rows(env.DB.prepare('SELECT * FROM templates ORDER BY label')),fields:await rows(env.DB.prepare('SELECT * FROM custom_fields ORDER BY name')),catalog:await rows(env.DB.prepare('SELECT * FROM requirement_catalog WHERE enabled=1 ORDER BY title'))});
  if(path==='/api/templates'&&method==='POST'){
   const id=safeText(body.id||uid(),60),label=safeText(body.label,120),ar=safeText(body.ar,1200),en=safeText(body.en,1200);
   if(!label||!ar||!en)throw new Error('يرجى إكمال نصي اللغتين');
   await env.DB.prepare('INSERT INTO templates(id,label,ar,en) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,ar=excluded.ar,en=excluded.en').bind(id,label,ar,en).run();return json({ok:true});
  }
  if(path==='/api/catalog'&&method==='POST'){
   const title=safeText(body.title,150),note=safeText(body.note,600);if(!title)throw new Error('اسم المتطلب مطلوب');
   await env.DB.prepare('INSERT INTO requirement_catalog(id,title,note) VALUES(?,?,?)').bind(uid(),title,note).run();return json({ok:true});
  }
  if(path==='/api/fields'&&method==='POST'){
   const name=safeText(body.name,90),kind=safeText(body.kind,20);if(!name||!['text','number','date','select'].includes(kind))throw new Error('حقل غير صالح');
   await env.DB.prepare('INSERT INTO custom_fields(id,name,kind,required) VALUES(?,?,?,?)').bind(uid(),name,kind,body.required?1:0).run();return json({ok:true});
  }
  if(path==='/api/patients'&&method==='POST'){
   const name=safeText(body.name,100),proc=safeText(body.procedure_name,120),lang=body.lang==='en'?'en':'ar';if(!name)throw new Error('اسم المريض مطلوب');
   const id=uid(),code='P-'+String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000),token=uid().replaceAll('-','')+uid().replaceAll('-','');
   const hash=await sha256hex(token),ms=now();
   await env.DB.prepare('INSERT INTO patients(id,code,name,procedure_name,lang,phone,custom_json,activation_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,code,name,proc,lang,safeText(body.phone,32),j(body.custom_json||{}),hash,ms,ms).run();
   await audit(env,id,'admin','created');return json({id,code,deep_link:`https://t.me/${env.BOT_USERNAME||'YOUR_BOT'}?start=${token}`},201);
  }
  if(path==='/api/export'&&method==='GET'){
    const patients=await rows(env.DB.prepare('SELECT * FROM patients'));
    const result={version:1,exported_at:new Date().toISOString(),patients:[]};
    for(const p of patients){result.patients.push({patient:health(p),tasks:await rows(env.DB.prepare('SELECT * FROM tasks WHERE patient_id=?').bind(p.id)),appointments:await rows(env.DB.prepare('SELECT * FROM appointments WHERE patient_id=?').bind(p.id)),messages:await rows(env.DB.prepare('SELECT * FROM messages WHERE patient_id=?').bind(p.id)),activity:await rows(env.DB.prepare('SELECT * FROM activity WHERE patient_id=?').bind(p.id))});}
    return new Response(j(result),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="demo-backup.json"','Cache-Control':'no-store'}});
  }
  if(x[0]==='api'&&x[1]==='patients'&&x[2]){
   const id=x[2],p=await mustPatient(env,id),part=x[3],sub=x[4],extra=x[5];
   if(!part&&method==='GET'){
    const [tasks,appointments,messages,activity,jobs,backup]=await Promise.all([
      rows(env.DB.prepare('SELECT * FROM tasks WHERE patient_id=? ORDER BY created_at DESC').bind(id)),rows(env.DB.prepare('SELECT * FROM appointments WHERE patient_id=? ORDER BY created_at DESC').bind(id)),
      rows(env.DB.prepare('SELECT * FROM messages WHERE patient_id=? ORDER BY created_at DESC').bind(id)),rows(env.DB.prepare('SELECT * FROM activity WHERE patient_id=? ORDER BY at DESC LIMIT 80').bind(id)),
      rows(env.DB.prepare("SELECT kind,entity_id,state,attempt,due_at,last_error FROM jobs WHERE patient_id=? AND state IN ('queued','failed') ORDER BY due_at DESC LIMIT 20").bind(id)),
      rows(env.DB.prepare('SELECT id,created_at FROM backup_snapshots WHERE patient_id=? ORDER BY created_at DESC LIMIT 10').bind(id))]);
    return json({patient:health(p),tasks,appointments,messages,activity,jobs,backups:backup});
   }
   if(!part&&method==='PATCH'){
    await mustPatient(env,id,true);
    await env.DB.prepare('UPDATE patients SET name=?,procedure_name=?,lang=?,phone=?,custom_json=?,updated_at=? WHERE id=?').bind(safeText(body.name??p.name,100),safeText(body.procedure_name??p.procedure_name,120),body.lang==='en'?'en':'ar',safeText(body.phone??p.phone,32),j(body.custom_json??parse(p.custom_json)),now(),id).run();
    await audit(env,id,'admin','patient_updated');return json({ok:true});
   }
   if(part==='activation'&&sub==='reset'&&method==='POST'){
    const token=uid().replaceAll('-','')+uid().replaceAll('-','');
    await env.DB.prepare('UPDATE patients SET activation_hash=?,activation_used_at=NULL,pending_telegram_id=NULL,pending_username=NULL,updated_at=? WHERE id=?').bind(await sha256hex(token),now(),id).run();
    await audit(env,id,'admin','new_qr_issued');return json({deep_link:`https://t.me/${env.BOT_USERNAME||'YOUR_BOT'}?start=${token}`});
   }
   if(part==='activation'&&sub==='decision'&&method==='POST'){
    if(!p.pending_telegram_id)throw new Error('لا يوجد طلب تفعيل معلق');
    if(body.approve){
      await env.DB.prepare('UPDATE patients SET telegram_id=?,telegram_username=?,pending_telegram_id=NULL,pending_username=NULL,activation_hash=NULL,activation_used_at=?,updated_at=? WHERE id=?').bind(p.pending_telegram_id,p.pending_username,now(),now(),id).run();
      await cancelAllOutgoing(env,id);await audit(env,id,'admin','activation_approved',{telegram:p.pending_telegram_id});
      await tg(env,'sendMessage',{chat_id:p.pending_telegram_id,text:p.lang==='en'?'Your account has been activated.':'تم تفعيل حسابك بنجاح.'}).catch(()=>{});
    }else{
      await env.DB.prepare('UPDATE patients SET pending_telegram_id=NULL,pending_username=NULL,updated_at=? WHERE id=?').bind(now(),id).run();
      await audit(env,id,'admin','activation_rejected');
    }return json({ok:true});
   }
   if(part==='archive'&&method==='POST'){
    await env.DB.prepare("UPDATE patients SET state='archived',archived_at=?,updated_at=? WHERE id=?").bind(now(),now(),id).run();
    await env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE patient_id=? AND state='queued'").bind(id).run();
    await audit(env,id,'admin','archived');return json({ok:true});
   }
   if(part==='reactivate'&&method==='POST'){
    await env.DB.prepare("UPDATE patients SET state='active',archived_at=NULL,updated_at=? WHERE id=?").bind(now(),id).run();
    await audit(env,id,'admin','reactivated');return json({ok:true});
   }
   if(part==='tasks'&&method==='POST'&&!sub){
    await mustPatient(env,id,true);const title=safeText(body.title,150);if(!title)throw new Error('اسم المتطلب مطلوب');
    await env.DB.prepare('INSERT INTO tasks(id,patient_id,title,note,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(uid(),id,title,safeText(body.note,600),now(),now()).run();await audit(env,id,'admin','task_added',{title});return json({ok:true});
   }
   if(part==='tasks'&&sub==='send'&&method==='POST'){
    await mustPatient(env,id,true);if(!p.telegram_id)throw new Error('حساب المريض غير مفعّل');
    const draft=await rows(env.DB.prepare("SELECT * FROM tasks WHERE patient_id=? AND status='draft'").bind(id));
    for(const t of draft){await enqueue(env,id,'task_send',t.id);await env.DB.prepare("UPDATE tasks SET status='queued' WHERE id=?").bind(t.id).run();}
    return json({ok:true,queued:draft.length});
   }
   if(part==='tasks'&&sub&&method==='PATCH'&&!extra){
    await mustPatient(env,id,true);const t=await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND patient_id=?').bind(sub,id).first();if(!t)throw new Error('متطلب غير موجود');
    const action=body.action;
    if(action==='review'){
      if(!['pending','approved','redo'].includes(body.reviewed))throw new Error('حالة غير صحيحة');
      await env.DB.prepare('UPDATE tasks SET reviewed=?,redo_text=?,updated_at=? WHERE id=?').bind(body.reviewed,safeText(body.redo_text||'',1200),now(),sub).run();await audit(env,id,'admin','task_reviewed',{task:t.title,reviewed:body.reviewed});
    }else if(action==='edit'){
      if(t.status!=='draft')throw new Error('لا يمكن تغيير نص متطلب سبق إرساله؛ أضف متطلبًا جديدًا');
      await env.DB.prepare('UPDATE tasks SET title=?,note=?,updated_at=? WHERE id=?').bind(safeText(body.title,150),safeText(body.note,600),now(),sub).run();
    }else if(action==='cancel'){
      await env.DB.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=?").bind(now(),sub).run();await cancelJobs(env,id,sub);await audit(env,id,'admin','task_cancelled',{task:t.title});
      if(t.telegram_message_id&&p.telegram_id)await tg(env,'editMessageReplyMarkup',{chat_id:p.telegram_id,message_id:t.telegram_message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
    }else throw new Error('إجراء غير معروف');return json({ok:true});
   }
   if(part==='tasks'&&sub&&extra==='notify'&&method==='POST'){
    await mustPatient(env,id,true);if(!p.telegram_id)throw new Error('الحساب غير مفعل');
    const t=await env.DB.prepare('SELECT * FROM tasks WHERE id=? AND patient_id=?').bind(sub,id).first();if(!t)throw new Error('متطلب غير موجود');
    const text=safeText(body.text||t.redo_text||`يرجى مراجعة متطلب: ${t.title}`,1500);
    if(!text)throw new Error('الرسالة فارغة');
    const kind=body.type==='cancel'?'cancel_notice':'redo_notice';
    if(kind==='redo_notice'&&t.status!=='sent')throw new Error('المتطلب ليس نشطًا');
    if(kind==='cancel_notice'&&t.status!=='cancelled')throw new Error('يجب إلغاء المتطلب أولًا');
    await enqueue(env,id,kind,sub,{text});await audit(env,id,'admin','notice_queued',{kind,task:t.title});return json({ok:true});
   }
   if(part==='appointments'&&method==='POST'&&!sub){
    await mustPatient(env,id,true);if(!['surgery','signing'].includes(body.kind))throw new Error('نوع موعد غير صحيح');
    const starts=dueAt(body.starts_local);if(starts<=now())throw new Error('اختر موعدًا مستقبليًا');
    await env.DB.prepare('INSERT INTO appointments(id,patient_id,kind,starts_at,place,instructions,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid(),id,body.kind,starts,safeText(body.place,170),safeText(body.instructions,1500),now(),now()).run();await audit(env,id,'admin','appointment_drafted',{kind:body.kind,date:starts});return json({ok:true});
   }
   if(part==='appointments'&&sub&&method==='PATCH'&&!extra){
    await mustPatient(env,id,true);const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND patient_id=?').bind(sub,id).first();if(!a)throw new Error('الموعد غير موجود');
    const edited={starts_at:dueAt(body.starts_local),place:safeText(body.place,170),instructions:safeText(body.instructions,1500)};
    if(edited.starts_at<=now())throw new Error('اختر موعدًا مستقبليًا');
    if(a.status==='sent'){await env.DB.prepare('UPDATE appointments SET draft_json=?,updated_at=? WHERE id=?').bind(j(edited),now(),sub).run();await cancelJobs(env,id,sub);}
    else await env.DB.prepare('UPDATE appointments SET starts_at=?,place=?,instructions=?,updated_at=? WHERE id=?').bind(edited.starts_at,edited.place,edited.instructions,now(),sub).run();
    await audit(env,id,'admin','appointment_edited',{draft:a.status==='sent'});return json({ok:true});
   }
   if(part==='appointments'&&sub&&extra==='send'&&method==='POST'){
    await mustPatient(env,id,true);if(!p.telegram_id)throw new Error('حساب المريض غير مفعّل');
    const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND patient_id=?').bind(sub,id).first();if(!a)throw new Error('موعد غير موجود');
    if(a.status==='sent'&&!a.draft_json)throw new Error('لا يوجد تعديل جديد لإرساله');
    if(a.status==='queued')throw new Error('جار إرسال الموعد');
    const updated=a.draft_json?parse(a.draft_json):{starts_at:a.starts_at,place:a.place,instructions:a.instructions};
    if(updated.starts_at<=now())throw new Error('انتهى موعد الحضور');
    const version=a.version+1;
    await enqueue(env,id,'appointment_send',sub,{...updated,version});
    if(a.status==='draft')await env.DB.prepare("UPDATE appointments SET status='queued' WHERE id=?").bind(sub).run();
    await audit(env,id,'admin','appointment_send_queued',{version,date:updated.starts_at});return json({ok:true});
   }
   if(part==='appointments'&&sub&&extra==='reassign'&&method==='POST'){
    await mustPatient(env,id,true);
    const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND patient_id=?').bind(sub,id).first();
    const np=await mustPatient(env,String(body.new_patient_id||''),true);
    if(!a||a.status!=='sent'||np.id===id)throw new Error('تعذر نقل الموعد');
    const nId=uid(),ms=now();
    await env.DB.prepare('INSERT INTO appointments(id,patient_id,kind,starts_at,place,instructions,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)').bind(nId,np.id,a.kind,a.starts_at,a.place,a.instructions,'draft',ms,ms).run();
    await env.DB.prepare("UPDATE appointments SET status='replaced',updated_at=? WHERE id=?").bind(ms,a.id).run();
    await cancelJobs(env,id,a.id);
    if(p.telegram_id){await enqueue(env,id,'postponement_notice',a.id,{text:p.lang==='en'?'Your previous appointment has been postponed. A new date will be announced later.':'تم تأجيل موعدك السابق، وسيتم تحديد موعد جديد وإبلاغك به لاحقًا.'});
      if(a.telegram_message_id)await tg(env,'editMessageReplyMarkup',{chat_id:p.telegram_id,message_id:a.telegram_message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
    }
    await audit(env,id,'admin','appointment_reassigned',{new_patient_id:np.id});await audit(env,np.id,'admin','appointment_received',{from_patient_id:id});return json({ok:true,new_appointment_id:nId});
   }
   if(part==='appointments'&&sub&&extra==='instructions'&&method==='POST'){
    await mustPatient(env,id,true);if(!p.telegram_id)throw new Error('الحساب غير مفعّل');
    const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND patient_id=?').bind(sub,id).first();if(!a||a.status!=='sent')throw new Error('يجب إرسال الموعد أولًا');
    const messageId=uid(),text=safeText(body.text,1500);if(!text)throw new Error('التعليمات فارغة');
    await env.DB.prepare('INSERT INTO messages(id,patient_id,kind,appointment_id,body,ack_required,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(messageId,id,'instruction',sub,text,1,now(),now()).run();
    await enqueue(env,id,'message_send',messageId);return json({ok:true});
   }
   if(part==='messages'&&method==='POST'&&!sub){
    await mustPatient(env,id,true);if(!p.telegram_id)throw new Error('الحساب غير مفعّل');
    const text=safeText(body.text,1500);if(!text)throw new Error('الرسالة فارغة');const mid=uid();
    await env.DB.prepare('INSERT INTO messages(id,patient_id,kind,body,ack_required,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(mid,id,'general',text,body.ack?1:0,now(),now()).run();await enqueue(env,id,'message_send',mid);return json({ok:true});
   }
   if(part==='backups'&&sub&&extra==='restore'&&method==='POST'){
     if(p.state!=='active')throw new Error('الاستعادة متاحة للمريض النشط فقط');
     const s=await env.DB.prepare('SELECT * FROM backup_snapshots WHERE id=? AND patient_id=?').bind(sub,id).first();if(!s)throw new Error('النسخة غير موجودة');
     if(await env.DB.prepare('SELECT id FROM deleted_ids WHERE id=?').bind(id).first())throw new Error('تم حذف هذا الحساب ولا يمكن استعادته');
     // Restore editable fields only, never Telegram binding, messages, appointments or side effects.
     const data=parse(s.data_json);if(!data.patient)throw new Error('نسخة تالفة');
     await env.DB.prepare('UPDATE patients SET custom_json=?,procedure_name=?,lang=?,updated_at=? WHERE id=?').bind(data.patient.custom_json||'{}',data.patient.procedure_name||'',data.patient.lang||'ar',now(),id).run();
     await audit(env,id,'admin','profile_restored_from_backup',{snapshot:sub});return json({ok:true,scope:'profile_only'});
   }
  }
  throw Object.assign(new Error('العنوان غير معروف'),{status:404});
 }catch(e){return bad(e.message||'تعذر إتمام العملية',e.status||400);}
}
async function cancelAllOutgoing(env,id){await env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE patient_id=? AND state='queued' AND kind IN ('activation_request')").bind(id).run();}
function isFinalTelegramError(msg){return /Telegram (403|400):/i.test(msg);}
async function doJob(env,job){
 const pid=job.patient_id,p=await getPatient(env,pid),payload=parse(job.payload_json);
 if(!p||p.state!=='active'||!p.telegram_id) return {cancel:true};
 const currentNow=now(),chat=p.telegram_id;
 if(job.kind==='task_send'){
  const t=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(job.entity_id).first();if(!t||t.status!=='queued')return {cancel:true};
  const result=await tg(env,'sendMessage',{chat_id:chat,text:taskText(t,p.lang),reply_markup:buttons('t',t.id,0,p.lang==='en'?['Yes','No']:['نعم','لا'])});
  await env.DB.prepare("UPDATE tasks SET status='sent',telegram_message_id=?,updated_at=? WHERE id=?").bind(result.message_id,currentNow,t.id).run();
  await audit(env,pid,'bot','task_sent',{task:t.title});return {sent:true,message_id:result.message_id};
 }
 if(job.kind==='appointment_send'){
  const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(job.entity_id).first();if(!a||a.status==='cancelled'||a.version>=payload.version)return {cancel:true};
  const next={...a,starts_at:payload.starts_at,place:payload.place,instructions:payload.instructions,version:payload.version};
  const result=await tg(env,'sendMessage',{chat_id:chat,text:appointmentText(next,p.lang),reply_markup:buttons('a',a.id,next.version,p.lang==='en'?['Yes, I can attend','No']:['نعم، أستطيع','لا أستطيع'])});
  if(a.telegram_message_id)await tg(env,'editMessageReplyMarkup',{chat_id:chat,message_id:a.telegram_message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
  await cancelJobs(env,pid,a.id);
  await env.DB.prepare("UPDATE appointments SET starts_at=?,place=?,instructions=?,version=?,status='sent',answer='',draft_json=NULL,telegram_message_id=?,sent_at=?,updated_at=? WHERE id=?").bind(next.starts_at,next.place,next.instructions,next.version,result.message_id,currentNow,currentNow,a.id).run();
  const offsets=reminderOffsets(next.starts_at-currentNow);
  for(let i=0;i<offsets.length;i++)await enqueue(env,pid,'appointment_reminder',a.id,{version:next.version,step:i+1},currentNow+offsets[i]);
  await audit(env,pid,'bot','appointment_sent',{kind:a.kind,version:next.version,starts_at:next.starts_at});return {sent:true,message_id:result.message_id};
 }
 if(job.kind==='appointment_reminder'){
  const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(job.entity_id).first();
  if(!a||a.status!=='sent'||a.version!==payload.version||a.answer||a.starts_at<=currentNow)return {cancel:true};
  const msg=p.lang==='en'?`Reminder: please confirm your attendance.\n${appointmentText(a,p.lang)}`:`تذكير: نرجو تأكيد حضورك.\n${appointmentText(a,p.lang)}`;
  const r=await tg(env,'sendMessage',{chat_id:chat,text:msg,reply_markup:buttons('a',a.id,a.version,p.lang==='en'?['Yes','No']:['نعم','لا'])});
  if(payload.step===2)await adminNotify(env,`⚠️ لم يؤكد المريض ${p.name} (${p.code}) موعد ${a.kind==='surgery'?'العملية':'التوقيع'} بعد التذكير الثاني.`);
  await audit(env,pid,'bot','appointment_reminded',{step:payload.step,version:a.version});return {sent:true,message_id:r.message_id};
 }
 if(job.kind==='message_send'){
  const m=await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(job.entity_id).first();if(!m||m.status!=='draft')return {cancel:true};
  const r=await tg(env,'sendMessage',{chat_id:chat,text:m.body,reply_markup:m.ack_required?ackButton(m.id,p.lang==='en'?'I have read this':'اطلعت على الرسالة'):undefined});
  await env.DB.prepare("UPDATE messages SET status='sent',telegram_message_id=?,updated_at=? WHERE id=?").bind(r.message_id,currentNow,m.id).run();
  if(m.ack_required){for(let step=1;step<=2;step++)await enqueue(env,pid,'message_reminder',m.id,{step,version:m.version},currentNow+(step*12*3600000));}
  await audit(env,pid,'bot','message_sent',{message_id:m.id,kind:m.kind});return {sent:true,message_id:r.message_id};
 }
 if(job.kind==='message_reminder'){
  const m=await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(job.entity_id).first();if(!m||m.status!=='sent'||m.ack_at||m.version!==payload.version)return {cancel:true};
  if(m.appointment_id){const a=await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(m.appointment_id).first();if(!a||a.status!=='sent'||a.starts_at<=currentNow)return {cancel:true};}
  const r=await tg(env,'sendMessage',{chat_id:chat,text:(p.lang==='en'?'Reminder: please acknowledge the previous instructions.':'تذكير: نرجو الاطلاع على التعليمات السابقة.'),reply_markup:ackButton(m.id,p.lang==='en'?'Read':'اطلعت')});
  if(payload.step===2)await adminNotify(env,`⚠️ ${p.name} (${p.code}) لم يؤكد الاطلاع على التعليمات بعد التذكير الثاني.`);
  await audit(env,pid,'bot','message_reminded',{step:payload.step});return {sent:true,message_id:r.message_id};
 }
 if(job.kind==='postponement_notice'){
  const r=await tg(env,'sendMessage',{chat_id:chat,text:payload.text});await audit(env,pid,'bot','appointment_postponed');return {sent:true,message_id:r.message_id};
 }
 if(job.kind==='redo_notice'||job.kind==='cancel_notice'){
  const t=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(job.entity_id).first();if(!t)return {cancel:true};
  const redo=job.kind==='redo_notice';
  if(redo&&t.status!=='sent')return {cancel:true};
  if(!redo&&t.status!=='cancelled')return {cancel:true};
  const r=await tg(env,'sendMessage',{chat_id:chat,text:payload.text,reply_markup:redo?buttons('t',t.id,0,p.lang==='en'?['Yes','No']:['نعم','لا']):undefined});
  if(redo){await env.DB.prepare("UPDATE tasks SET answer='',reviewed='redo',updated_at=? WHERE id=?").bind(currentNow,t.id).run();}
  await audit(env,pid,'bot',job.kind,{task:t.title});return {sent:true,message_id:r.message_id};
 }
 return {cancel:true};
}
async function processJobs(env,max=25){
 const pending=await rows(env.DB.prepare("SELECT * FROM jobs WHERE state='queued' AND due_at<=? ORDER BY due_at LIMIT ?").bind(now(),max));
 for(const item of pending){
  const changed=await env.DB.prepare("UPDATE jobs SET state='processing',attempt=attempt+1,updated_at=? WHERE id=? AND state='queued'").bind(now(),item.id).run();
  if(!changed.meta?.changes)continue;
  try{
   const outcome=await doJob(env,item);
   await env.DB.prepare('UPDATE jobs SET state=?,telegram_message_id=?,updated_at=? WHERE id=?').bind(outcome.cancel?'cancelled':'sent',outcome.message_id||null,now(),item.id).run();
  }catch(e){
   const attempt=item.attempt+1,permanent=e.permanent||isFinalTelegramError(e.message);
   const failed=permanent||attempt>=3;
   await env.DB.prepare('UPDATE jobs SET state=?,due_at=?,last_error=?,updated_at=? WHERE id=?').bind(failed?'failed':'queued',now()+(attempt*60000),String(e.message).slice(0,300),now(),item.id).run();
   if(failed){const p=await getPatient(env,item.patient_id);await adminNotify(env,`❌ تعذر إرسال ${item.kind} إلى ${p?.name||'مريض'} بعد المحاولات. راجع الملف.`);}
  }
 }
}
async function snapshotAndCleanup(env){
 const nowMs=now();
 // Cancel post-due reminders and delete archived patients after exactly seven days or later on cron execution.
 const expired=await rows(env.DB.prepare("SELECT id FROM patients WHERE state='archived' AND archived_at<=?").bind(nowMs-7*DAY));
 for(const p of expired){
   await env.DB.prepare('INSERT OR IGNORE INTO deleted_ids(id,deleted_at) VALUES(?,?)').bind(p.id,nowMs).run();
   await env.DB.prepare('DELETE FROM patients WHERE id=?').bind(p.id).run();
 }
 await env.DB.prepare('DELETE FROM backup_snapshots WHERE created_at<?').bind(nowMs-7*DAY).run();
 await env.DB.prepare('DELETE FROM bot_updates WHERE processed_at<?').bind(nowMs-14*DAY).run();
 await env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE state='queued' AND patient_id IN (SELECT id FROM patients WHERE state='archived')").run();
 // Daily snapshot inside D1: additionally rely on provider PITR for whole-database disaster recovery.
 const dayStart=Math.floor(nowMs/DAY)*DAY;
 const patients=await rows(env.DB.prepare('SELECT * FROM patients WHERE state=\'active\''));
 for(const p of patients){
   const previous=await env.DB.prepare('SELECT id FROM backup_snapshots WHERE patient_id=? AND created_at>=? LIMIT 1').bind(p.id,dayStart).first();
   if(previous)continue;
   const data={patient:{procedure_name:p.procedure_name,lang:p.lang,custom_json:p.custom_json},tasks:await rows(env.DB.prepare('SELECT * FROM tasks WHERE patient_id=?').bind(p.id)),appointments:await rows(env.DB.prepare('SELECT * FROM appointments WHERE patient_id=?').bind(p.id))};
   await env.DB.prepare('INSERT INTO backup_snapshots(id,patient_id,created_at,data_json) VALUES(?,?,?,?)').bind(uid(),p.id,nowMs,j(data)).run();
 }
}
async function handleCallback(env,callback){
 const from=String(callback.from?.id||''),data=callback.data||'',parts=data.split(':'),type=parts[0],id=parts[1],value=parts[2];
 try{
  if(!['t','a','m'].includes(type)||!id)throw new Error('زر غير معروف');
  let entity,p;
  if(type==='t'){
   entity=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();p=entity&&await getPatient(env,entity.patient_id);
  }else if(type==='a'){
   entity=await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(id).first();p=entity&&await getPatient(env,entity.patient_id);
  }else{
   entity=await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(id).first();p=entity&&await getPatient(env,entity.patient_id);
  }
  if(!p||p.state!=='active'||String(p.telegram_id)!==from||entity.status!=='sent')throw new Error('هذا الزر غير متاح لهذا الحساب');
  if(type==='a'&&(String(entity.version)!==parts[3]||entity.starts_at<=now()))throw new Error('الموعد تغير أو انتهى؛ يرجى مراجعة آخر رسالة');
  if(type==='t'&&!['y','n'].includes(value))throw new Error('رد غير معروف');
  if(type==='a'&&!['y','n'].includes(value))throw new Error('رد غير معروف');
  const answer=value==='y'?'yes':'no';
  let receipt='';
  if(type==='t'){
   if(entity.answer!==answer){receipt=patientReplyReceipt('t',entity,answer,p.lang);await env.DB.prepare("UPDATE tasks SET answer=?,reviewed=CASE WHEN reviewed='approved' THEN 'pending' ELSE reviewed END,updated_at=? WHERE id=?").bind(answer,now(),id).run();
    await audit(env,p.id,'patient','task_answer',{title:entity.title,from:entity.answer,to:answer});
    await adminNotify(env,`📝 ${p.name} (${p.code}) — ${entity.title}: ${entity.answer||'لم يرد'} ← ${answer==='yes'?'نعم':'لا'}`);
    if(answer==='yes'){const inc=await env.DB.prepare("SELECT COUNT(*) n FROM tasks WHERE patient_id=? AND status='sent' AND answer!='yes'").bind(p.id).first();if(inc?.n===0)await adminNotify(env,`✅ ${p.name} (${p.code}) أفاد بإنجاز جميع المتطلبات؛ جاهزة لمراجعتك.`);}
   }
  }else if(type==='a'){
   if(entity.answer!==answer){receipt=patientReplyReceipt('a',entity,answer,p.lang);await env.DB.prepare('UPDATE appointments SET answer=?,updated_at=? WHERE id=?').bind(answer,now(),id).run();await audit(env,p.id,'patient','appointment_answer',{kind:entity.kind,from:entity.answer,to:answer,version:entity.version});
    await adminNotify(env,`📅 ${p.name} (${p.code}) ${entity.kind==='surgery'?'العملية':'التوقيع'}: ${entity.answer||'لم يرد'} ← ${answer==='yes'?'نعم':'لا'}`);}
  }else if(type==='m'){
   if(!entity.ack_required)throw new Error('لا يتطلب هذا إشعارًا بالاطلاع');
   if(!entity.ack_at){receipt=patientReplyReceipt('m',entity,answer,p.lang);await env.DB.prepare('UPDATE messages SET ack_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run();await audit(env,p.id,'patient','acknowledged',{message_id:id});await adminNotify(env,`📨 ${p.name} (${p.code}) أقر بالاطلاع على الرسالة.`);}
  }
  await tg(env,'answerCallbackQuery',{callback_query_id:callback.id,text:type==='m'?'تم تسجيل اطلاعك':'تم تسجيل إجابتك',show_alert:false});
  if(receipt)await tg(env,'sendMessage',{chat_id:from,text:receipt}).catch(()=>{});
 }catch(e){await tg(env,'answerCallbackQuery',{callback_query_id:callback.id,text:safeText(e.message,180),show_alert:true}).catch(()=>{});}
}
async function handleBotMessage(env,message){
 const text=String(message.text||'').trim(),from=String(message.from?.id||'');if(!from||!text.startsWith('/'))return;
 if(text.startsWith('/id')){await tg(env,'sendMessage',{chat_id:from,text:`Telegram ID: ${from}`});return;}
 if(text.startsWith('/start')){
  if(from===String(env.ADMIN_TELEGRAM_ID)){await tg(env,'sendMessage',{chat_id:from,text:'مرحبًا بالمدير. افتح لوحة الإدارة من زر القائمة (Menu) أسفل المحادثة.'});return;}
  const token=text.split(/\s+/)[1]||'';
  if(!token){await tg(env,'sendMessage',{chat_id:from,text:'مرحبًا. يرجى فتح البوت من رمز QR الذي استلمته.'});return;}
  const hash=await sha256hex(token),p=await env.DB.prepare('SELECT * FROM patients WHERE activation_hash=? AND state=\'active\'').bind(hash).first();
  if(!p){await tg(env,'sendMessage',{chat_id:from,text:'رمز التفعيل غير صالح أو استُخدم سابقًا.'});return;}
  const linked=await env.DB.prepare('SELECT id FROM patients WHERE telegram_id=? AND id!=?').bind(from,p.id).first();
  if(linked){await tg(env,'sendMessage',{chat_id:from,text:'هذا الحساب مرتبط مسبقًا بملف آخر. راجع المدير.'});return;}
  await env.DB.prepare('UPDATE patients SET pending_telegram_id=?,pending_username=?,pending_requested_at=?,updated_at=? WHERE id=?').bind(from,safeText(message.from.username||message.from.first_name,90),now(),now(),p.id).run();
  await audit(env,p.id,'patient','activation_requested',{telegram:from});await adminNotify(env,`🔑 طلب تفعيل: ${p.name} (${p.code}) — تيليجرام ${from}. افتح لوحة الإدارة للموافقة.`);
  await tg(env,'sendMessage',{chat_id:from,text:p.lang==='en'?'Your request is pending approval.':'تم تسجيل طلب التفعيل، وهو بانتظار موافقة المسؤول.'});return;
 }
 if(text.startsWith('/change')){
  const p=await env.DB.prepare('SELECT * FROM patients WHERE telegram_id=? AND state=\'active\'').bind(from).first();
  await tg(env,'sendMessage',{chat_id:from,text:p?'تم تسجيل رغبتك بتغيير حسابك. اطلب باركود جديدًا من المسؤول ثم افتحه من الحساب الجديد.':'لإعادة الربط يرجى طلب باركود جديد من المسؤول.'});
  if(p)await adminNotify(env,`🔄 ${p.name} (${p.code}) طلب تغيير حساب تيليجرام. أصدر QR جديدًا من ملفه.`);return;
 }
 if(text.startsWith('/recover')){
  const code=safeText(text.split(/\s+/)[1],20),p=code&&await env.DB.prepare("SELECT * FROM patients WHERE code=? AND state='active'").bind(code).first();
  if(!p){await tg(env,'sendMessage',{chat_id:from,text:'للاستعادة اطلب رمزًا جديدًا من المسؤول أو أرسل /recover متبوعًا برقمك الخاص.'});return;}
  await env.DB.prepare('UPDATE patients SET pending_telegram_id=?,pending_username=?,pending_requested_at=?,updated_at=? WHERE id=?').bind(from,safeText(message.from.username||message.from.first_name,90),now(),now(),p.id).run();
  await audit(env,p.id,'patient','recovery_requested',{telegram:from});await adminNotify(env,`⚠️ طلب استعادة من حساب جديد: ${p.name} (${p.code}) — تيليجرام ${from}. لا توافق دون التحقق من صاحب الحساب.`);
  await tg(env,'sendMessage',{chat_id:from,text:'طلب الاستعادة بانتظار مراجعة المسؤول.'});return;
 }
 // Ignore all other commands and all free-text messages (do not save them).
}
async function webhook(env,request){
 if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return bad('Unauthorized',403);
 let update;try{update=await request.json();}catch{return bad('Bad JSON');}
 if(!Number.isInteger(update.update_id))return json({ok:true});
 const seen=await env.DB.prepare('SELECT id FROM bot_updates WHERE id=?').bind(update.update_id).first();if(seen)return json({ok:true});
 if(update.callback_query)await handleCallback(env,update.callback_query);
 else if(update.message)await handleBotMessage(env,update.message);
 await env.DB.prepare('INSERT OR IGNORE INTO bot_updates(id,processed_at) VALUES(?,?)').bind(update.update_id,now()).run();return json({ok:true});
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/webhook'&&request.method==='POST')return webhook(env,request).catch(e=>{console.error('webhook error',e.message);return bad('Bot error',500);});
  if(url.pathname.startsWith('/api/'))return userCall(env,request,url);
  return env.ASSETS.fetch(request);
 },
 async scheduled(event,env,ctx){
  await processJobs(env);
  // Lightweight daily snapshot and deletion worker; every cron call is idempotent.
  if(new Date().getUTCMinutes()===0)await snapshotAndCleanup(env);
 }
};
