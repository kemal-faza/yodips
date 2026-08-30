package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonContentItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CourseDetailScreenTest {
    @Test
    fun `assignmentFromItem bridges cmid and falls back assignmentId to cmid`() {
        val item = KulonContentItem(kind = "assign", name = "Tugas 1", url = "https://k/a", cmid = 102)
        val a = assignmentFromItem(item, courseId = 77, courseName = "Algoritma")
        assertEquals(102L, a.id)
        assertEquals(102L, a.courseModuleId)
        assertEquals(102L, a.assignmentId) // backend never sends assignmentId → fallback cmid
        assertEquals("Tugas 1", a.name)
        assertEquals(77L, a.courseId)
        assertEquals("Algoritma", a.course)
        assertEquals(0L, a.duedate)
        assertFalse(a.overdue)
    }

    @Test
    fun `isAssignmentOpenable requires kind assign and a cmid`() {
        assertTrue(isAssignmentOpenable(KulonContentItem(kind = "assign", cmid = 5)))
        assertFalse(isAssignmentOpenable(KulonContentItem(kind = "assign", cmid = null)))
        assertFalse(isAssignmentOpenable(KulonContentItem(kind = "file", cmid = 5)))
    }
}
