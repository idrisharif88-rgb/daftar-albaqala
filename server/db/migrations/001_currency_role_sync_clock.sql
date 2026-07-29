-- ============================================================
-- ترحيل 001 — العملات المتعددة + صفة الجهة + ساعة السيرفر للمزامنة
-- Migration 001 — multi-currency, contact role, server-side sync clock
--
-- يُشغَّل مرة واحدة على السيرفر بصلاحية root (المستخدم daftar_user لديه DML فقط):
--   sudo mysql -u root -p daftar_db < server/db/migrations/001_currency_role_sync_clock.sql
--
-- آمن لإعادة التشغيل؟ لا — MySQL لا يدعم ADD COLUMN IF NOT EXISTS.
-- إذا فشل بخطأ "Duplicate column name" فهذا يعني أنه طُبّق سابقاً؛ تجاهله.
-- ============================================================

-- ------------------------------------------------------------
-- 1) صفة الجهة: عميل / مورد / شريك
--    الصفوف الحالية كلها عملاء — هذا كل ما كان التطبيق يعرفه.
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'customer' AFTER note;

-- ------------------------------------------------------------
-- 2) عملة المعاملة. الصفوف الحالية بالريال اليمني بحكم التعريف.
--    المبلغ يبقى DECIMAL(12,2) — يكفي للذهب بالجرام حتى 0.01 جرام.
-- ------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'YER' AFTER amount;

-- ------------------------------------------------------------
-- 3) ساعة السيرفر للمزامنة الدلتا (الأهم).
--
--    كانت /sync/pull تُرشِّح على created_at / updated_at، وهذه يكتبها الهاتف.
--    هاتف بساعة خاطئة يكتب صفاً بتاريخ في الماضي، فيتجاوزه مؤشّر جهاز آخر
--    ولا يصل إليه أبداً. الحل: عمود تختمه قاعدة البيانات بنفسها.
--
--    القيمة الابتدائية للصفوف القديمة = الآن، فتُسحب مرة واحدة بعد الترحيل
--    (السحب متكرر الأثر idempotent، فلا ضرر).
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

ALTER TABLE transactions
  ADD COLUMN server_updated_at DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3);

-- ------------------------------------------------------------
-- 4) الفهارس: المزامنة صارت تقرأ على العمود الجديد.
--    بدون الفهرس يصبح كل سحب مسحاً كاملاً للجدول (خطير على سيرفر بذاكرة 1GB).
-- ------------------------------------------------------------
ALTER TABLE customers    DROP INDEX idx_cust_sync;
ALTER TABLE customers    ADD  KEY   idx_cust_sync (user_id, server_updated_at);

ALTER TABLE transactions DROP INDEX idx_txn_sync;
ALTER TABLE transactions ADD  KEY   idx_txn_sync (user_id, server_updated_at);
