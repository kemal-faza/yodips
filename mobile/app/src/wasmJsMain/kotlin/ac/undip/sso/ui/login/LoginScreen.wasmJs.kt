package ac.undip.sso.ui.login

import ac.undip.sso.appBaseUrl
import ac.undip.sso.core.data.TokenStoreLike
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.createPlatformClient
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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

// Alfabet Crockford 32 tanpa I/L/O/U (mirror core/scan/PairCodeExtract.kt;
// konstanta di sana private agar API-nya tetap satu fungsi extractPairCode).
private const val PAIR_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Sanitasi ketik bertahap: uppercase, buang spasi/dash, disambiguasi
 * O->0 / I->1 / L->1, buang non-Crockford, maksimal 8 karakter.
 */
private fun sanitizeTyped(raw: String): String =
    raw.uppercase()
        .replace(" ", "")
        .replace("-", "")
        .replace('O', '0')
        .replace('I', '1')
        .replace('L', '1')
        .filter { it in PAIR_CODE_ALPHABET }
        .take(CODE_LEN)

/**
 * Login pairing utk wasmJs: tampilan kode 1 baris (2 grup x 4 karakter) +
 * satu field tersembunyi penampung ketik + scan QR kamera.
 * - SEMUA ketik masuk ke SATU field tersembunyi (multi-field terbukti race di
 *   Compose-wasm: pindah-fokus per keystroke kalah cepat dari ketik GBoard).
 * - Sel hanya me-render karakter; tap area sel mem-fokus field tersembunyi.
 * - Penuh 8 (ketik/paste/scan) -> auto-submit.
 */
@Composable
fun LoginScreen(
    tokenStore: TokenStoreLike,
    onLoggedIn: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }

    fun setCodeFrom(raw: String): Boolean {
        val normalized = extractPairCode(raw) ?: return false
        code = normalized
        return true
    }

    fun submit() {
        if (code.length != CODE_LEN || busy) return
        busy = true
        scanning = false
        error = null
        scope.launch {
            try {
                val client = createPlatformClient()
                try {
                    val resp = client.post("${appBaseUrl}/api/auth/pair/consume") {
                        setBody("""{"code":"$code"}""")
                        contentType(ContentType.Application.Json)
                    }
                    val text = resp.bodyAsText()
                    if (resp.status.isSuccess()) {
                        val result = json.decodeFromString<PairConsumeResponse>(text)
                        tokenStore.save(result.accessToken, siap = null, kulon = null)
                        // WAJIB sebelum AppShell terbentuk: tanpa ini request
                        // terkirim tanpa Bearer -> 401 sampai hard-refresh.
                        Backend.authToken = result.accessToken
                        onLoggedIn()
                    } else {
                        val err = try {
                            json.decodeFromString<PairErrorResponse>(text)
                        } catch (_: Exception) {
                            PairErrorResponse("Gagal terhubung ke server", "NETWORK_ERROR")
                        }
                        error = when (err.code) {
                            "INVALID_CODE" -> "Kode tidak valid atau sudah pernah dipakai."
                            "EXPIRED_CODE" -> "Kode sudah kedaluwarsa. Minta kode baru."
                            "SESSION_DEAD" -> "Sesi asal sudah berakhir. Login ulang di perangkat utama."
                            else -> err.message.ifBlank { "Gagal terhubung ke server" }
                        }
                    }
                } finally {
                    client.close()
                }
            } catch (e: Exception) {
                error = "Gagal terhubung ke server: ${e.message}"
            } finally {
                busy = false
            }
        }
    }

    fun startScan() {
        if (busy || scanning) return
        scanning = true
        error = null
        scope.launch {
            when (val result = QrScanner.scanOnce()) {
                is QrScanResult.Success -> {
                    if (!setCodeFrom(result.token)) {
                        error = "QR bukan kode pairing YoDips."
                    }
                }

                is QrScanResult.Error -> error = result.message
                // User menutup scanner sendiri - kembali ke form tanpa pesan.
                QrScanResult.Cancelled -> Unit
            }
            scanning = false
        }
    }

    // Deep-link: ?pair=CODE auto-isi lalu submit.
    LaunchedEffect(Unit) {
        val params = jsUrlSearchParams("pair")
        if (params != null && setCodeFrom(params)) submit()
    }

    // Auto-submit saat 8 karakter penuh (hasil ketik maupun scan).
    LaunchedEffect(code) {
        if (code.length == CODE_LEN && !busy) submit()
    }

    // Surface eksplisit: canvas Compose transparan — bg wajib dari tema agar
    // teks selalu kontras di light & dark.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("YoDips", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(24.dp))

            OtpCodeInput(
                code = code,
                enabled = !busy,
                onCodeChange = { code = it },
                onDone = { submit() },
            )
            Spacer(Modifier.height(20.dp))

            Button(
                onClick = { submit() },
                enabled = code.length == CODE_LEN && !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Menyambungkan…" else "Masuk")
            }
            Spacer(Modifier.height(12.dp))

            OutlinedButton(
                onClick = { startScan() },
                enabled = !busy && !scanning,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (scanning) "Memindai…" else "Pindai QR")
            }
            if (scanning) {
                Spacer(Modifier.height(12.dp))
                CircularProgressIndicator()
            }

            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/**
 * Pola OTP standar: tampilan kode SATU BARIS — 2 grup kotak @4 karakter
 * (tanpa sel per-huruf) + SATU [OutlinedTextField] tersembunyi (alpha ~0.001)
 * yang menampung seluruh ketik. Tidak ada pindah-fokus antar-field — sumber
 * race Compose-wasm.
 *
 * - onValueChange menyaring via [sanitizeTyped]; caret dipaksa ke akhir
 *   sehingga ketik selalu append dan backspace selalu hapus karakter akhir.
 * - Overlay transparan menangkap semua tap -> focusRequester field
 *   tersembunyi (tap tak pernah menyentuh field itu sendiri, jadi posisi
 *   caret tidak pernah pindah ke tengah teks).
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
        // Field tersembunyi: penampung ketik tunggal. Value dikontrol penuh;
        // selection selalu di akhir agar caret tak pernah di tengah kode.
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
                disabledBorderColor = Color.Transparent,
                cursorColor = Color.Transparent,
            ),
        )

        // Tampilan 1 baris: 2 grup @4 karakter, posisi kosong = '_'.
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            CodeGroup(code.take(4).padEnd(4, '_'))
            CodeGroup(code.drop(4).padEnd(4, '_'))
        }

        // Overlay tangkap tap: fokuskan field tersembunyi di mana pun user
        // mengetuk area OTP.
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { hiddenFocus.requestFocus() },
        )
    }
}

/** Satu grup 4 karakter tampilan OTP: kotak ber-border berisi satu Text. */
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

@JsFun("(key) => { const p = new URLSearchParams(window.location.search); return p.get(key); }")
private external fun jsUrlSearchParams(key: String): String?
