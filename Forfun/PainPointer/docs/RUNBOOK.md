# PainPointer RUNBOOK

로컬 전용(127.0.0.1) 근거 리포트 생성기. 설계: `docs/designs/painpointer.md`, CEO 플랜: `~/.gstack/projects/jamy3251-git-remote-repo/ceo-plans/2026-09-17-painpointer.md`.

## 0. 설치

```powershell
cd D:\Projects\Forfun\PainPointer
pip install -e ..\..\Data\DCCrawler      # 코퍼스 저장소(posts/FTS/마이그레이션)를 의존성으로
pip install -e .
copy .env.example .env                    # ANTHROPIC_API_KEY, PP_MODEL_CLASSIFY, PP_MODEL_COACH 채우기
python -m painpointer models              # /v1/models 목록 확인 → 고정 모델 ID를 .env에
python -m painpointer init
```

모델 ID 규칙: 이동 별칭(`-latest`) 금지. 현재 세대는 날짜 접미사 없는 ID가 정식 ID(`claude-sonnet-5`, `claude-haiku-4-5`)이며 구세대 `-YYYYMMDD` 스냅샷도 고정 ID다(2026-09-22 확인). `-latest`면 리포트 0번 박스에 경고 배지가 붙는다. `llm_calls.response_model`에 실제 응답 모델이 기록된다.

## 1. 코퍼스

```powershell
python -m painpointer watch add dcinside <갤러리ID> --label "첫 팀 주제"
python -m painpointer watch add googleplay <패키지ID>
python -m painpointer collect                 # 락 → watch_list 순회 → 임베딩 → 후보 갱신
python -m painpointer collect --source dcinside:<갤러리ID>   # 한 소스만 재실행(백필)
python -m painpointer status
```

- 첫 실행은 소스당 최대 `PP_COLLECT_MAX_PAGES`(기본 30) 페이지 백필. 이후는 마지막 성공 실행일 − 1일 이후 글만.
- 디시는 `fetch_body=True`(글당 상세 요청 1회 + 댓글 AJAX). 시간이 문제면 `--no-body`(제목만 색인됨 — 판정 품질 저하).
- 4h 목표 미달 시 설계의 축소 경로: 소스 1곳, 6개월.
- 임베딩 모델(ko-sroberta)은 로컬 캐시만 사용(`HF_HUB_OFFLINE=1`). 최초 다운로드는 `PP_HF_ONLINE=1 python -m painpointer embed-posts`.
- 한이음 유사 시도: `python -m painpointer precompute-attempts` (HanCrawler `data/public_projects.json`, `award_projects.json`).

### Windows 작업 스케줄러
매일 05:40 (FConline-AutoUpdate 05:30 이후):
```
schtasks /Create /SC DAILY /ST 05:40 /TN PainPointer-Collect /TR "cmd /c cd /d D:\Projects\Forfun\PainPointer && python -m painpointer collect >> data\logs\collect.out 2>&1"
```

## 2. 리포트 생성

```powershell
python -m painpointer serve      # http://127.0.0.1:8765
```
입력 → `/expand`(검색어 확장, 실패 시 원문 검색어 + 배너) → 확인 화면(검색어별 적중, 중복 제거 전/후) → `/generate`(잡) → 3초 폴링 → `/r/{id}` (noindex) → `/r/{id}/download`.

CLI: `python -m painpointer report --pain "..." --target "..." [--term 추가검색어] [--source dcinside] [--out r.html]`

## 3. 상태·로그

- `python -m painpointer status`: 코퍼스, 상시 수집(마지막 성공·경과·suspect), 후보 갱신일, 오늘 LLM 호출/상한 %, 최근 잡·리포트.
- JSONL 로그: `data/logs/YYYY-MM-DD.jsonl` (event, job_id/run_id, stage, elapsed_ms).
- 테이블: `judgments`(판정 캐시, 4중키), `llm_calls`, `reports`, `jobs`, `collection_runs`, `watch_list`, `source_candidates`, `post_embeddings`, `attempt_embeddings`.

## 4. 장애 대응

