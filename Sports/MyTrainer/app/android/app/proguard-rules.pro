# MediaPipe tasks-vision 에 들어 있는 애노테이션 프로세서(autovalue)가 javax.lang.model 을 참조한다.
# 실행 중에는 쓰지 않는 코드라 경고만 끈다(R8 이 만든 missing_rules.txt).
-dontwarn javax.lang.model.SourceVersion
-dontwarn javax.lang.model.element.Element
-dontwarn javax.lang.model.element.ElementKind
-dontwarn javax.lang.model.type.TypeMirror
-dontwarn javax.lang.model.type.TypeVisitor
-dontwarn javax.lang.model.util.SimpleTypeVisitor8

# MediaPipe 는 네이티브(JNI)에서 이름으로 클래스를 찾는다. 줄이면 임베딩이 런타임에 죽는다.
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.mediapipe.**
