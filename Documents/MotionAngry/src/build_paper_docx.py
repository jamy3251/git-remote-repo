"""IAAI 제출용 논문 docx 생성: 지난 IAAI 논문(Creative/paper)의 스타일·여백을 그대로 쓰고 본문만 바꾼다.
출력: paper/MotionAngry_IAAI2026_강정모.docx
수치는 results/*.csv 및 paper/main_ko.md와 같다.
"""
import copy
from pathlib import Path

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT.parent / "Creative" / "paper" / "국제인공지능학회 학술대회 논문_강정모_수정본.docx"
OUT = ROOT / "paper" / "MotionAngry_IAAI2026_강정모_v2.docx"
FIG = ROOT / "paper" / "figures"
INDENT = Emu(109855)  # 지난 논문 본문 첫 줄 들여쓰기

d = docx.Document(TEMPLATE)
body = d.element.body
for el in list(body):
    if not el.tag.endswith("sectPr"):
        body.remove(el)


def para(text, style="Normal", indent=True, align=None, size=None, bold=None):
    p = d.add_paragraph(style=style)
    if indent and style == "Normal":
        p.paragraph_format.first_line_indent = INDENT
    if align is not None:
        p.alignment = align
    # **굵게** 구간 지원
    parts = text.split("**")
    for i, t in enumerate(parts):
        if not t:
            continue
        r = p.add_run(t)
        if size:
            r.font.size = Pt(size)
        if bold or i % 2 == 1:
            r.bold = True
    return p


def h(text, level):
    p = d.add_paragraph(text, style=f"Heading {level}")
    if level == 1 and text in ("Abstract",):
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def caption(text):
    return para(text, indent=False, align=WD_ALIGN_PARAGRAPH.CENTER, size=8, bold=True)


def figure(path, width_in, cap):
    p = d.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(path), width=Inches(width_in))
    caption(cap)


def table(rows, widths_in, cap):
    caption(cap)
    t = d.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = d.styles["Table Grid"]
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            c = t.cell(i, j)
            c.width = Inches(widths_in[j])
            c.text = ""
            p = c.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if j > 0 or i == 0 else WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(val)
            r.font.size = Pt(8)
            if i == 0:
                r.bold = True
    d.add_paragraph()
    return t


# ---------------- 제목·저자 ----------------
para("모바일 모션 센서 기반 온디바이스 정서 추정 시스템의 설계 및 구현",
     indent=False, align=WD_ALIGN_PARAGRAPH.CENTER, size=15, bold=True)
h("Design and Implementation of an On-Device Affect Estimation System Based on Mobile Motion Sensors", 1)
para("강정모")
para("Kang Jeong Mo")
para("202620044@seoil.ac.kr")
para("서일대학교 정보통신공학과, 전공심화")

h("Abstract", 1)
para("This paper designs and implements an on-device system that estimates a user's affective state from motion sensors, "
     "and determines what level of motion information such a system needs. Using laboratory and daily-life data, we compared "
     "OS-level activity categories, movement intensity, and fine-grained raw features at several sampling rates. Activity "
     "categories reached only chance level in daily life (AUROC 0.52), whereas continuous wrist intensity sampled at 2 Hz "
     "estimated arousal (0.60) as well as richer features did; fine-grained motion added information only for stress. The "
     "system ran feature extraction and inference on a smartphone in under 4 ms per window without network access, and a "
     "single-user pilot showed that labels from facial expressions can be collected on the device. The results suggest that "
     "affect estimation depends more on how continuously the sensor stays on the body than on signal precision.")
para("Keywords: affective computing, mobile sensing, motion sensor, on-device AI, stress estimation")

# ---------------- I. 서론 ----------------
h("I. 서론", 1)
para("스마트폰과 웨어러블 기기는 사용자의 움직임을 하루 종일 기록한다. 이 기록으로 스트레스나 기분 같은 정서 상태를 추정할 수 "
     "있다면 정신 건강 관리, 집중 관리, 콘텐츠 추천 등 여러 서비스에 활용할 수 있다. 움직임 센서는 카메라나 마이크보다 거부감이 "
     "적고 전력 소모가 작아 일상에서 상시로 쓰기에 알맞다.")
