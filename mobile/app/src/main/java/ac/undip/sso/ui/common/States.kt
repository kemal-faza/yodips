package ac.undip.sso.ui.common

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Clamps a suspend data load into one of four states (Loading/Empty/Error/
 * Content) for every data screen. Screens pass their repository call as [load]
 * and render [content]; a failed source renders an inline error with retry
 * instead of blocking the whole screen (§ per-source resilience).
 */
@Composable
fun <T> LoadableData(
    load: suspend () -> ApiResult<T>,
    modifier: Modifier = Modifier,
    emptyMessage: String = "Belum ada data",
    content: @Composable (T) -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var result by remember { mutableStateOf<ApiResult<T>?>(null) }
    LaunchedEffect(attempt) {
        result = load()
    }
    when (val r = result) {
        null -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }

        is ApiResult.Success<*> -> {
            @Suppress("UNCHECKED_CAST")
            val data = (r as ApiResult.Success<T>).data
            val isEmpty = isEmpty(data)
            if (isEmpty) {
                EmptyState(modifier, emptyMessage)
            } else {
                content(data)
            }
        }

        is ApiResult.Error -> {
            ErrorState(modifier, r.message, onRetry = { attempt++ }, isUnauthorized = r.type == ErrorType.UNAUTHORIZED)
        }
    }
}

/** Heuristic: an empty collection / blank string counts as an empty state. */
private fun <T> isEmpty(data: T): Boolean =
    when (data) {
        is Collection<*> -> data.isEmpty()
        is String -> data.isBlank()
        is Map<*, *> -> data.isEmpty()
        else -> false
    }

@Composable
private fun EmptyState(
    modifier: Modifier,
    message: String,
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("—", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.outline)
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
        }
    }
}

@Composable
private fun ErrorState(
    modifier: Modifier,
    message: String,
    onRetry: () -> Unit,
    isUnauthorized: Boolean,
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(24.dp),
        ) {
            Text(
                if (isUnauthorized) "Sesi berakhir" else "Tidak dapat memuat data",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onRetry) { Text("Coba lagi") }
        }
    }
}
