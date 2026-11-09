"""Bài học chuẩn: mục tiêu, video, nội dung, câu hỏi kiểm tra, tài liệu thực hành, nộp bài."""

QUIZ = {
    "questions": [
        {
            "question": "Bảng giá đăng trên website",
            "options": ["Đỏ", "Vàng", "Xanh"],
            "answer": 2,
            "explanation": "Xanh",
        },
        {"question": "Hợp đồng thật có tên khách", "options": ["Đỏ", "Vàng", "Xanh"], "answer": 0, "explanation": "Đỏ"},
    ]
}


async def test_standard_lessons(client, login, employees, fake_r2):
    teacher, admin = await login("NV002"), await login("NV001")
    learner, other = await login("NV003"), await login("NV004")

    resp = await client.post(
        "/documents",
        files={"file": ("DS1_Bang_gia.xlsx", b"PK demo", "application/vnd.ms-excel")},
        data={"title": "Bảng giá", "visibility": "course"},
        headers=teacher,
    )
    assert resp.status_code == 201, resp.text
    ds1 = resp.json()

    resp = await client.post("/courses", json={"code": "AIKD", "title": "AI thực chiến"}, headers=teacher)
    cid = resp.json()["id"]
    url = f"/courses/{cid}/lessons"

    # Thiếu phần bắt buộc theo dạng bài
    for bad in (
        {"title": "x", "content_type": "standard", "body": "<p>x</p>"},  # thiếu lesson_kind
        {"title": "x", "content_type": "standard", "lesson_kind": "quiz", "body": "<p>x</p>"},  # thiếu quiz
        {"title": "x", "content_type": "standard", "lesson_kind": "practice", "body": "<p>x</p>"},  # thiếu assignment
        {"title": "x", "content_type": "standard", "lesson_kind": "theory"},  # không có nội dung
        {
            "title": "x",
            "content_type": "standard",
            "lesson_kind": "quiz",
            "body": "x",
            "quiz": {"questions": [{"question": "q", "options": ["a", "b"], "answer": 5}]},
        },
    ):
        assert (await client.post(url, json=bad, headers=teacher)).status_code == 422, bad

    theory = (
        await client.post(
            url,
            json={
                "title": "Khai mạc",
                "content_type": "standard",
                "lesson_kind": "theory",
                "goals": [" Nắm mục tiêu khoá học ", ""],
                "external_url": "https://youtu.be/abcdefghijk",
                "video_minutes": 8,
                "body": "<h2>Cách học</h2><pre class='prompt'>Bạn là trợ lý...</pre>",
            },
            headers=teacher,
        )
    ).json()
    assert theory["goals"] == ["Nắm mục tiêu khoá học"] and theory["lesson_kind"] == "theory"

    resp = await client.post(
        url,
        json={
            "title": "Phân loại dữ liệu",
            "content_type": "standard",
            "lesson_kind": "quiz",
            "body": "<p>Đèn Đỏ – Vàng – Xanh</p>",
            "quiz": QUIZ,
        },
        headers=teacher,
    )
    assert resp.status_code == 201, resp.text
    quiz = resp.json()
    assert quiz["quiz"]["questions"][0]["answer"] == 2  # người soạn thấy đáp án

    resp = await client.post(
        url,
        json={
            "title": "Lập báo giá",
            "content_type": "standard",
            "lesson_kind": "practice",
            "goals": ["Tính báo giá đúng 100%"],
            "body": "<p>5 bước</p>",
            "practice_document_ids": [ds1["id"], ds1["id"]],
            "assignment": {"requirement": "File báo giá + Excel đối chiếu", "criteria": ["Số tiền khớp 100%", " "]},
        },
        headers=teacher,
    )
    assert resp.status_code == 201, resp.text
    practice = resp.json()
    assert [d["id"] for d in practice["practice_documents"]] == [ds1["id"]]
    assert practice["assignment"]["criteria"] == ["Số tiền khớp 100%"]

    # Tài liệu thực hành đang dùng: không xoá được
    assert (await client.delete(f"/documents/{ds1['id']}", headers=teacher)).status_code == 409

    # Danh sách bài có dạng bài
    course = (await client.get(f"/courses/{cid}", headers=teacher)).json()
    assert [x["lesson_kind"] for x in course["lessons"]] == ["theory", "quiz", "practice"]

    await client.post(f"/courses/{cid}/status", json={"status": "published"}, headers=teacher)
    resp = await client.post(f"/courses/{cid}/enrollments", json={"user_ids": [employees["NV003"]]}, headers=admin)
    assert resp.status_code == 201, resp.text
    me = f"/me/courses/{cid}/lessons"

    # Học viên: không thấy đáp án, xem được tài liệu thực hành (visibility=course)
    detail = (await client.get(f"{url}/{quiz['id']}", headers=learner)).json()
    assert all(q["answer"] is None and q["explanation"] is None for q in detail["quiz"]["questions"])
    assert (await client.get(f"/documents/{ds1['id']}", headers=learner)).status_code == 200
    assert (await client.get(f"/documents/{ds1['id']}", headers=other)).status_code == 404

    # Lý thuyết có video: phải xem hết video mới hoàn thành
    resp = await client.post(f"{me}/{theory['id']}/progress", json={"completed": True}, headers=learner)
    assert resp.status_code == 409
    resp = await client.post(f"{me}/{theory['id']}/progress", json={"position_seconds": 440}, headers=learner)
    assert resp.status_code == 200
    resp = await client.post(
        f"{me}/{theory['id']}/progress", json={"video_completed": True, "completed": True}, headers=learner
    )
    assert resp.status_code == 200, resp.text
    p = next(x for x in resp.json()["lessons"] if x["lesson_id"] == theory["id"])
    assert p["video_completed_at"] and p["completed_at"] and p["last_position_seconds"] == 440

    # Kiểm tra: chấm trên máy chủ, sai thì chưa hoàn thành được
    assert (await client.post(f"{me}/{quiz['id']}/quiz", json={"answers": [2]}, headers=learner)).status_code == 422
    resp = await client.post(f"{me}/{quiz['id']}/quiz", json={"answers": [2, 1]}, headers=learner)
    result = resp.json()
    assert (
        result["score"] == 1
        and not result["passed"]
        and result["results"][1]
        == {
            "correct": False,
            "explanation": "Đỏ",
        }
    )
    assert (
        await client.post(f"{me}/{quiz['id']}/progress", json={"completed": True}, headers=learner)
    ).status_code == 409
    result = (await client.post(f"{me}/{quiz['id']}/quiz", json={"answers": [2, 0]}, headers=learner)).json()
    assert result["passed"] and result["score"] == 2
    p = next(x for x in result["progress"]["lessons"] if x["lesson_id"] == quiz["id"])
    assert p["quiz_attempts"] == 2 and p["quiz_score"] == 2 and p["quiz_passed_at"]
    # Làm lại sai vẫn giữ kết quả đạt
    await client.post(f"{me}/{quiz['id']}/quiz", json={"answers": [0, 1]}, headers=learner)
    resp = await client.post(f"{me}/{quiz['id']}/progress", json={"completed": True}, headers=learner)
    assert resp.status_code == 200, resp.text
    # Bài không có câu hỏi
    assert (await client.post(f"{me}/{theory['id']}/quiz", json={"answers": []}, headers=learner)).status_code == 404

    # Thực hành: chưa nộp thì chưa hoàn thành; phải có link hoặc file
    assert (
        await client.post(f"{me}/{practice['id']}/progress", json={"completed": True}, headers=learner)
    ).status_code == 409
    sub_url = f"{me}/{practice['id']}/submissions"
    assert (await client.post(sub_url, data={"note": "Em đã làm xong"}, headers=learner)).status_code == 422
    assert (await client.post(sub_url, data={"link": "drive"}, headers=learner)).status_code == 422
    assert (
        await client.post(f"{me}/{theory['id']}/submissions", data={"link": "https://a.vn/x"}, headers=learner)
    ).status_code == 404
    resp = await client.post(
        sub_url,
        data={"link": "https://drive.google.com/x", "note": "Điểm người kiểm: 5/5"},
        files=[("files", ("bao-gia.docx", b"PK docx", "application/octet-stream"))],
        headers=learner,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    sub = body["submission"]
    assert sub["review_status"] == "pending" and sub["files"][0]["file_name"] == "bao-gia.docx"
    assert sub["files"][0]["download_url"].startswith("https://r2.test/")
    assert any(k.endswith("/bao-gia.docx") for k in fake_r2)
    assert body["progress"]["enrollment"]["status"] == "completed"  # 3/3 bài bắt buộc
    assert len((await client.get(sub_url, headers=learner)).json()) == 1

    # Giảng viên xem bài nộp và chấm
    eid = body["progress"]["enrollment"]["id"]
    subs = (await client.get(f"/enrollments/{eid}/submissions", headers=teacher)).json()
    assert [s["id"] for s in subs] == [sub["id"]]
    assert (await client.get(f"/enrollments/{eid}/submissions", headers=learner)).status_code == 403
    assert (
        await client.patch(f"/submissions/{sub['id']}", json={"review_status": "passed"}, headers=learner)
    ).status_code == 403
    resp = await client.patch(
        f"/submissions/{sub['id']}", json={"review_status": "failed", "review_note": "Thiếu VAT"}, headers=teacher
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["review_status"] == "failed" and resp.json()["reviewed_at"] and resp.json()["reviewed_by"]
    resp = await client.patch(f"/submissions/{sub['id']}", json={"review_status": "pending"}, headers=teacher)
    assert resp.json()["reviewed_at"] is None

    # Đổi bài chuẩn sang bài đọc: bỏ phần riêng của bài chuẩn
    resp = await client.patch(f"{url}/{practice['id']}", json={"content_type": "text"}, headers=teacher)
    assert resp.status_code == 200, resp.text
    changed = resp.json()
    assert changed["lesson_kind"] is None and changed["assignment"] is None and changed["practice_documents"] == []
    # Đổi dạng bài sang kiểm tra mà không có câu hỏi -> lỗi
    resp = await client.patch(f"{url}/{theory['id']}", json={"lesson_kind": "quiz"}, headers=teacher)
    assert resp.status_code == 422


async def test_bulk_import_and_must_correct(client, login, employees):
    teacher, admin, learner = await login("NV002"), await login("NV001"), await login("NV003")
    resp = await client.post("/courses", json={"code": "AIKD-IMPORT", "title": "Nhập từ file mẫu"}, headers=teacher)
    cid = resp.json()["id"]
    await client.post(
        f"/courses/{cid}/lessons", json={"title": "Bài có sẵn", "content_type": "text", "body": "x"}, headers=teacher
    )
    quiz = {
        "pass_score": 2,
        "must_correct": [1, 1],
        "questions": [
            {"question": f"Câu {i}", "options": ["Sai", "Đúng"], "answer": 1, "explanation": None} for i in range(3)
        ],
    }
    lessons = [
        {"title": "B0 · Khai mạc", "content_type": "standard", "lesson_kind": "theory", "body": "<p>x</p>"},
        {
            "title": "B8.1 · Kiểm tra cuối khoá",
            "content_type": "standard",
            "lesson_kind": "quiz",
            "body": "x",
            "quiz": quiz,
        },
        {
            "title": "B8.2 · Cam kết",
            "content_type": "standard",
            "lesson_kind": "practice",
            "body": "x",
            "assignment": {"requirement": "Phiếu cam kết", "criteria": ["Đủ 3 việc"], "allow_text": True},
        },
    ]
    url = f"/courses/{cid}/lessons/bulk"

    # Một bài lỗi -> không thêm bài nào
    bad = [
        *lessons,
        {"title": "x", "content_type": "standard", "lesson_kind": "theory", "practice_document_ids": [999999]},
    ]
    bad[-1]["body"] = "x"
    resp = await client.post(url, json={"lessons": bad}, headers=teacher)
    assert resp.status_code == 422 and "Bài 4" in resp.json()["detail"]
    assert len((await client.get(f"/courses/{cid}", headers=teacher)).json()["lessons"]) == 1
    assert (await client.post(url, json={"lessons": lessons}, headers=learner)).status_code == 403

    resp = await client.post(url, json={"lessons": lessons}, headers=teacher)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert [x["sort_order"] for x in created] == [2, 3, 4]
    assert [x["lesson_kind"] for x in created] == ["theory", "quiz", "practice"]
    qid = created[1]["id"]
    detail = (await client.get(f"/courses/{cid}/lessons/{qid}", headers=teacher)).json()
    assert detail["quiz"]["must_correct"] == [1] and detail["quiz"]["pass_score"] == 2

    # Đủ số câu nhưng sai câu bắt buộc -> chưa đạt
    await client.post(f"/courses/{cid}/status", json={"status": "published"}, headers=teacher)
    await client.post(f"/courses/{cid}/enrollments", json={"user_ids": [employees["NV003"]]}, headers=admin)
    me = f"/me/courses/{cid}/lessons/{qid}/quiz"
    result = (await client.post(me, json={"answers": [1, 0, 1]}, headers=learner)).json()
    assert result["score"] == 2 and not result["passed"]
    result = (await client.post(me, json={"answers": [0, 1, 1]}, headers=learner)).json()
    assert result["score"] == 2 and result["passed"]
