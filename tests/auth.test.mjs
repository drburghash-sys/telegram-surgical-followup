import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {verifyInitData,buttons,patientReplyReceipt} from '../src/telegram.js';
function sign(token,id,time){const params=new URLSearchParams({auth_date:String(time),user:JSON.stringify({id,first_name:'Admin'})});const check=[...params].sort((a,b)=>a[0].localeCompare(b[0])).map(([a,b])=>a+'='+b).join('\n');const key=createHmac('sha256','WebAppData').update(token).digest();const digest=createHmac('sha256',key).update(check).digest('hex');params.set('hash',digest);return params.toString();}
test('valid Telegram Mini App initData accepts only known admin',async()=>{const ts=Math.floor(Date.now()/1000),token='demo-token',data=sign(token,123,ts);assert.equal(await verifyInitData(data,token,123),true);assert.equal(await verifyInitData(data,token,124),false);assert.equal(await verifyInitData(data,'wrong',123),false);});
test('modern Telegram initData with signature validates correctly',async()=>{
  const ts=Math.floor(Date.now()/1000),token='demo-token';
  const params=new URLSearchParams({auth_date:String(ts),user:JSON.stringify({id:123,first_name:'Admin'}),signature:'fake-ed25519-signature-for-hmac-test'});
  const dataCheck=[...params.entries()].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',secret).update(dataCheck).digest('hex'));
  const signed=params.toString();
  assert.equal(await verifyInitData(signed,token,123),true);
  assert.equal(await verifyInitData(signed,token,124),false);
  const tampered=new URLSearchParams(signed);tampered.set('signature','changed');
  assert.equal(await verifyInitData(tampered.toString(),token,123),false);
});
test('expired Telegram initData rejected',async()=>{const ts=Math.floor(Date.now()/1000)-9999;assert.equal(await verifyInitData(sign('secret',123,ts),'secret',123),false);});
test('button callback below Telegram 64 byte limit',()=>assert.ok(buttons('a','12345678-1234-1234-1234-123456789abc',999).inline_keyboard[0][0].callback_data.length<64));

test('patient interactions render short Arabic and English chat acknowledgements',()=>{
 const task={title:'تحاليل الدم'};
 assert.match(patientReplyReceipt('t',task,'yes','ar'),/نعم/);
 assert.match(patientReplyReceipt('t',task,'no','ar'),/تحاليل الدم/);
 assert.match(patientReplyReceipt('t',task,'yes','en'),/Your response was recorded/);
 assert.match(patientReplyReceipt('a',{},'no','ar'),/الموعد/);
 assert.match(patientReplyReceipt('m',{},'yes','ar'),/اطلاعك/);
});
