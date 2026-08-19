package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import ac.undip.sso.ui.common.LoadableData
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
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

// ===== Hit-testing helpers (pure, unit-tested) =====

/** Horizontal pixel distance between consecutive points of an n-point series. */
internal fun lineSlot(plotLeft: Float, plotRight: Float, n: Int): Float =
    if (n <= 1) 0f else (plotRight - plotLeft) / (n - 1)

/** Nearest point index for a tap/drag x on a line chart; clamped to the series. */
internal fun nearestLineIndex(
    x: Float,
    plotLeft: Float,
    slot: Float,
    n: Int,
): Int =
    when {
        n <= 1 -> 0
        slot <= 0f -> 0
        else -> ((x - plotLeft) / slot).roundToInt().coerceIn(0, n - 1)
    }

/** Stacked-bar slot index for a tap/drag x; clamped to the bar count. */
internal fun barIndex(
    x: Float,
    plotLeft: Float,
    slot: Float,
    n: Int,
): Int =
    when {
        n <= 1 -> 0
        slot <= 0f -> 0
        else -> ((x - plotLeft) / slot).toInt().coerceIn(0, n - 1)
    }

// ===== Section that renders the three web charts =====

@Composable
fun AcademicCharts(
    repo: SsoRepository,
    refreshTick: Int = 0,
) {
    LoadableData(load = { repo.khs() }, emptyMessage = "Belum ada data nilai untuk grafik", refreshTrigger = refreshTick) { khs ->
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
    var hoverIndex by remember { mutableStateOf<Int?>(null) }
    val density = LocalDensity.current
    val tooltipBg = MaterialTheme.colorScheme.inverseSurface
    val tooltipFg = MaterialTheme.colorScheme.inverseOnSurface

    BoxWithConstraints(Modifier.fillMaxWidth().height(200.dp)) {
        val n = values.size
        val side = with(density) { 30.dp.toPx() }
        val bottom = with(density) { 26.dp.toPx() }
        val top = with(density) { 16.dp.toPx() }
        val px = with(density) { 8.dp.toPx() }
        val plotLeft = px + side
        val plotTop = top
        val plotRight = with(density) { maxWidth.toPx() } - px
        val plotBottom = with(density) { maxHeight.toPx() } - bottom
        val plotW = plotRight - plotLeft
        val plotH = plotBottom - plotTop
        val yMin = 0f
        val slot = lineSlot(plotLeft, plotRight, n)

        fun xAt(i: Int): Float = if (n <= 1) plotLeft + plotW / 2 else plotLeft + plotW * i / (n - 1)
        fun yAt(v: Float): Float = plotTop + plotH * (1 - (v - yMin) / (yMax - yMin))
        fun reveal(x: Float) {
            hoverIndex = nearestLineIndex(x, plotLeft, slot, n)
        }

        // Wrap Canvas in a Box so gesture modifiers resolve cleanly — Canvas
        // receives only drawing (no pointer chain) and Box handles the touch.
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(values.size, plotLeft, slot, n) {
                    detectTapGestures { off -> reveal(off.x) }
                }
                .pointerInput(values.size, plotLeft, slot, n) {
                    detectHorizontalDragGestures(
                        onDragStart = { off -> reveal(off.x) },
                        onHorizontalDrag = { change, _ ->
                            change.consume()
                            reveal(change.position.x)
                        },
                    )
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
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

            val hi = hoverIndex
            if (hi != null && hi in values.indices) {
                val cx = xAt(hi)
                val cy = yAt(values[hi])
                drawLine(lineColor.copy(alpha = 0.35f), Offset(cx, plotTop), Offset(cx, plotBottom), strokeWidth = 1.5f)
                drawCircle(lineColor, radius = 8f, center = Offset(cx, cy))
                drawCircle(Color.White, radius = 3f, center = Offset(cx, cy))
                drawTooltip(listOf("Semester ${hi + 1} · ${fmtValue(values[hi])}"), cx, cy - with(density) { 20.dp.toPx() }, tooltipBg, tooltipFg)
            }
        }
    }
}

}

