-- ============================================================
-- daftar_db — مخطط قاعدة بيانات "دفتر البقالة"
-- المرحلة 1: الجداول + الفهارس + القيود
-- المحرّك: InnoDB | الترميز: utf8mb4 (يدعم العربية والرموز كاملةً)
-- ملاحظة: كل الأوقات تُخزَّن بتوقيت UTC، والعرض يتم في التطبيق.
-- ============================================================

-- ------------------------------------------------------------
-- جدول المستخدمين (التجّار) — على السيرفر فقط
-- لا يُخزَّن محلياً على الجهاز سوى توكن الجلسة.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                       CHAR(36)        NOT NULL,                 -- معرّف UUID
  phone                    VARCHAR(32)     NOT NULL,                 -- رقم الهاتف = معرّف تسجيل الدخول
  password_hash            VARCHAR(255)    NOT NULL,                 -- bcrypt (لا تُخزَّن كلمة السر أبداً)
  store_name               VARCHAR(255)    NULL,
  currency                 VARCHAR(8)      NOT NULL DEFAULT 'YER',   -- ريال يمني
  language                 VARCHAR(8)      NOT NULL DEFAULT 'ar',

  -- حقول الاشتراك (المدفوع = السحابة)
  plan                     VARCHAR(16)     NOT NULL DEFAULT 'free',  -- free | cloud
  subscription_status      ENUM('none','active','expired') NOT NULL DEFAULT 'none',
  subscription_expires_at  DATETIME        NULL,

  created_at               DATETIME        NOT NULL,
  updated_at               DATETIME        NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- جدول العملاء — محلي + سيرفر | قابل للتعديل + حذف ناعم
-- التفرّد على رقم الهاتف يُفرض في طبقة التطبيق (ضمن user_id و deleted_at IS NULL)
-- وليس بقيد UNIQUE صلب، حتى يتوافق مع Offline والحذف الناعم.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id          CHAR(36)        NOT NULL,
  user_id     CHAR(36)        NOT NULL,                -- مالك السجل (عزل المستأجرين)
  name        VARCHAR(255)    NOT NULL,
  phone       VARCHAR(32)     NOT NULL,                -- مطلوب
  note        TEXT            NULL,

  created_at  DATETIME        NOT NULL,
  updated_at  DATETIME        NOT NULL,                -- مفتاح المزامنة الدلتا + آخر-كتابة-تفوز
  deleted_at  DATETIME        NULL,                    -- حذف ناعم (tombstone)

  PRIMARY KEY (id),
  CONSTRAINT fk_cust_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_cust_user (user_id),                         -- لتسريع كل استعلام مفلتر بـ user_id
  KEY idx_cust_sync (user_id, updated_at)              -- لجلب "ما تغيّر بعد آخر مزامنة"
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- جدول المعاملات — محلي + سيرفر | append-only (لا تعديل/حذف)
-- التصحيح يكون بإضافة معاملة عكسية، لا بتعديل القديمة.
-- لذلك لا حاجة لـ deleted_at هنا.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id           CHAR(36)        NOT NULL,
  user_id      CHAR(36)        NOT NULL,               -- مالك السجل (عزل المستأجرين)
  customer_id  CHAR(36)        NOT NULL,
  type         ENUM('debt','payment') NOT NULL,        -- دَين / تسديد
  amount       DECIMAL(12,2)   NOT NULL,               -- دقّة نقدية بلا أخطاء فاصلة
  note         TEXT            NULL,
  occurred_at  DATETIME        NOT NULL,               -- وقت حدوث المعاملة فعلياً (يحدده المستخدم)
  created_at   DATETIME        NOT NULL,               -- وقت الإدراج (مفتاح المزامنة)

  PRIMARY KEY (id),
  CONSTRAINT fk_txn_user FOREIGN KEY (user_id)     REFERENCES users(id),
  CONSTRAINT fk_txn_cust FOREIGN KEY (customer_id) REFERENCES customers(id),
  KEY idx_txn_user_cust (user_id, customer_id),        -- معاملات عميل معيّن
  KEY idx_txn_sync (user_id, created_at)               -- جلب الجديد منذ آخر مزامنة
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