para("이런 시스템을 만들려면 먼저 움직임 신호의 어느 수준까지 받아야 하는지 정해야 한다. 운영체제(OS)는 앱에 원시 신호 대신 "
     "'정지·걷기·차량' 같은 활동 판정만 주는 경우가 많다. 반대로 원시 신호를 1초에 수십 번씩 계속 받으면 배터리와 계산 부담이 "
     "커지고, 이를 서버로 보내면 개인정보 문제가 생긴다. 필요한 정보 수준을 모르면 수집 주기, 센서 위치, 처리 위치를 정할 수 없다.")
para("본 논문은 움직임 기반 정서 추정 시스템을 스마트폰 안에서 동작하도록 설계·구현하고, 그 설계 근거를 세 단계로 검증한다. "
     "첫째, 공개 데이터로 움직임 정보의 수준(활동 판정, 움직임 세기, 원시 미세 움직임)과 측정 빈도에 따라 정서 추정 성능이 어떻게 "
     "달라지는지 실험실과 일상 환경에서 비교한다. 둘째, 같은 계산을 인터넷 권한 없는 스마트폰 앱으로 구현하여 결과 일치와 처리 "
     "시간을 확인한다. 셋째, 콘텐츠 이용 중 감정 반응으로 확장하기 위해 표정을 정답으로 수집하는 기능을 구현하고 1인 파일럿으로 "
     "동작을 확인한다.")

# ---------------- II. 관련 연구 ----------------
h("II. 관련 연구", 1)
para("휴대폰 센서로 정서를 추정하려는 연구는 대학생의 스마트폰 데이터와 기분 응답을 장기간 모은 데이터셋[1,2]과 실험실에서 "
     "스트레스를 유도한 데이터셋[3]을 중심으로 이루어져 왔다. 일상 데이터에서는 성능이 낮고, 실험실 데이터에서는 성능이 높지만 "
     "조건이 통제되어 있다. 움직임 신호만으로도 정서 정보를 얻을 수 있다는 보고가 있으나[4,6], 활동 판정·움직임 세기·원시 신호와 "
     "측정 빈도를 같은 절차로 비교하여 시스템 설계 기준을 제시한 연구는 찾기 어렵다. 또한 실험실 스트레스 과제는 서서 말하는 "
     "방식이어서, 움직임으로 얻은 높은 성능이 정서가 아니라 과제 동작의 차이일 수 있다는 지적이 있다[7]. 본 논문은 이 문제를 "
     "움직임 강도를 맞춘 비교로 직접 다루고, 같은 비교를 일상 데이터에서 반복한다.")

# ---------------- III. 시스템 설계 및 구현 ----------------
h("III. 시스템 설계 및 구현", 1)
h("3.1 시스템 설계", 2)
h("3.1.1 개발 환경", 3)
para("개발 환경은 표 1과 같다. 분석은 Python, 단말 앱은 Java로 작성하였다.")
table([["구분", "항목", "버전"],
       ["언어", "Python / Java(JDK)", "3.11.9 / 17"],
       ["데이터·신호처리", "pandas / NumPy / SciPy", "2.3.3 / 2.1.3 / 1.15.3"],
       ["분류 모델·평가", "LightGBM / scikit-learn", "4.7.0 / 1.8.0"],
       ["카메라·표정 추출", "CameraX / MediaPipe Face Landmarker", "1.4.2 / 0.10.35"],
       ["단말", "Galaxy Note9 (Exynos 9810)", "Android 10"]],
      [1.3, 2.6, 1.6], "표 1. 개발 환경")
h("3.1.2 시스템 구성", 3)
para("시스템은 그림 1과 같이 추정 흐름과 기록 흐름으로 구성된다. 추정 흐름에서는 백그라운드 서비스가 가속도 센서 값을 계속 받아 "
     "저장해 두고, 15초마다 최근 60초 신호를 일정한 시간 간격으로 다시 맞춘 뒤 특징을 계산하여 결정트리 모델(LightGBM[5])로 "
     "정서 확률을 낸다. 학습된 모델은 트리 구조를 텍스트로 옮겨 앱에 넣었으므로 별도의 추론 엔진이 필요 없다. 기록 흐름은 "
     "모델을 사용자 자신의 데이터로 다시 학습하기 위한 정답을 모은다. 가속도·자이로를 초당 약 50회 기록하고, 화면이 켜져 있는 "
     "동안 앞카메라 영상을 초당 2장 얼굴 분석 모델[8]에 넣어 표정 계수 52개(웃음, 찡그림 등 얼굴 부위의 움직임 정도를 0~1로 "
     "나타낸 값)만 저장한다. 함께 사용 중인 앱, 재생 중인 곡 제목, 사용자가 화면 가장자리 버튼으로 직접 누른 좋아/별로를 "
     "남긴다. 앱에는 인터넷 권한을 두지 않아 원시 신호, 표정 계수, 추정 결과가 단말 밖으로 나갈 경로가 없으며, 얼굴 영상은 "
     "저장하지 않는다.")
