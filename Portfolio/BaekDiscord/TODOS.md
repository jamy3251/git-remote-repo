# TODOS — DevHub

2026-11-13 설계 점검(`docs/designs/devhub-next-20261113.md`)에서 미룬 항목.

## 권한 단계가 있는 기기 토큰 (C6)
- **What:** 기기 토큰에 읽기 전용 / 입력 가능 / 세션 생성 단계.
- **Why:** 터널로 접속한 기기마다 할 수 있는 일을 다르게.
- **Context:** 기기 토큰(계획 P3)이 먼저 있어야 한다. 사용자가 1명인 동안은 쓸 곳이 없다.
- **Effort:** 사람 M / CC S. **Priority:** P3. **Depends on:** P3 기기 토큰.

## 안드로이드용 프로토콜 JSON 스키마 생성 (C8)
- **What:** `packages/protocol`에서 JSON 스키마를 뽑아 Kotlin 타입 검증.
- **Why:** 프로토콜의 세 번째 구현(Kotlin)이 조용히 어긋나는 것을 막는다.
- **Context:** 지금은 공용 JSON 픽스처로 대신한다. 안드로이드가 읽는 메시지 종류가 10개를 넘으면 전환.
- **Effort:** 사람 M / CC S. **Priority:** P3.

## SQLite 저장소 (C4)
- **What:** `runner/src/store/` 뒤를 SQLite로 교체.
- **Why:** 판단 기록 질의와 조인.
- **Context:** 판단 기록 1만 건 초과 또는 기기 테이블에 조인이 필요해질 때.
- **Effort:** 사람 M / CC S. **Priority:** P3. **Depends on:** P1 저장 모듈.

## 작업 큐와 예산 (C14)
- **What:** 동시 세션 상한에 맞춘 대기열, 작업별 토큰과 시간 예산, 초과 시 정지.
- **Why:** 이 PC는 메모리 부족으로 백그라운드 프로세스가 죽은 이력이 있다(addendum 2026-10-04 4절).
- **Effort:** 사람 L / CC M. **Priority:** P2.

## 하루 브리핑 (C15)
- **What:** 작업 내역, 교차검증, 제품 상태를 모은 "어제 한 일 / 오늘 손볼 것" 화면.
- **Context:** `web/lib/digest/render.ts` 재사용 후보.
- **Effort:** 사람 M / CC S. **Priority:** P2.

## 지시 템플릿 (C16)
- **What:** 자주 쓰는 지시서 저장과 변수 치환. 작업 내역의 "이 지시로 다시"가 일부 대신한다.
- **Effort:** 사람 S / CC S. **Priority:** P3.

## 비용 대시보드 (C17)
- **What:** 엔진별, 세션별 토큰과 추정 비용 추이. 상단 토큰 집계가 이미 있다.
- **Effort:** 사람 M / CC S. **Priority:** P3.

## worktree 격리 (C12)
- **What:** 세션마다 git worktree에서 작업하고 끝나면 diff 검토 후 병합 또는 폐기.
- **Why:** 같은 저장소에 여러 에이전트를 붙일 때 충돌을 막고 교차검증의 diff 기준점을 깨끗하게 한다.
- **Context:** git 최상위가 모노레포(`D:\Projects`)라 전체 체크아웃이 된다. 부분 체크아웃(sparse-checkout)과 worktree 위치(저장소 밖), 세션 cwd의 하위 경로 대응을 먼저 설계해야 한다. 폴더 이동 커밋이 선행 조건.
- **Effort:** 사람 L / CC M. **Priority:** P2.

## 폰 탭 4개 축소와 "더 보기"
- **What:** 폰 하단 탭을 1차 탭 4개로 줄이고 나머지는 "더 보기"로.
- **Why:** 탭이 6개이고 기능이 붙을 때마다 늘어난다.
- **Context:** 1차 동안은 "새 탭 추가 금지" 규칙으로 버틴다. 답 대기열이 자리 잡은 뒤 실제 사용 빈도를 보고 4개를 고른다.
- **Effort:** 사람 M / CC S. **Priority:** P2.

## 데스크톱 3단 고정 레이아웃
- **What:** 세션 목록, 선택 세션 터미널과 피드, 관제 AI의 3단.
- **Effort:** 사람 M / CC S. **Priority:** P3.

## DESIGN.md
- **What:** `/design-consultation`으로 디자인 시스템 문서 작성.
- **Context:** 지금은 `globals.css` 토큰 11개와 `devhub-control.md`의 상태 표가 전부다.
- **Effort:** 사람 M / CC S. **Priority:** P3.

## 커뮤니티와 문서 편의
- **What:** 기여 안내, 이슈 템플릿, 문서 검색, 시작 시간 자동 계측.
- **Context:** 정체성 결정(본인 전용 / 포트폴리오 / 제품)이 "남도 쓰는 제품"으로 날 때만.
- **Effort:** 사람 M / CC S. **Priority:** P3.

## 출력 방송 성능 측정
- **What:** 세션 출력이 폭주할 때 러너 메모리와 지연을 재는 측정.
- **Context:** 역압 한도(클라이언트당 4MB)는 넣지만 실제 수치는 없다. 이 PC는 메모리 부족 이력이 있다.
- **Effort:** 사람 S / CC S. **Priority:** P3.

## Codex 세션의 구조화 신호
- **What:** Codex 세션도 정규식이 아닌 구조화 신호로 상태를 판정.
- **Why:** 여러 회사 CLI 관제가 차별점인데 hook은 Claude 전용이다.
- **Context:** 공식 기능 관문에서 Codex 쪽 신호 수단을 조사한 뒤.
- **Effort:** 사람 M / CC S. **Priority:** P2.

## 자율 정책 허용 목록
- **What:** hook의 `tool_input`으로 자율 승인 대상을 허용 목록(읽기 전용 도구, 세션 작업 폴더 안 편집, 설정한 명령)으로 제한.
- **Why:** 지금 자율 응답은 판단 엔진 제안과 위험 패턴으로만 정해진다. "위험 패턴에 안 걸림"은 승인 근거가 아니다.
- **Context:** hook 신호는 들어왔다(`docs/designs/devhub-control.md` 2-1절). 승인 카드(2차)와 같이.
- **Effort:** 사람 M / CC S. **Priority:** P2.

## diff 사본 정리
- **What:** `runner/.data/diffs/`의 오래된 사본 삭제(작업 내역에서 빠진 항목).
- **Context:** 사본 하나는 60KB 상한이다. 지금은 지우지 않는다.
- **Effort:** 사람 S / CC S. **Priority:** P3.
