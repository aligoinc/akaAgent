# Lịch sử chạy chiến dịch — V408

Ngày 16/10/2026. Canonical SQL ở `migrations/migration_v408_campaign_logs.sql`; chỉ apply trên akachat (`cgjbsmqtfhqvttudyjzq`).

## Hợp đồng dữ liệu

```sql
CREATE TABLE public.auto_campaign_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
  log text NOT NULL CHECK (btrim(log) <> '' AND char_length(log) <= 16000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_campaign_logs_campaign_id_id
  ON public.auto_campaign_logs (campaign_id, id DESC);
```

Một lần append là một dòng, giữ nguyên xuống dòng, Unicode và marker screenshot. Cắt tại 16.000 ký tự theo PostgreSQL, kèm marker cũ. Không backfill, không dual write, không TTL/cron/xóa lịch sử. `auto_campaigns.log` cũ đóng băng; giao diện mới chỉ hiển thị dữ liệu sau chuyển đổi. FK RESTRICT giữ log khi có yêu cầu xóa vật lý campaign; xóa mềm vẫn theo hợp đồng hiện có và RPC từ chối đọc/ghi campaign đã xóa.

`append_auto_campaign_log(bigint,bigint,text)` vẫn trả boolean, giữ kiểm tra ID/staff/campaign chưa xóa. Lấy transaction advisory lock riêng `hashtextextended('auto_campaign_logs:' || campaign_id, 0)` trước INSERT/cấp identity. Các transaction cùng campaign chỉ cấp ID theo thứ tự qua khóa và commit/rollback; đọc `afterId` không thể nhảy qua một append cũ chưa commit. ID có thể có khoảng trống khi rollback; client không suy diễn ID liên tiếp.

Ghi mới không SELECT lịch sử cũ, không UPDATE campaign và không khóa dòng campaign để ghép log. FK vẫn có kiểm tra khóa ngoại tiêu chuẩn. Khóa advisory giữ đến cuối transaction của caller, vì vậy transaction dài vẫn có thể làm các log cùng campaign chờ.

## Quyền và tương thích

RLS bật, không policy trực tiếp; REVOKE table/sequence cho PUBLIC, anon, authenticated, service_role, aka_agent_chat_api. Writer đổi có chủ đích từ INVOKER sang DEFINER của postgres, search_path cố định pg_catalog/public để gọi INSERT khi client không có quyền bảng. Giữ EXECUTE cho bốn role có tên hiện hữu; bỏ EXECUTE PUBLIC rộng. Không thay credential helper hoặc tenant/entitlement của RPC hiện có.

RPC Desktop mới `aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb)` dùng đúng cổng credential/staff/org/account/quyền nền tảng của nhánh log Desktop live. RPC Web `aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)` chỉ service_role, kiểm tra cả campaign và account thuộc staff/org, chưa xóa, platform được phép; Zalo phải Server và không Web. API phải xác thực session trước khi truyền scope này.

Nhánh log của `aka_agent_desktop_campaign_detail` cũ dựng chuỗi từ bảng mới khi đọc, giữ response/delta cho client cũ. Endpoint native `/log` cũng dựng chuỗi mới khi đọc, tối đa 2.000 mục và dưới 256 KiB UTF-8. Helper dừng con trỏ index ngay khi đầy giới hạn, không tải toàn lịch sử. Không sửa UI native. Desktop cũ không có tải lịch sử vô hạn; cần cập nhật để dùng giao diện mới.

Không đổi phần cấu hình/config version/access của detail RPC; diagnostics giữ các truy vấn account log, action result, input và credential/tenant như bản live. Chỉ nguồn campaignHistory đổi sang tối đa 30 dòng vật lý không rỗng mới nhất từ bảng mới, tối đa 8.000 ký tự/dòng. Quy tắc che credential ở ứng dụng giữ nguyên. Context trợ lý Desktop/Web đọc nguồn mới theo giới hạn cũ.

## API và cursor

`GET /api/aka-agent/control/v1/campaigns/:id/logs?limit=100`

```json
{"campaignId":101,"items":[{"id":"9007199254740993","log":"...","createdAt":"2026-10-16T09:00:00+00:00"}],"hasMore":true,"nextCursor":"9007199254740993","throughId":null}
```