figure(FIG / "fig_system.png", 5.0, "그림 1. 시스템 구성 (실선: 구현, 점선: 향후 과제)")
h("3.1.3 움직임 정보의 수준", 3)
para("시스템이 받을 움직임 정보를 네 수준으로 나누었다. ① OS 활동 판정은 운영체제가 앱에 알려 주는 '정지·도보·차량' 같은 "
     "판정과 그 확신도이다. ② 움직임 세기는 1초 동안 흔들린 크기의 평균 하나로, 사용자가 얼마나 움직였는지만 나타낸다. "
     "③ 3범주는 1초마다 움직임을 정지·약한 움직임·걷기 이상 중 하나로 매긴 비율로, OS 판정을 같은 센서 신호로 흉내 낸 것이다. "
     "④ 원시 미세 움직임은 가속도에서 자세(중력) 성분을 빼고 남은 흔들림으로부터 흔들림 크기의 분포, 느린 흔들림과 빠른 "
     "흔들림의 비율(주파수 대역 비율), 흔들림의 불규칙성(스펙트럼 엔트로피), 움직임이 얼마나 급하게 바뀌는지(저크), 가만히 있는 "
     "시간의 비율을 계산한 16~19개 특징이다. 측정 빈도(Hz)는 1초에 센서 값을 몇 번 읽는지를 뜻하며, 같은 신호를 2~32Hz로 "
     "줄여 가며 비교하였다.")

h("3.2 실험 및 검증 방법", 2)
para("검증은 표 2의 세 단계로 진행하였다. 1단계에서는 실험실 데이터(WESAD[3], 15명, 손목 가속도 32Hz)로 스트레스 구간과 휴식 "
     "구간을 구분하고, 일상 데이터(K-EmoPhone[2], 77명, 자기보고 3,771건)로 응답 직전 30분의 움직임에서 정서가(기분이 좋은지), "
     "각성(들떠 있는지), 스트레스를 추정하였다. 일상 데이터는 손목 기기 가속도가 초당 약 8회로 기록되어 있고 폰의 OS 활동 판정을 "
     "함께 담고 있어 같은 시점에서 두 수준을 직접 비교할 수 있다. 모든 평가는 한 사람의 데이터를 통째로 빼고 학습한 뒤 그 사람을 "
     "맞히는 방식(LOSO)으로 하여, 처음 보는 사용자에 대한 성능을 측정하였다. 성능 지표 AUROC는 정답이 다른 두 사례를 무작위로 "
     "골랐을 때 모델이 맞는 쪽에 더 높은 점수를 줄 확률로, 0.5는 우연 수준, 1.0은 완벽한 구분이다. 두 특징 세트의 차이는 "
     "참가자를 무작위로 다시 뽑는 부트스트랩(1,000회)으로 95% 신뢰구간을 구해 0을 포함하지 않을 때만 차이가 있다고 보았다.")
para("2단계에서는 같은 특징 계산과 모델을 스마트폰 앱으로 옮겨, 같은 입력에 대해 Python과 결과가 같은지와 처리 시간을 쟀다. "
     "3단계에서는 저자 1인이 음악·영상 앱을 평소처럼 쓰는 동안 기록 흐름으로 데이터를 모아, 얼굴이 실제로 검출되는 비율과 "
     "표정·움직임의 관계를 1초 단위로 보았다. 시간에 따라 이어지는 값은 우연히도 상관이 커 보이기 쉬우므로, 한쪽 시계열을 "
     "시간 축으로 밀어 1,000번 다시 계산한 분포와 비교하는 순열 검정을 쓰고, 여러 쌍을 동시에 본 만큼 기준을 엄격하게 "
     "보정(본페로니)하였다.")
