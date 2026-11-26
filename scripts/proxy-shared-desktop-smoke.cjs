// Desktop chạy tài khoản bằng proxy do đồng nghiệp thêm (V511 + V665), bằng MÃ THẬT của Desktop trên PostgreSQL 17 cục bộ.
// - DB: bảng / RLS / quyền của auto_proxies, hai hàm phạm vi nhân viên, trigger chặn xoá proxy và trigger
//   trg_account_proxy_scope_guard dựng NGUYÊN VĂN từ akachat đọc 26/11/2026 (scripts/fixtures/proxy-shared-runtime-v665/), rồi apply
//   đúng file migrations/migration_v665_proxy_shared_runtime_bound_device.sql.
// - Desktop: esbuild đóng gói src/main/data/repositories/proxyRepository.ts, src/main/services/proxyRuntimeService.ts và
//   src/main/services/zaloRuntimeService.ts; supabase-js thật gọi một PostgREST giả chạy câu SELECT dưới vai aka_agent_desktop + JWT
//   claims của nhân viên (đúng cách PostgREST áp RLS). Electron chỉ giả phần session (ghi lại setProxy).
// - Zalo QR: createZaloClient thật + zca-js loginQR thật đi qua một proxy giả cục bộ (không ra mạng): kiểm lệnh CONNECT và
//   Proxy-Authorization là của proxy đồng nghiệp.
// Chạy: CHAT_REPO=<akaAgentChatApi> node scripts/proxy-shared-desktop-smoke.cjs   (cần node_modules của checkout chính)
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { startCluster, requireFrom } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN = ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`) ? path.resolve(ROOT, '../../..') : ROOT
const NODE_MODULES = [path.join(ROOT, 'node_modules'), path.join(MAIN, 'node_modules')].filter(d => fs.existsSync(d))
const need = name => require(require.resolve(name, { paths: NODE_MODULES }))
const { Client } = requireFrom('pg')
const esbuild = need('esbuild')
const { createClient } = need('@supabase/supabase-js')
const FIX = path.join(ROOT, 'scripts/fixtures/proxy-shared-runtime-v665')
const V665 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v665_proxy_shared_runtime_bound_device.sql'), 'utf8')
const read = f => fs.readFileSync(path.join(FIX, f), 'utf8')
const STAFF_UUID = { 7: '00000000-0000-4000-8000-000000000007', 8: '00000000-0000-4000-8000-000000000008' }

let checks = 0
const pass = name => { checks++; console.log(`ok ${checks} - ${name}`) }

async function refuses(promise, pattern, name) {
  try { await promise } catch (err) {
    assert.match(String(err?.message || err), pattern, name)
    return pass(name)
  }
  throw new Error(`${name}: không bị từ chối`)
}

const FIXTURE_SQL = String.raw`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE private.aka_agent_desktop_users (staff_id bigint, auth_user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  is_admin_akabiz boolean NOT NULL DEFAULT false, deleted_at timestamptz, aka_agent_device_fingerprint_hash text);
CREATE TABLE public.auto_system_settings (id bigserial PRIMARY KEY, key text NOT NULL UNIQUE, value text, description text,
  is_secret boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  device_fingerprint_hash text NOT NULL, device_label text, device_platform text, app_version text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz, runtime_state jsonb, runtime_state_at timestamptz);
-- auto_proxies: cột, ràng buộc, quyền, RLS như akachat 26/11/2026.
CREATE TABLE public.auto_proxies (
  id bigserial PRIMARY KEY, name text NOT NULL, protocol text NOT NULL DEFAULT 'http', host text NOT NULL, port integer NOT NULL,
  username text, password text, staff_id bigint NOT NULL REFERENCES public.org_staff(id), organization_id bigint,
  is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_on date, note text,
  CONSTRAINT auto_proxies_port_check CHECK (port >= 1 AND port <= 65535),
  CONSTRAINT auto_proxies_protocol_check CHECK (protocol = ANY (ARRAY['http'::text, 'https'::text, 'socks5'::text])));
