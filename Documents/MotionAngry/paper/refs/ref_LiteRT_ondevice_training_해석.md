# 참고문헌 해석: Google, "On-Device Training with LiteRT"

## 문서 정보

- 제목: On-Device Training with LiteRT (Google AI Edge, LiteRT 문서)
- 요청 URL: https://ai.google.dev/edge/litert/models/ondevice_training
- 실제 도달 URL(리디렉션): https://developers.google.com/edge/litert/conversion/tensorflow/build/ondevice_training
- 확인 날짜: 2026-10-25
- 페이지 표기: Copyright 2024 The AI Edge Authors, Apache License 2.0, "Last updated 2026-05-28"
- 형식: Colab 노트북을 그대로 올린 튜토리얼(Run in Google Colab, View source on GitHub, Download notebook 링크 포함). 노트북 안에서 사용한 TensorFlow 버전은 2.8.0이며, 온디바이스 학습 API는 TensorFlow 2.7 이상에서 제공된다고 명시한다.
- 저장 파일: paper/refs/ref_LiteRT_ondevice_training.html (248,952바이트)

## 한 줄 요약

TensorFlow 모델을 tf.Module로 감싸 train, infer, save, restore 네 함수를 시그니처로 노출하고 LiteRT로 변환하면, 안드로이드 앱 안에서 Interpreter.runSignature 호출로 모델을 추가 학습하고 가중치를 체크포인트 파일로 저장·복원할 수 있음을 Fashion-MNIST 의류 분류기 예제로 보여 주는 공식 튜토리얼이다.

## 문서가 설명하는 것

### 동기

기기에 배포한 모델을 사용자 입력으로 개인화하거나 개선하고 싶을 때, 데이터가 기기를 떠나지 않게 하면서(개인정보 보호) 앱 업데이트 없이 모델을 갱신하는 수단으로 온디바이스 학습을 제시한다. 예로 패션 아이템 인식 모델이 신발에 관심 있는 사용자의 사용에 따라 특정 신발 스타일을 더 잘 알아보게 되는 상황을 든다. 대상 기기가 로컬 파일 저장을 지원하면 기존 LiteRT 구현에 덧붙일 수 있다고 적는다.

### 모델 구조: tf.Module에 네 개의 시그니처

LiteRT 모델은 보통 추론용 함수 하나만 노출하므로, 학습까지 하려면 모델을 여러 함수로 확장하고 변환 시 각 함수를 시그니처로 내보내야 한다고 설명한다. 예제 코드는 다음과 같다.

- 모델 본체: Keras Sequential, Flatten(28x28) 다음 Dense(128, relu) 다음 Dense(10). 옵티마이저 sgd, 손실 CategoricalCrossentropy(from_logits=True).
- train(x, y): tf.GradientTape로 순전파와 손실을 기록하고 tape.gradient(loss, self.model.trainable_variables)로 기울기를 구해 optimizer.apply_gradients로 갱신한다. 반환은 {"loss": loss}. 입력 시그니처는 x가 [None, 28, 28] float32, y가 [None, 10] float32(원핫)이다.
- infer(x): 로짓과 softmax 확률을 {"output", "logits"}로 반환한다.
- save(checkpoint_path): tf.raw_ops.Save로 model.weights 전체를 파일에 쓴다. 입력은 스칼라 tf.string 경로.
- restore(checkpoint_path): tf.raw_ops.Restore로 각 변수를 읽어 var.assign한다.

문서는 GradientTape 대신 Keras Model.train_step을 써도 되지만 그 손실값은 이동 평균이므로 주기적으로 초기화해야 한다고 덧붙이고, 저장되는 가중치는 TensorFlow 1 형식 체크포인트 파일로 직렬화된다고 명시한다.

### 데이터와 사전 학습

Fashion-MNIST(Zalando, 28x28 흑백 60,000장, 10개 의류 범주)를 쓴다. 픽셀을 255로 나눠 0~1로 정규화하고 라벨을 원핫으로 바꾼다. 변환 전에 Python에서 train 시그니처로 100 에폭(배치 100)을 먼저 학습해 초기 가중치를 확보해야 하며, 기기에서 데이터를 모으고 추가 학습하기 전에 합리적인 추론이 가능해야 한다고 강조한다.

### 변환 방법

tf.saved_model.save(m, dir, signatures={'train', 'infer', 'save', 'restore'}: 각 get_concrete_function())로 저장한 뒤 tf.lite.TFLiteConverter.from_saved_model로 변환한다. 변환기 설정은 두 가지다.

- converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS, tf.lite.OpsSet.SELECT_TF_OPS]
- converter.experimental_enable_resource_variables = True

즉 공식 예제는 내장 연산자(TFLITE_BUILTINS)만으로 변환하지 않고 Select TF ops를 함께 켠다. 문서는 어느 연산자가 Select TF ops로 넘어가는지, 내장 연산자만으로 학습 그래프를 만들 수 있는지에 대해서는 아무 설명을 하지 않는다. 지원 연산자 목록이나 제약도 이 페이지에는 없다.

