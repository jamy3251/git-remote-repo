plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.baekdiscord.devhub"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.baekdiscord.devhub"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Google code scanner: QR scanning without a camera permission or a scanner UI of our own.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
