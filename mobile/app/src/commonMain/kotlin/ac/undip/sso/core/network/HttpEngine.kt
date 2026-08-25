package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig

/**
 * Platform-specific Ktor HttpClient factory.
 * androidMain: OkHttp engine with cert pinning for backend.crunchy.my.id.
 * The [configure] lambda receives the same [HttpClientConfig] that the engine
 * config block receives, so callers can add plugins like defaultRequest.
 */
internal expect fun createPlatformClient(
    configure: HttpClientConfig<*>.() -> Unit = {},
): HttpClient
