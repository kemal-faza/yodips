package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Aktif course ids (`timelineStatus == "inprogress"`), populated from
 * /api/kulon/courses so `taskBucket` matches web categorization (Perlu dikerjakan
 * hanya utk matkul semester berjalan).
 */
private data class CourseCtx(
    val activeCourseIds: Set<Long> = emptySet(),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(
    repo: SsoRepository,
    onOpenDetail: (KulonAssignment) -> Unit = {},
) {
    var ctx by remember { mutableStateOf(CourseCtx()) }
    FeatureScreen("Tugas") {
        suspend fun loadCtx(force: Boolean) {
            when (val r = repo.courses(force)) {
                is ApiResult.Success -> {
                    ctx =
                        CourseCtx(
                            activeCourseIds =
                                r.data
                                    .filter { it.timelineStatus == "inprogress" }
                                    .map { it.id }
                                    .toSet(),
                        )
                }

                is ApiResult.Error -> {
                    Unit
                }
            }
        }
        RefreshableLoadableData(
            load = {
                loadCtx(false)
                repo.assignments()
            },
            onRefresh = {
                loadCtx(true)
                repo.assignments(force = true)
            },
            emptyMessage = "Tidak ada tugas saat ini.",
        ) { tasks ->
            var filter by remember { mutableStateOf<TaskBucket?>(TaskBucket.NEED) }
            var showCount by remember { mutableStateOf(TASK_PAGE_SIZE) }
            var searchQuery by remember { mutableStateOf("") }
            // Switching filter resets the page back to the first chunk.
            LaunchedEffect(filter, searchQuery) { showCount = TASK_PAGE_SIZE }
            Column(Modifier.fillMaxSize()) {
                // Search bar (active on "Semua" and any bucket filter).
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    singleLine = true,
                    placeholder = { Text("Cari tugas…") },
                    leadingIcon = {
                        Icon(Icons.Outlined.Search, contentDescription = null)
                    },
                    trailingIcon = {
                        if (searchQuery.isNotBlank()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(Icons.Outlined.Close, contentDescription = "Hapus pencarian")
                            }
                        }
                    },
                )
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
                        .filter { filter == null || taskBucket(it, ctx.activeCourseIds) == filter }
                        .filter { filterTasksByQuery(it, searchQuery) }
                        .sortedBy { it.duedate }
                if (visible.isEmpty()) {
                    EmptyTasks(filter, searchQuery)
                } else {
                    val (page, remaining) = pagedTasks(visible, showCount)
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(page, key = { it.id }) { t ->
                            TaskCard(t, taskBucket(t, ctx.activeCourseIds), onClick = { onOpenDetail(t) })
                        }
                        if (remaining > 0) {
                            item(key = "load-more") {
                                LoadMoreTasks(remaining) { showCount += TASK_PAGE_SIZE }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun emptyTasksMessage(filter: TaskBucket?, searchQuery: String = ""): String =
    when {
        searchQuery.isNotBlank() -> "Tidak ada tugas yang cocok dengan pencarian."
        filter == null -> "Tidak ada tugas saat ini."
        filter == TaskBucket.NEED -> "Tidak ada tugas yang perlu dikerjakan. Kamu sudah beres."
        filter == TaskBucket.DONE -> "Belum ada tugas yang selesai dikerjakan."
        filter == TaskBucket.LATE -> "Tidak ada tugas terlambat."
        else -> "Tidak ada tugas saat ini."
    }

@Composable
private fun EmptyTasks(filter: TaskBucket?, searchQuery: String = "") {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Inbox, contentDescription = null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(56.dp))
            Text(
                emptyTasksMessage(filter, searchQuery),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
        }
    }
}

@Composable
private fun TaskCard(
    t: KulonAssignment,
    bucket: TaskBucket?,
    onClick: () -> Unit = {},
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors =
            if (bucket == TaskBucket.LATE) {
                CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
            } else {
                CardDefaults.cardColors()
            },
        onClick = onClick,
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    t.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = if (bucket == TaskBucket.LATE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    modifier = Modifier.weight(1f),
                )
                if (bucket != null) {
                    Spacer(Modifier.width(10.dp))
                    BucketPill(bucket)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(t.course, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Deadline: ${epochToDate(t.duedate)}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun BucketPill(bucket: TaskBucket) {
    val (container, content) =
        when (bucket) {
            TaskBucket.NEED -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer

            TaskBucket.DONE -> Color(0xFFE0F2E3) to Color(0xFF1B5E20)

            // Solid error so the pill stays visible on the errorContainer card bg.
            TaskBucket.LATE -> MaterialTheme.colorScheme.error to MaterialTheme.colorScheme.onError
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

/** Client-side page size for the tasks list (not all assignments render at once). */
internal const val TASK_PAGE_SIZE = 15

/** Case-insensitive match on task name or course name; blank query matches all. */
internal fun filterTasksByQuery(
    t: KulonAssignment,
    query: String,
): Boolean {
    val q = query.trim()
    if (q.isEmpty()) return true
    return t.name.contains(q, ignoreCase = true) || t.course.contains(q, ignoreCase = true)
}

/** Slice for one page of a sorted task list; returns (shown slice, how many remain).
 *  Kept pure so pagination behavior is unit-testable. */
internal fun <T> pagedTasks(
    list: List<T>,
    showCount: Int,
): Pair<List<T>, Int> {
    val safe = showCount.coerceAtLeast(0)
    val slice = list.take(safe)
    return slice to (list.size - slice.size).coerceAtLeast(0)
}

@Composable
private fun LoadMoreTasks(
    remaining: Int,
    onLoadMore: () -> Unit,
) {
    Button(
        onClick = onLoadMore,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text("Muat lebih banyak ($remaining lagi)")
    }
}
