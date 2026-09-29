# 🛠️ DCCrawler

여러 온라인 커뮤니티에서 **페이지 범위를 지정해 글을 수집**하고, 반복되는
**페인포인트(불편·문제·질문)를 분석**해 "지금 무엇이 가장 문제인지"와
**현실 수요 / 아이디어 기회**를 뽑아내는 크롤러 플랫폼.

> 디시인사이드 중장비 갤러리 같은 현장 커뮤니티의 진짜 목소리에서
> 출발해, 공모전·제품 기획의 근거가 되는 인사이트를 만든다.

## 지원 소스

| 소스 | 상태 | board 입력값 | 비고 |
|------|------|-------------|------|
| `dcinside` | ✅ | 갤러리ID (`joonjangbee`) | 정식/마이너/미니 자동 감지. `mini:joonjangbee` 명시 가능. `--body` 시 본문+댓글 수집 |
| `todayhumor` | ✅ | 게시판 table (`bestofbest`) | 오유 베오베/베스트 등 |
| `fmkorea` | ✅ | 게시판 mid (`best`) | 펨코 포텐. Cloudflare 간헐 차단 시 `--delay`↑ |
| `natepann` | ✅ | 카테고리 (`ranking`) | 네이트판. 목록 미리보기를 본문 스니펫으로 활용 |
| `fourchan` | ✅ | 보드코드 (`g`, `biz`) | 공식 읽기 JSON API, 1~10페이지 |
| `reddit` | 🔑 | 서브레딧 (`Construction`) | OAuth 필요(아래 .env) |
| `youtube` | 🔑 | 영상ID | `YOUTUBE_API_KEY` 필요 |

`🔑` = 자격증명/키 필요. 없으면 명확한 안내 메시지를 반환한다.

## 분석 엔진 (2단계)

1. **키워드/페인 신호 통계** — *API 불필요, 항상 동작.* 한국어(kiwipiepy
   형태소) + 영어 이중 토큰화로 상위 키워드를 뽑고, 질문/불만·고장/비용/도움요청
   4개 카테고리의 **페인 신호**를 탐지해 화제 글을 랭킹한다.
2. **LLM 페인포인트 인사이트** — *선택.* `ANTHROPIC_API_KEY`가 있으면 Claude가
   글을 분석해 페인포인트 군집, **"지금 가장 큰 문제"**, 아이디어 기회를
   구조화해 제시한다. 키가 없으면 1단계만으로 자동 폴백.

## 설치

```bash
pip install -r requirements.txt
cp .env.example .env   # 필요한 키만 채우기(전부 선택)
```

## 사용 — CLI

```bash
# 디시 중장비갤 1~5페이지 분석
python -m dccrawler crawl dcinside joonjangbee --from 1 --to 5

# 본문까지 + 결과 JSON 저장
python -m dccrawler crawl dcinside joonjangbee --from 1 --to 3 --body --json out.json

# 4chan, 레딧
python -m dccrawler crawl fourchan biz --from 1 --to 3
python -m dccrawler crawl reddit Construction --from 1 --to 2

# LLM 분석 끄기 / 소스 목록 / 웹 실행
python -m dccrawler crawl dcinside joonjangbee --no-llm
python -m dccrawler sources
python -m dccrawler serve            # http://127.0.0.1:8000

# 멀티소스 교차 분석 — 여러 커뮤니티 공통 페인 = 검증된 수요
python -m dccrawler cross dcinside:joonjangbee fmkorea:best natepann:ranking --from 1 --to 2
```

## 멀티소스 교차 분석

`cross`는 여러 `소스:보드`를 한 번에 긁어 비교한다:
- **공통 키워드** — 2개 이상 소스에 동시 등장(같은 언어권 공통 화제, 소스별 빈도 표시)
- **페인 카테고리 매트릭스** — 카테고리×소스 표(언어 무관 비교)
- **소스 고유 키워드** — 한 커뮤니티에만 두드러지는 관심사
- **LLM 교차 종합**(키 있을 때) — 교차검증된 공통 페인 / 커뮤니티별 차이 / 가장 강한 수요

웹 대시보드의 **🔗 교차 분석** 탭에서도 소스를 여러 개 추가해 같은 분석을 볼 수 있다.

## 사용 — 웹 플랫폼

```bash
python -m dccrawler serve
```

브라우저에서 `http://127.0.0.1:8000` → 소스/보드/페이지 범위를 입력하면
**가장 큰 문제 카드 · 페인포인트 · 아이디어 기회 · 페인 신호 분포 · 키워드 ·
화제 글 · 전체 목록**을 대시보드로 보여준다.

## 환경변수 (.env, 전부 선택)

```
ANTHROPIC_API_KEY=     # LLM 인사이트
DCCRAWLER_LLM_MODEL=claude-haiku-4-5-20251001
YOUTUBE_API_KEY=       # 유튜브 댓글
REDDIT_CLIENT_ID=      # 레딧(prefs/apps 의 script 앱)
REDDIT_CLIENT_SECRET=
```

## 구조

```
dccrawler/
  models.py        # Post / CrawlResult
  storage.py       # SQLite 캐시(중복 제거)
  service.py       # 크롤 → 저장 → 분석 오케스트레이션
  sources/         # 소스 어댑터(플러그인) — base + dcinside/reddit/fourchan/youtube/stubs
  analysis/        # keywords(통계) + painpoints(LLM)
  cli.py / api.py  # CLI / FastAPI 웹
web/index.html     # 단일 페이지 대시보드
```

새 커뮤니티 추가 = `sources/`에 `BaseSource` 구현 한 개 + 레지스트리 등록.

## 한계 / 다음 단계

- 여러 소스 교차 분석(동일 주제의 한·영 페인포인트 비교)
- 펨코 Cloudflare 차단 시 자동 재시도/백오프
- 요청 과다 시 차단 가능 — `--delay`로 예의 있게.
