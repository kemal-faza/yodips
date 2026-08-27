import java.io.FileInputStream
import java.util.Properties
import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
// ^^ wasmJs target (Plan 3/F3)

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
        versionCode = 7
        versionName = "0.5.0"
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
    lint {
        // lintVitalAnalyzeRelease refuses to read Kotlin 2.3 metadata
        // ("Module was compiled with an incompatible version of Kotlin,
        // binary 2.3.0, expected 2.0.0") — the lint tooling is older than the
        // Kotlin plugin. The code is fine; only the lintVital gate trips. Keep
        // lint on normal builds (lintDebug still runs) but don't let it
        // block the release APK.
        checkReleaseBuilds = false
    }
}

kotlin {
    androidTarget {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        outputModuleName = "composeApp"
        browser {
            commonWebpackConfig {
                outputFileName = "composeApp.js"
            }
        }
        binaries.executable()
    }

    sourceSets {
        commonMain.dependencies {
            // Dipakai ui/theme/Theme.kt (T3):
            implementation(libs.compose.ui)
            implementation(libs.compose.foundation)
            implementation(libs.compose.runtime)
            // Material3 via CMP BOM (androidx.compose.material3:material3:1.5.0-alpha17 for CMP 1.11.1)
            // wasmJs target needs the CMP-published variant (has wasm-js variant).
            // androidMain keeps stable 1.4.0 via explicit override.
            implementation(compose.material3)
            implementation(libs.compose.components.resources)
            // Dibawa Task 4 — data+network stack di commonMain:
            implementation(libs.compose.ui.graphics)
            implementation(libs.compose.material.icons)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            // Coil 3 — dipakai ProfileScreen (T6a)
            implementation(libs.coil.compose)
            implementation(libs.coil.network.ktor3)
            // Navigation multiplatform (AppShell commonMain)
            implementation(libs.navigation.multiplatform)
            // Ktor client (F2) — core engine
            implementation(libs.ktor.client.core)
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
            implementation(libs.datastore.preferences)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            // Ktor client — core + OkHttp engine (androidMain, engine nyata)
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.okhttp)
            // CameraX + MLKit QR scan (absen presence)
            implementation(libs.androidx.camera.core)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.view)
            implementation(libs.mlkit.barcode)
        }
        androidUnitTest.dependencies {
            implementation(libs.junit)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        wasmJsMain.dependencies {
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.js)
            implementation(npm("jsqr", "1.4.0"))
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
    // Coil 3 — dipakai ProfileScreen
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
