package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonAssignment
import org.junit.Assert.assertEquals
import org.junit.Test

class TasksSortTest {
    private fun task(id: Long, duedate: Long) = KulonAssignment(id = id, duedate = duedate, name = "Tugas $id")

    @Test
    fun `NEED filter sorts by soonest deadline first (urgent on top)`() {
        val list = listOf(task(1, 300), task(2, 100), task(3, 200))
        assertEquals(listOf(2L, 3L, 1L), sortTasksByFilter(list, TaskBucket.NEED).map { it.id })
    }

    @Test
    fun `null filter (Semua) sorts by newest task first`() {
        val list = listOf(task(1, 100), task(2, 300), task(3, 200))
        assertEquals(listOf(2L, 3L, 1L), sortTasksByFilter(list, null).map { it.id })
    }

    @Test
    fun `DONE filter sorts by newest task first`() {
        val list = listOf(task(1, 100), task(2, 300), task(3, 200))
        assertEquals(listOf(2L, 3L, 1L), sortTasksByFilter(list, TaskBucket.DONE).map { it.id })
    }

    @Test
    fun `LATE filter sorts by newest task first`() {
        val list = listOf(task(1, 100), task(2, 300), task(3, 200))
        assertEquals(listOf(2L, 3L, 1L), sortTasksByFilter(list, TaskBucket.LATE).map { it.id })
    }

    @Test
    fun `empty input stays empty regardless of filter`() {
        val empty: List<KulonAssignment> = emptyList()
        assertEquals(empty, sortTasksByFilter(empty, null))
        assertEquals(empty, sortTasksByFilter(empty, TaskBucket.NEED))
    }

    @Test
    fun `tie on equal duedate keeps insertion order stable`() {
        val list = listOf(task(1, 200), task(2, 200), task(3, 100))
        assertEquals(listOf(1L, 2L, 3L), sortTasksByFilter(list, null).map { it.id })
    }
}
