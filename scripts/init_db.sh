#!/usr/bin/env bash
# Khởi tạo bảng LMS trong database project_manager (dùng chung, user pm_user).
#   ./scripts/init_db.sh          # chạy migration LMS (alembic upgrade head)
#   ./scripts/init_db.sh --demo   # kèm dữ liệu mẫu (db/seeds/01_demo_data.sql) nếu chưa có công ty DEMO
# Cần database project_manager đã ở revision 0008 (project_manager/scripts/init_db.sh hoặc khởi động API của nó).
# Không bao giờ xoá dữ liệu có sẵn.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$ROOT/.env" ]] && source "$ROOT/.env"

CONTAINER="${PG_CONTAINER:-carbon_analyst_db}"
DB="${PM_DB_NAME:-project_manager}"

psql_pm() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U pm_user -d "$DB" "$@"; }

echo "→ Chạy migration LMS (alembic upgrade head)"
docker compose -f "$ROOT/docker-compose.yml" run --rm --build --no-deps api alembic upgrade head

if [[ "${1:-}" == "--demo" ]]; then
  if [[ "$(psql_pm -Atc "SELECT count(*) FROM companies WHERE code = 'DEMO'")" == "0" ]]; then
    psql_pm < "$ROOT/db/seeds/01_demo_data.sql"
    echo "  + dữ liệu mẫu: công ty DEMO, nhân viên NV001..NV004 (mật khẩu Demo@123)"
  else
    echo "  ! Đã có công ty DEMO — bỏ qua dữ liệu mẫu"
  fi
fi
echo "✓ Xong"
