package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonContentItem
import ac.undip.sso.core.network.KulonCourseContent
import ac.undip.sso.core.network.KulonSection
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.theme.accentForeground
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private val KIND_LABEL: Map<String, String> = mapOf(
    "assign" to "Tugas",
    "quiz" to "Kuis",
    "url" to "Link",
    "forum" to "Forum",
    "page" to "Materi",
    "file" to "",
    "other" to "",
)

private fun kindIcon(kind: String): ImageVector =
    when (kind) {
        "file" -> Icons.Filled.Description
        "assign" -> Icons.Filled.PlayArrow
        "quiz" -> Icons.Filled.Help
        "url" -> Icons.Filled.Link
        "forum" -> Icons.Filled.Campaign
        "page" -> Icons.Filled.MenuBook
        else -> Icons.Filled.Description
    }

/** Badge teks untuk item — file: ekstensi (bila bukan other), lainnya: KIND_LABEL. */
internal fun itemBadge(item: KulonContentItem): String =
    if (item.kind == "file") {
        val ft = item.fileType
        if (ft.isNullOrBlank() || ft == "other") "" else ft
    } else {
        KIND_LABEL[item.kind] ?: ""
    }

/** Build KulonAssignment untuk route task/{id} — backend content tdk kirim assignmentId/duedate. */
internal fun assignmentFromItem(
    item: KulonContentItem,
    courseId: Long,
    courseName: String,
): KulonAssignment =
    KulonAssignment(
        id = item.cmid ?: 0L,
        name = item.name,
        module = "assign",
        eventType = "due",
        duedate = 0L,
        overdue = false,
        course = courseName,
        courseId = courseId,
        assignmentId = item.assignmentId ?: item.cmid ?: 0L,
        courseModuleId = item.cmid ?: 0L,
    )

internal fun isAssignmentOpenable(item: KulonContentItem): Boolean =
    item.kind == "assign" && item.cmid != null

@Composable
fun CourseDetailScreen(
    repo: SsoRepository,
    courseId: Long,
    courseName: String,
    semester: String?,
    onOpenAssignment: (KulonAssignment) -> Unit,
    onBack: () -> Unit,
) {
    FeatureScreen(courseName, onBack = onBack) {
        LoadableData(
            load = { repo.courseContent(courseId) },
            emptyMessage = "Mata kuliah tidak ditemukan.",
        ) { content ->
            CourseContent(content, semester, onOpenAssignment)
        }
    }
}

@Composable
private fun CourseContent(
    content: KulonCourseContent,
    semester: String?,
    onOpenAssignment: (KulonAssignment) -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    var collapsed by remember { mutableStateOf<Map<Long, Boolean>?>(null) }
    if (collapsed == null) {
        collapsed = defaultCollapsed(content.sections)
    }
    val collapse = collapsed ?: emptyMap()

    LazyColumn(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (!semester.isNullOrBlank()) {
            item(key = "semester") {
                Text(
                    semester,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(content.sections, key = { "sec-${it.id}" }) { section ->
            SectionCard(
                section = section,
                isCollapsed = collapse[section.id] ?: true,
                onToggle = { collapsed = collapse + (section.id to !(collapse[section.id] ?: true)) },
                onOpenItem = { item ->
                    if (isAssignmentOpenable(item)) {
                        onOpenAssignment(assignmentFromItem(item, content.courseId, ""))
                    } else if (item.url.isNotBlank()) {
                        uriHandler.openUri(item.url)
                    }
                },
            )
        }
    }
}

@Composable
private fun SectionCard(
    section: KulonSection,
    isCollapsed: Boolean,
    onToggle: () -> Unit,
    onOpenItem: (KulonContentItem) -> Unit,
) {
    Card(
        onClick = onToggle,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (isCollapsed) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        section.label,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (isCurrentWeekSection(section.dateRange)) {
                        Text(
                            "Minggu Ini",
                            style = MaterialTheme.typography.labelSmall,
                            color = accentForeground(),
                        )
                    }
                }
                if (!section.dateRange.isNullOrBlank()) {
                    Text(
                        section.dateRange,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
            if (!isCollapsed) {
                if (section.items.isEmpty()) {
                    Text(
                        "Tidak ada materi pada pertemuan ini.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp),
                    )
                } else {
                    Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp)) {
                        section.items.forEach { item ->
                            ItemRow(item, onClick = { onOpenItem(item) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(
    item: KulonContentItem,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(kindIcon(item.kind), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                item.name,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            val badge = itemBadge(item)
            if (badge.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Text(
                    badge,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