table([["단계", "검증 질문", "데이터", "정답", "평가 지표"],
       ["1. 공개 데이터", "어떤 수준의 움직임 정보가\n정서를 담는가", "실험실 15명\n일상 77명·49명", "실험 조건\n자기보고", "AUROC\n(처음 보는 사용자)"],
       ["2. 단말 구현", "폰에서 같은 결과를\n빠르게 내는가", "갤럭시 노트9", "Python 결과", "오차, 처리 시간"],
       ["3. 실사용 파일럿", "사용 중 정답을\n모을 수 있는가", "저자 1인, 18분", "표정 계수\n좋아/별로", "검출률, 순열 검정"]],
      [1.0, 1.7, 1.3, 1.0, 1.3], "표 2. 검증 단계 구성")

h("3.3 구현 결과", 2)
h("3.3.1 움직임 정보 수준별 정서 추정 성능", 3)
para("표 3은 움직임 정보 수준별 AUROC이다. 일상 환경에서 폰의 OS 활동 판정은 정서가 0.52, 각성 0.52로 우연 수준이었고, 또 다른 "
     "일상 데이터(StudentLife[1], 49명)에서도 0.49, 0.50으로 같은 결과가 재현되었다. 반면 손목에서 잰 움직임은 각성을 0.60으로 "
     "추정하여 OS 판정보다 0.08 [0.05, 0.11] 높았다. 이 이득은 대부분 움직임 세기 하나(0.59)로 이미 얻어졌고, 원시 미세 움직임을 "
     "더하거나 측정 빈도를 2Hz에서 8Hz로 올려도 늘지 않았다. 손목 3범주(0.60)는 OS 판정과 똑같이 거친 정보인데도 성능이 "
     "높았으므로, OS 판정의 실패는 정보가 거칠어서가 아니라 폰이 몸에서 떨어져 있는 시간이 많기 때문일 가능성이 크다. 스트레스는 "
     "양상이 달랐다. 실험실에서는 측정 빈도가 높을수록 성능이 올라 3범주 0.80에서 원시 16·32Hz 0.90까지 증가하였고(그림 2(a)), "
     "일상에서도 세 과제 중 스트레스만 원시 특징이 움직임 세기보다 유의하게 높았다(+0.037 [0.015, 0.061]).")
table([["움직임 정보 수준", "실험실\n스트레스", "실험실 스트레스\n(강도 통제)", "일상\n각성", "일상\n스트레스"],
       ["① OS 활동 판정 (폰)", "–", "–", "0.52", "0.54"],
       ["② 움직임 세기 1개", "–", "0.52", "0.59", "0.50"],
       ["③ 3범주", "0.80", "0.63", "0.60", "0.52"],
       ["④ 원시, 저빈도 (실험실 4Hz·일상 2Hz)", "0.83", "–", "0.61", "0.52"],
       ["④ 원시, 8Hz", "0.87", "–", "0.60", "0.54"],
       ["④ 원시, 32Hz", "0.90", "0.83", "–", "–"]],
      [2.4, 0.9, 1.2, 0.8, 0.8], "표 3. 움직임 정보 수준별 정서 추정 성능 (AUROC, 0.5=우연; –: 해당 데이터에 없음)")
h("3.3.2 움직임 강도 통제 실험", 3)
para("실험실의 스트레스 과제는 서서 발표하고 휴식은 앉아서 하므로, 스트레스 구간의 움직임 세기 중앙값이 휴식의 약 1.8배였다. "
     "따라서 위 성능에는 정서가 아닌 동작 차이가 섞여 있을 수 있다. 이를 가리기 위해 가만히 있는 시간이 50% 이상인 구간만 남겨 "
     "다시 평가하였다. 이 조건에서 움직임 세기 하나의 AUROC는 0.52로 떨어져 두 조건의 움직임 양 차이가 사실상 사라졌음을 "
     "확인하였다. 그럼에도 원시 미세 움직임은 0.83을 유지한 반면 3범주는 0.63으로 떨어졌다(그림 2(b)). 기준을 70%로 높이면 "
     "0.75 대 0.55였고, 거의 움직이지 않는 85% 이상에서는 원시 특징도 0.54로 떨어져 피부전도 등 생리 신호(0.80)만 정보를 "
     "유지하였다. 즉 스트레스 정보의 일부는 움직임의 양이 아니라 흔들림의 형태에 있지만, 완전히 정지한 상태에서는 움직임 "
     "센서만으로 한계가 있다.")
