# Telegram Surgical Follow-up Demo

Mobile-first Telegram Mini App (admin) + Telegram Bot (patient), powered by one Cloudflare Worker and D1. **Synthetic patient data only.** This repository contains source and setup instructions; it is not automatically deployed.

[Full Arabic setup instructions / دليل التشغيل بالعربية](README_AR.md).

```sh
npm install
npm test
npx wrangler d1 create surgical_followup
# Paste your database_id into wrangler.jsonc
npm run db:remote
# Set Telegram secrets with npx wrangler secret put ...
npm run deploy
```

Do not commit `.dev.vars`, BotFather tokens, or patient records. The UI cannot be used as an authenticated administrator outside Telegram (non-Telegram page is a read-only fictional-data preview). See the Arabic README for exact steps and limitations.