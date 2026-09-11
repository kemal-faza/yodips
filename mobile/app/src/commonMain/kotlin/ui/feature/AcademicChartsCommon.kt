package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import kotlin.math.roundToInt

// ===== Pure data helpers (mirror web src/utils/dashboard.ts) =====

private fun graded(s: SiapKhsSemester): Boolean = s.nilai.any { it.nilaiHuruf.trim().isNotEmpty() }

/** Per-semester IP for graded terms only (the on-going term has no grades → excluded). */
internal fun ipTrend(khs: SiapKhs): List<Pair<Int, Double>> = khs.semesters.filter { graded(it) }.mapIndexed { i, s -> (i + 1) to s.ip }

internal val GRADE_KEYS = listOf("A", "AB", "B", "BC", "C", "D", "E")

internal data class TooltipRow(
    val label: String,
    val value: String,
)

internal data class ChartTooltipModel(
    val title: String,
    val rows: List<TooltipRow>,
)

internal fun lineTooltipModel(
    semester: Int,
    value: Float,
    label: String,
): ChartTooltipModel =
    ChartTooltipModel(
        title = "Semester $semester",
        rows = listOf(TooltipRow(label, formatTooltipValue(value.toDouble()))),
    )

internal fun gradeTooltipModel(
    semester: Int,
    counts: Map<String, Int>,
): ChartTooltipModel =
    ChartTooltipModel(
        title = "Semester $semester",
        rows = GRADE_KEYS.mapNotNull { grade ->
            val count = counts[grade] ?: 0
            if (count > 0) TooltipRow(grade, count.toString()) else null
        },
    )

/**
 * "3.456"->"3.46"; "3.40"->"3.4"; "3.00"->"3"; 144.0->"144" — parity dgn %.2f + trim (D4).
 */
internal fun formatTooltipValue(value: Double): String {
    if (value == value.toLong().toDouble()) return value.toLong().toString()
    val rounded = kotlin.math.round(value * 100) / 100
    val s = rounded.toString()
    return if (s.endsWith(".0")) s.dropLast(2) else s
}

internal val GRADE_COLORS =
    mapOf(
        "A" to androidx.compose.ui.graphics.Color(0xFF16A34A),
        "AB" to androidx.compose.ui.graphics.Color(0xFF22C55E),
        "B" to androidx.compose.ui.graphics.Color(0xFF3B82F6),
        "BC" to androidx.compose.ui.graphics.Color(0xFF6366F1),
        "C" to androidx.compose.ui.graphics.Color(0xFFF59E0B),
        "D" to androidx.compose.ui.graphics.Color(0xFFF97316),
        "E" to androidx.compose.ui.graphics.Color(0xFFDC2626),
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

/** Common-safe axis label formatter (no String.format). */
internal fun fmtValue(v: Float): String {
    if (kotlin.math.abs(v - kotlin.math.round(v)) < 0.05f) return v.roundToInt().toString()
    val r = (kotlin.math.round(v * 10) / 10).toString()
    return if (r.endsWith(".0")) r.dropLast(2) else r
}

// ===== AcademicCharts (renderer Canvas CMP) =====
// Implementasi `AcademicCharts` kini hidup di ChartsCanvas.kt (commonMain) —
// dirender dengan Canvas Compose multiplatform, dipakai Android & PWA /app/.
// Data helper murni di file ini tetap di-test di ChartsDataTest (JVM).