figure(FIG / "fig_resolution.png", 5.4, "그림 2. 실험실 스트레스 판별: (a) 측정 빈도별 성능, (b) 움직임 강도 통제 후 성능")
h("3.3.3 단말 실행 성능", 3)
para("2·8·16·32Hz용 모델(트리 200개)을 갤럭시 노트9에서 실행하였다. 같은 입력 5개에 대해 단말과 Python의 특징값 차이는 상대오차 "
     "10⁻¹⁴ 이하였고 정서 확률은 완전히 같았다. 60초 신호 하나의 특징 계산은 2Hz에서 0.16ms, 32Hz에서 3.8ms로 측정 빈도에 "
     "비례하였고, 모델 추론은 약 20μs(0.02ms)였다(표 4). 15초마다 한 번 실행하므로 CPU 사용은 0.3% 미만이다. 한편 안드로이드는 "
     "다른 앱이 같은 센서를 더 자주 읽고 있으면 그 빈도로 값을 보내 주어, 2Hz를 요청해도 실제로는 초당 50회가 들어왔다.")
table([["항목", "2Hz", "8Hz", "16Hz", "32Hz"],
       ["특징 계산 중앙값 / 상위 5% (ms)", "0.16 / 0.40", "0.44 / 0.68", "1.5 / 1.6", "3.8 / 4.1"],
       ["모델 추론 중앙값 (μs)", "24", "19", "18", "19"],
       ["모델 불러오기 (ms)", "40", "17", "18", "21"]],
      [2.3, 1.05, 1.05, 1.05, 1.05], "표 4. 갤럭시 노트9 처리 시간 (60초 신호 1개 기준, 200회 반복)")
h("3.3.4 실사용 파일럿", 3)
para("저자 1인이 18분 동안 음악·영상 앱을 쓰며 기록 흐름을 확인하였다(표 5). 얼굴 검출률은 폰을 얼굴 앞에 들고 보는 영상 앱에서 "
     "77%, 곡을 고른 뒤 폰을 내려 두는 음악 앱에서 32%로 사용 방식에 따라 크게 달랐다. 음악 앱은 곡 제목이 함께 기록되어 좋아/별로를 "
     "곡 단위로 묶을 수 있었다. 표정과 움직임이 함께 있는 292초에서 웃음 계수는 느린 흔들림(0~3Hz)의 비율과 같은 방향으로 "
     "움직였으나 보정 후 기준을 넘지 못하였다. 중간 시점(16분)에 보였던 '별로 직전 찡그림 증가'는 버튼을 누르려 화면을 보는 직전 "
     "2초를 빼고 곡 단위로 묶자 사라졌다. 이 단계의 결과는 정답 수집 절차가 단말에서 동작함을 보인 것이며, 정서와 움직임의 관계에 "
     "대한 결론은 아니다.")
table([["항목", "값"],
       ["기록 시간 / 표정 프레임", "18분 (가속도·자이로 초당 50회) / 2,084장"],
       ["얼굴 검출률", "영상 앱 77%, 음악 앱 32%, 홈 화면 2%"],
       ["좋아 / 별로 입력", "29회 / 14회 (곡 단위 좋아 10곡, 별로 11곡)"],
       ["웃음 계수 ↔ 느린 흔들림 비율", "상관 0.34, 보정 후 p=0.056 (기준 미달)"]],
      [2.3, 3.6], "표 5. 실사용 파일럿 결과")

# ---------------- IV. 결론 ----------------
h("IV. 결론", 1)
para("본 논문은 움직임 센서로 정서를 추정하는 시스템을 스마트폰 안에서 동작하도록 설계·구현하고, 어떤 수준의 움직임 정보가 필요한지 "
     "공개 데이터, 단말 실행, 실사용 파일럿의 세 단계로 검증하였다. 그 결과 다음을 밝혔다. 첫째, OS가 주는 활동 판정만으로는 일상의 "
     "정서를 추정할 수 없다. 둘째, 일상의 각성 정보는 손목에서 꾸준히 잰 움직임의 양에 대부분 담겨 있어 초당 2회 측정으로 충분하다. "
     "셋째, 스트레스만은 움직임의 양을 맞춘 뒤에도 흔들림의 형태에 정보가 남아 있어, 이때에만 높은 측정 빈도가 의미를 가진다. 넷째, "
     "이 계산은 일반 스마트폰에서 60초 신호당 4ms 이내로 외부 전송 없이 실행된다.")
