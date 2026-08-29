package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonAssignmentDetail
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown

private const val SUBMISSION_NOT_SUBMITTED = "not_submitted"
private const val SUBMISSION_SUBMITTED = "submitted"
private const val SUBMISSION_GRADED = "graded"

private fun submissionLabel(status: String): String =
    when (status) {
        SUBMISSION_SUBMITTED -> "Sudah dikumpulkan"
        SUBMISSION_GRADED -> "Sudah dinilai"
        else -> "Belum dikumpulkan"
    }

/**
 * Full-screen detail of a single assignment (mirrors the web DetailPanel but
 * as a pushed sub-screen). Loads `GET /api/kulon/assignments/:id/detail?cmid=`.
 * Shows the Markdown-rendered description, submission status, files and a link
 * to open the assignment in Kulon in the device browser.
 */
@Composable
fun AssignmentDetailScreen(
    repo: SsoRepository,
    assignment: KulonAssignment,
    onBack: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    FeatureScreen(assignment.name, onBack = onBack) {
        LoadableData(
            load = {
                repo.assignmentDetail(
                    assignmentId = assignment.assignmentId.takeIf { it > 0 } ?: assignment.id,
                    cmid = assignment.courseModuleId,
                )
            },
            emptyMessage = "Detail tugas tidak tersedia.",
        ) { detail ->
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                HeaderCard(assignment, detail)
                if (detail.descriptionMarkdown.isNotBlank()) {
                    DescriptionCard(detail.descriptionMarkdown)
                }
                SubmissionCard(detail)
                if (detail.files.isNotEmpty()) {
                    FilesCard(detail.files)
                }
                Button(
                    onClick = { uriHandler.openUri(detail.kulonUrl) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Buka di Kulon →")
                }
            }
        }
    }
}

@Composable
private fun HeaderCard(
    assignment: KulonAssignment,
    detail: KulonAssignmentDetail,
) {
    Card(
        Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                detail.name.ifBlank { assignment.name },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                assignment.course,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Deadline: ${epochToDate(assignment.duedate)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DescriptionCard(descriptionMarkdown: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                "Deskripsi",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = accentForeground(),
            )
            Spacer(Modifier.height(8.dp))
            if (descriptionMarkdown.trim().isEmpty()) {
                Text("Tidak ada deskripsi.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Markdown(content = descriptionMarkdown, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun SubmissionCard(detail: KulonAssignmentDetail) {
    val s = detail.submission
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                "Submission",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = accentForeground(),
            )
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Status", style = MaterialTheme.typography.bodyMedium)
                Text(
                    submissionLabel(s.status),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
            }
            if (s.submittedAt != null && s.submittedAt > 0) {
                Spacer(Modifier.height(4.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Dikumpulkan", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        epochToDate(s.submittedAt),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
            if (s.grade != null || s.maxGrade != null) {
                Spacer(Modifier.height(4.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Nilai", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${s.grade?.let { fmtNumber(it) } ?: "—"} / ${s.maxGrade?.let { fmtNumber(it) } ?: "—"}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun FilesCard(files: List<ac.undip.sso.core.network.KulonFile>) {
    val uriHandler = LocalUriHandler.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                "File",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = accentForeground(),
            )
            Spacer(Modifier.height(8.dp))
            files.forEach { f ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        f.name,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}

/** Format a Double grade avoiding a trailing ".0" (85.0 → "85"). */
private fun fmtNumber(v: Double): String =
    if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()
