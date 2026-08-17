package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.sksKumulatif
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Weekday order used to sort schedule rows Senin-first (0) to Minggu (6). */
internal val dayOrder = listOf("senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu")

/** Rank of a raw SIAP day string for stable weekday ordering; unknown → after minggu. */
internal fun dayRank(hari: String): Int = dayOrder.indexOf(hari.trim().lowercase()).let { if (it < 0) dayOrder.size else it }

/** Capitalize a weekday name from SIAP's lowercase token ("jumat" → "Jumat", blank → ""). */
internal fun capitalizeDay(hari: String): String = if (hari.isBlank()) "" else hari.trim().replaceFirstChar { it.uppercase() }

internal fun epochToDate(epochSec: Long): String {
    if (epochSec <= 0) return "—"
    return Instant
        .ofEpochSecond(epochSec)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm"))
}

internal fun formatIpk(value: Double?): String = if (value == null) "—" else String.format("%.2f", value)

internal fun formatSks(value: Double?): String = if (value == null) "—" else ((if (value % 1.0 == 0.0) value.toInt() else value).toString())

@Composable
internal fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(2.dp))
            Text(
                value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Text(
        title,
        modifier = modifier,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
    )
}

/**
 * Cumulative IPK + SKS cards sourced from the authoritative KHS endpoint
 * (profile.ipk / profile.sksLulus are unreliable/absent). Until KHS loads it
 * renders placeholders so the row keeps its size instead of popping in.
 */
@Composable
internal fun AcademicStats(
    repo: SsoRepository,
    modifier: Modifier = Modifier,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var result by remember { mutableStateOf<ApiResult<SiapKhs>?>(null) }
    LaunchedEffect(attempt) { result = repo.khs() }
    val data = (result as? ApiResult.Success)?.data
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatCard("IPK", formatIpk(data?.ipk), Modifier.weight(1f))
        StatCard("SKS Kumulatif", formatSks(data?.sksKumulatif), Modifier.weight(1f))
    }
}
