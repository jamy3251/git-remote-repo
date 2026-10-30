# 투고 저널 조사 (VENUE) — 2026-10-30

대상 원고: "폰 움직임 기반 정서 추정의 온디바이스 교차 모달 자기 학습(표정 교사 → 움직임 학생)과 무작위 질문 기반 성능 가드" 시스템·정서 컴퓨팅 논문.
현재 증거 수준: **공개 데이터(K-EmoPhone, 77명) 시뮬레이션 + 저자 1명(N=1) 프로토타입 앱 가동**. 현장 연구(참가자 실험)·IRB 【미실시】. 리뷰어 심사 보고서(`docs/reviewer_critique_2026-10-30.md`)의 Major 지적 M1(교사–학생 효과 미측정), M2(n=1·IRB 부재), M9(전력 측정), M10(교사 규칙 타당성), M11(코드 공개)이 그대로 열려 있다는 전제로 저널을 고른다.

조사 방법: 각 저널의 공식 안내 페이지를 2026-10-30에 직접 열어 확인했다(WebFetch 또는 Chrome). 공식 페이지가 열리지 않거나 수치가 없는 항목은 **[TO VERIFY]**로 표시하고, 제3자 집계 사이트(journalmetrics 등) 수치는 참고로만 적는다. 임팩트 팩터(JIF)는 Clarivate JCR 2025(2026-06 발표)가 최신이며, 저널 자체 페이지에 적힌 값을 우선한다.

---

## 1. 한눈에 보기

