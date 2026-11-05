package ac.undip.sso.ui.login

import ac.undip.sso.appBaseUrl
import ac.undip.sso.core.data.TokenStoreLike
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.BackendCodes
import ac.undip.sso.core.network.UserMessages
import ac.undip.sso.core.network.createPlatformClient
import ac.undip.sso.core.scan.CameraRegion
import ac.undip.sso.core.scan.QrScanResult
import ac.undip.sso.core.scan.QrScanner
import ac.undip.sso.core.scan.extractPairCode
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.roundToInt

@Serializable
private data class PairConsumeResponse(
    val accessToken: String = "",
    val hasKulon: Boolean = false,
    val hasSiap: Boolean = false,
)

@Serializable
private data class PairErrorResponse(
    val message: String = "",
    val code: String = "",
)

/** Jumlah sel OTP = panjang kode pairing Crockford. */
private const val CODE_LEN = 8

/** Harus sama dengan TERMS_VERSION di web/src/views/LoginView.vue. */
private const val CONSENT_VERSION = "2026-09-20"

private const val PAIR_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

private enum class LoginMode { Landing, Scanning, Code }

/** Sanitasi ketik: uppercase, buang spasi/dash, O→0, I/L→1, maks 8. */
private fun sanitizeTyped(raw: String): String =
    raw.uppercase()
        .replace(" ", "")
        .replace("-", "")
        .replace('O', '0')
        .replace('I', '1')
        .replace('L', '1')
        .filter { it in PAIR_CODE_ALPHABET }
        .take(CODE_LEN)

