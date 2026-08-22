// Top-level build file. Plugin versions come from gradle/libs.versions.toml.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    // FCM push (Task 6). Di-apply kondisional di app/build.gradle.kts — hanya
    // saat google-services.json ada, agar CI/fresh clone tetap build.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
