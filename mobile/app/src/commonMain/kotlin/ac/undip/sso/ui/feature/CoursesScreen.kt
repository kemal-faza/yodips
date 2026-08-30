package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MenuBook
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun CoursesScreen(
    repo: SsoRepository,
    onOpenCourse: (KulonCourse) -> Unit,
    onBack: () -> Unit,
) {
    FeatureScreen("Mata Kuliah", onBack = onBack) {
        LoadableData(
            load = { repo.courses() },
            emptyMessage = "Belum ada mata kuliah yang diambil",
        ) { courses ->
            CoursesContent(courses, onOpenCourse)
        }
    }
}

@Composable
private fun CoursesContent(
    courses: List<KulonCourse>,
    onOpenCourse: (KulonCourse) -> Unit,
) {
    val active = activeCourses(courses)
    val past = pastCourses(courses)
    val semSub = actualSemester(active)
    val pastGroups = groupCoursesBySemester(past)
    var pastExpanded by remember { mutableStateOf(false) }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ── Aktif ──
        item(key = "header-active") {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Aktif", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = accentForeground())
                if (semSub != null) {
                    Text(semSub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (active.isEmpty()) {
            item(key = "active-empty") {
                Text(
                    "Belum ada mata kuliah aktif di semester ini.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }
        } else {
            items(active, key = { "active-${it.id}" }) { course ->
                CourseCard(course = course, active = true, onClick = { onOpenCourse(course) })
            }
        }

        // ── Sebelumnya ──
        if (pastGroups.isNotEmpty()) {
            item(key = "past-toggle") {
                PastToggle(pastExpanded, past.size) { pastExpanded = !pastExpanded }
            }
            if (pastExpanded) {
                pastGroups.forEach { (sem, list) ->
                    item(key = "sem-$sem") {
                        Text(
                            sem,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(list, key = { "past-${it.id}" }) { course ->
                        CourseCard(course = course, active = false, onClick = { onOpenCourse(course) })
                    }
                }
            }
        }
    }
}

@Composable
private fun CourseCard(
    course: KulonCourse,
    active: Boolean,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.MenuBook,
                contentDescription = null,
                tint = accentForeground(),
                modifier = Modifier.size(24.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    course.fullname.ifBlank { course.shortname },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val sub = buildList {
                    if (active) add("Aktif")
                    course.semester?.takeIf { it.isNotBlank() }?.let { add(it) }
                    course.lecturer?.takeIf { it.isNotBlank() }?.let { add(it) }
                }.joinToString(" · ")
                if (sub.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        sub,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PastToggle(
    expanded: Boolean,
    count: Int,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (expanded) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Mata Kuliah Sebelumnya",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "($count mata kuliah)",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
