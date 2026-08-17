package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import ac.undip.sso.ui.common.LoadableData
import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

// ===== Pure data helpers (mirror web src/utils/dashboard.ts) =====

private fun graded(s: SiapKhsSemester): Boolean = s.nilai.any { it.nilaiHuruf.trim().isNotEmpty() }

/** Per-semester IP for graded terms only (the on-going term has no grades → excluded). */
internal fun ipTrend(khs: SiapKhs): List<Pair<Int, Double>> = khs.semesters.filter { graded(it) }.mapIndexed { i, s -> (i + 1) to s.ip }

internal val GRADE_KEYS = listOf("A", "AB", "B", "BC", "C", "D", "E")

private val GRADE_COLORS =
    mapOf(
        "A" to Color(0xFF16A34A),
        "AB" to Color(0xFF22C55E),
        "B" to Color(0xFF3B82F6),
        "BC" to Color(0xFF6366F1),
        "C" to Color(0xFFF59E0B),
        "D" to Color(0xFFF97316),
        "E" to Color(0xFFDC2626),
    )

/** Letter-grade counts per graded semester (key = normalized grade, value = count). */
internal fun gradeRows(khs: SiapKhs): List<Pair<Int, Map<String, Int>>> =
    khs.semesters
        .filter { graded(it) }
        .mapIndexed { i, s ->
            val m = GRADE_KEYS.associateWith { 0 }.toMutableMap()
            s.nilai.forEach { n ->
                val k = n.nilaiHuruf.trim().uppercase()
                if (k in m) m[k] = m[k]!! + 1
            }
            (i + 1) to m
        }

/** Running cumulative SKS across semesters that carry SKS (incl. current term). */
internal fun sksCumulative(khs: SiapKhs): List<Pair<Int, Double>> {
    var running = 0.0
    return khs.semesters
        .filter { it.totalSks > 0 }
        .map {
            running += it.totalSks
            running
        }.mapIndexed { idx, value -> (idx + 1) to value }
}

// ===== Section that renders the three web charts =====

@Composable
fun AcademicCharts(repo: SsoRepository) {
    LoadableData(load = { repo.khs() }, emptyMessage = "Belum ada data nilai untuk grafik") { khs ->
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LineChartCard(
                title = "Tren Indeks Prestasi (IP)",
                subtitle = "Riwayat IP per semester",
                values = ipTrend(khs).map { it.second.toFloat() },
                yMax = 4f,
                fill = false,
            )
            GradeChartCard(khs)
            LineChartCard(
                title = "Akumulasi SKS",
                subtitle = "Pertumbuhan SKS menuju kelulusan",
                values = sksCumulative(khs).map { it.second.toFloat() },
                yMax = 160f,
                target = 144f,
                targetLabel = "Target 144 SKS",
                fill = true,
            )
        }
    }
}

