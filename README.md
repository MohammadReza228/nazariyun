# Nazariyun Real V1

نسخه V1 واقعی نظریون با:
- ثبت‌نام و ورود سروری
- Session امن با توکن تصادفی و هش‌شده
- Password hashing با PBKDF2/SHA-256
- Cloudflare D1
- چت خصوصی و ذخیره پیام
- پروفایل
- استوری 24 ساعته با لینک HTTPS تصویر
- رابط PWA ساده و ریسپانسیو

## Deploy

1. این پوشه را روی GitHub قرار بده.
2. در Cloudflare Workers & Pages از GitHub ایمپورت کن.
3. Build/Deploy command:
   `npx wrangler deploy`
4. D1 قبلاً در `wrangler.toml` به `nazariyun-db` وصل شده است.

## نکته
`database_id` داخل wrangler.toml مربوط به دیتابیسی است که در این گفتگو ساختی. اگر Cloudflare پروژه را به حساب/دیتابیس دیگری منتقل کردی، ID را با Database ID همان دیتابیس عوض کن.

برای توسعه محلی:
`npx wrangler dev`

برای اعمال schema روی دیتابیس از فایل schema.sql:
`npx wrangler d1 execute nazariyun-db --remote --file=./schema.sql`
