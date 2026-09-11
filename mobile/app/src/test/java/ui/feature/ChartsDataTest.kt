package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import ac.undip.sso.core.network.SiapNilai
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartsDataTest {
    private fun sem(
        ip: Double,
        totalSks: Double,
        nilai: List<Pair<String, Double>> = emptyList(),
    ): SiapKhsSemester =
        SiapKhsSemester(
            semester = "s",
            ip = ip,
            totalSks = totalSks,
            nilai = nilai.map { SiapNilai(mataKuliah = "mk", sks = it.second, nilaiHuruf = it.first) },
        )

    // real-shaped: 4 graded terms + 1 on-going (no grade, ip 0)
    private fun sampleKhs(): SiapKhs =
        SiapKhs(
            ipk = 3.65,
            semesters =
                listOf(
                    sem(3.95, 20.0, listOf("A" to 8.0)),
                    sem(3.6, 20.0, listOf("AB" to 9.0)),
                    sem(3.0, 20.0, listOf("B" to 7.0)),
                    sem(3.38, 24.0, List(5) { "A" to 1.0 } + listOf("C" to 3.0)),
                    sem(0.0, 23.0), // on-going, no grades
                ),
        )

    @Test
    fun `ipTrend excludes the ungraded current term`() {
        val trend = ipTrend(sampleKhs())
        assertEquals(4, trend.size)
        assertEquals(listOf(1, 2, 3, 4), trend.map { it.first })
        assertEquals(listOf(3.95, 3.6, 3.0, 3.38), trend.map { it.second })
    }

    @Test
    fun `gradeRows tallies letter grades per graded semester`() {
        val rows = gradeRows(sampleKhs())
        assertEquals(4, rows.size)
        val last = rows.last().second
        // semester 4 = 5 x 'A' + 1 x 'C' graded courses
        assertEquals(5, last["A"])
        assertEquals(1, last["C"])
        assertEquals(5 + 1, last.values.sum())
    }

    @Test
    fun `sksCumulative is running sum including current term sks`() {
        val series = sksCumulative(sampleKhs())
        assertEquals(listOf(20.0, 40.0, 60.0, 84.0, 107.0), series.map { it.second })
        assertEquals(listOf(1, 2, 3, 4, 5), series.map { it.first })
    }

    @Test
    fun `empty khs yields empty series`() {
        assertEquals(0, ipTrend(SiapKhs()).size)
        assertEquals(0, gradeRows(SiapKhs()).size)
        assertEquals(0, sksCumulative(SiapKhs()).size)
    }

    // ---- touch hit-testing (mobile substitute for the web hover) ----

    @Test
    fun `lineSlot divides plot space evenly across n points`() {
        assertEquals(0f, lineSlot(100f, 300f, 1))
        assertEquals(100f, lineSlot(100f, 300f, 3)) // 2 gaps of 100
    }

    @Test
    fun `nearestLineIndex snaps tap x to the closest point and clamps`() {
        // plot 100..300, n=3 → slots of 100; points at x=100,200,300.
        assertEquals(0, nearestLineIndex(140f, 100f, 100f, 3))
        assertEquals(1, nearestLineIndex(160f, 100f, 100f, 3))
        assertEquals(2, nearestLineIndex(250f, 100f, 100f, 3))
        // Taps left/right of the plot clamp to the first/last point.
        assertEquals(0, nearestLineIndex(0f, 100f, 100f, 3))
        assertEquals(2, nearestLineIndex(999f, 100f, 100f, 3))
    }

    @Test
    fun `barIndex maps x to the stacked-bar slot and clamps`() {
        // plot 100..300, n=3 → slots of 66.67; slots start at x=100.
        assertEquals(0, barIndex(110f, 100f, 66.67f, 3))
        assertEquals(1, barIndex(170f, 100f, 66.67f, 3))
        assertEquals(2, barIndex(240f, 100f, 66.67f, 3))
        assertEquals(2, barIndex(999f, 100f, 66.67f, 3)) // clamp to last bar
        assertEquals(0, barIndex(50f, 100f, 66.67f, 3)) // clamp to first bar
    }

    @Test
    fun `line tooltip mirrors web semester header and labeled value`() {
        val tooltip = lineTooltipModel(semester = 2, value = 3.65f, label = "IP Semester")

        assertEquals("Semester 2", tooltip.title)
        assertEquals(listOf(TooltipRow("IP Semester", "3.65")), tooltip.rows)
    }

    @Test
    fun `grade tooltip keeps only nonzero grades in web order`() {
        val tooltip =
            gradeTooltipModel(
                semester = 4,
                counts = mapOf("A" to 5, "AB" to 0, "C" to 1, "E" to 0),
            )

        assertEquals("Semester 4", tooltip.title)
        assertEquals(
            listOf(TooltipRow("A", "5"), TooltipRow("C", "1")),
            tooltip.rows,
        )
    }
}
