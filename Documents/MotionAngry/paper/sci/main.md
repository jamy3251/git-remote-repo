---
title: "When Does On-Device Self-Training Help? Cross-Modal Teacher Signals, Random Probes and a Performance Guard for Smartphone-Movement Affect Estimation"
author:
  - Jeongmo Kang (Dept. of Information and Communication Engineering, Seoil University)
  - Wantae Kim (Dept. of Information and Communication Engineering, Seoil University)
date: 2026-10-31 (draft v0.1, autonomous 48 h run)
bibliography: references.bib
---

<!-- 모든 수치는 results/ 파일을 가리킨다. 손으로 적은 수치 없음. [PENDING: Phase N] = 아직 채우지 않은 자리. -->
<!-- 빌드: pandoc paper/sci/main.md --citeproc -o paper/sci/main.pdf (pandoc 미설치 환경에서는 마크다운으로 제출 초안 유지) -->

# Abstract

[PENDING: Phase 7 — write after Results are final. Structure: problem (movement-based affect estimation on phones cannot be personalised by sparse surveys), idea (face blendshapes during screen use as a dense, noisy teacher for a 33-parameter movement student updated hourly on device; random probes feed a hysteresis guard), evaluation (K-EmoPhone 77 users replayed through a loop simulator with teacher accuracy p and density d; Bernoulli guard simulation; privacy attacks), findings (quantified conditions; negative result on within-user gains with one week of data; guard false-revert rate), release.]

# 1 Introduction

Smartphones record their owner's movement continuously through the accelerometer. A compact model that maps movement summaries to arousal and valence can run entirely on the device, which keeps a sensitive signal (affect) off the network and makes it available to applications that adapt content, pacing or notifications in real time. Two obstacles stand in the way. First, affect expressed in movement is individual: a model trained on other people transfers only partly, and the within-person variation that applications care about is exactly the part a population model captures least. Second, the obvious remedy, personalising the model with the user's own self-reports, is limited by how rarely people answer surveys. Three answers a day for a week give about twenty labels, far fewer than a 33-parameter model needs to beat its prior.

This paper studies an alternative supply of labels. While the screen is in use, the front camera can estimate facial expression, and expression is a well-studied correlate of momentary affect. We treat expression-derived labels as a *teacher* for a *student* model that uses movement features only, so that the student keeps estimating when the camera is off. The teacher is dense (one label per minute of screen use) but noisy; survey answers are sparse but accurate. Whether self-training with the dense noisy signal can beat fine-tuning on the sparse accurate signal is the central question, and the answer depends on the teacher's accuracy and density. Because a self-trained model can also drift, we evaluate it against the population model on *random* probes that do not depend on the model's own output, and revert to the population model when the student falls behind.

We make the following contributions.

- **C1 (system).** A complete on-device loop on Android: minute-level movement features, a LightGBM population model, a MediaPipe-blendshape teacher, a LiteRT logistic student trained on the phone with a closed-form gradient, a contact gate, a two-arm prompting scheduler (model-triggered arm A, random arm B) and a hysteresis guard. Training cost on a 2018 mid-range phone is tens of milliseconds per hourly update (Section 6.6).
- **C2 (conditions for self-training).** A replay simulator that runs 77 users of K-EmoPhone through the loop with controlled teacher accuracy $p$, density $d$ and bias $b$, comparing the student with the fixed population model, ESM fine-tuning, per-user Platt scaling and an oracle teacher. We report in which $(p, d)$ region dense noisy labels beat sparse accurate ones, and we show a result that constrains all four approaches: with about one week of data none of them improves within-user discrimination over the population model, and the apparent gains are level calibration visible only in pooled AUROC (Section 6.2).
- **C3 (guard and selection bias).** A Bernoulli analysis of the hysteresis guard against SPRT, Bayesian and confidence-interval alternatives at three random probes per day (Section 6.3), and a measurement of how model-triggered prompts bias accuracy estimates (Section 6.4).
- **C4 (privacy).** Re-identification attacks on the 32 movement features with stronger attackers and smaller candidate sets, and an attack on the 33 student weights that a device would export (Section 6.5).
- **C5 (reproducibility).** All experiments are scripts in the public repository; every number in this paper is produced by a script whose output file is cited next to it.

# 2 Related Work

<!-- paper/sci/related_work.md 를 여기에 삽입 (에이전트 작성, DOI 확인). -->
[PENDING: Phase 7 — insert paper/sci/related_work.md]

# 3 Problem Setting and Notation

