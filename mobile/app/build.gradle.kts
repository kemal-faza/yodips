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
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "ac.undip.sso"
    compileSdk = 35

    defaultConfig {
        applicationId = "ac.undip.sso"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "0.3.3"
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
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coil.compose)

    // CameraX + MLKit QR scan (absen presence)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode)

    testImplementation(libs.junit)
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Matches the coroutines version Gradle resolves (BOM 1.8.1) — needed for runTest.
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")

    debugImplementation(libs.androidx.ui.tooling)
}
