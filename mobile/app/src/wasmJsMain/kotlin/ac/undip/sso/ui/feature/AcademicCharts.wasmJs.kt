package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * wasmJs placeholder for academic charts.
 * Android uses Canvas-based charts; wasmJs renders simple text summary.
 * TODO(F5): Replace with canvas-based chart CMP implementation.
 */
@Composable
internal actual fun AcademicCharts(repo: SsoRepository, refreshTick: Int) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Grafik Akademik",
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "(tersedia di perangkat Android)",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}