A user $u$ produces a stream of minute-level movement summaries $x_t \in \mathbb{R}^{32}$ (median and interquartile range over the past 30 minutes of 16 per-minute features, Section 4.1). Ground truth is an occasional self-report $y_s \in \{0,1\}$ (arousal above neutral; valence above neutral) at times $s$ drawn by the random scheduler (arm B). The population model $f_0$ is trained on other users. The student $g_\theta$ is a logistic model on standardised $x_t$ with 33 parameters, initialised from a population logistic seed $\theta_0$. A teacher provides pseudo-labels $\tilde y_t$ on a subset of minutes with density $d$ (fraction of minutes labelled) and accuracy $p = \Pr(\tilde y_t = y_t)$, possibly with class-dependent bias $b$. The device updates $\theta$ hourly by 100 full-batch gradient steps on the most recent 2,000 teacher-labelled minutes.

Evaluation uses two views of accuracy that behave differently under personalisation. **Pooled AUROC** ranks all probes of all users together and therefore rewards getting each user's *level* right. **Within-user AUROC** is computed per user and averaged, and rewards tracking *changes within a person*. Level can be learned from a handful of labels; tracking changes cannot. We report both throughout and treat within-user AUROC as primary (pre-registered, `docs/PREREG.md`).

# 4 System Design

## 4.1 Movement features and population model

The phone samples the accelerometer at the rate the OS delivers (about 50 Hz on the test device), interpolates to an 8 Hz grid and block-averages to 2 Hz, the rate at which the public dataset and the device agree exactly (`src/s6_build_2hz.py`, `android/.../Features.java`). Each minute yields 16 orientation-free features of the gravity-removed magnitude (five distribution statistics, dominant frequency, spectral entropy, 0.1–1 Hz band power, five jerk statistics, per-second intensity mean and coefficient of variation, still fraction). The 30-minute summary is the median and IQR of each feature, 32 values. The population model is a LightGBM classifier with 50 trees of 3 leaves, trained on K-EmoPhone (Section 5.1) and flattened to a 7.5 KB table for the device.

## 4.2 Teacher: facial blendshapes during screen use

When the screen is on and the user holds the phone, the front camera runs MediaPipe Face Landmarker at 2 frames per second and keeps only the 52 blendshape coefficients; no image is stored. Per minute the app aggregates the mean smile coefficient (average of `mouthSmileLeft` and `mouthSmileRight`), the mean `jawOpen` and the fraction of frames with a detected face. The teacher emits a valence pseudo-label when smile exceeds $\theta_v$ and an arousal pseudo-label when smile plus jaw exceeds $\theta_a$, provided the face-detection rate is at least 0.3. Thresholds are set per user as the 70th percentile of the first days' coefficients, or, once at least 20 random-probe answers exist, by maximising agreement with those answers (`src/s8_teacher.py`). This rule is deliberately simple and is the component whose validity we can least establish from public data (Section 7).

## 4.3 Student and on-device training

The student is $g_\theta(x) = \sigma(w^\top z + b)$ with $z = (x - \mu)/s$, where $\mu, s$ are population statistics stored in the model. It is exported as a LiteRT model with `infer` and `train` signatures. Automatic differentiation produced an operator (`BroadcastGradientArgs`) that is not a built-in LiteRT operator, so the gradient is written in closed form: $\nabla_w = Z^\top(\sigma(Zw+b)-y)/n$, $\nabla_b = \mathbf{1}^\top(\sigma(Zw+b)-y)/n$, learning rate 0.05. Weights are read and written through `get_weights`/`set_weights` signatures because the checkpoint operators require the Flex delegate. The trainer keeps the most recent 2,000 teacher-labelled minutes and runs 100 steps once an hour when at least 50 are available (`OnDeviceTrainer.java`). The numpy re-implementation used by the simulator reproduces the LiteRT probabilities to within $10^{-4}$ on the fixed probe batch (`tests/test_loop_sim.py`).

## 4.4 Contact gate

Estimation is suspended, but logging continues, when the device is charging, or when the screen is off and the still fraction of the past minute exceeds 0.9 (`ContactGate.java`). On K-EmoPhone the equivalent rule suspends 18.3 % of windows; arousal AUROC on suspended windows is lower (0.595 vs 0.623), although the participant-bootstrap confidence interval of the difference includes zero (`results/s9_contact.csv`, `results/S14_NOTES.md`).

## 4.5 Two-arm prompting and the performance guard

Arm A prompts when the current arousal estimate differs from the estimate at the previous prompt by at least 0.25 and at least 30 minutes have passed. Arm B prompts three times a day at uniformly random times between 09:00 and 23:00, at least 30 minutes apart. Only arm B answers are used for evaluation and for the guard. The guard scores the population model and the student on every arm B answer (threshold 0.5), keeps a 14-day window, and once $n \ge 15$ reverts to the population model when the student's accuracy is more than 0.10 below it, re-enabling the student when it is at least 0.05 above (`DriftGuard.java`). Section 6.3 evaluates these constants.

