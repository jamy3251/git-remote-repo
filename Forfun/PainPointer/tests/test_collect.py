from datetime import date

from dccrawler.models import Post
from dccrawler.sources.base import ParserDriftError

from painpointer import db
from painpointer.collect_daily import Collector, Lock


class FakeSource:
    """페이지별 글을 돌려주는 가짜 소스. pages[board] = [[Post,...], ...]"""
    registry: dict[str, dict] = {}
    calls: list[tuple] = []

    def __init__(self, name):
        self.name = name

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        FakeSource.calls.append((self.name, board, start_page))
        spec = FakeSource.registry[(self.name, board)]
        if spec.get("error"):
            raise spec["error"]
        pages = spec["pages"]
        return list(pages[start_page - 1]) if start_page <= len(pages) else []


def _posts(board, day, ids):
    return [Post(source="dcinside", board=board, post_id=str(i), title=f"t{i}", body=f"본문 {i} 배달 늦음",
                 created_at=f"{day} 10:00:00", url=f"https://x/{i}") for i in ids]


def _watch(db_path, items):
    conn = db.open_write(db_path)
    with conn:
        conn.executemany("INSERT INTO watch_list(source, board, label, enabled, added_at) VALUES (?,?,?,1,'2026-09-01')", items)
    conn.close()


def _runs(db_path):
    conn = db.open_read(db_path)
    rows = [dict(r) for r in conn.execute("SELECT source, board, run_date, status, n_new, error FROM collection_runs ORDER BY id")]
    conn.close()
    return rows


def test_lock_prevents_double_run(tmp_db, tmp_path):
    lock = tmp_path / "collect.lock"
    lock.write_text("x")
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=lock, today=date(2026, 9, 21))
    assert c.run() == []
    assert lock.exists()
    # 6h 지난 락은 무시
    import os, time
    os.utime(lock, (time.time() - 7 * 3600, time.time() - 7 * 3600))
    assert Lock(lock).acquire() is True


def test_a_ok_b_failed_then_only_b_backfills(tmp_db, tmp_path):
    FakeSource.calls.clear()
    FakeSource.registry = {
        ("dcinside", "A"): {"pages": [_posts("A", "2026-09-20", [1, 2]), _posts("A", "2026-09-10", [3]), _posts("A", "2026-08-01", [4])]},
        ("dcinside", "B"): {"pages": [], "error": ParserDriftError("dcinside", "B", "u", 5000)},
    }
    _watch(tmp_db, [("dcinside", "A", ""), ("dcinside", "B", "")])
    sent = []
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 21),
                  webhook=lambda url, text: sent.append(text), max_pages=10, delay=0)
    res = c.run()
    assert [r["status"] for r in res] == ["ok", "failed"]
    assert res[0]["n_new"] == 4 and "ParserDriftError" in res[1]["error"]
    assert sent == []  # 첫 실패는 웹훅 없음

    # 다음날: A는 워터마크(마지막 ok − 1일 = 09-20) 이후만 → 1페이지에서 새 글 1건, 2페이지(09-10)에서 중단
    FakeSource.calls.clear()
    FakeSource.registry[("dcinside", "A")]["pages"][0] = _posts("A", "2026-09-22", [9]) + _posts("A", "2026-09-20", [1, 2])
    c2 = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 22),
                   webhook=lambda url, text: sent.append(text), max_pages=10, delay=0)
    res2 = c2.run()
    assert res2[0]["status"] == "ok" and res2[0]["n_new"] == 1
    a_pages = [p for (s, b, p) in FakeSource.calls if b == "A"]
    assert a_pages == [1, 2]                      # 3페이지(백필)는 다시 가지 않음
    assert res2[1]["status"] == "failed"
    assert len(sent) == 1 and "2일 연속" in sent[0]   # B 2일 연속 실패 → 웹훅 1회
    runs = _runs(tmp_db)
    assert [r["status"] for r in runs if r["board"] == "B"] == ["failed", "failed"]


