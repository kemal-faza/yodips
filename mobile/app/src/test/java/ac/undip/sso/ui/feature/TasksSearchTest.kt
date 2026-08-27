package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonAssignment
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TasksSearchTest {
    private fun task(name: String, course: String) = KulonAssignment(name = name, course = course)

    @Test
    fun `blank query matches everything`() {
        assertTrue(filterTasksByQuery(task("Tugas 1", "Matematika"), ""))
        assertTrue(filterTasksByQuery(task("Tugas 1", "Matematika"), "   "))
    }

    @Test
    fun `matches task name case-insensitively`() {
        assertTrue(filterTasksByQuery(task("Kerjakan Modul 1", "Matematika"), "modul"))
        assertTrue(filterTasksByQuery(task("Kerjakan Modul 1", "Matematika"), "MODUL 1"))
    }

    @Test
    fun `matches course name`() {
        assertTrue(filterTasksByQuery(task("Tugas A", "Algoritma Struktur Data"), "algoritma"))
    }

    @Test
    fun `no match returns false`() {
        assertFalse(filterTasksByQuery(task("Tugas A", "Matematika"), "fisika"))
    }

    @Test
    fun `query trimmed before matching`() {
        assertTrue(filterTasksByQuery(task("Tugas A", "Fisika Dasar"), "  fisika  "))
    }
}