## 4.6 Implementation

[PENDING: Phase 7 — table: Galaxy Note9 (Android 10), LiteRT 2.16.1, MediaPipe tasks-vision 0.10.35, LightGBM 4.7.0, Python 3.11.9, JDK 17; APK 22.5 MB; tests 13 pytest + 31 JUnit. Sources: `docs/REPO_MAP.md`, `results/S8_NOTES.md`.]

# 5 Evaluation Methodology

## 5.1 Data

K-EmoPhone [KangK2023] contains 77 participants over about one week with 3,771 ESM responses that have at least 50 % wrist-accelerometer coverage in the preceding 30 minutes and at least five complete minutes (`data/processed/kemophone_2hz_block.parquet`). Arousal and valence are reported on a scale centred at zero; we binarise at zero (above zero positive), and test the user-median alternative in Section 6.1. The accelerometer is a wrist band at about 8 Hz, not the phone's own sensor; the dataset does not release phone IMU data. All movement results in this paper are therefore results about wrist movement features that the phone computes identically, and the transfer to phone-worn movement is a limitation we return to in Section 7.

## 5.2 Loop simulator

We replay each user in time order (`experiments/loop_sim/sim.py`, design in `docs/LOOP_SIM_README.md`). For every response we compute the 30-minute summary at each of the 30 preceding minutes, exactly as the phone does; the summary at the response time equals the population model's input to the last digit. The teacher labels each of these minutes with the response's own label flipped with probability $1-p$, present with probability $d$; bias $b$ makes flips of negatives more likely than flips of positives. The student is updated at every clock hour of the user's period. The prediction for a response is made before that response's teacher minutes are added, so no label information leaks forward. The first 60 % of each user's period is the learning phase; responses in the last 40 % are the evaluation set (minimum 10 per user). Conditions: (a) population model; (b) seed fine-tuned on previous ESM answers with the same learner; (b′) L2 logistic on previous ESM answers; (c) population model with per-user Platt scaling; (d) student on teacher labels; (e) student with the guard; (f) oracle teacher ($p=1, d=1$); and the untouched seed as a reference. Grid: $p \in \{0.6,0.7,0.8,0.9\}$, $d \in \{0.2,0.5\}$, $b \in \{0,0.2\}$, three seeds. The simulator cannot create affective states between responses; what it isolates is the effect of label noise, density and the on-device learning rule given the same underlying information.

## 5.3 Statistics

Within-user AUROC is averaged over users with at least 10 (simulator) or 20 (benchmark) evaluation responses and both classes. Confidence intervals are participant bootstraps (1,000 resamples of users); paired comparisons use the Wilcoxon signed-rank test with effect size $r = Z/\sqrt{n}$. We also report AUPRC, MCC at 0.5, Brier score and expected calibration error (`experiments/common/eval.py`).

# 6 Results

## 6.1 Population model and ablations (RQ1)

[PENDING: Phase 1 — `results/benchmark/summary.csv`; figures/fig_window_ablation.pdf]

## 6.2 Dense noisy teacher vs sparse accurate labels (RQ2)

[PENDING: Phase 2 — `results/loop_sim/summary.csv`; figures/fig_density_noise_map.pdf, fig_conditions.pdf, fig_timecourse.pdf; figures/tables/tab_conditions.md]

## 6.3 Guard behaviour (RQ3)

[PENDING: Phase 2 — `results/guard_sim/guard_sim.csv`; figures/fig_guard.pdf; figures/tables/tab_guard.md]

## 6.4 Selection bias of model-triggered prompts (RQ4)

[PENDING: Phase 2 — `results/loop_sim/rq4_selection.csv`; figures/fig_selection_bias.pdf]

## 6.5 Privacy (RQ6)

[PENDING: Phase 5 — `results/privacy/reident.csv`, `results/privacy/weight_leak.csv`]

## 6.6 System cost (RQ7)

[PENDING: Phase 4 — `data/raw/life/2026-10-25/litert_probe.txt` (device), `results/system/scaling_pc.csv`, `results/system/minute_timing.csv`]

# 7 Discussion

[PENDING: Phase 7 — when self-training helps; the level-vs-change distinction; teacher validity (RQ5: author log had no probe answers with a detected face, `results/teacher/teacher_validity_log.txt`); wrist-to-phone transfer; one-week horizon; threats to validity.]

# 8 Ethics and Privacy

[PENDING: Phase 7 — camera use without image storage, data on device, consent package `docs/field_study/`, re-identification numbers with threat model.]

# 9 Conclusion

[PENDING: Phase 7]

# References

<!-- references.bib (에이전트 작성, DOI 확인; [TO VERIFY] 표시 유지) -->