def test_suspect_when_median_positive_but_zero_today(tmp_db, tmp_path):
    _watch(tmp_db, [("dcinside", "A", "")])
    conn = db.open_write(tmp_db)
    with conn:
        for d, n in (("2026-09-17", 5), ("2026-09-18", 5), ("2026-09-19", 4), ("2026-09-20", 6)):
            conn.execute("INSERT INTO collection_runs(source, board, run_date, status, n_new, started_at, finished_at) VALUES ('dcinside','A',?, 'ok', ?, ?, ?)", (d, n, d, d))
    conn.close()
    FakeSource.registry = {("dcinside", "A"): {"pages": [_posts("A", "2026-09-01", [1])]}}
    # 이미 있는 글만 돌아옴 → 신규 0
    from dccrawler.storage import Store
    st = Store(tmp_db); st.upsert_posts(_posts("A", "2026-09-01", [1])); st.close()
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 21), delay=0,
                  webhook=lambda url, text: None)
    res = c.run()
    assert res[0]["status"] == "suspect"


def test_low_volume_board_zero_day_is_ok(tmp_db, tmp_path):
    # 하루 0~2건 갤러리: 0건 날(suspect 기록 포함)을 평균에 넣으면 1건 미만 → 오늘 0건은 정상
    _watch(tmp_db, [("dcinside", "A", "")])
    conn = db.open_write(tmp_db)
    with conn:
        for d, st, n in (("2026-09-17", "ok", 2), ("2026-09-18", "suspect", 0), ("2026-09-19", "ok", 1), ("2026-09-20", "suspect", 0)):
            conn.execute("INSERT INTO collection_runs(source, board, run_date, status, n_new, started_at, finished_at) VALUES ('dcinside','A',?, ?, ?, ?, ?)", (d, st, n, d, d))
    conn.close()
    FakeSource.registry = {("dcinside", "A"): {"pages": [_posts("A", "2026-09-01", [1])]}}
    from dccrawler.storage import Store
    st = Store(tmp_db); st.upsert_posts(_posts("A", "2026-09-01", [1])); st.close()
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 21), delay=0,
                  webhook=lambda url, text: None)
    assert c.run()[0]["status"] == "ok"


def test_candidates_refresh_parses_gallery_links(tmp_db, tmp_path):
    class R:
        status_code = 200
        text = ('<a href="https://gall.dcinside.com/mgallery/board/lists/?id=delivery">배달 갤러리</a>'
                '<a href="https://gall.dcinside.com/board/lists/?id=food">음식 갤러리</a>')
        def raise_for_status(self): pass
    class C:
        def get(self, url): return R()
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 21))
    n = c.refresh_candidates(["배달"], client=C())
    assert n == 2
    conn = db.open_read(tmp_db)
    rows = conn.execute("SELECT name, ref, keyword FROM source_candidates ORDER BY id").fetchall()
    conn.close()
    assert rows[0]["name"] == "배달 갤러리" and rows[0]["keyword"] == "배달"


def test_backfill_spike_does_not_inflate_threshold(tmp_db, tmp_path):
    # 백필한 날 149건 + 이후 1·0·2건 → 중앙값 1.5 < 3 → 오늘 0건은 정상
    _watch(tmp_db, [("dcinside", "A", "")])
    conn = db.open_write(tmp_db)
    with conn:
        for d, n in (("2026-09-17", 149), ("2026-09-18", 1), ("2026-09-19", 0), ("2026-09-20", 2)):
            conn.execute("INSERT INTO collection_runs(source, board, run_date, status, n_new, started_at, finished_at) VALUES ('dcinside','A',?, 'ok', ?, ?, ?)", (d, n, d, d))
    conn.close()
    FakeSource.registry = {("dcinside", "A"): {"pages": [_posts("A", "2026-09-01", [1])]}}
    from dccrawler.storage import Store
    st = Store(tmp_db); st.upsert_posts(_posts("A", "2026-09-01", [1])); st.close()
    c = Collector(tmp_db, source_factory=FakeSource, lock_path=tmp_path / "l", today=date(2026, 9, 21), delay=0,
                  webhook=lambda url, text: None)
    assert c.run()[0]["status"] == "ok"
