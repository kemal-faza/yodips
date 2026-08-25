// Top-level build file. Plugin versions come from gradle/libs.versions.toml.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.jetbrains.compose) apply false
    // WAJIB ada (review #4-HIGH): app/build.gradle.kts meng-aply plugin ini via string id
    // kondisional google-services.json; tanpa deklarasi di root, resolusi plugin gagal.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
