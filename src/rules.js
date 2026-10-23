/** Pure domain rules, independently unit-tested. */
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export function reminderOffsets(remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return [];
  if (remainingMs > 36 * HOUR) return [12 * HOUR, 24 * HOUR];
  const times = [Math.floor(remainingMs / 3), Math.floor(remainingMs * 2 / 3)];
  return times.filter((x,i)=>x>0 && x<remainingMs && (i===0 || x>times[0]));
}
export function dueAt(isoLocal) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(isoLocal||'')) throw new Error('صيغة التاريخ غير صحيحة');
  const epoch = Date.parse(isoLocal + ':00+03:00');
  if (!Number.isFinite(epoch) || new Date(epoch + 3*3600000).toISOString().slice(0,16) !== isoLocal) throw new Error('تاريخ غير صالح');
  return epoch;
}
export function dateLabel(timestamp,lang='ar') {
  return new Intl.DateTimeFormat(lang==='en'?'en-GB':'ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(timestamp));
}
export function canRespond(patient,entity) {return !!patient && patient.state==='active' && entity && entity.status==='sent';}
export function backupRetentionFilter(items, deletedIds) {const dead=new Set(deletedIds);return items.filter(v=>!dead.has(v.id));}
