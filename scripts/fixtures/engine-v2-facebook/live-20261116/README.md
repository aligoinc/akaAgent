# Thân hàm engine v2 đang chạy production (đọc chỉ đọc 16/11/2026 ~19:10 VN, akachat `cgjbsmqtfhqvttudyjzq`)

`pg_get_functiondef` nguyên văn của các hàm mà V558 / bản sau sửa thân, làm nguồn cho `scripts/build-v558-sql.cjs`. Không phải dữ liệu khách.
DB thử (`scripts/engine-v2-facebook/fixture.cjs`, tới V532) cho đúng các md5 này. Trước khi apply, preflight của migration kiểm lại md5
trên production; production đã đổi thì đọc lại và sinh lại.