| 저널 | 색인 / JIF | 논문 유형·길이 | 템플릿 | 심사 방식 | APC | 심사 기간 | 우리 증거 수준과의 적합성 |
|---|---|---|---|---|---|---|---|
| **IEEE Access** (기본) | SCIE·Scopus / **4.2** (JCR 2025, 공식) | Research Article 외 14종(**Negative Result, Applied Research, Methods** 포함). 쪽수 제한 없음, 20쪽 이하 권장(초과 시 편집 사전심사) | IEEE Access 전용 Word/LaTeX(IEEEtran 계열 2단) | 상시 접수, **이진 판정(Accept / Reject-재투고 허용 1회 / Reject)**, 단일 익명, 최소 2인 | **US$2,160** (완전 OA, 회원 5~20% 할인) | 투고→게재 4~6주 목표, 평균 결정 약 4주 | 높음. 시스템+공개데이터 시뮬레이션 수용. "기술적 건전성"·"최신 대비 명확한 진전" 요구, 수락률 약 20~27% |
| **IEEE Trans. Affective Computing (TAFFC)** | SCIE / **11.3** (IEEE 페이지, JCR 연도 [TO VERIFY]) | 정규 논문 **12쪽**(초과 $220/쪽, 2026 IEEE APC 목록) | IEEE CS 2단 템플릿 | 상시 접수, 단일 익명(요청 시 이중 익명) | 하이브리드: OA 선택 시 **US$2,645**, 구독형 선택 시 0 | 공식 미표기 [TO VERIFY]; 통상 수개월 | 낮음(현재). 정서 컴퓨팅 최상위 저널, 사람 대상 검증 없이는 Reject 가능성 높음 |
| **ACM IMWUT (PACM IMWUT)** | Scopus / JIF 비공식 4.5~6.2 [TO VERIFY]; SCIE 여부 [TO VERIFY] | 쪽수 제한 없음, **8,000~10,000단어(13~16쪽)** 적정 | ACM Large(acmart) 1단 | **연 3회 마감(2/1·5/1·11/1)**, 8/1은 Major Revision 재투고 전용, **이중 익명**, Major Revision 후 다음 두 마감 중 재투고 | ACM 2026년 완전 OA 전환, PACM 논문 **US$350(비회원)/250(회원)**, ACM Open 기관은 0 | 마감→통보 약 3개월, 재투고 포함 6~9개월 | 낮음(현재). 통상 실세계 배치·사용자 연구 기대. 2026-11-01 마감이 곧 다음 기회 |
| **Pervasive and Mobile Computing (PMC, Elsevier)** | **SCIE·Scopus** / **3.9**, CiteScore 8.8 (공식) | Original research / Review / **Fast Communications**(짧은 진행 중 연구). 쪽수 제한 미명시 | Elsevier elsarticle(LaTeX 2단 허용) | 상시 접수, 단일 익명, 최소 2인 | 하이브리드: OA **US$2,470**, 구독형 0 | 1차 결정 4일(데스크), **심사 후 결정 89일, 수락까지 210일**, 온라인 게재 9일(공식) | 중간~높음. 범위 적합(온디바이스 학습·활동 인식·컨텍스트 인식), 느림 |
| **Sensors (MDPI)** | SCIE·Scopus·PubMed [SCIE 공식 페이지 접속 차단, TO VERIFY] / **3.5** (JCR 2024, MDPI 공식 발표); 3rd-party 4.0(JCR 2025) [TO VERIFY] | Article / Communication / Review. **최대 길이 없음**, 재현 가능한 전 실험 세부 요구 | MDPI Word/LaTeX | 상시 접수, 단일 익명 | **CHF 2,600** (공식) | **1차 결정 약 19.7일, 수락→게재 2.4일**(2025 상반기, 공식) | 중간. 빠름, 시스템+공개데이터 논문 다수. 단, 2개월 안에 결과 필요하면 유리 |
| IEEE Internet of Things Journal | SCIE / **8.9** (JCR 2024, 공식 사이트) | 8쪽 초과 시 $175/쪽 | IEEE 2단 | 상시, 단일 익명, 최소 2인 | 하이브리드: OA $2,695(사이트)/$2,800(2026 목록) | **1차 결정 6.9주, 게재 14.5주**(공식 평균) | 낮음. 범위(IoT 아키텍처·프로토콜)와 정서 추정이 멀다 |
| Smart Health (Elsevier) | **ESCI·Scopus**(SCIE 아님) / 3.4, CiteScore 7.7 (공식) | 유형 미명시 | elsarticle | 단일 익명, 최소 2인 | OA APC 공식 미표기 [TO VERIFY] | 1차 7일, 심사 후 106일, 수락 113일(공식) | 중간. 폰 기반 모니터링 범위에 맞지만 SCIE가 아님 |
| Frontiers in Digital Health | **ESCI**·Scopus·PubMed / 5.2 (공식 페이지) | Original Research **12,000단어**, Brief Research Report 4,000단어·그림표 4개 | Frontiers 템플릿 | 상시, 단일 익명, 심사자·AE 만장일치 수락 | A-type **CHF 3,150** | 미표기 [TO VERIFY] | 중간. "공개 데이터 계산 연구는 적절한 검증 필수" 명문화, 건강 응용 연결 필요 |
| PLOS Digital Health | ESCI·Scopus·PubMed / 7.7 (3rd-party) [TO VERIFY] | 길이 제한 없음, 초록 300단어 | 자유(DOC/PDF) | 상시, 데이터 전면 공개 필수 | **US$3,165** | **1차 결정 52일, 게재 236일, 수락률 33%**(2025 공식) | 낮음. 임상·건강 영향 요구, 범위 어긋남 |
| JMIR mHealth and uHealth | **SCIE**·Scopus·MEDLINE / **6.3** (JCR 2025, 공식) | Original Paper 본문 10,000단어 권장(초과 시 추가비) | JMIR 서식(IMRAD) | 상시, 보고 지침 체크리스트 필수 | **US$3,150** | 미표기 [TO VERIFY] | 낮음. 건강 결과·참가자 연구 중심, 시뮬레이션만으로 부족 |

---

## 2. 저널별 상세

### 2.1 IEEE Access (기본 후보)