REVOKE ALL ON public.auto_proxies FROM anon, authenticated;
GRANT SELECT ON public.auto_proxies TO aka_agent_desktop;
GRANT INSERT (host, is_active, name, organization_id, password, port, protocol, staff_id, username),
      UPDATE (host, is_active, is_delete, name, password, port, protocol, updated_at, username) ON public.auto_proxies TO aka_agent_desktop;
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, name text, staff_id bigint, organization_id bigint, proxy_id bigint REFERENCES public.auto_proxies(id),
  flatform_type text, is_zalo_server boolean DEFAULT false, is_zalo_show_web boolean DEFAULT false, is_delete boolean DEFAULT false);
`

const POLICY_SQL = String.raw`
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_desktop_data_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION private.aka_agent_desktop_data_context() TO aka_agent_desktop;
ALTER TABLE public.auto_proxies ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_org_read ON public.auto_proxies AS RESTRICTIVE FOR SELECT TO aka_agent_desktop
  USING (organization_id = (SELECT ctx.organization_id FROM private.aka_agent_desktop_data_context() ctx(staff_id, organization_id, system_admin)));
CREATE POLICY desktop_owned_delete ON public.auto_proxies AS RESTRICTIVE FOR DELETE TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request));
CREATE POLICY desktop_owned_insert ON public.auto_proxies AS RESTRICTIVE FOR INSERT TO aka_agent_desktop
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request));
CREATE POLICY desktop_owned_update ON public.auto_proxies AS RESTRICTIVE FOR UPDATE TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request));
CREATE POLICY v435_existing_role_access ON public.auto_proxies AS PERMISSIVE FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
CREATE TRIGGER trg_prevent_delete_proxy_with_accounts BEFORE DELETE OR UPDATE OF is_delete ON public.auto_proxies
  FOR EACH ROW EXECUTE FUNCTION prevent_delete_proxy_with_accounts();
-- auto_accounts: Desktop chỉ cần đọc proxy_id tài khoản của mình (đếm lượt dùng); RLS rút gọn theo nhân viên.
GRANT SELECT ON public.auto_accounts TO aka_agent_desktop;
ALTER TABLE public.auto_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_own_accounts ON public.auto_accounts FOR SELECT TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));
CREATE TRIGGER trg_account_proxy_scope_guard BEFORE INSERT OR UPDATE OF proxy_id, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete
  ON public.auto_accounts FOR EACH ROW EXECUTE FUNCTION private.aka_agent_guard_account_proxy_scope();
