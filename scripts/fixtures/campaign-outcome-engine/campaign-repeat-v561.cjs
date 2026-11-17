// Mảnh production mà "Lặp lại sau khi chạy xong" (V561) cần trên DB thử engine v2: trigger completed_at, bảng lịch sử chạy, bảng Quy
// trình, trung tâm thông báo tối thiểu với thân hàm ghi thông báo V475 thật. Dùng chung cho scripts/campaign-repeat-v561-smoke.cjs và bộ
// kịch bản engine v2 (SCENARIO_CAMPAIGN_REPEAT=1). Gọi sau engine Facebook V556–V558 (phiên Desktop giả, org_staff).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT } = require('./pg-fixture.cjs')

async function applyCampaignRepeatStubs(db) {
  // Như production: completed_at do trigger đặt khi chiến dịch chuyển "hoàn thành".
  await db.query(`CREATE FUNCTION public.aka_agent_set_campaign_completed_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'hoàn thành' AND OLD.status IS DISTINCT FROM NEW.status THEN NEW.completed_at = now(); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_aka_agent_set_campaign_completed_at BEFORE UPDATE OF status ON public.auto_campaigns
      FOR EACH ROW EXECUTE FUNCTION public.aka_agent_set_campaign_completed_at();`)
  await db.query(`CREATE TABLE public.auto_campaign_logs (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, log text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
  await db.query(`CREATE TABLE public.auto_journeys (id bigint PRIMARY KEY, is_delete boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active');
    CREATE TABLE public.auto_journey_step_campaigns (journey_id bigint NOT NULL, campaign_id bigint NOT NULL)`)
  // Trung tâm thông báo: bảng và hàm phụ tối thiểu, thân hàm ghi thông báo là bản V475 đang chạy trên production.
  await db.query(`CREATE TABLE public.auto_notification_subscriptions (staff_id bigint, event_type text, scope text, is_enabled boolean, filters jsonb, cooldown_minutes integer);
    CREATE TABLE public.auto_notifications (id bigserial PRIMARY KEY, organization_id bigint, staff_id bigint, event_type text, severity text, campaign_id bigint,
      account_id bigint, entity_key text, occurred_at timestamptz, deliver_after timestamptz, dedupe_key text UNIQUE, payload jsonb,
      content_status text NOT NULL DEFAULT 'pending', updated_at timestamptz);
    CREATE FUNCTION private.aka_agent_notification_enabled() RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION private.aka_agent_notification_default_filters(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"toStatuses":["hoàn thành","tạm dừng"]}'::jsonb $$;
    CREATE FUNCTION private.aka_agent_notification_int_setting(text, integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';
    CREATE FUNCTION private.aka_agent_notification_staff_org(bigint, bigint) RETURNS bigint LANGUAGE sql AS 'SELECT $2';
    CREATE FUNCTION private.aka_agent_notification_change_source() RETURNS text LANGUAGE sql AS $$ SELECT 'test'::text $$;`)
  const v475 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v475_journey_campaign_notifications.sql'), 'utf8')
  const capture = /CREATE OR REPLACE FUNCTION private\.aka_agent_notification_capture_campaign\(\)[\s\S]*?\$\$;/.exec(v475)[0]
  await db.query(capture)
  await db.query(`CREATE TRIGGER trg_aka_agent_notify_campaign_status AFTER UPDATE OF status ON public.auto_campaigns FOR EACH ROW
    WHEN (old.status IS DISTINCT FROM new.status AND new.is_delete IS NOT TRUE AND new.staff_id IS NOT NULL)
    EXECUTE FUNCTION private.aka_agent_notification_capture_campaign()`)
}

/** Mảnh phụ rồi V561 p1 + p2. */
async function applyCampaignRepeatV561(db) {
  await applyCampaignRepeatStubs(db)
  const v561 = require('../../build-v561-sql.cjs')
  await db.query(v561.migrationP1)
  await db.query(v561.migrationP2)
}

module.exports = { applyCampaignRepeatStubs, applyCampaignRepeatV561 }