@Composable
fun LoginScreen(
    tokenStore: TokenStoreLike,
    onLoggedIn: () -> Unit,
) {
    var mode by remember { mutableStateOf(LoginMode.Landing) }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var consent by remember { mutableStateOf(jsReadConsent() == CONSENT_VERSION) }
    var region by remember { mutableStateOf<CameraRegion?>(null) }
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }
    val density = LocalDensity.current.density

    fun saveConsent(value: Boolean) {
        if (!value) {
            jsWriteConsent(null)
            consent = false
            return
        }
        // Mode privat / storage diblokir: gate tetap tertutup (spec §6.6).
        if (jsWriteConsent(CONSENT_VERSION)) {
            consent = true
        } else {
            error = "Penyimpanan browser diblokir. Izinkan penyimpanan situs untuk melanjutkan."
        }
    }

    fun submit(raw: String) {
        val normalized = sanitizeTyped(raw)
        if (normalized.length != CODE_LEN || busy || !consent) return
        busy = true
        error = null
        scope.launch {
            try {
                val client = createPlatformClient()
                try {
                    val resp = client.post("${appBaseUrl}/api/auth/pair/consume") {
                        setBody("""{"code":"$normalized"}""")
                        contentType(ContentType.Application.Json)
                    }
                    val text = resp.bodyAsText()
                    if (resp.status.isSuccess()) {
                        val result = json.decodeFromString<PairConsumeResponse>(text)
                        jsScrubPairQuery()
                        tokenStore.save(result.accessToken, siap = null, kulon = null)
                        Backend.authToken = result.accessToken
                        onLoggedIn()
                    } else {
                        code = ""
                        val err = try {
                            json.decodeFromString<PairErrorResponse>(text)
                        } catch (_: Exception) {
                            PairErrorResponse("", "NETWORK_ERROR")
                        }
                        error = when {
                            resp.status.value == 429 ->
                                "Terlalu banyak percobaan. Tunggu ±1 menit."
                            err.code == BackendCodes.INVALID_CODE ->
                                "Kode tidak valid atau sudah dipakai. Minta kode baru."
                            err.code == BackendCodes.EXPIRED_CODE ->
                                "Kode sudah kedaluwarsa. Minta kode baru."
                            err.code == BackendCodes.SESSION_DEAD ->
                                "Sesi di perangkat sumber sudah berakhir. Login ulang di sana lalu minta kode baru."
                            else -> UserMessages.PAIR_FAILED
                        }
                    }
                } finally {
                    client.close()
                }
            } catch (_: Exception) {
                code = ""
                error = UserMessages.NETWORK
            } finally {
                busy = false
            }
        }
    }

    // Deep link ?pair=CODE: langsung ke mode kode, tanpa kamera.
    LaunchedEffect(Unit) {
        val raw = jsUrlSearchParams("pair") ?: return@LaunchedEffect
        val normalized = extractPairCode(raw) ?: return@LaunchedEffect
        code = normalized
        mode = LoginMode.Code
    }

    // Auto-open kamera hanya bila izin pernah diberikan dan tidak ada deep link.
    LaunchedEffect(Unit) {
        if (consent && jsCameraOk() && jsUrlSearchParams("pair") == null) {
            mode = LoginMode.Scanning
        }
    }

    // Auto-submit: hanya saat kode lengkap DAN persetujuan tersimpan.
    LaunchedEffect(code, consent, mode) {
        if (mode == LoginMode.Code && consent && code.length == CODE_LEN && !busy) {
            submit(code)
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = if (mode == LoginMode.Scanning) Arrangement.Top else Arrangement.Center,
        ) {
            Text("YoDips", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(16.dp))

            when (mode) {
                LoginMode.Landing -> {
                    Text(
                        "Pindai QR dari perangkat yang sudah login",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(20.dp))
                    Button(
                        onClick = {
                            region = null
                            mode = LoginMode.Scanning
                        },
                        enabled = consent,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Pindai QR") }
                    Spacer(Modifier.height(12.dp))
                    TextButton(
                        onClick = { mode = LoginMode.Code },
                        enabled = consent,
                    ) { Text("Masukkan kode manual") }
                    Spacer(Modifier.height(20.dp))
                    ConsentRow(
                        consent = consent,
                        onConsent = { saveConsent(it) },
                        onOpen = { path -> jsOpenUrl(jsOrigin() + path) },
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Belum punya perangkat yang login? Login di Chrome desktop dengan extension YoDips.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                LoginMode.Scanning -> {
                    Text(
                        "Arahkan kamera ke QR di layar perangkat lain",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .onGloballyPositioned { coords ->
                                // Ukur sekali saja. Memperbarui region tiap
                                // layout membuat LaunchedEffect(mode, region)
                                // restart di tengah getUserMedia dan
                                // meninggalkan overlay kamera yatim.
                                if (region == null) {
                                    val b = coords.boundsInWindow()
                                    if (b.width > 0f && b.height > 0f) {
                                        region = CameraRegion(
                                            left = (b.left / density).roundToInt(),
                                            top = (b.top / density).roundToInt(),
                                            width = (b.width / density).roundToInt(),
                                            height = (b.height / density).roundToInt(),
                                        )
                                    }
                                }
                            },
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = { mode = LoginMode.Code },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Masukkan kode manual") }
                    TextButton(onClick = { mode = LoginMode.Landing }) { Text("Batal") }
                }

                LoginMode.Code -> {
                    OtpCodeInput(
                        code = code,
                        enabled = !busy,
                        onCodeChange = { code = it },
                        onDone = { submit(code) },
                    )
                    Spacer(Modifier.height(20.dp))
                    if (!consent) {
                        ConsentRow(
                            consent = consent,
                            onConsent = { saveConsent(it) },
                            onOpen = { path -> jsOpenUrl(jsOrigin() + path) },
                        )
                        Spacer(Modifier.height(12.dp))
                    }
                    TextButton(
                        onClick = {
                            region = null
                            mode = LoginMode.Scanning
                        },
                    ) { Text("Pindai QR") }
                    if (error != null) {
                        Spacer(Modifier.height(12.dp))
                        Text(error!!, color = MaterialTheme.colorScheme.error)
                    }
                    if (busy) {
                        Spacer(Modifier.height(12.dp))
                        CircularProgressIndicator()
                    }
                }
            }
        }
    }

    // Pemindaian dimulai hanya setelah region terukur. Perubahan mode
    // membatalkan LaunchedEffect → scanOnce dibatalkan → jsStopCamera di finally.
    LaunchedEffect(mode, region) {
        if (mode != LoginMode.Scanning) return@LaunchedEffect
        val r = region ?: return@LaunchedEffect
        if (r.width <= 0 || r.height <= 0) return@LaunchedEffect
        when (val result = QrScanner.scanOnce(r)) {
            is QrScanResult.Success -> {
                val normalized = extractPairCode(result.token)
                if (normalized == null) {
                    error = "QR bukan kode pairing YoDips."
                } else {
                    jsSetCameraOk()
                    code = normalized
                }
                mode = LoginMode.Code
            }

            is QrScanResult.Error -> {
                jsClearCameraOk()
                error = result.message
                mode = LoginMode.Code
            }

            QrScanResult.Cancelled -> Unit
        }
    }
}

@Composable
private fun ConsentRow(
    consent: Boolean,
    onConsent: (Boolean) -> Unit,
    onOpen: (String) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = consent, onCheckedChange = onConsent)
        Text("Saya menyetujui ", style = MaterialTheme.typography.bodySmall)
        Text(
            "Syarat",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { onOpen("/terms") },
        )
        Text(" dan ", style = MaterialTheme.typography.bodySmall)
        Text(
            "Privasi",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { onOpen("/privacy") },
        )
    }
}

/**
 * Pola OTP standar: tampilan kode SATU BARIS — 2 grup kotak @4 karakter
 * (tanpa sel per-huruf) + SATU [OutlinedTextField] tersembunyi (alpha ~0.001)
 * yang menampung seluruh ketik. Tidak ada pindah-fokus antar-field — sumber
 * race Compose-wasm.
 */
@Composable
private fun OtpCodeInput(
    code: String,
    enabled: Boolean,
    onCodeChange: (String) -> Unit,
    onDone: () -> Unit,
) {
    val hiddenFocus = remember { FocusRequester() }

    Box {
        OutlinedTextField(
            value = TextFieldValue(code, TextRange(code.length)),
            onValueChange = { raw ->
                val sanitized = sanitizeTyped(raw.text)
                if (sanitized != code) onCodeChange(sanitized)
            },
            modifier = Modifier
                .matchParentSize()
                .focusRequester(hiddenFocus)
                .alpha(0.001f),
            singleLine = true,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Ascii,
                capitalization = KeyboardCapitalization.Characters,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = Color.Transparent,
                unfocusedTextColor = Color.Transparent,
                disabledTextColor = Color.Transparent,
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
                focusedBorderColor = Color.Transparent,
                unfocusedBorderColor = Color.Transparent,
                cursorColor = Color.Transparent,
            ),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            CodeGroup(code.take(4).padEnd(4, '_'))
            CodeGroup(code.drop(4).padEnd(4, '_'))
        }

        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { hiddenFocus.requestFocus() },
        )
    }
}

