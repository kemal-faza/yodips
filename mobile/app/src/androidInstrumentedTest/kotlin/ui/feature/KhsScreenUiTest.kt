package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonAssignmentDetail
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.KulonCourseContent
import ac.undip.sso.core.network.LogoutResponse
import ac.undip.sso.core.network.MeResponse
import ac.undip.sso.core.network.PushDeviceRequest
import ac.undip.sso.core.network.PushDeviceResponse
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import ac.undip.sso.core.network.SiapLecturer
import ac.undip.sso.core.network.SiapNilai
import ac.undip.sso.core.network.SiapNilaiDetail
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SsoApi
import ac.undip.sso.core.network.VapidPublicKeyResponse
import ac.undip.sso.core.network.WebPushDeviceRequest
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.click
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

class KhsScreenUiTest {
    @get:Rule
    val compose = createComposeRule()

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun api_khs_without_detail_id_shows_grade_and_tap_does_not_open_detail() {
        val api = KhsScreenFakeApi(
            SiapKhs(
                ipk = 3.8,
                semesters = listOf(
                    SiapKhsSemester(
                        semester = "2025/2026 Genap",
                        ip = 3.8,
                        totalSks = 3.0,
                        nilai = listOf(
                            SiapNilai(
                                kode = "IF101",
                                mataKuliah = "Matematika Data",
                                sks = 3.0,
                                nilaiHuruf = "A",
                            ),
                        ),
                    ),
                ),
            ),
        )
        val repo = SsoRepository(api = api)
        var openedDetail: SiapNilai? = null

        compose.setContent {
            MaterialTheme {
                KhsScreen(
                    repo = repo,
                    onBack = {},
                    onOpenNilaiDetail = { openedDetail = it },
                )
            }
        }

        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("A · SKS 3").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("A · SKS 3").assertIsDisplayed()
        compose.onNodeWithText("A · SKS 3").performTouchInput { click() }

        compose.runOnIdle { assertNull(openedDetail) }
    }
}

/** Small SsoApi fake matching the API-backed KHS fixture used by this screen test. */
private class KhsScreenFakeApi(
    private val khsResult: SiapKhs,
) : SsoApi {
    override suspend fun profile(): SiapProfile = error("Unexpected profile request")

    override suspend fun me(): MeResponse = error("Unexpected me request")

    override suspend fun irs(): SiapIrs = error("Unexpected IRS request")

    override suspend fun khs(): SiapKhs = khsResult

    override suspend fun nilaiDetail(id: String): SiapNilaiDetail = error("Unexpected detail request")

    override suspend fun jadwal(): List<SiapJadwal> = error("Unexpected jadwal request")

    override suspend fun assignments(): List<KulonAssignment> = error("Unexpected assignments request")

    override suspend fun assignmentDetail(assignmentId: Long, cmid: Long): KulonAssignmentDetail =
        error("Unexpected assignment detail request")

    override suspend fun courses(list: Boolean): List<KulonCourse> = error("Unexpected courses request")

    override suspend fun courseContent(courseId: Long): KulonCourseContent = error("Unexpected course content request")

    override suspend fun lecturers(): List<SiapLecturer> = error("Unexpected lecturers request")

    override suspend fun absen(): List<SiapAbsen> = error("Unexpected attendance request")

    override suspend fun registerPushDevice(body: PushDeviceRequest): PushDeviceResponse =
        error("Unexpected push registration request")

    override suspend fun unregisterPushDevice(body: PushDeviceRequest): PushDeviceResponse =
        error("Unexpected push unregistration request")

    override suspend fun vapidPublicKey(): VapidPublicKeyResponse = error("Unexpected VAPID key request")

    override suspend fun registerWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse =
        error("Unexpected web push registration request")

    override suspend fun unregisterWebPushDevice(body: WebPushDeviceRequest): PushDeviceResponse =
        error("Unexpected web push unregistration request")

    override suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse =
        error("Unexpected attendance submission")

    override suspend fun logout(): LogoutResponse = error("Unexpected logout request")
}