변환 후 tf.lite.Interpreter의 get_signature_runner("infer")로 원 모델과 변환 모델의 로짓을 비교해 변환으로 동작이 바뀌지 않음을 보인다.

### 기기에서 재학습

변환 모델을 배포한 뒤 train 시그니처로 새 데이터를 학습하면 메모리 안의 가중치가 갱신된다. 학습은 자원을 많이 쓰므로 사용자가 기기를 쓰지 않을 때 백그라운드로, WorkManager로 예약해 수행하라고 권한다. 안드로이드에서는 Java 또는 C++ API를 쓸 수 있고, Java에서는 Interpreter를 열어 다음처럼 호출한다.

- 입력은 Map<String, Object>에 "x"(FloatBuffer.allocateDirect, nativeOrder), "y"를 넣고, 출력은 "loss"(FloatBuffer 길이 1)를 넣은 뒤 interpreter.runSignature(inputs, outputs, "train")을 호출한다.
- 예제 코드는 100 에폭 x 600 배치(60,000장을 100장씩)를 돌리는 구조이며 10 에폭마다 손실을 출력한다.

Python 쪽 시연에서는 변환된 모델로 50 에폭을 더 학습해 손실이 0.230에서 0.198로 이어 내려가는 것을 보여 주고, 온디바이스 학습이 사전 학습이 멈춘 지점에서 정확히 이어진다고 설명한다. 단순화를 위해 같은 학습 데이터를 다시 썼으며 실제로는 기기에서 수집한 데이터를 쓰라고 적는다. 완전한 안드로이드 예제는 별도의 "model personalization demo app"을 참고하라고 링크한다(이 페이지에는 그 앱의 내용이 설명되어 있지 않다).

### 체크포인트 저장과 복원

- save: inputs에 "checkpoint_path"로 앱 내부 저장소 경로(getFilesDir() 아래 checkpoint.ckpt)를 넣고 runSignature(inputs, outputs, "save")를 호출한다.
- restore: Interpreter를 새로 만들면 항상 원래 모델 가중치가 로드되므로, 체크포인트가 있으면 restore 시그니처로 읽어야 한다. 원칙은 "Interpreter를 만들 때마다 체크포인트가 있으면 로드한다"이고, 기준 모델로 되돌리려면 체크포인트를 지우고 Interpreter를 새로 만들면 된다.
- 복원에는 변수 수와 체크포인트 크기에 비례하는 시간이 걸릴 수 있고, 앱 재시작 후 새 추론 전에 학습된 가중치를 다시 로드해야 한다고 주의한다.
- 복원 없이 추론해도 동작은 하지만 개선 전 원래 모델의 예측이 나온다.

### 제한 사항으로 읽을 수 있는 것

- 플랫폼: 본문은 안드로이드(Java, C++ API)만 다룬다. iOS나 다른 플랫폼 언급은 없다.
- 저장소: 로컬 파일 저장을 지원하는 기기가 전제다(save/restore가 파일 경로를 받는다).
- 연산자: 변환기에 SELECT_TF_OPS를 켜도록 안내한다. Select TF ops 없이도 되는지, 어느 연산자가 문제인지는 언급이 없다.
- 버전: TensorFlow 2.7 이상.
- 비용: 학습은 자원 집약적이므로 백그라운드 수행을 권한다.

## 우리 연구와의 연결

우리는 32개 특징을 표준화한 뒤 로지스틱 회귀(가중치 32개와 편향 1개, 총 33개 파라미터) 학생 모델을 LiteRT 2.16.1로 변환해 Galaxy Note9에서 100스텝 온디바이스 학습을 수행했다. 자동 미분(GradientTape)이 만드는 BroadcastGradientArgs 연산자가 LiteRT 내장 연산자에 없어 기울기를 닫힌 식으로 직접 그래프에 넣었고, 파일 기반 save/restore 대신 가중치 텐서를 직접 주고받는 get_weights/set_weights 시그니처로 대체했다.

일치하는 부분은 다음과 같다.