REVOKE ALL ON FUNCTION private.aka_agent_proxy_shared_runtime_ready(bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_guard_account_proxy_scope() FROM PUBLIC;

INSERT INTO public.auto_system_settings(key, value) VALUES ('proxies.shared_runtime', '{"server":true,"desktopMinVersion":"9.6.0"}');
INSERT INTO public.org_organization VALUES (1, 'Tổ chức 1'), (2, 'Tổ chức 2');
INSERT INTO public.org_staff(id, organization_id, name, aka_agent_device_fingerprint_hash) VALUES
  (7, 1, 'Nhân viên chạy tài khoản', 'fp7'), (8, 1, 'Đồng nghiệp thêm proxy', 'fp8'), (9, 2, 'Nhân viên tổ chức khác', 'fp9');
INSERT INTO private.aka_agent_desktop_users(staff_id, auth_user_id) VALUES (7, '${STAFF_UUID[7]}'), (8, '${STAFF_UUID[8]}');
-- Nhân viên 7: máy gắn đã cập nhật 10.6.0, còn dòng 9.5.0 của chính máy 5 ngày trước (V511 chặn, V665 cho).
INSERT INTO public.auto_staff_device_presence(staff_id, organization_id, device_fingerprint_hash, app_version, started_at, last_seen_at, ended_at) VALUES
  (7, 1, 'fp7', '9.5.0', now() - interval '5 days 1 hour', now() - interval '5 days', now() - interval '5 days'),
  (7, 1, 'fp7', '10.6.0', now() - interval '2 hours', now() - interval '1 minute', NULL);
INSERT INTO public.auto_proxies(id, name, protocol, host, port, username, password, staff_id, organization_id, is_active) VALUES
  (1, 'Proxy của đồng nghiệp', 'http', '127.0.0.1', 9, 'user8', 'p@ss8', 8, 1, true),
  (2, 'Proxy của mình', 'socks5', '10.0.0.7', 1080, NULL, NULL, 7, 1, true),
  (3, 'Proxy đồng nghiệp đang tắt', 'http', '10.0.0.9', 8080, 'user9', 'pass9', 8, 1, false),
  (4, 'Proxy tổ chức khác', 'http', '10.0.0.4', 3128, 'u4', 'p4', 9, 2, true);
SELECT setval('public.auto_proxies_id_seq', 10);
INSERT INTO public.auto_accounts(id, name, staff_id, organization_id, flatform_type) VALUES
  (101, 'Facebook của 7', 7, 1, 'facebook'), (102, 'Zalo QR của 7', 7, 1, 'zalo');
`

/** PostgREST giả: chỉ GET, chạy SELECT dưới vai aka_agent_desktop với JWT claims của nhân viên (RLS thật của DB). */
function makeRestFetch(db, staffId, log) {
  const IDENT = /^[a-z_][a-z0-9_]*$/
  return async (input, init = {}) => {
    const url = new URL(String(input))
    const method = (init.method || 'GET').toUpperCase()
    const table = url.pathname.replace(/^\/rest\/v1\//, '')
    if (method !== 'GET' || !IDENT.test(table)) throw new Error(`PostgREST giả chỉ nhận GET bảng: ${method} ${url.pathname}`)
    const params = []
    const where = []
    let columns = '*', order = ''
    for (const [key, raw] of url.searchParams) {
      if (key === 'select') {
        columns = raw === '*' ? '*' : raw.split(',').map(c => { assert.match(c, IDENT); return c }).join(', ')
        continue
      }
      if (key === 'order') {
        order = ' ORDER BY ' + raw.split(',').map(part => {
          const [col, dir] = part.split('.'); assert.match(col, IDENT)
          return `${col} ${dir === 'desc' ? 'DESC' : 'ASC'}`
        }).join(', ')
        continue
      }
      assert.match(key, IDENT)
      if (raw === 'is.null') where.push(`${key} IS NULL`)
      else if (raw === 'not.is.null') where.push(`${key} IS NOT NULL`)
      else if (raw.startsWith('eq.')) { params.push(raw.slice(3)); where.push(`${key} = $${params.length}`) }
      else throw new Error(`PostgREST giả chưa hỗ trợ bộ lọc ${key}=${raw}`)
    }
    const sql = `SELECT coalesce(json_agg(t), '[]'::json) AS rows FROM (SELECT ${columns} FROM public.${table}` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') + `${order}) t`
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE aka_agent_desktop')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'aka_agent_desktop', sub: STAFF_UUID[staffId] })])
      const { rows } = await db.query(sql, params)
      await db.query('COMMIT')
      log.push({ table, query: url.search })
      const data = rows[0].rows
      const accept = new Headers(init.headers || {}).get('accept') || ''
      if (accept.includes('vnd.pgrst.object')) {
        if (data.length !== 1) return new Response(JSON.stringify({ code: 'PGRST116', message: 'not one row' }), { status: 406, headers: { 'content-type': 'application/json' } })
        return new Response(JSON.stringify(data[0]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {})
      return new Response(JSON.stringify({ message: err.message, code: err.code }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
  }
}

/** Đóng gói mã thật của Desktop. Module ngoài đường proxy của zaloRuntimeService thay bằng stub CommonJS (không gọi tới). */
async function bundleDesktop(dir) {
  const entry = path.join(dir, 'entry.ts')
  fs.writeFileSync(entry, [
    `export * as proxyRepo from ${JSON.stringify(path.join(ROOT, 'src/main/data/repositories/proxyRepository'))}`,
    `export { ProxyRuntimeService } from ${JSON.stringify(path.join(ROOT, 'src/main/services/proxyRuntimeService'))}`,
    `export { ZaloRuntimeService } from ${JSON.stringify(path.join(ROOT, 'src/main/services/zaloRuntimeService'))}`,
    `export { MISSING_ACCOUNT_PROXY_MESSAGE } from ${JSON.stringify(path.join(ROOT, 'src/shared/proxyRuntime'))}`
  ].join('\n'))
  const zaloFile = path.join(ROOT, 'src/main/services/zaloRuntimeService.ts')
  const KEEP_FROM_ZALO = new Set(['./zaloProxyConnectObserver', '../../shared/proxyRuntime'])
  const FIXTURES = {
    electron: `module.exports = globalThis.__desktopFx.electron`,
    supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__desktopFx.client }`,
    currentUser: `module.exports = { requireCurrentUser: () => globalThis.__desktopFx.user, getCurrentUser: () => globalThis.__desktopFx.user }`,
    webEnrichmentControl: `module.exports = { preemptWebEnrichment() {}, webEnrichmentSnapshot: () => [] }`,
    stub: `module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : function stub() { return undefined } })`
  }
  const out = path.join(dir, 'desktop.cjs')
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: out,
    nodePaths: NODE_MODULES, logLevel: 'error',
    plugins: [{
      name: 'desktop-fixtures',
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fx' }))
        build.onResolve({ filter: /(?:^|\/)(supabaseClient|currentUser|webEnrichmentControl)$/ }, args =>
          ({ path: args.path.split('/').pop(), namespace: 'fx' }))
        build.onResolve({ filter: /^\./ }, args => {
          if (args.importer !== zaloFile || KEEP_FROM_ZALO.has(args.path)) return undefined
          return { path: `stub:${args.path}`, namespace: 'fx' }
        })
        build.onLoad({ filter: /.*/, namespace: 'fx' }, args => ({
          contents: FIXTURES[args.path] ?? FIXTURES.stub, loader: 'js'
        }))
      }
    }]
  })
  return require(out)
}

