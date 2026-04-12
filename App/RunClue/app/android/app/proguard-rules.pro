# Flutter
-keep class io.flutter.** { *; }
-keep class io.flutter.embedding.** { *; }

# Google Maps
-keep class com.google.android.gms.maps.** { *; }
-keep class com.google.android.gms.location.** { *; }

# Google Play Core (deferred components)
-dontwarn com.google.android.play.core.**

# Supabase / GoTrue
-dontwarn io.supabase.**

# Keep annotations
-keepattributes *Annotation*