para("본 연구에는 한계가 있다. 일상 데이터의 손목 가속도가 초당 8회로 제한되어 더 빠른 미세 움직임은 일상에서 검증하지 못하였고, "
     "실험실 데이터는 15명이다. 일상 성능은 AUROC 0.60 수준이어서 단독으로 개인의 정서를 판정하기에는 부족하다. 안드로이드는 요청한 "
     "측정 빈도를 보장하지 않아 저빈도 수집의 전력 이점을 직접 재지 못하였고, 파일럿은 1인 18분의 데이터이다.")
para("그러나 이 한계들을 함께 놓으면 하나의 일관된 결론이 드러난다. 정서 추정의 성패를 가른 것은 신호의 정밀도보다 센서가 "
     "사람에게 얼마나 꾸준히 닿아 있었는가였다. 같은 수준의 거친 정보라도 폰의 OS 판정은 실패하고 손목의 3범주는 성공하였으며, "
     "측정 빈도를 4배로 올려도 일상 성능은 늘지 않았다. 파일럿에서도 표정 정답은 폰을 얼굴 앞에 들 때만 얻어졌다. 게다가 폰에서는 "
     "다른 앱이 센서를 쓰는 동안 요청보다 촘촘한 신호가 이미 들어오므로, 정밀한 신호를 쓰는 추가 비용은 주로 처리량이고 그마저 "
     "수 밀리초에 불과하다. 따라서 모바일 정서 추정 시스템은 정밀한 센서를 더하기보다 '몸에 닿은 기기에서 낮은 빈도로 끊김 없이 재고, 상황에 "
     "맞는 정답(영상은 표정, 음악은 직접 입력)으로 사용자별로 다시 학습하는' 구조로 설계해야 한다. 향후 이 구조에 따라 수집 기간을 "
     "늘려 개인별 재학습을 구현하고, 콘텐츠 이용 중 실시간 감정 피드백으로 발전시킬 예정이다.")

# ---------------- 참고문헌 ----------------
h("참고문헌", 1)
REFS = [
    '[1] R. Wang et al., "StudentLife: Assessing mental health, academic performance and behavioral trends of college students using smartphones," in Proc. ACM UbiComp, pp. 3–14, 2014.',
    '[2] S. Kang et al., "K-EmoPhone: A mobile and wearable dataset with in-situ emotion, stress, and attention labels," Scientific Data, vol. 10, 351, 2023.',
    '[3] P. Schmidt et al., "Introducing WESAD, a multimodal dataset for wearable stress and affect detection," in Proc. ACM ICMI, pp. 400–408, 2018.',
    '[4] R. Wampfler et al., "Affective state prediction from smartphone touch and sensor data in the wild," in Proc. ACM CHI, 2022.',
    '[5] G. Ke et al., "LightGBM: A highly efficient gradient boosting decision tree," in Proc. NeurIPS, 2017.',
    '[6] S. Woll, J. Müther, D. Birkenmaier, G. Biri, U. W. Ebner-Priemer, M. Giurgiu, "Predicting momentary mood in daily life from accelerometer data: Evaluating single vs. multiple sensor locations using machine learning," Sensors, vol. 26, no. 12, 3688, 2026.',
    '[7] N. Kwon, S. Yoon, J. Hur, H. S. Kang, "When wellness stress detection enters healthcare workflows: An iso-heart-rate, cross-corpus evaluation of wrist wearables," Healthcare, vol. 14, no. 15, 2434, 2026.',
    '[8] C. Lugaresi et al., "MediaPipe: A framework for building perception pipelines," arXiv:1906.08172, 2019.',
]
for r in REFS:
    para(r, indent=False, size=8)

# 템플릿 settings.xml의 <w:zoom>에 필수 속성 percent가 없어 스키마 검증에 걸리므로 채운다
from docx.oxml.ns import qn
for z in d.settings.element.iter(qn("w:zoom")):
    if z.get(qn("w:percent")) is None:
        z.set(qn("w:percent"), "100")
d.save(OUT)
print("saved", OUT)