- 색인·지표: Science Citation Index Expanded, Scopus, DOAJ, Ei Compendex 등(공식 bibliometrics 페이지). **JIF 4.2 (JCR 2025)**, CiteScore 9.3, Eigenfactor 0.329.
- 논문 유형: Research Article, Topical Review, Theory, Survey, Perspective, **Applied Research, Negative Result, Methods**, Tutorial, Standards, Debate, Exposition, Meta-Analysis, Unsolved Problem. 모르면 Research Article.
- 길이: "쪽수 제한 없음, 따라서 초과 요금 없음". 가독성을 위해 **20쪽 이하 권장**, 20쪽 초과 시 편집 사전심사(또는 EIC 사전 허가). 긴 논문은 심사도 길어진다고 명시.
- 템플릿: IEEE Access 전용 2단 Word/LaTeX 템플릿 필수, 소스 파일+PDF 둘 다 제출. 그래픽 초록 요구는 안내 페이지에 미명시 [TO VERIFY].
- 심사: 상시 접수. **이진 판정** — Accept(소수 수정 허용) / Reject(재투고 전 수정 필요, 포인트별 응답문 첨부, **재투고 1회만**) / Reject(재투고 불가). 최소 2인 독립 심사, 최종 결정은 AE. 범위·품질 점검 단계에서 "최신 대비 명확한 진전" 요구, 심사자는 "과학계 기여·기술적 건전성·포괄성·참고문헌 적절성" 평가. 수락률 약 20%(authors 페이지)~27%(stages 페이지).
- APC: **US$2,160/편**(세금 별도). IEEE 회원 5%, IEEE+소사이어티 회원 20% 할인(학생 회원 제외). 완전 OA.
- 기간: "투고→온라인 게재 4~6주" 목표, 평균 결정 약 4주(rapid review 페이지).
- 적합성: 시스템 기여와 공개 데이터 시뮬레이션을 그대로 받는다. **Negative Result 유형이 있어 S7(설문 누적 개인화가 사용자 안 판별을 올리지 않음) 같은 부정 결과를 숨기지 않고 쓸 수 있다.** 사용자 연구를 요구하는 규정은 없다. 다만 "기술적 건전성"은 CI·베이스라인·재현성으로 채워야 하며, 재투고 기회가 1회뿐이므로 첫 투고 전에 M4~M6(해결됨)에 더해 M11(코드 공개) 정리가 필요하다.
- 공식 안내: https://ieeeaccess.ieee.org/authors/ (열림), 제출 체크리스트 https://ieeeaccess.ieee.org/authors/submission-guidelines/ (열림), 심사 단계 https://ieeeaccess.ieee.org/authors/stages-of-peer-review/ (열림), APC https://ieeeaccess.ieee.org/about/article-processing-charges/ (열림), 지표 https://ieeeaccess.ieee.org/about/bibliometrics/ (열림). (주의: 옛 주소 /guide-for-authors/ 는 404.)

### 2.2 IEEE Transactions on Affective Computing (TAFFC)

