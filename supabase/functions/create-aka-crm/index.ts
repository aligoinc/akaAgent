/**
 * Edge Function: create-aka-crm v4
 * - Tạo aka_crm idempotent (1/customer/ngày VN)
 * - Tự tính cskh_due_date theo giờ VN
 * - Resolve owner: caller > aka_customer.org_staff_id_owner > **random pool is_data_division**
 * - Notify Lark after creating a new CRM row
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeCskhDueDate } from "./_shared/cskh-due-date.ts";

interface CreateCrmBody {
  customer_id: number;
  crm_type_id: number;
  org_staff_owner_id?: number | null;
  organization_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  note?: string | null;
  suggested_channel_id?: number | null;
  suggested_content?: string | null;
  priority?: number | null;
  created_by?: number | null;
  source?: string | null;
}

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";
const LARK_CRM_WEBHOOK_URL = "https://ajput668ypy3.jp.larksuite.com/base/workflow/webhook/event/RC6wawp00w8IwRhtVHZj3ZtepjH";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
function err(code: string, message: string, status = 400): Response {
  return jsonResponse(status, { ok: false, code, error: message });
}
function todayStartVnIso(): string {
  const now = new Date();
  const w = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), 0, 0, 0) - 7 * 60 * 60 * 1000).toISOString();
}
function logEvent(level: "info" | "warn" | "error", event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
function formatDateVnForLark(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = vn.getUTCFullYear();
  const month = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vn.getUTCDate()).padStart(2, "0");
  const hour = String(vn.getUTCHours()).padStart(2, "0");
  const minute = String(vn.getUTCMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

/** Random pick 1 staff trong pool is_data_division. */
async function pickRandomDataDivisionStaff(sb: SupabaseClient): Promise<{ id: number; organization_id: number; name: string; name_akabiz: string | null } | null> {
  const { data, error } = await sb
    .from("org_staff")
    .select("id, organization_id, name, name_akabiz")
    .eq("is_data_division", true)
    .eq("is_active", true);
  if (error || !data || data.length === 0) return null;
  const pick = data[Math.floor(Math.random() * data.length)];
  return { id: pick.id as number, organization_id: pick.organization_id as number, name: pick.name as string, name_akabiz: pick.name_akabiz as string | null };
}

