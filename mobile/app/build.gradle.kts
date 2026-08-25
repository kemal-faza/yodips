import java.io.FileInputStream
import java.util.Properties

// Secrets never live in the repo: `keystore.properties` is git-ignored and
// holds the release keystore path + passwords. Absent → release stays unsigned
// (an explicit warning) so CI / fresh clones still configure cleanly.
fun loadReleaseProps(): Properties? {
    val file = rootProject.file("keystore.properties")
    if (!file.exists()) return null
    val props = Properties()
    FileInputStream(file).use { props.load(it) }
    return props
}

fun releaseStoreFile(): java.io.File? {
    val props = loadReleaseProps() ?: return null
    return try {
        rootProject.file(props.getProperty("storeFile") ?: "keystore/undip-sso.jks")
    } catch (_: Exception) {
        null
    }
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.jetbrains.compose)
}

android {
    namespace = "ac.undip.sso"
    compileSdk = 35

    defaultConfig {
        applicationId = "ac.undip.sso"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.4.0"
    }

    signingConfigs {
        create("release") {
            val props = loadReleaseProps()
            if (props != null) {
                storeFile = rootProject.file(props.getProperty("storeFile") ?: "keystore/undip-sso.jks")
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        debug {
            // Emulator loopback → local backend (`npm run start:dev` di backend/).
            // Host ini satu-satunya yang boleh cleartext (src/debug/res/xml/
            // network_security_config.xml); jangan isi URL produksi di sini.
            buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:3000\"")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Produksi (Heroku di balik Cloudflare) — cert pin-nya ada di ApiClient.
            buildConfigField("String", "BASE_URL", "\"https://backend.crunchy.my.id\"")
            val storeFile = releaseStoreFile()
            if (storeFile != null && storeFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn("keystore.properties tidak ada — build release ini TIDAK ditanda-tangani.")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    sourceSets {
        commonMain.dependencies {
            // Dipakai ui/theme/Theme.kt (T3):
            implementation(libs.compose.ui)
            implementation(libs.compose.foundation)
            implementation(libs.compose.runtime)
            implementation(libs.androidx.material3)
            implementation(libs.compose.components.resources)
            // Dibawa Task 4 — data+network stack di commonMain (retrofit transit F1):
            implementation(libs.compose.ui.graphics)
            implementation(libs.compose.material.icons)
            implementation(libs.retrofit)
            implementation(libs.retrofit.kotlinx.serialization)
            implementation(libs.okhttp)
            implementation(libs.okhttp.logging)
            implementation(libs.kotlinx.serialization.json)
            // Coil 3 — dipakai ProfileScreen (T6a)
            implementation(libs.coil.compose)
            implementation(libs.coil.network.ktor3)
            // Navigation multiplatform (AppShell commonMain)
            implementation(libs.navigation.multiplatform)
        }
        androidMain.dependencies {
            implementation(libs.androidx.core.ktx)
            implementation(libs.androidx.lifecycle.runtime.ktx)
            implementation(libs.androidx.lifecycle.runtime.compose)
            implementation(libs.androidx.lifecycle.viewmodel.compose)
            implementation(libs.androidx.activity.compose)
            // CMP aliases masih di androidMain untuk UI files yang belum pindah
            implementation(libs.compose.ui)
            implementation(libs.compose.ui.graphics)
            implementation(libs.androidx.material3)
            implementation(libs.compose.material.icons)
            implementation(libs.compose.ui.tooling.preview)
            implementation(libs.datastore.preferences)
            // Retrofit/OkHttp transit — sudah di commonMain, tapi androidMain
            // tetap butuh karena androidMain masih ada file yang pakai (fallback)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            // CameraX + MLKit QR scan (absen presence)
            implementation(libs.androidx.camera.core)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.view)
            implementation(libs.mlkit.barcode)
        }
        androidUnitTest.dependencies {
            implementation(libs.junit)
            implementation(libs.mockwebserver)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
    }
}

// Generated Res accessor package — dipin agar import stabil sesuai rencana T3
// (`ac.undip.sso.ui.theme.Res`), bukan default `{group}.{module}.generated.resources`.
compose {
    resources {
        packageOfResClass = "ac.undip.sso.ui.theme"
    }
}

dependencies {
    // Coil 2 -> 3: satu-satunya pemakaian adalah coil.compose.AsyncImage di ProfileScreen
    implementation(libs.coil.compose)
    implementation(libs.coil.network.ktor3)   // fetcher jaringan Coil3
}

// Firebase hanya saat config ada — CI / fresh clone tidak membawa
// google-services.json sehingga apply tanpa syarat MEMECAHKAN build.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

dependencies {
    implementation("com.google.firebase:firebase-messaging:24.1.1")
}
