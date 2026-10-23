PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS patients (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, procedure_name TEXT NOT NULL DEFAULT '',
 lang TEXT NOT NULL DEFAULT 'ar', phone TEXT NOT NULL DEFAULT '', custom_json TEXT NOT NULL DEFAULT '{}',
 telegram_id TEXT UNIQUE, telegram_username TEXT, activation_hash TEXT UNIQUE, activation_used_at INTEGER,
 pending_telegram_id TEXT, pending_username TEXT, pending_requested_at INTEGER,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_patients_state ON patients(state, updated_at);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
 answer TEXT NOT NULL DEFAULT '', reviewed TEXT NOT NULL DEFAULT 'pending',
 redo_text TEXT NOT NULL DEFAULT '', telegram_message_id INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_patient ON tasks(patient_id);
CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('signing','surgery')),
 starts_at INTEGER NOT NULL, place TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft', answer TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
 draft_json TEXT, telegram_message_id INTEGER, sent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apps_patient ON appointments(patient_id);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
 body TEXT NOT NULL, ack_required INTEGER NOT NULL DEFAULT 0, ack_at INTEGER,
 status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
 telegram_message_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_patient ON messages(patient_id);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL,
 due_at INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'queued', last_error TEXT NOT NULL DEFAULT '', telegram_message_id INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(state, due_at);
CREATE TABLE IF NOT EXISTS activity (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 actor TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_patient ON activity(patient_id, at DESC);
CREATE TABLE IF NOT EXISTS requirement_catalog (id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO requirement_catalog(id,title,note) VALUES
 ('blood','تحاليل الدم',''),('xray','الأشعة المطلوبة',''),('anesthesia','تقييم التخدير',''),('ecg','تخطيط القلب',''),('cardiac','تقييم القلب','');
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, label TEXT NOT NULL, ar TEXT NOT NULL, en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS custom_fields (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS backup_snapshots (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, data_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_backup_patient ON backup_snapshots(patient_id, created_at DESC);
CREATE TABLE IF NOT EXISTS deleted_ids (id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bot_updates (id INTEGER PRIMARY KEY, processed_at INTEGER NOT NULL);
INSERT OR IGNORE INTO templates(id,label,ar,en) VALUES
 ('general','تنبيه عام','يرجى مراجعة التنبيه التالي.','Please review this notice.'),
 ('retest','إعادة متطلب','يرجى إعادة الإجراء المطلوب ثم تأكيد إنجازه.','Please repeat the required test and confirm when completed.'),
 ('arrival','تذكير موعد','يرجى تأكيد قدرتك على الحضور في الموعد المحدد.','Please confirm your ability to attend the scheduled appointment.');