- Mặc định 100, tối đa 500 mục; ID/cursor là chuỗi thập phân trong miền bigint, không ép Number.
- Trang đầu/`beforeId` trả mới đến cũ; `nextCursor` là ID cuối trang.
- `afterId` trả cũ đến mới. Lần đầu chốt `throughId` từ ID mới nhất đã nhìn thấy; các trang tiếp theo giữ mốc này để kết thúc hữu hạn ngay cả khi writer vẫn chạy. Chỉ tiến newestId trong UI sau khi tất cả trang thành công. Lỗi/hủy ở trang sau giữ cursor trước lượt tải để thử lại không mất dữ liệu.
- Tải mới tự động giữ số mục đang xem (ít nhất 100); mục rời cửa sổ vẫn tải lại được bằng “Tải lịch sử cũ hơn”. Bấm tải cũ tăng cửa sổ thêm 100; không xóa dữ liệu DB.
- Truy vấn dùng campaign_id/ID + LIMIT, không OFFSET hoặc COUNT toàn lịch sử. LIMIT+1 chỉ xác định hasMore. Hai helper đọc dùng custom plan để tránh generic plan chọn global PK rồi lọc hàng loạt campaign khác khi phân bố lịch sử lệch.

Desktop/Web dùng sự kiện log, reconnect/focus và chu kỳ đọc danh sách hiện hữu; không dựa updatedAt để tải log. Không thêm pool, connection nghiệp vụ hay polling clock. Scope/session, tab active, visibility và generation chặn kết quả muộn; tải cũ Desktop cũng bị hủy khi rời tab. Luồng mới bỏ hash/ghép/parse toàn chuỗi; mỗi entry hiển thị một mục, kể cả continuation trông giống timestamp. Khung Tiến trình tiếp tục 500 mục RAM, kết quả hành động/data/random history không thay đổi.

## Kiểm chứng

- `node scripts/campaign-history-smoke.cjs`: bigint, drain đủ trang, high-watermark, lỗi trang sau, cancellation, cửa sổ RAM, tải cũ, multiline/screenshot, overflow, parity Desktop/Web.
- `node scripts/campaign-history-sql-smoke.cjs`: PostgreSQL 16 cô lập, bốn role gọi RPC và bị chặn bảng, field campaign bất biến, cap UTF-8, tenant/platform/credential/deleted guards, commit đảo thứ tự bị chặn trước identity, rollback, index và khôi phục snapshot giữ log.
- Cùng smoke chạy code Chat `appendCampaignLogWithRealtime` thật với Kysely/pg và role aka_agent_chat_api trên DB cục bộ: log commit, notification kind=log phát và campaign.updatedAt giữ nguyên. Không cần sửa/deploy Chat runtime.
- SQL live `migrations/tests/migration_v408_campaign_logs_smoke.sql` chạy trong BEGIN/ROLLBACK, không để lại fixture. Supabase postgres không được SET ROLE aka_agent_chat_api: kiểm tra grants trên live, thực thi role này ở DB cô lập; ba role còn lại được SET ROLE và thử live.
- Electron thật `node scripts/run-campaign-history-ui-smoke.cjs`: 100 mục, tải cũ, Unicode nhiều dòng, log signal khi campaign timestamp giữ nguyên, bỏ tải cũ khi rời tab, logout fence. HTTP bị chặn; ảnh ở `docs/audits/campaign-logs-v408/desktop-history.png`.
- Web 83 ca CampaignDetailDock/CampaignsPage và 3 ca lifecycle history mới đạt. API 364 ca repository/routes/service/assistant/diagnostics đạt.
- Browser production bundle: 3 cấu hình Desktop Chromium, Android Chromium, iPhone WebKit; 100 mục/tải cũ, bigint, drain 1.200 mục mới qua nhiều trang với updatedAt bất biến. API/WS giả lập, không chạy campaign/gửi tin/model.
- Desktop hai typecheck, production build và Server build đạt; Web toàn bộ workspace typecheck và production build đạt. API bundle nhúng module TypeScript campaign-core bằng tsup noExternal để chạy được trong image Node.
- Hồi quy diagnostics/che dữ liệu, editVersion và trạng thái realtime đạt. Hai fixture cũ được cập nhật theo dependency mapper và kênh log hiện hữu.

