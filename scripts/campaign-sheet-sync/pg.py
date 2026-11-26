"""Cụm Postgres 16 dùng một lần cho bài kiểm V662 (chạy psql qua tiến trình con, không cần thư viện Python).

Chạy bằng root trong container: initdb / postgres chạy dưới user hệ thống `postgres`.
"""
import json
import os
import shutil
import subprocess
import tempfile

BIN = next((d for d in [os.environ.get('PG_BIN', ''), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin',
                          '/opt/homebrew/opt/postgresql@17/bin'] if d and os.path.exists(os.path.join(d, 'initdb'))), None)


def _as_pg(cmd):
    if os.geteuid() == 0:
        return ['runuser', '-u', 'postgres', '--'] + cmd
    return cmd


class Cluster:
    def __init__(self, port=55462):
        if not BIN:
            raise SystemExit('Không tìm thấy initdb (đặt PG_BIN)')
        self.dir = tempfile.mkdtemp(prefix='v662-pg-')
        os.chmod(self.dir, 0o777)
        self.port = port
        env = dict(os.environ, LC_ALL='C')
        subprocess.run(_as_pg([os.path.join(BIN, 'initdb'), '-D', self.dir + '/data', '-U', 'postgres', '--auth=trust', '-E', 'UTF8'] + (['--locale=C.UTF-8'] if self._has_c_utf8() else [])),
                       check=True, capture_output=True, env=env)
        subprocess.run(_as_pg([os.path.join(BIN, 'pg_ctl'), '-D', self.dir + '/data', '-l', self.dir + '/log', '-w',
                               '-o', f'-k {self.dir} -p {port} -c listen_addresses=', 'start']), check=True, capture_output=True, env=env)

    @staticmethod
    def _has_c_utf8():
        # Production dùng en_US.UTF-8: lower() chữ Việt có dấu chỉ đúng khi ctype là UTF-8.
        try:
            out = subprocess.run(['locale', '-a'], capture_output=True, text=True).stdout.lower()
            return 'c.utf8' in out or 'c.utf-8' in out
        except OSError:
            return False

    def psql(self, sql, check=True, db='postgres'):
        out = subprocess.run(_as_pg([os.path.join(BIN, 'psql'), '-h', self.dir, '-p', str(self.port), '-U', 'postgres', '-d', db,
                                     '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']),
                             input=sql, capture_output=True, text=True)
        if check and out.returncode != 0:
            raise RuntimeError(out.stderr.strip())
        return out

    def one(self, sql):
        out = self.psql(sql).stdout.strip().splitlines()
        return out[-1] if out else ''

    def json(self, sql):
        return json.loads(self.one(sql))

    def error(self, sql):
        out = self.psql(sql, check=False)
        return out.stderr.strip() if out.returncode != 0 else None

    def stop(self):
        subprocess.run(_as_pg([os.path.join(BIN, 'pg_ctl'), '-D', self.dir + '/data', '-m', 'fast', 'stop']), capture_output=True)
        shutil.rmtree(self.dir, ignore_errors=True)