@Composable
private fun CodeGroup(text: String) {
    Box(
        modifier = Modifier
            .size(width = 108.dp, height = 56.dp)
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(4.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(4.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(key) => { const p = new URLSearchParams(window.location.search); return p.get(key); }")
private external fun jsUrlSearchParams(key: String): String?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { try { return localStorage.getItem('yodips_terms_accepted') } catch (e) { return null } }")
private external fun jsReadConsent(): String?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(v) => { try { if (v === null) localStorage.removeItem('yodips_terms_accepted'); else localStorage.setItem('yodips_terms_accepted', v); return true } catch (e) { return false } }")
private external fun jsWriteConsent(v: String?): Boolean

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { try { return localStorage.getItem('yodips_camera_ok') === '1' } catch (e) { return false } }")
private external fun jsCameraOk(): Boolean

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { try { localStorage.setItem('yodips_camera_ok', '1') } catch (e) {} }")
private external fun jsSetCameraOk()

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { try { localStorage.removeItem('yodips_camera_ok') } catch (e) {} }")
private external fun jsClearCameraOk()

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { try { history.replaceState(history.state, '', '/app/') } catch (e) {} }")
private external fun jsScrubPairQuery()

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => window.location.origin")
private external fun jsOrigin(): String

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(u) => { try { window.open(u, '_blank', 'noopener,noreferrer') } catch (e) {} }")
private external fun jsOpenUrl(u: String)
