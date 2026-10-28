async def test_direct_upload_to_r2(client, login, fake_r2):
    teacher = await login("NV002")
    resp = await client.post(
        "/documents/upload-url",
        json={"file_name": "bai giang/../video 1.mp4", "size_bytes": 11, "content_type": "video/mp4"},
        headers=teacher,
    )
    assert resp.status_code == 200, resp.text
    ticket = resp.json()
    key = ticket["storage_key"]
    assert key.startswith("lms/") and key.endswith("/video 1.mp4")
    assert ticket["upload_url"] == f"https://r2.test/put/{key}"

    body = {"storage_key": key, "file_name": "video 1.mp4", "title": "Video bài 1", "visibility": "course"}
    # Chưa PUT lên R2
    assert (await client.post("/documents/complete", json=body, headers=teacher)).status_code == 409

    fake_r2[key] = (b"hello video", "video/mp4")  # trình duyệt PUT xong
    resp = await client.post("/documents/complete", json=body, headers=teacher)
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc["size_bytes"] == 11 and doc["preview_kind"] == "video" and doc["visibility"] == "course"
    # Xác nhận lại lần nữa -> trùng
    assert (await client.post("/documents/complete", json=body, headers=teacher)).status_code == 409


async def test_direct_upload_guards(client, login, fake_r2):
    teacher = await login("NV002")
    # Key của công ty khác / key tự đặt
    khac_id = (await client.get("/auth/me", headers=await login("NV001", "KHAC"))).json()["company"]["id"]
    for key in (f"lms/{khac_id}/abc/x.pdf", "projects/1/x.pdf"):
        fake_r2[key] = (b"x", "application/pdf")
        resp = await client.post(
            "/documents/complete", json={"storage_key": key, "file_name": "x.pdf"}, headers=teacher
        )
        assert resp.status_code == 422
    # Quá dung lượng
    resp = await client.post(
        "/documents/upload-url", json={"file_name": "lon.mp4", "size_bytes": 10 * 1024**4}, headers=teacher
    )
    assert resp.status_code == 413
    # Học viên không tải lên được
    resp = await client.post(
        "/documents/upload-url", json={"file_name": "a.pdf", "size_bytes": 1}, headers=await login("NV003")
    )
    assert resp.status_code == 403
