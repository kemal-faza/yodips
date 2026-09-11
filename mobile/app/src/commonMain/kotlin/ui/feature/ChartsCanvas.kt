package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.ui.common.LoadableData
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Grafik akademik (IP trend, distribusi nilai huruf, akumulasi SKS) yang
 * dirender dengan Canvas Compose multiplatform — dipakai Android DAN PWA /app/.
 * Data helper murni (ipTrend/gradeRows/sksCumulative/hit-test) ada di
 * AcademicChartsCommon.kt; renderer Canvas CMP hidup di sini (sebelumnya
 * androidMain memakai android.graphics.Paint yang tidak tersedia di wasmJs).
 *
 * Hit-test touch (tap/drag untuk tooltip) dibahas di ChartsDataTest (JVM).
 */

@Composable
internal fun AcademicCharts(repo: SsoRepository, refreshTick: Int) {
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
    androidx.compose.material3.Card {
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
    val tooltipBg = MaterialTheme.colorScheme.background
    val tooltipFg = MaterialTheme.colorScheme.onBackground
    val tooltipBorder = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
    val textMeasurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.labelSmall

    BoxWithConstraints(Modifier.fillMaxWidth().height(200.dp)) {
        val n = values.size
        val plotLeft = with(density) { 38.dp.toPx() }
        val plotTop = with(density) { 10.dp.toPx() }
        val plotRight = with(density) { maxWidth.toPx() } - with(density) { 8.dp.toPx() }
        val plotBottom = with(density) { maxHeight.toPx() } - with(density) { 24.dp.toPx() }
        val plotW = plotRight - plotLeft
        val plotH = plotBottom - plotTop
        val yMin = 0f
        val slot = lineSlot(plotLeft, plotRight, n)

        fun xAt(i: Int): Float = if (n <= 1) plotLeft + plotW / 2 else plotLeft + plotW * i / (n - 1)
        fun yAt(v: Float): Float = plotTop + plotH * (1 - (v - yMin) / (yMax - yMin))
        fun reveal(x: Float) {
            hoverIndex = nearestLineIndex(x, plotLeft, slot, n)
        }

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
                    drawAxisText(textMeasurer, fmtValue(yMin + (yMax - yMin) * g / 4f), plotLeft - 6f, gy + 4f, labelStyle, alignRight = true)
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
                        drawAxisText(textMeasurer, it, plotRight - 4f, ty - 6f, labelStyle, color = errorColor, alignRight = true)
                    }
                }

                (0 until n).forEach { i ->
                    drawAxisText(textMeasurer, "${i + 1}", xAt(i), plotBottom + 18f, labelStyle, alignCenter = true)
                }

                val hi = hoverIndex
                if (hi != null && hi in values.indices) {
                    val cx = xAt(hi)
                    val cy = yAt(values[hi])
                    drawLine(lineColor.copy(alpha = 0.35f), Offset(cx, plotTop), Offset(cx, plotBottom), strokeWidth = 1.5f)
                    drawCircle(lineColor, radius = 8f, center = Offset(cx, cy))
                    drawCircle(Color.White, radius = 3f, center = Offset(cx, cy))
                    drawTooltip(
                        textMeasurer = textMeasurer,
                        model = lineTooltipModel(hi + 1, values[hi], if (yMax <= 4f) "IP Semester" else "SKS Kumulatif"),
                        anchorX = cx,
                        anchorY = cy - with(density) { 20.dp.toPx() },
                        background = tooltipBg,
                        textColor = tooltipFg,
                        borderColor = tooltipBorder,
                        indicatorColor = { lineColor },
                    )
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
            val tooltipBg = MaterialTheme.colorScheme.background
            val tooltipFg = MaterialTheme.colorScheme.onBackground
            val tooltipBorder = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
            val textMeasurer = rememberTextMeasurer()
            val labelStyle = MaterialTheme.typography.labelSmall
            BoxWithConstraints(Modifier.fillMaxWidth().height(170.dp)) {
                val n = rows.size
                val plotLeft = with(density) { 34.dp.toPx() }
                val plotRight = with(density) { maxWidth.toPx() } - with(density) { 8.dp.toPx() }
                val plotBottom = with(density) { maxHeight.toPx() } - with(density) { 24.dp.toPx() }
                val plotTop = with(density) { 8.dp.toPx() }
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
                            drawAxisText(textMeasurer, "${g * maxTotal / 4}", plotLeft - 6f, gy + 4f, labelStyle, alignRight = true)
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
                            drawAxisText(textMeasurer, "${i + 1}", barCenter(i), plotBottom + 18f, labelStyle, alignCenter = true)
                        }

                        val hi = hoverIndex
                        if (hi != null && hi in rows.indices) {
                            val (_, counts) = rows[hi]
                            val cx = barCenter(hi)
                            drawLine(gridColor.copy(alpha = 0.7f), Offset(cx, plotTop), Offset(cx, plotBottom), strokeWidth = 1.5f)
                            drawTooltip(
                                textMeasurer = textMeasurer,
                                model = gradeTooltipModel(hi + 1, counts),
                                anchorX = cx,
                                anchorY = plotBottom,
                                background = tooltipBg,
                                textColor = tooltipFg,
                                borderColor = tooltipBorder,
                                indicatorColor = { grade -> GRADE_COLORS[grade] ?: tooltipFg },
                            )
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
}

// ===== Text drawing on Canvas (Compose TextMeasurer) =====

private fun DrawScope.drawAxisText(
    textMeasurer: TextMeasurer,
    text: String,
    x: Float,
    y: Float,
    style: TextStyle,
    color: Color = Color(0xFF616161),
    alignRight: Boolean = false,
    alignCenter: Boolean = false,
) {
    val layout = textMeasurer.measure(text, style = style)
    val w = layout.size.width.toFloat()
    val left =
        when {
            alignRight -> x - w
            alignCenter -> x - w / 2f
            else -> x
        }
    drawText(layout, topLeft = Offset(left, y), color = color)
}

/**
 * Rounded tooltip chip drawn above `anchor` on the canvas. Multi-line for the
 * stacked-bar reader (header + per-grade rows) and single-line for line charts.
 * Ported dari AcademicChartsAndroid (android.graphics.Paint) ke TextMeasurer.
 */
private fun DrawScope.drawTooltip(
    textMeasurer: TextMeasurer,
    model: ChartTooltipModel,
    anchorX: Float,
    anchorY: Float,
    background: Color,
    textColor: Color,
    borderColor: Color,
    indicatorColor: (String) -> Color,
) {
    val padX = 8.dp.toPx()
    val padY = 5.dp.toPx()
    val lineH = 17.dp.toPx()
    val indicatorGap = 6.dp.toPx()
    val valueGap = 12.dp.toPx()

    val titleStyle = TextStyle(fontWeight = FontWeight.Bold, fontSize = 12.sp)
    val rowStyle = TextStyle(fontSize = 12.sp)
    val valueStyle = TextStyle(fontSize = 12.sp)

    val titleLayout = textMeasurer.measure(model.title, style = titleStyle)
    val rowLayouts = model.rows.map { textMeasurer.measure(it.label, style = rowStyle) }
    val valueLayouts = model.rows.map { textMeasurer.measure(it.value, style = valueStyle) }

    val labelWidth = rowLayouts.maxOfOrNull { it.size.width.toFloat() } ?: 0f
    val valueWidth = valueLayouts.maxOfOrNull { it.size.width.toFloat() } ?: 0f
    val contentWidth = maxOf(titleLayout.size.width.toFloat(), indicatorGap + 10.dp.toPx() + labelWidth + valueGap + valueWidth)
    val boxW = contentWidth + padX * 2
    val dividerGap = 4.dp.toPx()
    val boxH = padY * 2 + lineH + dividerGap + if (model.rows.isEmpty()) lineH else model.rows.size * lineH
    val left = (anchorX - boxW / 2).coerceIn(2.dp.toPx(), size.width - boxW - 2.dp.toPx())
    val top = (anchorY - boxH - 6.dp.toPx()).coerceAtLeast(2.dp.toPx())
    drawRoundRect(background, topLeft = Offset(left, top), size = Size(boxW, boxH), cornerRadius = CornerRadius(8.dp.toPx()))
    drawRoundRect(borderColor, topLeft = Offset(left, top), size = Size(boxW, boxH), cornerRadius = CornerRadius(8.dp.toPx()), style = Stroke(width = 1.dp.toPx()))

    val titleBaseline = top + padY + lineH / 2f
    drawText(titleLayout, topLeft = Offset(left + padX, titleBaseline), color = textColor)
    val dividerY = top + padY + lineH + dividerGap / 2
    drawLine(borderColor, Offset(left + padX, dividerY), Offset(left + boxW - padX, dividerY), 1.dp.toPx())

    if (model.rows.isEmpty()) {
        drawText(textMeasurer.measure("Tidak ada data", style = rowStyle), topLeft = Offset(left + padX, top + padY + lineH + dividerGap), color = textColor)
        return
    }

    model.rows.forEachIndexed { index, row ->
        val rowTop = top + padY + lineH + dividerGap + index * lineH
        val centerY = rowTop + lineH / 2f
        drawCircle(indicatorColor(row.label), radius = 3.dp.toPx(), center = Offset(left + padX + 3.dp.toPx(), centerY))
        drawText(rowLayouts[index], topLeft = Offset(left + padX + 10.dp.toPx(), rowTop + 2.dp.toPx()), color = textColor)
        drawText(valueLayouts[index], topLeft = Offset(left + boxW - padX - valueLayouts[index].size.width.toFloat(), rowTop + 2.dp.toPx()), color = textColor)
    }
}
