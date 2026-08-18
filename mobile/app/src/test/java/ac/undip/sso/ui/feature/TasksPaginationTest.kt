package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TasksPaginationTest {
    @Test
    fun `show count below list length shows all`() {
        val all = (1..10).toList()
        val (page, remaining) = pagedTasks(all, 15)
        assertEquals(all, page)
        assertEquals(0, remaining)
    }

    @Test
    fun `chunks at the page size and reports what remains`() {
        val all = (1..40).toList()
        val (page, remaining) = pagedTasks(all, TASK_PAGE_SIZE)
        assertEquals(TASK_PAGE_SIZE, page.size)
        assertEquals(25, remaining)
    }

    @Test
    fun `negative show count clamps to empty page`() {
        val (page, remaining) = pagedTasks(listOf(1, 2, 3), -5)
        assertTrue(page.isEmpty())
        assertEquals(3, remaining)
    }

    @Test
    fun `advancing past total shows everything and zero remaining`() {
        val all = (1..30).toList()
        val (page, remaining) = pagedTasks(all, TASK_PAGE_SIZE * 2)
        assertEquals(all, page)
        assertEquals(0, remaining)
    }
}
