package ac.undip.sso.ui.common

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.nowMs
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Clamps a suspend data load into one of four states (Loading/Empty/Error/
 * Content) for every data screen. Screens pass their repository call as [load]
 * and render [content]; a failed source renders an inline error with retry
 * instead of blocking the whole screen (§ per-source resilience).
 *
 * The loading branch renders [loading] (a skeleton by default) instead of a
 * centered spinner: a cold load can take many seconds, and a skeleton keeps the
 * page's shape so the arrival of data does not re-lay-out the whole screen.
 */
@Composable
fun <T> LoadableData(
    load: suspend () -> ApiResult<T>,
    modifier: Modifier = Modifier,
    emptyMessage: String = "Belum ada data",
    refreshTrigger: Int = 0,
    loading: @Composable () -> Unit = { ListSkeleton() },
    content: @Composable (T) -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var result by remember { mutableStateOf<ApiResult<T>?>(null) }
    LaunchedEffect(attempt, refreshTrigger) {
        result = load()
    }
    when (val r = result) {
        null -> loading()

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
            ErrorState(modifier, r.message, onRetry = { attempt++ }, isUnauthorized = r.type == ErrorType.UNAUTHORIZED || r.type == ErrorType.STALE_SESSION)
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

/**
 * Pull-to-refresh variant of [LoadableData]. Same four-state machine, but the
 * rendered state sits inside a Material3 [PullToRefreshBox]; pulling invokes
 * [onRefresh] (normally a cache-bypassing force fetch) so pulled data is always
 * fresh, while the first load / retry uses [load] (cache-respecting).
 *
 * Anti-spam: [minRefreshIntervalMs] is the minimum gap between two refreshes;
 * pulls faster than that are ignored, so accidental repeated pulls can't
 * hammer the backend. Never sets [isRefreshing] when a pull is throttled.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> RefreshableLoadableData(
    load: suspend () -> ApiResult<T>,
    onRefresh: suspend () -> ApiResult<T>,
    modifier: Modifier = Modifier,
    emptyMessage: String = "Belum ada data",
    minRefreshIntervalMs: Long = REFRESH_COOLDOWN_MS,
    loading: @Composable () -> Unit = { ListSkeleton() },
    content: @Composable (T) -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var result by remember { mutableStateOf<ApiResult<T>?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val lastRefreshAt = remember { arrayOf(0L) }

    LaunchedEffect(attempt) {
        if (attempt > 0) isRefreshing = true
        result = load()
        isRefreshing = false
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            val now = nowMs()
            if (now - lastRefreshAt[0] < minRefreshIntervalMs) return@PullToRefreshBox
            lastRefreshAt[0] = now
            isRefreshing = true
            scope.launch {
                result = onRefresh()
                isRefreshing = false
            }
        },
        modifier = modifier.fillMaxSize(),
    ) {
        when (val r = result) {
            null -> loading()

            is ApiResult.Success<*> -> {
                @Suppress("UNCHECKED_CAST")
                val data = (r as ApiResult.Success<T>).data
                if (isEmpty(data)) {
                    EmptyState(modifier, emptyMessage)
                } else {
                    content(data)
                }
            }

            is ApiResult.Error -> {
                ErrorState(modifier, r.message, onRetry = { attempt++ }, isUnauthorized = r.type == ErrorType.UNAUTHORIZED || r.type == ErrorType.STALE_SESSION)
            }
        }
    }
}

/** Minimum gap between two pull-to-refresh network calls (anti-spam). */
const val REFRESH_COOLDOWN_MS = 15_000L

// ===== Skeletons =====
// Blok abu-abu berdenyut yang menahan bentuk halaman selama muat pertama.
// SkeletonGroup menghitung SATU denyut untuk seluruh grup (bukan satu animasi
// per blok); SkeletonBlock hanya menggambar.

/** Alpha blok skeleton; [SkeletonGroup] mengganti nilainya tiap frame. */
private val LocalSkeletonAlpha = compositionLocalOf { 0.18f }

/**
 * Bungkus sekumpulan [SkeletonBlock] dengan satu denyut halus bersama. Tanpa
 * grup, blok tetap tergambar (alpha statis) — skeleton tidak pernah menghilang.
 */
@Composable
fun SkeletonGroup(content: @Composable () -> Unit) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by
        transition.animateFloat(
            initialValue = 0.11f,
            targetValue = 0.22f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 900, easing = LinearEasing), RepeatMode.Reverse),
            label = "skeletonAlpha",
        )
    CompositionLocalProvider(LocalSkeletonAlpha provides alpha) { content() }
}

@Composable
fun SkeletonBlock(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(8.dp),
) {
    Box(modifier.background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = LocalSkeletonAlpha.current), shape))
}

/** Placeholder satu layar daftar: beberapa kartu setinggi [rowHeight]. */
@Composable
fun ListSkeleton(
    rows: Int = 4,
    modifier: Modifier = Modifier,
    rowHeight: Dp = 88.dp,
) {
    SkeletonGroup {
        Column(
            modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            repeat(rows) {
                SkeletonBlock(
                    Modifier
                        .fillMaxWidth()
                        .height(rowHeight),
                    shape = RoundedCornerShape(12.dp),
                )
            }
        }
    }
}

@Composable
private fun EmptyState(
    modifier: Modifier,
    message: String,
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Inbox, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(56.dp))
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
