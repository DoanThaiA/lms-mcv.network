from tests.conftest import PASSWORD


async def _login(client, company: str, employee: str, password: str = PASSWORD):
    return await client.post(
        "/auth/login", json={"company_code": company, "employee_code": employee, "password": password}
    )


async def test_login_by_company_and_employee_code(client):
    resp = await _login(client, "demo", "nv003")  # mã không phân biệt hoa thường
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    me = (await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["company"]["code"] == "DEMO"
    assert me["user"]["employee_code"] == "NV003"
    assert me["role"] == "learner" and me["permissions"] == []


async def test_same_employee_code_in_other_company(client, login):
    me = (await client.get("/auth/me", headers=await login("NV001", "KHAC"))).json()
    assert me["company"]["code"] == "KHAC"
    assert me["user"]["full_name"] == "Ngô Công Ty Khác"
    assert me["role"] == "learner"


async def test_login_failures(client):
    assert (await _login(client, "DEMO", "NV003", "sai-mat-khau")).status_code == 401
    assert (await _login(client, "KHONGCO", "NV003")).status_code == 401
    assert (await _login(client, "DEMO", "NV999")).status_code == 401
    assert (await client.get("/auth/me")).status_code == 401
    assert (await client.get("/auth/me", headers={"Authorization": "Bearer abc"})).status_code == 401


async def test_admin_permissions(client, login):
    me = (await client.get("/auth/me", headers=await login("NV001"))).json()
    assert me["role"] == "admin"
    assert set(me["permissions"]) == {"employee.manage", "content.manage", "enrollment.manage", "report.view"}


async def test_employee_management_and_lockout(client, login):
    admin = await login("NV001")
    company_id = (await client.get("/auth/me", headers=admin)).json()["company"]["id"]
    base = f"/companies/{company_id}/employees"

    body = {
        "employee_code": "NV100",
        "full_name": "Nhân Viên Mới",
        "email": "nv100@demo.vn",
        "password": "MatKhau@123",
    }
    resp = await client.post(base, json=body, headers=admin)
    assert resp.status_code == 201, resp.text
    emp = resp.json()
    assert emp["username"] == "demo.nv100" and emp["role"] == "learner"

    # Trùng mã nhân viên trong công ty
    dup = await client.post(base, json={**body, "email": "khac@demo.vn", "username": "khac.user"}, headers=admin)
    assert dup.status_code == 409

    # Học viên không quản lý được nhân viên; admin công ty khác không xem được
    assert (await client.get(base, headers=await login("NV003"))).status_code == 403
    khac_id = (await client.get("/auth/me", headers=await login("NV001", "KHAC"))).json()["company"]["id"]
    assert (await client.get(f"/companies/{khac_id}/employees", headers=admin)).status_code == 403

    # Đổi vai trò
    resp = await client.put(f"{base}/{emp['id']}/role", json={"role": "instructor"}, headers=admin)
    assert resp.json()["role"] == "instructor"
    listed = (await client.get(base, params={"role": "instructor"}, headers=admin)).json()
    assert {e["employee_code"] for e in listed["items"]} == {"NV002", "NV100"}

    # Sai mật khẩu nhiều lần -> tạm khoá, kể cả nhập đúng
    for _ in range(5):
        assert (await _login(client, "DEMO", "NV100", "sai")).status_code == 401
    assert (await _login(client, "DEMO", "NV100", "MatKhau@123")).status_code == 429

    # Đặt lại mật khẩu không gỡ khoá tạm; khoá tài khoản -> đăng nhập bị từ chối
    resp = await client.post(f"{base}/{emp['id']}/reset-password", json={"new_password": "MoiMoi@123"}, headers=admin)
    assert resp.status_code == 200
    resp = await client.patch(f"{base}/{emp['id']}", json={"status": "locked"}, headers=admin)
    assert resp.json()["status"] == "locked"

    # Gỡ khỏi công ty
    assert (await client.delete(f"{base}/{emp['id']}", headers=admin)).status_code == 204
    assert (await client.get(f"{base}/{emp['id']}", headers=admin)).status_code == 404


async def test_change_password(client, login):
    admin = await login("NV001")
    company_id = (await client.get("/auth/me", headers=admin)).json()["company"]["id"]
    body = {"employee_code": "NV101", "full_name": "Đổi Mật Khẩu", "email": "nv101@demo.vn", "password": "Ban@Dau123"}
    assert (await client.post(f"/companies/{company_id}/employees", json=body, headers=admin)).status_code == 201

    token = (await _login(client, "DEMO", "NV101", "Ban@Dau123")).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    wrong = await client.post(
        "/auth/change-password", json={"current_password": "x", "new_password": "Moi@12345"}, headers=headers
    )
    assert wrong.status_code == 400
    ok = await client.post(
        "/auth/change-password", json={"current_password": "Ban@Dau123", "new_password": "Moi@12345"}, headers=headers
    )
    assert ok.status_code == 200
    assert (await _login(client, "DEMO", "NV101", "Moi@12345")).status_code == 200


async def test_companies_require_system_admin(client, login):
    assert (await client.get("/companies", headers=await login("NV001"))).status_code == 403


async def test_employee_lookup(client, login):
    rows = (await client.get("/employees/lookup", params={"q": "nv00"}, headers=await login("NV002"))).json()
    assert {r["employee_code"] for r in rows} >= {"NV001", "NV002", "NV003", "NV004"}
    assert (await client.get("/employees/lookup", headers=await login("NV003"))).status_code == 403


async def test_unassigned_requires_system_admin(client, login):
    assert (await client.get("/employees/unassigned", headers=await login("NV001"))).status_code == 403


async def test_system_admin_manages_companies(client, login):
    sa = await login("NV000")
    me = (await client.get("/auth/me", headers=sa)).json()
    assert me["is_system_admin"] and "company.manage" in me["permissions"]

    resp = await client.post("/companies", json={"code": "MOI", "name": "Công ty Mới"}, headers=sa)
    assert resp.status_code == 201, resp.text
    company = resp.json()
    assert (await client.post("/companies", json={"code": "moi", "name": "Trùng"}, headers=sa)).status_code == 409

    # Gán tài khoản Project Manager có sẵn làm quản trị LMS của công ty mới
    users = (await client.get("/employees/unassigned", params={"q": "pm.only"}, headers=sa)).json()
    assert [u["username"] for u in users] == ["pm.only"]
    base = f"/companies/{company['id']}/employees"
    resp = await client.post(
        base + "/link", json={"user_id": users[0]["id"], "employee_code": "AD01", "role": "admin"}, headers=sa
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "admin"
    assert (await client.get("/employees/unassigned", params={"q": "pm.only"}, headers=sa)).json() == []

    # Đăng nhập LMS bằng mật khẩu Project Manager cũ
    resp = await client.post("/auth/login", json={"company_code": "MOI", "employee_code": "AD01", "password": PASSWORD})
    assert resp.status_code == 200

    # Còn nhân viên thì không xoá được; ngừng hoạt động thì nhân viên không đăng nhập được
    assert (await client.delete(f"/companies/{company['id']}", headers=sa)).status_code == 409
    resp = await client.patch(f"/companies/{company['id']}", json={"status": "inactive"}, headers=sa)
    assert resp.json()["status"] == "inactive"
    resp = await client.post("/auth/login", json={"company_code": "MOI", "employee_code": "AD01", "password": PASSWORD})
    assert resp.status_code == 403
    # Không tự khoá / xoá công ty của mình
    own = me["company"]["id"]
    assert (await client.patch(f"/companies/{own}", json={"status": "inactive"}, headers=sa)).status_code == 400
    assert (await client.delete(f"/companies/{own}", headers=sa)).status_code == 400
