package ac.undip.sso.ui.login

import ac.undip.sso.appBaseUrl
import ac.undip.sso.core.data.TokenStoreLike
import ac.undip.sso.core.network.createPlatformClient
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.coroutines.launch

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

@Composable
fun LoginScreen(
    tokenStore: TokenStoreLike,
    onLoggedIn: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val json = remember { Json { ignoreUnknownKeys = true } }

    fun normalize(input: String): String =
        input.uppercase()
            .replace('O', '0').replace('I', '1').replace('L', '1')

    fun submit() {
        val normalized = normalize(code)
        if (normalized.length != 8 || busy) return
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
                        tokenStore.save(result.accessToken, siap = null, kulon = null)
                        onLoggedIn()
                    } else {
                        val err = try {
                            json.decodeFromString<PairErrorResponse>(text)
                        } catch (_: Exception) {
                            PairErrorResponse("Gagal terhubung ke server", "NETWORK_ERROR")
                        }
                        error = when (err.code) {
                            "INVALID_CODE" -> "Kode tidak valid. Periksa kembali."
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

    LaunchedEffect(Unit) {
        val params = jsUrlSearchParams("pair")
        if (params != null) {
            code = params
            submit()
        }
    }

    // Surface eksplisit: canvas Compose transparan secara default — tanpa ini
    // background halaman (putih di index.html) tembus, dan teks putih tema gelap
    // jadi tak terlihat. Surface memastikan bg selalu = colorScheme.background.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("YoDips", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(8.dp))
            Text("Scan atau masukkan kode pairing dari perangkat utama")
            Spacer(Modifier.height(24.dp))

            OutlinedTextField(
                value = code,
                onValueChange = { if (it.length <= 8) code = normalize(it) },
                label = { Text("Kode pairing") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
                // Kode pairing Crockford uppercase: keyboard caps otomatis,
                // tanpa autocorrect, ascii saja.
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    // Eksplisit onSurface: default M3 (varian CMP alpha) pernah
                    // resolve ke warna yang menyatu dengan background.
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                    disabledTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline,
                    cursorColor = MaterialTheme.colorScheme.primary,
                ),
            )
            Spacer(Modifier.height(16.dp))

            Button(
                onClick = { submit() },
                enabled = code.length == 8 && !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Menyambungkan…" else "Masuk")
            }

            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@JsFun("(key) => { const p = new URLSearchParams(window.location.search); return p.get(key); }")
private external fun jsUrlSearchParams(key: String): String?