| 증상 | 원인 | 조치 |
|---|---|---|
| 잡 실패 "수집 배치 진행 중" | SQLite 잠금(busy_timeout 5s 초과) | 배치 끝난 뒤 재생성. 잡은 같은 query_hash로 다시 제출 |
| 잡 실패 "일일 한도 도달" | `llm_calls` 오늘 행 수 ≥ `PP_DAILY_LLM_LIMIT` | 내일 재시도 또는 상한 상향 |
| 0번 박스 "판정 불가 F/S > 5%" 배너 | API 장애·429·JSON 오류 | `llm_calls.error` 확인, 재생성 시 캐시 적중분은 재호출 없음 |
| collection_runs `failed` ParserDriftError | 사이트 마크업 변경 | `dccrawler/sources/dcinside.py` 셀렉터 수정 → `collect --source` 재실행 |
| `suspect` | 최근 7일 중앙값 > 0인데 0건 | 사이트 직접 확인. 2일 연속이면 웹훅 |
| 리포트 "유사 시도 미계산" | attempt_embeddings 비어 있음 | `precompute-attempts` |
| "임베딩 미계산 글 N건 → 기타 군집" | 수집 후 임베딩 단계 실패 | `embed-posts` |
| 서버 재시작 후 잡 running | 중단된 스레드 | 서버 시작 시 자동 failed 처리(recover) |
| 로그 `llm_call`에 `record_error: ... locked` | 수집 배치가 쓰기 잠금을 연속 점유해 `llm_calls` 감사 행 기록이 5회 재시도 후 실패 | 판정·리포트는 정상 진행. 일일 상한 카운트만 그 건수만큼 적게 잡힘. 반복되면 배치 시간대와 리포트 생성 시간대를 분리 |
| migrate 실패 | 중간 예외 | 자동 백업(`*.bak-타임스탬프`)에서 복원됨. 로그 확인 후 재실행 |

## 5. 테스트

```powershell
cd D:\Projects\Data\DCCrawler && python -m pytest -q        # 48 (모델·마이그레이션·FTS·파서·구글플레이)
cd D:\Projects\Forfun\PainPointer && python -m pytest -q     # 42 (골든 200건·경계 799/800/801·29/30·카오스·인젝션 5·동시성·앱·수집)
```
`-m live` 표시 테스트는 기본 제외(실 API/네트워크).

## 6. 아직 안 한 것 / 알려진 제약
- `Quote.dead_link`은 항상 false(생성 시 외부 요청 0회 제약). 원문 사망 검사는 수집 배치에 추가 예정.
- 사례 층(`SHOW_CASES`) 데이터 없음(v1 OFF).
- 2단계(링크 공유 `/r/{id}` + events, Q3-1 버튼, PM/VOC 모드)는 첫 팀 검증 후.
- 8f 후보 목록은 `PP_CANDIDATE_KEYWORDS`(쉼표 구분)를 설정해야 갱신된다. 디시 검색 페이지 마크업이 바뀌면 조용히 0건.
- 앱스토어 리뷰 RSS는 응답 확인됨(2026-09-22 실측: `itunes.apple.com/kr/rss/customerreviews/page=N/id=<앱ID>/sortby=mostrecent/json`, N=1~10, 페이지당 50건 = 최신 500건 상한, 11페이지부터 400, 연속 10회 요청 전부 200). `page=` 없는 URL은 entry 0건. 어댑터는 미구현 — 앱리뷰는 아직 구글플레이 단독.

## 7. 디시 일시 차단 (2026-09-21 실측)
본문+댓글 포함 수집으로 약 300회 연속 요청 후, 모든 갤러리 목록이 **200 OK + 본문 0바이트**로 바뀌었다(몇 분~수 시간 지속).
- 어댑터는 이를 `EmptyResponseError`로 던지고 배치는 `failed`로 기록한다(`ok 0건` 금지 — 워터마크가 오염된다).
- 대응: `--delay 1.5` 이상, 하루 백필은 갤러리 2곳 이하로 나눠서. 댓글 AJAX는 글당 요청 1~2회를 더 쓴다.
- 차단 확인: `python -c "from dccrawler.sources import get_source; print(len(get_source('dcinside').client.get('https://gall.dcinside.com/board/lists/?id=changup').text))"` → 0이면 아직 차단.

## 8. 토큰 효율 (2026-09-22)
실코퍼스 85건(창업·공모전 갤러리) 판정 입력량 측정: 이전 79,889자 → 묶음 1건 62,492자(-22%) → 묶음 5건 30,396자(-62%) → 묶음 10건 26,628자(-67%).
- 판정은 글 `PP_CLASSIFY_BATCH`(기본 5)건을 한 호출에 묶는다. 시스템 프롬프트가 글마다 반복되지 않고 호출 수가 1/5이라 일일 상한도 덜 쓴다. 캐시는 여전히 글 단위이며 응답에 빠진 id는 그 글만 F.
- 본문 900자까지만 전송, 출력은 `id/relevant/intensity/quotes(≤2, 100자)/inj` 다섯 키만(설명 필드 제거). 출력 상한 = 90×글 수 + 60 토큰.
- 검색어 확장 200, 군집 이름 60×군집 수, 코칭 700 토큰으로 출력 상한 고정. 군집 대표 문장 3개×100자.
- `python -m painpointer status`가 오늘 입력/출력 토큰 합계와 묶음 크기를 보여준다.
- 더 줄이려면: 묶음 10건(품질 확인 후), Message Batches API(50% 단가, 지연 수분~수시간이라 잡 페이지 3초 폴링과 맞지 않아 미적용).