/** Proxy giả: ghi dòng lệnh và Proxy-Authorization rồi trả 403 (không ra mạng). */
async function withFakeProxy(run) {
  const seen = []
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', buffer => {
      const lines = buffer.toString('latin1').split('\r\n')
      const auth = lines.find(l => /^proxy-authorization:/i.test(l))
      seen.push({ line: lines[0], auth: auth ? auth.split(':').slice(1).join(':').trim() : null })
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { return await run(server.address().port, seen) } finally { await new Promise(resolve => server.close(resolve)) }
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-shared-desktop-'))
  const cluster = startCluster({ port: 56000 + (process.pid % 900), label: 'v665-desk-', timeoutMs: 180000 })
  let admin, rest
  try {
    admin = await cluster.connect()
    await admin.query('CREATE DATABASE desk')
    await admin.end()
    const connect = async () => { const c = new Client({ host: cluster.temp, port: 56000 + (process.pid % 900), user: 'postgres', database: 'desk' }); await c.connect(); return c }
    admin = await connect()
    rest = await connect()
    await admin.query(FIXTURE_SQL)
    for (const f of ['live-staff-scope-20261126.sql', 'live-desktop-context-20261126.sql', 'live-20261126.sql', 'live-guard-20261126.sql']) await admin.query(read(f))
    await admin.query(String.raw`CREATE OR REPLACE FUNCTION public.prevent_delete_proxy_with_accounts()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_delete = false AND NEW.is_delete = true) THEN
    IF EXISTS (
      SELECT 1
      FROM public.auto_accounts a
      WHERE a.proxy_id = OLD.id
        AND a.is_delete = false
    ) THEN
      RAISE EXCEPTION 'Không thể xoá proxy khi còn tài khoản đang dùng proxy này';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$`)
    await admin.query(POLICY_SQL)
    const md5 = async sig => (await admin.query(`SELECT md5(pg_get_functiondef($1::regprocedure)) m`, [sig])).rows[0].m
    assert.equal(await md5('private.aka_agent_staff_scope_for_request()'), 'd417807fa9dc08cfecbd6cd0aab7df3e')
    assert.equal(await md5('private.aka_agent_desktop_data_context()'), '1c661248ef952acb98ee2a2082cf8bf8')
    assert.equal(await md5('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)'), '5c25d073f3a9ee1859dccf6cc4f45fff')
    assert.equal(await md5('private.aka_agent_guard_account_proxy_scope()'), 'f627625f6081c390328be43d27bec454')
    pass('DB cục bộ: 4 hàm có md5 như production 26/11')

    // ------------------------------------------------------------------ gắn proxy đồng nghiệp (Web ghi bằng service_role → trigger)
    await refuses(admin.query('UPDATE public.auto_accounts SET proxy_id = 1 WHERE id = 101'), /proxy_shared_runtime_not_ready/,
      'bản V511: trigger chặn gắn proxy đồng nghiệp (máy gắn đã 10.6.0, còn dòng 9.5.0 5 ngày trước)')
    await admin.query(V665)
    assert.equal(await md5('private.aka_agent_proxy_shared_runtime_ready(bigint,boolean)'), 'ee76fb5dae789f510cb90425f24e0f03')
    pass('apply đúng file V665')
    await admin.query('UPDATE public.auto_accounts SET proxy_id = 1 WHERE id IN (101, 102)')
    pass('V665: trigger cho gắn proxy đồng nghiệp cho tài khoản Facebook và Zalo QR của nhân viên 7')

    // ------------------------------------------------------------------ mã thật của Desktop, đăng nhập là nhân viên 7
    const restLog = []
    const proxyCalls = []
    const sessions = new Map()
    globalThis.__desktopFx = {
      user: { staffId: 7, organizationId: 1 },
      client: createClient('http://127.0.0.1:54321', 'fixture-publishable-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: makeRestFetch(rest, 7, restLog) }
      }),
      electron: {
        app: { on() {}, getPath: () => work },
        session: {
          fromPartition(partition) {
            if (!sessions.has(partition)) sessions.set(partition, {
              partition,
              async setProxy(config) { proxyCalls.push({ partition, config }) },
              async closeAllConnections() {},
              async forceReloadProxyConfig() {}
            })
            return sessions.get(partition)
          }
        }
      }
    }
    const desktop = await bundleDesktop(work)
    const { proxyRepo, ProxyRuntimeService, ZaloRuntimeService, MISSING_ACCOUNT_PROXY_MESSAGE } = desktop
    pass('đóng gói mã thật: proxyRepository, ProxyRuntimeService, ZaloRuntimeService')

    const list = await proxyRepo.listProxies()
    assert.deepEqual(list.map(p => p.id).sort(), [1, 2, 3])
    assert.equal(list.find(p => p.id === 1).staffId, 8)
    assert.equal(list.find(p => p.id === 1).password, null)
    assert.equal(list.find(p => p.id === 1).usageCount, 2)
    pass('listProxies: thấy proxy cả tổ chức (gồm của đồng nghiệp), không thấy tổ chức khác, không trả mật khẩu, đếm 2 tài khoản đang dùng')

    const colleague = await proxyRepo.getProxy(1)
    assert.equal(colleague?.host, '127.0.0.1')
    assert.equal(colleague?.username, 'user8')
    assert.equal(colleague?.password, 'p@ss8')
    pass('getProxy (bộ chạy): đọc được proxy của đồng nghiệp kèm tài khoản / mật khẩu proxy')
    assert.equal(await proxyRepo.getProxy(4), null)
    pass('getProxy: proxy tổ chức khác không đọc được (RLS)')
    await refuses(proxyRepo.updateProxy(1, { name: 'Sửa thử' }), /do đồng nghiệp thêm/, 'updateProxy: không sửa được proxy của đồng nghiệp')
    assert.ok(restLog.every(r => r.table === 'auto_proxies' || r.table === 'auto_accounts'))

    // Trình duyệt (Facebook / Zalo trình duyệt): ProxyRuntimeService thật với getProxy thật.
    const runtime = new ProxyRuntimeService(id => proxyRepo.getProxy(id))
    await runtime.prepareAccountSession({ id: 101, proxyId: 1 })
    const applied = proxyCalls.at(-1)
    assert.equal(applied.partition, 'persist:account_101')
    assert.deepEqual(applied.config, { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:9' })
    const ses = sessions.get('persist:account_101')
    assert.deepEqual(runtime.getSessionProxyAuthentication(ses), { host: '127.0.0.1', port: 9, username: 'user8', password: 'p@ss8' })
    assert.equal(runtime.isAccountSessionPrepared({ id: 101, proxyId: 1 }), true)
    pass('trình duyệt: phiên tài khoản 101 đặt proxy http://127.0.0.1:9 của đồng nghiệp, giữ đúng tài khoản / mật khẩu proxy')

    // Zalo QR: createZaloClient thật + zca-js loginQR thật qua proxy giả.
    const zaloRuntime = Object.create(ZaloRuntimeService.prototype)
    zaloRuntime.getProxyById = id => proxyRepo.getProxy(id)
    await withFakeProxy(async (port, seen) => {
      await admin.query('UPDATE public.auto_proxies SET port = $1 WHERE id = 1', [port])
      const zalo = await zaloRuntime.createZaloClient({ id: 102, proxyId: 1 })
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('loginQR treo quá 15 giây')), 15000).unref())
      await Promise.race([zalo.loginQR({ userAgent: 'Mozilla/5.0', language: 'vi' }, () => {}), timeout]).catch(err => {
        if (/treo/.test(err.message)) throw err
      })
      assert.equal(seen[0]?.line, 'CONNECT id.zalo.me:443 HTTP/1.1')
      assert.equal(seen[0]?.auth, 'Basic ' + Buffer.from('user8:p@ss8').toString('base64'))
      pass(`Zalo QR: zca-js gọi id.zalo.me qua proxy của đồng nghiệp (CONNECT tới proxy giả cổng ${port}, đúng Proxy-Authorization)`)
    })

    // Proxy đồng nghiệp đang tắt: ghi lại hành vi hiện có (không phải V665).
    await admin.query('UPDATE public.auto_accounts SET proxy_id = 3 WHERE id IN (101, 102)')
    await runtime.prepareAccountSession({ id: 101, proxyId: 3 })
    assert.deepEqual(proxyCalls.at(-1).config, { mode: 'system' })
    const zaloOff = await zaloRuntime.createZaloClient({ id: 102, proxyId: 3 })
    assert.equal(zaloOff.options?.agent, undefined)
    pass('HÀNH VI HIỆN CÓ: proxy (của đồng nghiệp) đang tắt ⇒ trình duyệt về mạng của máy, Zalo QR không có agent proxy — chạy không qua proxy, không báo lỗi')
    await admin.query('UPDATE public.auto_accounts SET proxy_id = 1 WHERE id IN (101, 102)')

    // Proxy không còn đọc được (không thuộc tổ chức): bộ chạy phải dừng.
    await refuses(admin.query('UPDATE public.auto_proxies SET is_delete = true WHERE id = 1'), /Không thể xoá proxy khi còn tài khoản đang dùng/,
      'xoá proxy của đồng nghiệp khi tài khoản còn dùng bị trigger production chặn')
    await admin.query('UPDATE public.auto_proxies SET organization_id = 2 WHERE id = 1')
    const before = proxyCalls.length
    await refuses(runtime.prepareAccountSession({ id: 101, proxyId: 1 }), new RegExp(MISSING_ACCOUNT_PROXY_MESSAGE.slice(0, 30)),
      'trình duyệt: không đọc được proxy ⇒ dừng với câu "Không đọc được proxy của tài khoản…"')
    assert.equal(proxyCalls.length, before, 'không đặt proxy nào khi dừng')
    await withFakeProxy(async (_port, seen) => {
      await refuses(zaloRuntime.createZaloClient({ id: 102, proxyId: 1 }), new RegExp(MISSING_ACCOUNT_PROXY_MESSAGE.slice(0, 30)),
        'Zalo QR: không đọc được proxy ⇒ dừng, không tạo client')
      assert.equal(seen.length, 0)
    })
    console.log(`proxy-shared-desktop-smoke: ${checks}/${checks} đạt`)
  } finally {
    await rest?.end().catch(() => {})
    await admin?.end().catch(() => {})
    cluster.stop()
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch(err => { console.error('FAIL', err); process.exit(1) })
