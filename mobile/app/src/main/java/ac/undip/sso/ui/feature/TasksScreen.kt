package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.ui.common.LoadableData
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Tugas list grouped the same way as the web Kulon task page: a filter bar
 * (Semua / Perlu dikerjakan / Sudah dikerjakan / Terlambat) over the flat
 * list, each card tagged with its bucket. `null` filter = Semua.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(repo: SsoRepository) {
    FeatureScreen("Tugas") {
        LoadableData(load = { repo.assignments() }, emptyMessage = "Tidak ada tugas saat ini.") { tasks ->
            var filter by remember { mutableStateOf<TaskBucket?>(null) }
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(selected = filter == null, onClick = { filter = null }, label = { Text("Semua") })
                    TaskBucket.entries.forEach { b ->
                        FilterChip(selected = filter == b, onClick = { filter = b }, label = { Text(taskBucketLabel(b)) })
                    }
                }
                val visible =
                    tasks
                        .filter { filter == null || taskBucket(it) == filter }
                        .sortedBy { it.duedate }
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(visible, key = { it.id }) { t ->
                        TaskCard(t, taskBucket(t))
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskCard(
    t: KulonAssignment,
    bucket: TaskBucket,
) {
    Card(
        colors =
            if (bucket == TaskBucket.LATE) {
                CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
            } else {
                CardDefaults.cardColors()
            },
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                t.name,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = if (bucket == TaskBucket.LATE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
            )
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BucketPill(bucket)
                Text("${t.eventType}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(6.dp))
            Text("${t.course}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Deadline: ${epochToDate(t.duedate)}", style = MaterialTheme.typography.bodySmall)
            t.submissionStatus?.takeIf { it.isNotBlank() }?.let {
                Text(
                    "Status: $it",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun BucketPill(bucket: TaskBucket) {
    val (container, content) =
        when (bucket) {
            TaskBucket.NEED -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
            TaskBucket.DONE -> Color(0xFFE0F2E3) to Color(0xFF1B5E20)
            TaskBucket.LATE -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        }
    Surface(shape = RoundedCornerShape(50), color = container) {
        Text(
            taskBucketLabel(bucket),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = content,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}