## Đo cùng tải trên DB cục bộ

Mỗi hàng đo 120 append cùng message. CPU từ tiến trình PostgreSQL có độ phân giải khoảng 10 ms; 0 không có nghĩa là không dùng CPU. WAL là EXPLAIN ANALYZE WAL của một append sau lượt đo; dữ liệu mẫu có thể nén mạnh. Contention: hai writer, mỗi writer 60 transaction; lấy mẫu wait_event_type=Lock mỗi khoảng 2 ms. Đây là fixture để so cơ chế, không phải phần trăm CPU production hoặc SLA.

| Lịch sử | 120 ghi (ms) | CPU (ms) | WAL một ghi (byte) | P95 hai writer (ms) | Mẫu lock / lượt lấy mẫu |
|---|---:|---:|---:|---:|---:|
| legacy-0 | 20.43 | 20 | 997 | 1.481 | 29 / 32 |
| legacy-2000 | 670.27 | 660 | 5081 | 11.897 | 236 / 257 |
| new-0 | 3.07 | 0 | 301 | 0.264 | 3 / 6 |
| new-2000 | 2.88 | 0 | 301 | 0.284 | 0 / 5 |
| new-100000 | 2.85 | 0 | 301 | 0.241 | 2 / 5 |

Truy vấn history 100.000 mục và campaign thưa dùng index; prepared query giữ điều kiện campaign và cursor trong Index Cond. Báo cáo đầy đủ `docs/audits/campaign-logs-v408/local-sql.json`.

## Snapshot và checksum

Trước chỉnh sửa đã lấy định nghĩa live/owner/ACL/security/volatility/config. Nguồn là `migrations/snapshots/campaign-logs-v408/before.json`; preflight fail-closed nếu bất kỳ định nghĩa cũ đổi hoặc bảng đã tồn tại. Các patch live ngoài phạm vi log được giữ nguyên.

| Chữ ký | MD5 trước | MD5 V408 |
|---|---|---|
| `aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)` | `2b0ba11c25cc61f111f5ed068a31626c` | `9391f47e1be976e0d7e595325d3c2f31` |
| `aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)` | `mới` | `3bafa54ccba53cb9788a32ab754ab7da` |
| `aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)` | `496c1f46adc7e4edfefbeeb0babd123e` | `8cd5def0920f178d5efed9fb73ddefab` |
| `aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb)` | `mới` | `61f1ce6860cfc474d998cc70005717a1` |
| `append_auto_campaign_log(bigint,bigint,text)` | `f94520920cec83d91829b7f542435eeb` | `230e219f5b854a2d2154ee0dc6c867a2` |
| `private.campaign_log_legacy(bigint)` | `mới` | `453c9f8a1e3d233764e9284e17c36be7` |
| `private.campaign_log_page(bigint,jsonb)` | `mới` | `9df075f367231f8ad06970bfb6a62a5a` |

## Triển khai và rollback

Đã apply **16:44:17 ngày 16/10/2026 giờ Việt Nam**, history `20261016094417 / migration_v408_campaign_logs`. Bảy checksum/owner/security/volatility/config/ACL live khớp đích đã kiểm tra; RLS/index đúng. Rollback smoke sau apply đạt và không để lại fixture. Snapshot đích ở `migrations/snapshots/campaign-logs-v408/after.json`.

Quan sát live đầu tiên: 187 mục/70 campaign trong khoảng 20 giây; lần tiếp theo 1.384 mục/230 campaign, không có UPDATE/DELETE trên bảng mới và không có fixture V408. Cả 10 campaign đối chiếu giữ MD5 legacy log, trong đó tám campaign có thêm log mới. updated_at thực tế vẫn có thể đổi bởi tiến độ/trạng thái nghiệp vụ; tính bất biến riêng thao tác append được kiểm chứng trong transaction. Bằng chứng đã giảm thông tin ở `docs/audits/campaign-logs-v408/live.json`. Ghi/NOTIFY Chat đã kiểm bằng code thật ở DB cô lập; không khẳng định đã quan sát đầy đủ WebSocket của từng client production.