1. 구조. tf.Module 안에 여러 @tf.function을 두고 tf.saved_model.save의 signatures 인자로 내보내며, 안드로이드에서 Interpreter.runSignature(inputs, outputs, "이름")으로 각각 호출하는 틀은 우리 구현과 같다. 우리는 train, infer 외에 save/restore 자리를 get_weights/set_weights로 바꾼 것이다.
2. 사전 학습 후 변환. 문서가 "변환 전에 초기 학습을 끝내 합리적인 추론이 가능한 상태로 배포하라"고 한 원칙은 우리가 서버(Python)에서 학습한 교사 모델의 지식을 담은 학생 모델을 초기 가중치로 넣고 기기에서 이어 학습한 흐름과 맞는다.
3. Select TF ops. 공식 예제가 TFLITE_BUILTINS만으로 변환하지 않고 SELECT_TF_OPS를 켠 것은, GradientTape 기반 train 시그니처가 내장 연산자만으로는 변환되지 않는 경우가 있음을 간접적으로 뒷받침한다. 우리가 겪은 BroadcastGradientArgs 미지원은 그 구체적 사례이며, 우리는 Select TF ops(Flex 위임)를 끌어오는 대신 닫힌 식 기울기로 내장 연산자 범위 안에 머물렀다. 다만 문서 자체는 어느 연산자가 문제인지 말하지 않으므로, BroadcastGradientArgs를 문서가 지목했다고 쓰면 안 된다.
4. 가중치 영속화. 문서의 "Interpreter를 만들 때마다 체크포인트가 있으면 복원한다"는 운용 규칙은, 우리가 앱 시작 시 저장해 둔 33개 값을 set_weights로 넣는 절차와 같은 역할이다. 차이는 문서가 tf.raw_ops.Save/Restore로 TF1 체크포인트 파일을 쓰는 반면 우리는 파일 입출력을 모델 밖(앱)으로 빼고 모델은 텐서만 주고받게 했다는 점이다.

## 인용 정확성 점검: "공개 예제는 이미지 분류기의 마지막 층을 다시 배우는 것"

이 문장은 이 문서에 대해서는 정확하지 않다. 문서의 예제는 Fashion-MNIST 의류 이미지 분류기이고, Flatten 다음 Dense(128) 다음 Dense(10)의 2층 완전연결망 전체(self.model.trainable_variables, 즉 두 Dense 층의 가중치와 편향 모두)를 train 시그니처로 학습한다. 고정된 특징 추출기 위에 마지막 층만 다시 배우는 구조가 아니다. 또 데이터셋은 MNIST 숫자가 아니라 Fashion-MNIST 의류다.

"마지막 층(헤드)만 재학습"이라는 서술은 문서가 링크만 하는 별도의 "model personalization demo app"(전이학습형 데모)에 해당할 가능성이 있으나, 이 페이지에는 그 앱의 구조가 쓰여 있지 않으므로 이 문서를 근거로 그렇게 쓸 수 없다. 그 앱을 인용하려면 해당 저장소를 따로 확인해야 한다【미확인】.

논문에서 쓸 수 있는 안전한 표현의 예는 다음과 같다.

- "LiteRT 공식 온디바이스 학습 튜토리얼은 Fashion-MNIST 의류 이미지 분류기(2층 완전연결망)를 기기에서 추가 학습하는 예제이며, 변환 시 Select TF ops를 함께 켜고 가중치는 TF1 체크포인트 파일로 저장·복원한다."
- "공식 예제는 수만 개 파라미터의 이미지 분류기를 다루며, 우리처럼 33개 파라미터의 로지스틱 모델을 내장 연산자만으로 학습한 사례는 다루지 않는다." (Dense(128)의 파라미터는 28x28x128+128 = 100,480개, Dense(10)은 1,290개로 합계 101,770개다. 이 수치는 코드에서 계산한 것이며 문서에 직접 적혀 있지는 않다.)

## 인용 시 주의점

- URL이 리디렉션된다. 요청한 ai.google.dev 주소는 developers.google.com/edge/litert/conversion/tensorflow/build/ondevice_training 으로 넘어가므로, 참고문헌에는 실제 도달 URL과 확인 날짜(2026-10-25)를 함께 적는 것이 안전하다.
- 저자는 "The AI Edge Authors"(Google)이며 개별 저자명은 없다. 연도는 저작권 표기 2024와 최종 갱신 2026-05-28 중 하나를 택해 일관되게 쓴다.
- 문서는 Colab 노트북 형식이라 학술 문헌이 아니라 개발자 가이드다. "공식 문서에 따르면" 수준으로 인용하고 성능 수치(손실 0.230, 0.198 등)는 논거로 쓰지 않는 것이 좋다.
- 문서는 지원 연산자 목록, BroadcastGradientArgs, 내장 연산자만으로의 학습 가능 여부, 플랫폼 지원 표를 전혀 언급하지 않는다. 이런 내용을 이 문서의 주장으로 돌리면 안 되고, 우리 실험에서 관찰한 사실로 서술해야 한다.
- 문서는 LiteRT 버전 번호를 적지 않는다(TensorFlow 2.7 이상, 노트북 실행 환경 2.8.0만 나온다). 우리가 쓴 LiteRT 2.16.1과 비교하는 문장은 우리 쪽 정보로 서술한다.
- 데이터셋은 Fashion-MNIST다. MNIST로 쓰면 틀린다.

## 제안 서지 표기

Google AI Edge (The AI Edge Authors), "On-Device Training with LiteRT," LiteRT documentation, Google for Developers, last updated 2026-05-28. https://developers.google.com/edge/litert/conversion/tensorflow/build/ondevice_training (accessed 2026-10-25).
