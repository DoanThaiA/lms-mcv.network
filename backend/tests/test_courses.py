from datetime import date, timedelta


async def _create_course(client, headers, code: str, **extra) -> dict:
    resp = await client.post("/courses", json={"code": code, "title": f"Khoá {code}", **extra}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add_lesson(client, headers, course_id: int, **body) -> dict:
    resp = await client.post(f"/courses/{course_id}/lessons", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_course_lifecycle_and_progress(client, login, employees, fake_r2):
    teacher, admin = await login("NV002"), await login("NV001")
    learner, other = await login("NV003"), await login("NV004")

    # Tài liệu chỉ dành cho học viên khoá học
    resp = await client.post(
        "/documents",
        files={"file": ("quy-trinh.pdf", b"%PDF-1.4 demo", "application/pdf")},
        data={"title": "Quy trình hội nhập", "visibility": "course"},
        headers=teacher,
    )
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc["preview_kind"] == "pdf" and len(fake_r2) == 1

    course = await _create_course(client, teacher, "HN01", summary="Hội nhập nhân viên mới")
    cid = course["id"]
    l1 = await _add_lesson(client, teacher, cid, title="Giới thiệu", content_type="text", body="Chào mừng!")
    l2 = await _add_lesson(
        client, teacher, cid, title="Video", content_type="video", external_url="https://youtu.be/abc"
    )
    l3 = await _add_lesson(client, teacher, cid, title="Tài liệu", content_type="document", document_id=doc["id"])
    await _add_lesson(client, teacher, cid, title="Đọc thêm", content_type="text", body="...", is_required=False)
    assert [l1["sort_order"], l2["sort_order"], l3["sort_order"]] == [1, 2, 3]

    # Bài học sai kiểu nội dung
    bad = await client.post(f"/courses/{cid}/lessons", json={"title": "x", "content_type": "text"}, headers=teacher)
    assert bad.status_code == 422

    # Nháp: học viên không thấy, chưa giao được
    assert (await client.get(f"/courses/{cid}", headers=learner)).status_code == 404
    assign = {"user_ids": [employees["NV003"]], "due_date": str(date.today() + timedelta(days=7))}
    assert (await client.post(f"/courses/{cid}/enrollments", json=assign, headers=admin)).status_code == 409

    resp = await client.post(f"/courses/{cid}/status", json={"status": "published"}, headers=teacher)
    assert resp.json()["status"] == "published" and resp.json()["published_at"]

    # Khoá 'assigned': chỉ người được giao thấy
    resp = await client.post(f"/courses/{cid}/enrollments", json=assign, headers=admin)
    assert resp.status_code == 201, resp.text
    resp = await client.post(f"/courses/{cid}/enrollments", json=assign, headers=admin)
    assert resp.json()["skipped_user_ids"] == [employees["NV003"]]

    assert (await client.get(f"/courses/{cid}", headers=other)).status_code == 404
    assert (await client.get(f"/documents/{doc['id']}", headers=other)).status_code == 404
    assert (await client.get(f"/documents/{doc['id']}", headers=learner)).status_code == 200
    detail = (await client.get(f"/courses/{cid}", headers=learner)).json()
    assert len(detail["lessons"]) == 4

    # Nhân viên công ty khác không thấy
    assert (await client.get(f"/courses/{cid}", headers=await login("NV001", "KHAC"))).status_code == 404

    my = (await client.get("/me/courses", headers=learner)).json()
    assert [c["course"]["code"] for c in my] == ["HN01"]
    assert my[0]["status"] == "not_started"

    lesson = (await client.get(f"/courses/{cid}/lessons/{l3['id']}", headers=learner)).json()
    assert lesson["document"]["download_url"].startswith("https://r2.test/")

    async def progress(lesson_id: int, **body):
        resp = await client.post(f"/me/courses/{cid}/lessons/{lesson_id}/progress", json=body, headers=learner)
        assert resp.status_code == 200, resp.text
        return resp.json()["enrollment"]

    e = await progress(l2["id"], position_seconds=30)
    assert e["status"] == "in_progress" and float(e["progress_percent"]) == 0
    e = await progress(l1["id"], completed=True)
    e = await progress(l2["id"], completed=True, position_seconds=300)
    assert float(e["progress_percent"]) == 66.67
    e = await progress(l3["id"], completed=True)
    assert e["status"] == "completed" and float(e["progress_percent"]) == 100 and e["completed_at"]

    # Thêm bài bắt buộc sau khi học viên đã hoàn thành: giữ trạng thái hoàn thành
    await _add_lesson(client, teacher, cid, title="Bài mới", content_type="text", body="Mới")
    e = (await client.get(f"/me/courses/{cid}/progress", headers=learner)).json()["enrollment"]
    assert e["status"] == "completed"

    # Có người ghi danh: không về nháp được, khoá đang phát hành không xoá được
    assert (await client.post(f"/courses/{cid}/status", json={"status": "draft"}, headers=teacher)).status_code == 409
    assert (await client.delete(f"/courses/{cid}", headers=teacher)).status_code == 409
    # Tài liệu đang dùng trong bài học
    assert (await client.delete(f"/documents/{doc['id']}", headers=teacher)).status_code == 409

    report = (await client.get("/reports/courses", headers=admin)).json()
    row = next(r for r in report if r["code"] == "HN01")
    assert row["enrolled"] == 1 and row["completed"] == 1 and float(row["completion_rate"]) == 100

    listed = (await client.get("/enrollments", params={"course_id": cid}, headers=admin)).json()
    assert listed["items"][0]["employee"]["employee_code"] == "NV003"
    assert (await client.get("/enrollments", headers=learner)).status_code == 403


async def test_open_course_self_enroll(client, login):
    teacher, learner = await login("NV002"), await login("NV004")
    course = await _create_course(client, teacher, "ATTT01", enroll_mode="open")
    cid = course["id"]
    lesson = await _add_lesson(client, teacher, cid, title="Mật khẩu mạnh", content_type="text", body="...")
    await client.post(f"/courses/{cid}/status", json={"status": "published"}, headers=teacher)

    catalog = (await client.get("/courses", headers=learner)).json()
    assert "ATTT01" in {c["code"] for c in catalog["items"]}
    # Chưa đăng ký thì chưa học được
    assert (await client.get(f"/courses/{cid}/lessons/{lesson['id']}", headers=learner)).status_code == 403

    resp = await client.post(f"/me/courses/{cid}/enroll", headers=learner)
    assert resp.status_code == 201 and resp.json()["source"] == "self"
    assert (await client.post(f"/me/courses/{cid}/enroll", headers=learner)).status_code == 409
    resp = await client.post(
        f"/me/courses/{cid}/lessons/{lesson['id']}/progress", json={"completed": True}, headers=learner
    )
    assert resp.json()["enrollment"]["status"] == "completed"

    # Lưu trữ: không còn trong danh mục, nhưng người đã học vẫn xem lại được
    await client.post(f"/courses/{cid}/status", json={"status": "archived"}, headers=teacher)
    catalog = (await client.get("/courses", headers=learner)).json()
    assert "ATTT01" not in {c["code"] for c in catalog["items"]}
    assert (await client.get(f"/courses/{cid}", headers=learner)).status_code == 200


async def test_learner_cannot_manage_content(client, login):
    learner = await login("NV003")
    assert (await client.post("/courses", json={"code": "X1", "title": "X"}, headers=learner)).status_code == 403
    assert (await client.post("/categories", json={"name": "X"}, headers=learner)).status_code == 403
    categories = (await client.get("/categories", headers=learner)).json()
    assert [c["name"] for c in categories] == ["Hội nhập", "An toàn thông tin"]


async def test_duplicate_course_code(client, login):
    teacher = await login("NV002")
    await _create_course(client, teacher, "DUP01")
    resp = await client.post("/courses", json={"code": "dup01", "title": "Trùng"}, headers=teacher)
    assert resp.status_code == 409