@Composable
private fun ChartCard(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Card {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            if (subtitle.isNotBlank()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

@Composable
private fun LineChartCard(
    title: String,
    subtitle: String,
    values: List<Float>,
    yMax: Float,
    target: Float? = null,
    targetLabel: String? = null,
    fill: Boolean = false,
) {
    ChartCard(title, subtitle) {
        if (values.isEmpty()) EmptyInline() else AreaLineChart(values, yMax, target, targetLabel, fill)
    }
}

@Composable
private fun EmptyInline() {
    Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
        Text("Tidak ada data", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AreaLineChart(
    values: List<Float>,
    yMax: Float,
    target: Float?,
    targetLabel: String?,
    fill: Boolean,
) {
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)
    val lineColor = MaterialTheme.colorScheme.primary
    val errorColor = MaterialTheme.colorScheme.error
    Canvas(Modifier.fillMaxWidth().height(200.dp)) {
        val side = 30.dp.toPx()
        val bottom = 26.dp.toPx()
        val top = 16.dp.toPx()
        val px = 8.dp.toPx()
        val plotLeft = px + side
        val plotTop = top
        val plotRight = size.width - px
        val plotBottom = size.height - bottom
        val plotW = plotRight - plotLeft
        val plotH = plotBottom - plotTop
        val yMin = 0f
        val n = values.size

        fun xAt(i: Int): Float = if (n <= 1) plotLeft + plotW / 2 else plotLeft + plotW * i / (n - 1)

        fun yAt(v: Float): Float = plotTop + plotH * (1 - (v - yMin) / (yMax - yMin))

        for (g in 0..4) {
            val gy = plotTop + plotH * g / 4f
            drawLine(gridColor, Offset(plotLeft, gy), Offset(plotRight, gy), strokeWidth = 1f)
            drawScaledText(fmtValue(yMin + (yMax - yMin) * g / 4f), plotLeft - 6, gy + 4f, size = 20f, align = Paint.Align.RIGHT)
        }

        if (fill && n > 1) {
            val p =
                Path().apply {
                    moveTo(xAt(0), yAt(values[0]))
                    for (i in 1 until n) lineTo(xAt(i), yAt(values[i]))
                    lineTo(xAt(n - 1), plotBottom)
                    lineTo(xAt(0), plotBottom)
                    close()
                }
            drawPath(p, lineColor.copy(alpha = 0.15f))
        }

        if (n > 1) {
            val p =
                Path().apply {
                    moveTo(xAt(0), yAt(values[0]))
                    for (i in 1 until n) lineTo(xAt(i), yAt(values[i]))
                }
            drawPath(p, lineColor, style = Stroke(width = 2.5f))
        }

        values.forEachIndexed { i, v -> drawCircle(lineColor, radius = 3.5f, center = Offset(xAt(i), yAt(v))) }

        if (target != null) {
            val ty = yAt(target)
            drawLine(
                errorColor,
                Offset(plotLeft, ty),
                Offset(plotRight, ty),
                strokeWidth = 1.5f,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 10f)),
            )
            targetLabel?.let {
                drawScaledText(it, plotRight - 4, ty - 6f, size = 20f, color = errorColor, align = Paint.Align.RIGHT)
            }
        }

        (0 until n).forEach { i -> drawScaledText("${i + 1}", xAt(i), plotBottom + 18f, size = 20f, align = Paint.Align.CENTER) }
    }
}

@Composable
private fun GradeChartCard(khs: SiapKhs) {
    val rows = gradeRows(khs)
    ChartCard("Distribusi Nilai Huruf", "Perolehan grade per semester") {
        if (rows.isEmpty()) {
            EmptyInline()
        } else {
            val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)
            Canvas(Modifier.fillMaxWidth().height(170.dp)) {
                val side = 26.dp.toPx()
                val bottom = 26.dp.toPx()
                val top = 8.dp.toPx()
                val px = 8.dp.toPx()
                val plotLeft = px + side
                val plotRight = size.width - px
                val plotBottom = size.height - bottom
                val plotTop = top
                val plotW = plotRight - plotLeft
                val plotH = plotBottom - plotTop
                val n = rows.size
                val maxTotal = rows.maxOfOrNull { it.second.values.sum() }?.coerceAtLeast(1) ?: 1
                val slot = plotW / n
                val barW = slot * 0.55f

                for (g in 0..4) {
                    val gy = plotTop + plotH * g / 4f
                    drawLine(gridColor, Offset(plotLeft, gy), Offset(plotRight, gy), strokeWidth = 1f)
                    drawScaledText("${g * maxTotal / 4}", plotLeft - 6, gy + 4f, size = 20f, align = Paint.Align.RIGHT)
                }

                rows.forEachIndexed { i, (_, counts) ->
                    var acc = 0f
                    val cx = plotLeft + slot * i + (slot - barW) / 2
                    counts.entries.sortedBy { GRADE_KEYS.indexOf(it.key) }.forEach { (k, c) ->
                        if (c > 0) {
                            val bh = plotH * (c / maxTotal.toFloat())
                            val bo = plotTop + plotH - bh - acc
                            drawRect(GRADE_COLORS[k] ?: Color(0xFF888888), Offset(cx, bo), Size(barW, bh))
                            acc += bh
                        }
                    }
                }
                (0 until n).forEach { i ->
                    drawScaledText("${i + 1}", plotLeft + slot * i + slot / 2, plotBottom + 18f, size = 20f, align = Paint.Align.CENTER)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                GRADE_KEYS.forEach { k ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 3.dp)) {
                        Box(Modifier.size(8.dp).background(GRADE_COLORS[k] ?: Color(0xFF888888), CircleShape))
                        Text(" $k", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

private fun fmtValue(v: Float): String =
    if (kotlin.math.abs(v - kotlin.math.round(v)) < 0.05f) v.roundToInt().toString() else String.format("%.1f", v)

// ===== Text drawing on Canvas =====

private fun DrawScope.drawScaledText(
    text: String,
    x: Float,
    y: Float,
    size: Float,
    align: Paint.Align = Paint.Align.LEFT,
    color: Color = Color(0xFF616161),
) {
    val p =
        android.graphics.Paint().apply {
            this.textSize = size
            this.color = color.toArgb()
            this.textAlign = align
            this.isAntiAlias = true
        }
    drawContext.canvas.nativeCanvas.drawText(text, x, y, p)
}