Web/API đã deploy lên `https://agent.akabiz.net`, image `registry.fly.io/aka-agent-web-app:campaign-logs-v408-20261016@sha256:8d8138911a35dac862d4579a69afae1c89c6bb36302aaeec534fcdadede49734`. Machine `48ee749f357398` healthy 1/1; cấu hình trước/sau chỉ đổi image, giữ 1 shared CPU/512 MB và connection. Health/home 200, hai endpoint /log và /logs không đăng nhập trả 401 no-store; asset và API runtime SHA-256 khớp build local. Ba browser profile chạy trên domain production đều đạt với API/WS giả lập. Mẫu 100 dòng log có 51 HTTP 200, một 404, không error/fatal/5xx/OOM trong mẫu; không phải load test.

Source triển khai là snapshot working tree WebApp đã kiểm tra, receipt SHA-256 `8645db3bb5d67ccad135b0bc234585f08bd698a4cb2fbd3cd13f2757a4b7d576`. Bằng chứng deployment/source/config/build/HTTP/browser/checksum ở thư mục riêng tư `/Users/lequangnhut/.codex/deployments/campaign-logs-v408-zbp09w5p`. Image trước deploy: `registry.fly.io/aka-agent-web-app:campaign-save-757f0af-20261016@sha256:ee496dd8bdd65681c255c94ffb5a8f7832c8f09d8b4c33da168835c4bff27854`. Chỉ rollback image sau khi xác nhận chưa có deployment mới hơn.

Desktop/Server build local, chưa đóng gói bộ cài/phát hành. Cần cập nhật Desktop để dùng màn hình phân trang; writer Server/Chat cũ tiếp tục gọi cùng RPC.

Đối chiếu bản Desktop 8.5.0 sau chuyển đổi: nhánh đọc `aka_agent_desktop_campaign_detail(..., 'log', ...)` vẫn trả log mới qua helper tương thích. Vì vậy app cũ vẫn ghi/xem được lịch sử mới, chỉ chưa có phân trang. Chiến dịch 31798 được kiểm tra read-only: cột cũ dừng ở 07:24:36 ngày 16/10, bảng mới có lượt 16:57–16:58:29 cùng ngày.

Review Web V408: tín hiệu mới từng chỉ đọc `runtimeEvents`, bỏ sót log từ socket Chat vốn nằm trong `events`. Bản sửa ở WebApp đọc sự kiện mới nhất của campaign từ danh sách `events` chung hai socket, giữ guard/in-flight/cursor/cadence và 500 mục Tiến trình; không sửa Desktop/Server/Chat API hoặc SQL. 98 ca UI/realtime, typecheck/build và ba browser profile với hai socket/API giả lập đạt. Chi tiết và release bản vá ở `akaAgentWebApp/docs/CAMPAIGN_LOGS_V408.md`.

Review Web tiếp theo: gom tín hiệu log/reconnect trong cửa sổ cố định 2 giây, hủy timer theo tab/campaign/phiên/visibility; mở tab/focus/page refresh vẫn đọc ngay, không thêm polling. Dev mock bổ sung `/logs` với entry/cursor riêng. 113 ca kiểm thử, typecheck 7 workspace, build và 3 profile browser local/production đạt; 20 log/2 giây giảm từ 21 xuống 2 request trong mô phỏng. Đã deploy Web image `campaign-history-coalesce-20261016` lúc 17:31 ngày 16/10/2026, chỉ đổi image trên machine hiện có; không sửa DB hoặc Desktop/Server/Chat runtime. Audit, checksum và rollback riêng bản vá ở tài liệu WebApp nêu trên.

Rollback SQL có checksum đích tại `migrations/snapshots/campaign-logs-v408/rollback.sql`. Kiểm tra không có thay đổi mới hơn, rollback ứng dụng theo snapshot/image đã lưu, rồi khôi phục đúng ba RPC cũ và ACL/comment/owner. Bảng mới, index, dữ liệu và helper được giữ nguyên; không DROP/TRUNCATE/DELETE/backfill. Writer cũ sẽ nối vào log legacy trở lại trong thời gian rollback, lịch sử mới giữ lại để xử lý tiếp có chủ đích. Không tự nối/migrate hai nguồn.