async function notifyLarkCrmCreated(args: {
  staffName: string;
  customerName: string;
  customerPhone: string;
  crmTypeName: string;
  cskhDueDate: Date;
  customerId: number;
  crmId: number;
}): Promise<void> {
  const payload = {
    staffname: args.staffName,
    note: `${args.customerName} - ${args.customerPhone} - ${args.crmTypeName}`,
    date: formatDateVnForLark(args.cskhDueDate),
  };
  try {
    const response = await fetch(LARK_CRM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logEvent("warn", "create-aka-crm.lark_webhook_failed", {
        crm_id: args.crmId,
        customer_id: args.customerId,
        status: response.status,
      });
    }
  } catch (e) {
    logEvent("warn", "create-aka-crm.lark_webhook_exception", {
      crm_id: args.crmId,
      customer_id: args.customerId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return err("method_not_allowed", "Use POST", 405);

  let body: CreateCrmBody;
  try { body = await req.json(); } catch { return err("invalid_json", "Body must be valid JSON"); }
  if (!body || typeof body !== "object") return err("invalid_body", "Body required");
  if (!Number.isInteger(body.customer_id) || body.customer_id <= 0) return err("invalid_customer_id", "customer_id must be positive integer");
  if (!Number.isInteger(body.crm_type_id) || body.crm_type_id <= 0) return err("invalid_crm_type_id", "crm_type_id must be positive integer");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return err("config_missing", "Edge function env not set", 500);

  const sb: SupabaseClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: cust, error: eCust } = await sb
      .from("aka_customer")
      .select("id, name, phone, org_staff_id_owner")
      .eq("id", body.customer_id)
      .maybeSingle();
    if (eCust) return err("db_load_customer", eCust.message, 500);
    if (!cust) return err("customer_not_found", `customer_id ${body.customer_id} không tồn tại`, 404);

	    const { data: crmType, error: eType } = await sb
	      .from("aka_crm_type")
	      .select("id, name, stt, is_active")
      .eq("id", body.crm_type_id)
      .maybeSingle();
    if (eType) return err("db_load_type", eType.message, 500);
    if (!crmType) return err("crm_type_not_found", `crm_type_id ${body.crm_type_id} không tồn tại`, 404);
    if (crmType.is_active === false) return err("crm_type_inactive", `crm_type_id ${body.crm_type_id} đang bị tắt`);

	    let ownerId: number | null = body.org_staff_owner_id ?? cust.org_staff_id_owner ?? null;
	    let orgId: number | null = body.organization_id ?? null;
	    let assignedRandomly = false;
	    let ownerName: string | null = null;
	    let ownerNameAkabiz: string | null = null;

    // Validate owner
    if (ownerId !== null) {
	      const { data: ownerRow } = await sb
	        .from("org_staff")
	        .select("id, organization_id, name, name_akabiz, is_active")
        .eq("id", ownerId)
        .maybeSingle();
	      if (!ownerRow || ownerRow.is_active === false) {
	        ownerId = null;
	      } else if (orgId === null) {
	        orgId = ownerRow.organization_id ?? null;
	      }
	      if (ownerRow && ownerRow.is_active !== false) {
	        ownerName = ownerRow.name ?? null;
	        ownerNameAkabiz = ownerRow.name_akabiz ?? null;
	      }
	    }

    // Fallback: random assign từ pool is_data_division
    if (ownerId === null) {
      const picked = await pickRandomDataDivisionStaff(sb);
      if (!picked) {
        logEvent("error", "create-aka-crm.no_assignable_staff", { customer_id: body.customer_id });
        return jsonResponse(503, { ok: false, code: "no_assignable_staff", error: "Pool is_data_division rỗng" });
      }
	      ownerId = picked.id;
	      orgId = picked.organization_id;
	      ownerName = picked.name;
	      ownerNameAkabiz = picked.name_akabiz;
	      assignedRandomly = true;
      logEvent("info", "create-aka-crm.auto_assigned", {
        customer_id: body.customer_id, picked_id: picked.id, picked_name: picked.name,
      });
    }

    const cskhDueDate = computeCskhDueDate(new Date());

    const insertRow = {
      customer_id: body.customer_id,
      customer_name: body.customer_name ?? cust.name ?? cust.phone ?? "",
      customer_phone: body.customer_phone ?? cust.phone ?? "",
      crm_type_id: body.crm_type_id,
      organization_id: orgId,
      org_staff_owner_id: ownerId,
      suggested_channel_id: body.suggested_channel_id ?? null,
      suggested_content: body.suggested_content ?? null,
      note: body.note ?? null,
      priority: body.priority ?? crmType.stt ?? 100,
      created_by: body.created_by ?? ownerId,
      cskh_due_date: cskhDueDate.toISOString(),
      is_read: false,
    };

    const { data: inserted, error: eIns } = await sb.from("aka_crm").insert(insertRow).select("id").single();

    if (eIns) {
      if ((eIns as { code?: string }).code === "23505") {
        const { data: existing } = await sb
          .from("aka_crm")
          .select("id, cskh_due_date, org_staff_owner_id")
          .eq("customer_id", body.customer_id)
          .gte("created_at", todayStartVnIso())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        logEvent("info", "create-aka-crm.skipped_duplicate", { customer_id: body.customer_id, source: body.source ?? null });
        return jsonResponse(200, {
          ok: true,
          crm_id: existing?.id ?? null,
          skipped: true,
          skip_reason: "duplicate_today",
          cskh_due_date: existing?.cskh_due_date ?? cskhDueDate.toISOString(),
          org_staff_owner_id: existing?.org_staff_owner_id ?? ownerId,
          organization_id: orgId,
          crm_type_id: body.crm_type_id,
          assigned_randomly: false,
        });
      }
      logEvent("error", "create-aka-crm.insert_failed", { customer_id: body.customer_id, message: eIns.message, source: body.source ?? null });
      return err("db_insert", eIns.message, 500);
    }

	    logEvent("info", "create-aka-crm.created", {
	      crm_id: inserted.id, customer_id: body.customer_id, crm_type_id: body.crm_type_id,
	      owner: ownerId, source: body.source ?? null, assigned_randomly: assignedRandomly,
	    });

	    await notifyLarkCrmCreated({
	      staffName: ownerNameAkabiz || ownerName || "",
	      customerName: String(insertRow.customer_name || ""),
	      customerPhone: String(insertRow.customer_phone || ""),
	      crmTypeName: String(crmType.name || ""),
	      cskhDueDate,
	      customerId: body.customer_id,
	      crmId: inserted.id,
	    });

	    return jsonResponse(200, {
      ok: true,
      crm_id: inserted.id,
      skipped: false,
      cskh_due_date: cskhDueDate.toISOString(),
      org_staff_owner_id: ownerId,
      organization_id: orgId,
      crm_type_id: body.crm_type_id,
      assigned_randomly: assignedRandomly,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal", msg, 500);
  }
});