@Composable
private fun GradeChartCard(khs: SiapKhs) {
    val rows = gradeRows(khs)
    ChartCard("Distribusi Nilai Huruf", "Perolehan grade per semester") {
        if (rows.isEmpty()) {
            EmptyInline()
        } else {
            var hoverIndex by remember { mutableStateOf<Int?>(null) }
            val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)
            val density = LocalDensity.current
            val tooltipBg = MaterialTheme.colorScheme.inverseSurface
            val tooltipFg = MaterialTheme.colorScheme.inverseOnSurface
            BoxWithConstraints(Modifier.fillMaxWidth().height(170.dp)) {
                val n = rows.size
                val side = with(density) { 26.dp.toPx() }
                val bottom = with(density) { 26.dp.toPx() }
                val top = with(density) { 8.dp.toPx() }
                val px = with(density) { 8.dp.toPx() }
                val plotLeft = px + side
                val plotRight = with(density) { maxWidth.toPx() } - px
                val plotBottom = with(density) { maxHeight.toPx() } - bottom
                val plotTop = top
                val plotW = plotRight - plotLeft
                val plotH = plotBottom - plotTop
                val maxTotal = rows.maxOfOrNull { it.second.values.sum() }?.coerceAtLeast(1) ?: 1
                val slot = plotW / n
                val barW = slot * 0.55f
                val barCenter: (Int) -> Float = { i -> plotLeft + slot * i + slot / 2 }

                fun reveal(x: Float) {
                    hoverIndex = barIndex(x, plotLeft, slot, n)
                }

                Box(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(n, plotLeft, slot) { detectTapGestures { off -> reveal(off.x) } }
                        .pointerInput(n, plotLeft, slot) {
                            detectHorizontalDragGestures(
                                onDragStart = { off -> reveal(off.x) },
                                onHorizontalDrag = { change, _ ->
                                    change.consume()
                                    reveal(change.position.x)
                                },
                            )
                        },
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                    for (g in 0..4) {
                        val gy = plotTop + plotH * g / 4f
                        drawLine(gridColor, Offset(plotLeft, gy), Offset(plotRight, gy), strokeWidth = 1f)
                        drawScaledText("${g * maxTotal / 4}", plotLeft - 6, gy + 4f, size = 20f, align = Paint.Align.RIGHT)
                    }

                    rows.forEachIndexed { i, (_, counts) ->
                        var acc = 0f
                        val cx = barCenter(i)
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
                        drawScaledText("${i + 1}", barCenter(i), plotBottom + 18f, size = 20f, align = Paint.Align.CENTER)
                    }

                    val hi = hoverIndex
                    if (hi != null && hi in rows.indices) {
                        val (_, counts) = rows[hi]
                        val cx = barCenter(hi)
                        drawLine(gridColor.copy(alpha = 0.7f), Offset(cx, plotTop), Offset(cx, plotBottom), strokeWidth = 1.5f)
                        val lines =
                            buildList {
                                add("Semester ${hi + 1}")
                                counts.entries.sortedBy { GRADE_KEYS.indexOf(it.key) }.forEach { (k, c) ->
                                    if (c > 0) add("$k : $c")
                                }
                                if (size == 1) add("Tidak ada data")
                            }
                        drawTooltip(lines, cx, plotBottom, tooltipBg, tooltipFg)
                    }
                    }
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

/**
 * Rounded tooltip chip drawn above `anchor` on the canvas. Multi-line for the
 * stacked-bar reader (header + per-grade rows) and single-line for line charts.
 * Clamped left/right/top so it never falls outside the canvas.
 */
private fun DrawScope.drawTooltip(
    lines: List<String>,
    anchorX: Float,
    anchorY: Float,
    background: Color,
    textColor: Color,
) {
    if (lines.isEmpty()) return
    val paint =
        Paint().apply {
            textSize = 22.dp.toPx()
            isAntiAlias = true
            typeface = Typeface.DEFAULT_BOLD
        }
    val padX = 8.dp.toPx()
    val padY = 5.dp.toPx()
    val lineH = 25.dp.toPx()
    val boxW = lines.maxOf { paint.measureText(it) } + padX * 2
    val boxH = lines.size * lineH + padY * 2
    val left = (anchorX - boxW / 2).coerceIn(2.dp.toPx(), size.width - boxW - 2.dp.toPx())
    val top = (anchorY - boxH - 6.dp.toPx()).coerceAtLeast(2.dp.toPx())
    drawRoundRect(background, topLeft = Offset(left, top), size = Size(boxW, boxH), cornerRadius = CornerRadius(6.dp.toPx()))
    paint.color = textColor.toArgb()
    paint.textAlign = Paint.Align.LEFT
    lines.forEachIndexed { i, t ->
        val lineCenter = top + padY + lineH * i + lineH / 2
        val baseline = lineCenter - (paint.descent() + paint.ascent()) / 2
        drawContext.canvas.nativeCanvas.drawText(t, left + padX, baseline, paint)
    }
}