- 색인·지표: SCIE(JCR 카테고리 Computer Science, Cybernetics 1위). **JIF 11.3**(IEEE/CS 저널 페이지 표기, 어느 JCR 연도인지 미표기 [TO VERIFY]; 직전 값 9.6). 제3자 집계는 9.8~11.7로 엇갈림.
- 길이: 2026 IEEE APC 목록(2026-07-30 갱신, 공식 PDF)에 **정규 논문 12쪽**, 초과 **$220/쪽**(Mandatory Overlength Page Charge). IEEE CS 공통 지침도 "Transactions 정규 논문 12쪽(초록·참고문헌·약력 포함)". 일부 도서관 DB는 14쪽으로 적어 상충 [TO VERIFY — 저널 Author Information 탭 확인]. 단문(short paper) 한도 미확인 [TO VERIFY].
- 템플릿: IEEE CS 2단 템플릿 필수(IEEE Template Selector).
- 심사: 상시 접수(ScholarOne https://mc.manuscriptcentral.com/taffc-cs). 기본 단일 익명, 요청 시 이중 익명. 심사 기간 공식 미표기 [TO VERIFY].
- APC: **하이브리드**. OA 선택 시 **US$2,645**(2026 목록), 구독형 선택 시 0.
- 적합성: 범위 선언에 "정서를 고려한 시스템의 설계·구현·평가"와 "정서 시스템 사용성 평가 방법"이 명시되어 주제 적합. 그러나 이 저널 수준에서 N=1 프로토타입은 통하지 않는다. 리뷰어 보고서의 M1·M2·M10이 열린 상태로는 Reject를 예상해야 하며, 12쪽 안에 시스템+시뮬레이션+현장 연구를 모두 담아야 한다.
- 공식 안내: IEEE CS 저널 공통 저자 지침 https://www.computer.org/publications/author-resources/authors (열림, 12쪽·$220/쪽·단일 익명 확인). 저널 페이지 https://www.computer.org/csdl/journal/ta (열리지만 JS 렌더링으로 본문 미추출), 일반 CFP https://www.computer.org/digital-library/journals/ta/tac-general-call-for-papers (열림, 범위 확인). 2026 APC 목록 PDF https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/2026-07-30-IEEE-Article-Processing-Charges-List.pdf (열림).

### 2.3 ACM IMWUT (Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies)

- 색인·지표: Scopus 수록. JIF는 제3자 집계 4.5(2024)/6.2(2025)로만 보임, SCIE/ESCI 여부와 공식 JIF **[TO VERIFY]**(Clarivate Master Journal List 확인 필요).
- 길이: "쪽수·단어 제한 없음. 참고문헌·그림 제외 **약 8,000~10,000단어(13~16쪽)** 가 적정. 현저히 길거나 짧으면 추가 검토." 초록 150~200단어.
- 템플릿: ACM Large(acmart) 1단, 약어 "Proc. ACM Interact. Mob. Wearable Ubiquitous Technol." 메타데이터는 자리표시 허용.
- 심사: **연 3회 신규 접수 마감 — 2월 1일·5월 1일·11월 1일**(23:59 AoE, 연장 없음). **8월 1일은 Major Revision 재투고 전용**. Major Revision은 다음 두 마감 중 하나에 재투고(예: 2/1 투고 → 5/1 또는 8/1). **이중 익명**(익명화 위반 시 데스크 리젝). 이전 IMWUT 거절 논문 재투고 시 심사 의견·변경 요약 첨부 의무. 통보 후 다음 분기 호에 게재(연 4호: 3·6·9·12월). 수락 논문은 UbiComp/ISWC 발표 초청(UbiComp 2027: 서울, 2027-10-03~07 — 제3자 사이트 정보 [TO VERIFY]).
- APC: ACM은 2026-01-01부터 완전 OA. ACM Open 참여 기관(1,800+)·저소득국 저자는 0. 그 외 2026년 보조금 적용가 **PACM 논문 US$350(비회원)/US$250(ACM·SIG 회원 1인 이상)**, 중저소득국 $175/$125. (저널 논문은 $1,450/$950 — PACM이 아님.)
- 적합성: 범위(모바일·웨어러블·유비쿼터스)는 정확히 맞고, 데이터·코드·영상 등 아티팩트 첨부를 권장한다. 그러나 IMWUT 심사 문화는 실세계 배치(deployment)와 사용자 연구를 사실상 기대한다. 리뷰어 보고서도 IMWUT 기준 Reject로 봤다. 이중 익명이므로 N=1이 저자 본인이라는 사실도 기술상 숨겨야 한다.
- 공식 안내: https://dl.acm.org/journal/imwut/author-guidelines (Chrome으로 열림, WebFetch는 403), 투고 일정 https://dl.acm.org/journal/imwut/how-to-submit (열림), OA 요금 https://dl.acm.org/journal/imwut/open-access (열림). 투고 시스템 https://new.precisionconference.com/submissions.

### 2.4 Pervasive and Mobile Computing (PMC, Elsevier)

- 색인·지표: **SCIE·Scopus**(공식 Insights 페이지), **JIF 3.9**, CiteScore 8.8.
- 논문 유형: Original research articles / Review / **Fast Communications**("진행 중 연구, 잠정적 아이디어, 기발표 연구에 대한 논평을 담은 짧고 자족적인 글"). 쪽수·단어 한도는 안내에 미명시 [TO VERIFY — 편집부 관행 확인]. 초록 250단어, 키워드 1~7, Highlights 3~5개(85자) 권장.
- 템플릿: Elsevier LaTeX(elsarticle) 권장, Word는 1단만·2단은 LaTeX만 허용. 참고문헌 번호 방식.
- 심사: 상시 접수, **단일 익명**, 편집 선별 후 최소 2인 심사. 연구 데이터 정책 Option C(저장소 기탁·링크, 불가 시 사유 진술 의무).
- APC: **하이브리드**. OA 선택 시 **US$2,470**(세금 별도, 기관 협약으로 감면 가능), 구독형 선택 시 0(셀프 아카이빙 엠바고 24개월).
- 기간(공식 Insights): 투고→1차 결정 4일(데스크 단계 포함 중위값으로 보임), **심사 후 결정 89일, 수락까지 210일**, 수락→온라인 9일.
- 적합성: 범위 목록에 "Pervasive, Mobile and Wearable Computing Systems", "Federated, Distributed and Embedded learning, Learning at-the-edge", "Learning on Streaming Data and Continual Learning", "Activity Recognition", "Context-aware Computing", "Trust, Reliability, Security, and Privacy"가 있어 온디바이스 자기 학습·가드·비식별성 분석이 모두 들어간다. 시뮬레이션 기반 시스템 논문이 꾸준히 실린다. 단점은 속도(수락까지 7개월)이고, 구독형 선택 시 APC가 0이라는 점이 학부 연구실 예산에 유리하다.
- 공식 안내: https://www.sciencedirect.com/journal/pervasive-and-mobile-computing/publish/guide-for-authors (Chrome으로 열림, WebFetch는 403), Insights https://www.sciencedirect.com/journal/pervasive-and-mobile-computing/about/insights (열림), OA 옵션 https://www.sciencedirect.com/journal/pervasive-and-mobile-computing/publish/open-access-options (열림).

### 2.5 Sensors (MDPI)

- 색인·지표: **JIF 3.5 (JCR 2024, MDPI 공식 공지 2025-06)**; 제3자 집계는 JCR 2025 값 4.0 [TO VERIFY]. SCIE·Scopus·PubMed 수록은 널리 알려져 있으나 공식 페이지가 자동 접속을 차단해 이번에 직접 확인 못함 [TO VERIFY].
- 논문 유형·길이: Article / Communication / Review. 공식 안내 "**최대 길이 제한 없음**(간결·포괄적이면), 재현 가능하도록 **전 실험 세부를 제공**, 과학적으로 건전한 실험과 상당량의 새 정보 요구". MDPI 공통 블로그는 3,000단어 미만·12,000단어 초과 시 사전 문의 권고. (2023년 심사 보고서에 "Article은 16쪽 이상 권장" 인용이 있으나 현행 안내에서 확인 못함 [TO VERIFY].)
- 템플릿: MDPI Word/LaTeX 템플릿.
- 심사: 상시 접수, 단일 익명. 데이터 가용성 진술 필수.
- APC: **CHF 2,600**(세금 별도, 공식 APC 페이지 — 검색 결과 발췌로 확인).
- 기간(공식 저널 설명, 2025 상반기 게재 논문 기준): **1차 결정 약 19.7일, 수락→게재 2.4일**. 2022년 중위값: 1차 결정 16일, 투고→게재 38일.
- 적합성: 폰 센서 기반 정서·활동 인식 논문이 많고, 공개 데이터 재분석+프로토타입 조합도 통과 사례가 많다. 사용자 연구를 규정으로 요구하지 않는다. 다만 "전 실험 세부·데이터 가용성"을 요구하므로 K-EmoPhone 부분집합 기준과 코드(M11)를 공개 수준으로 정리해야 한다. 2개월 안에 게재 실적이 필요할 때 가장 현실적이다.
- 공식 안내: https://www.mdpi.com/journal/sensors/instructions (브라우저로 열림, 자동 추출은 차단), APC https://www.mdpi.com/journal/sensors/apc, JIF 공지 https://www.mdpi.com/journal/sensors/announcements/12201.

### 2.6 추가 후보

**IEEE Internet of Things Journal** — JIF 8.9(JCR 2024, 공식 사이트), 5년 9.6. 8쪽 초과 **$175/쪽**(의무, 협상 불가), IEEE 2단 템플릿, 단일 익명 최소 2인. OA APC $2,695(사이트) / $2,800(2026 APC 목록) — 상충 [TO VERIFY]. 공식 평균 **1차 결정 6.9주, 게재 14.5주**. 범위는 IoT 아키텍처·통신·서비스이며 정서 추정 자체는 주변부. "온디바이스 학습 + 에너지 예산 + 프라이버시"로 프레이밍하면 투고 가능하나 정서 평가 부분이 심사자 풀과 맞지 않는다. 안내: https://ieee-iotj.org/guidelines-for-authors/ (열림), https://ieee-iotj.org/ (열림).

**Smart Health (Elsevier)** — **ESCI**·Scopus(SCIE 아님), JIF 3.4, CiteScore 7.7(공식). 범위 "Cell-phone based monitoring systems, Wearable health system, Health Data Privacy" 등 P7 헬스케어. 단일 익명 최소 2인, 1차 7일·심사 후 106일·수락 113일(공식). OA APC 공식 페이지에 미표기 [TO VERIFY]. 논문 유형·길이 미명시. SCIE 실적이 목표면 부적합. 안내: https://www.sciencedirect.com/journal/smart-health/publish/guide-for-authors (Chrome으로 열림), https://www.sciencedirect.com/journal/smart-health/about/insights (열림).

**Frontiers in Digital Health** — **ESCI**·Scopus·PubMed·PMC·DOAJ(공식 about 페이지, SCIE 미기재), JIF 5.2, CiteScore 6.8. Original Research·Technology and Code **12,000단어**, Brief Research Report 4,000단어·그림표 4개. A-type **CHF 3,150**, B-type CHF 2,500. 단일 익명, **심사자·AE 만장일치**로 수락. 심사 기준은 "결과의 타당성, 체감 영향 아님". 주의 문구: "**공개 데이터 계산 연구는 적절한 검증을 포함해야 하며 그렇지 않으면 고려하지 않음**", "건강 응용이 없는 디지털 도구는 부적합". 심사 기간 미표기 [TO VERIFY]. 안내: https://www.frontiersin.org/journals/digital-health/for-authors/author-guidelines (열림), 유형 https://www.frontiersin.org/journals/digital-health/for-authors/article-types (열림), 요금 https://www.frontiersin.org/journals/digital-health/for-authors/publishing-fees (열림).

**PLOS Digital Health** — PubMed·Scopus·Web of Science(ESCI)·DOAJ(공식), JIF는 저널이 공개하지 않음(제3자 7.7) [TO VERIFY]. 길이 제한 없음, 초록 300단어, Author Summary 150~200단어, DOC/PDF 자유 서식. **US$3,165**. 2025 공식 지표: **1차 결정 52일, 게재 236일, 수락률 33%**. 게재 기준: "연구자·엔지니어·임상가 공동체에 높은 중요성과 넓은 관심", "결론에 대한 상당한 증거", 데이터 전면 공개("data not shown" 불허). 임상·건강 결과 지향이라 범위 어긋남. 안내: https://journals.plos.org/digitalhealth/s/submission-guidelines (열림), https://journals.plos.org/digitalhealth/s/journal-information (열림), 요금 https://www.plos.org/publication-fees (열림), 지표 https://plos.org/metrics/ (열림).

**JMIR mHealth and uHealth** — **SCIE**·Scopus·MEDLINE·PMC·PsycINFO(공식), **JIF 6.3 (JCR 2025)**, 5년 7.2, Q1. Original Paper는 하드 한도 없음, 본문 10,000단어 권장(초과 시 편집 추가비), 구조화 초록 450단어. **US$3,150**(Research Letter $1,575). 보고 지침 체크리스트 업로드 필수. 사람 대상 건강 결과 연구가 중심이어서 시뮬레이션+N=1로는 부적합. 안내: https://mhealth.jmir.org/author-information (열림), 요금 https://mhealth.jmir.org/about-journal/article-processing-fees (열림), 색인 https://mhealth.jmir.org/about-journal/indexing-and-impact-factor (열림).

---

## 3. 추천

### 1순위: IEEE Access

지금 가진 증거(공개 데이터 77명 시뮬레이션 + N=1 프로토타입)로 **올해 안에 SCIE 게재를 노릴 수 있는 유일한 후보**다. 이유는 네 가지다. (1) 쪽수 제한이 없어 시스템 설계·결정 원장·S14~S18 통계·프로토타입 가동 기록을 한 편에 모두 담을 수 있고, 20쪽 안에서 부록으로 미실시 항목까지 정직하게 적을 수 있다. (2) 논문 유형에 **Negative Result**와 **Applied Research**가 있어, "설문 누적 개인화는 사용자 안 판별을 올리지 않는다(S7·S16)"는 부정 결과를 설계 근거로 쓰는 우리 구조가 유형상 어색하지 않다. (3) 심사 기준이 "기술적 건전성·최신 대비 진전"이지 "사용자 연구 필수"가 아니며, 4~6주 이진 판정이라 거절돼도 PMC·Sensors로 빨리 돌릴 수 있다. (4) 완전 OA(US$2,160)라 하이브리드 저널의 구독형 선택지는 없지만, TAFFC·IoTJ의 OA 요금보다 낮고 PLOS·JMIR·Frontiers보다 CHF/US$ 1,000 가량 싸다. 단, 재투고가 1회뿐이므로 첫 제출 전에 리뷰어 보고서 D절 1~4번 반영분과 코드·부분집합 기준 공개(M11)를 끝내야 한다.

### 대안: Pervasive and Mobile Computing (Elsevier) — 구독형(APC 0) 또는 Fast Communication

IEEE Access가 "최신 대비 명확한 진전" 단계에서 걸릴 경우의 대안이다. 범위 선언에 "Learning at-the-edge", "Continual Learning in Pervasive and Mobile Systems", "Context-aware Computing", "Privacy"가 명시돼 심사자 풀이 우리 기여(온디바이스 자기 학습·가드·비식별성)를 가장 정확히 읽는다. SCIE·JIF 3.9이고 **구독형을 선택하면 APC가 0**이라 예산 부담이 없다. 결정적 단점은 속도(수락까지 중위 210일)이므로, 참가자 실험(M1·M2) 결과가 몇 달 뒤 들어올 예정이면 오히려 리비전 단계에서 그 결과를 보강할 시간이 된다. 2개월 안에 게재 실적이 급하면 Sensors(1차 결정 약 20일, CHF 2,600)를 대신 쓴다.

### 보류: TAFFC·IMWUT

두 저널은 참가자 3~5명 2주 배치(M2)와 교사–학생 효과 측정(M1)이 끝난 뒤의 목표다. IMWUT는 2026-11-01 신규 마감이 바로 앞이지만 현 증거로는 Major Revision조차 어렵고, 이중 익명이라 N=1 저자 실험을 기술상 숨겨야 한다. TAFFC는 12쪽 한도 안에 현장 연구까지 들어가야 한다. 참가자 실험이 끝나면 IMWUT 2027-02-01 또는 2027-05-01 마감(UbiComp 2027 서울 발표 가능)이 현실적 목표다.

---

## 4. 저널별 추가 요구 증거

| 저널 | 지금 증거로 부족한 것 | 투고 전 최소 보강 |
|---|---|---|
| IEEE Access | "최신 대비 진전" 한 문장(기여 문장이 "구현하였다"면 약함) | S18 베이스라인 비교를 기여 문장의 중심에 두기, 코드·K-EmoPhone 부분집합 기준 공개(M11), 폰 가동 기록(교사 라벨 수·학습 횟수) 표 1개 |
| PMC | 시스템 평가(지연·전력·메모리) 수치 | 학습 비용(50 ms/시간) 외 전류 측정 또는 전력 추정 근거(M9), 재현 데이터 Option C 진술 |
| Sensors | 전 실험 세부·데이터 가용성 | 특징 추출 코드와 부분집합 ID 목록 공개, 센서 사양·샘플링 표 |
| TAFFC | 사람 대상 검증, 교사 규칙 타당성 | 참가자 3~5명 2주 배치(IRB 또는 면제 근거), 교사 라벨–기분 지도 응답 일치율(M10), 교사–학생 효과 1단계 게이트(M1) |
| IMWUT | 실세계 배치·사용자 연구, 이중 익명 | 위 TAFFC 요건 + 배치 기간 사용 경험(질적 응답), 익명화된 N≥5 데이터, ACM 윤리 정책 준수 진술 |
| IoTJ | IoT 시스템 관점 평가 | 에너지·통신 비용, 다기기 배치 가능성 — 정서 평가는 부차적 |
| Smart Health / Frontiers / PLOS / JMIR | 건강 결과·임상 연결 | 정서 추정이 건강 지표(스트레스·기분 장애 선별)와 연결됨을 보이는 참가자 데이터; Frontiers는 공개 데이터 계산 연구에 "적절한 검증" 명시 요구 |

---

## 5. 검증 메모

- 직접 열어 확인한 공식 페이지(2026-10-30): IEEE Access authors·submission-guidelines·stages-of-peer-review·APC·bibliometrics; IEEE CS 저자 지침; TAC 일반 CFP; 2026 IEEE APC 목록 PDF; IMWUT author-guidelines·how-to-submit·open-access(Chrome); PMC guide-for-authors·insights·open-access-options(Chrome); Smart Health guide-for-authors·insights(Chrome); Frontiers DH author-guidelines·article-types·publishing-fees·about·peer-review; PLOS DH submission-guidelines·journal-information·publication-fees·metrics; JMIR mHealth author-information·APC·indexing; IoTJ guidelines·홈.
- 자동 접속이 차단되어 **검색 발췌로만** 확인한 것: MDPI Sensors instructions·APC·JIF 공지(mdpi.com은 WebFetch 403, Chrome에서는 로딩 미완료). IEEE TAFFC 저널 전용 Author Information 탭(computer.org CSDL은 JS 렌더링으로 본문 미추출).
- [TO VERIFY] 목록: TAFFC JIF 11.3의 JCR 연도·단문 한도·심사 기간; IMWUT SCIE/ESCI 여부·공식 JIF; Sensors SCIE 수록·JCR 2025 JIF 4.0·권장 최소 길이; PMC 쪽수 관행; Smart Health OA APC; Frontiers DH 심사 기간; PLOS DH 공식 JIF; JMIR 심사 기간; IoTJ APC($2,695 vs $2,800); UbiComp 2027 일정.
- 제3자 집계(journalmetrics·scijournal 등)는 저널 간에도 서로 다른 값을 내므로 본문 수치로 쓰지 않았다. 투고 직전 Clarivate JCR 또는 저널 공식 페이지에서 한 번 더 확인한다.
