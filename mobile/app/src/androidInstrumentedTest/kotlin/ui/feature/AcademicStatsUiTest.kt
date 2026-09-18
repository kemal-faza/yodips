package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapKhsSemester
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test

class AcademicStatsUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun loading_shows_skeletons_without_default_values() {
        render(khs = null, irs = null)

        compose.onNodeWithTag("academic-stat-ipk-skeleton").assertIsDisplayed()
        compose.onNodeWithTag("academic-stat-cumulative-sks-skeleton").assertIsDisplayed()
        compose.onNodeWithTag("academic-stat-semester-sks-skeleton").assertIsDisplayed()
        compose.onNodeWithTag("academic-stat-ipk-value").assertDoesNotExist()
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertDoesNotExist()
    }

    @Test
    fun success_shows_real_values_after_each_source_is_ready() {
        render(
            khs = ApiResult.Success(SiapKhs(ipk = 3.75, semesters = listOf(SiapKhsSemester(totalSks = 21.0)))),
            irs = ApiResult.Success(SiapIrs(totalSks = 18.0)),
        )

        compose.onNodeWithTag("academic-stat-ipk-value").assertTextEquals("3.75")
        compose.onNodeWithTag("academic-stat-cumulative-sks-value").assertTextEquals("21")
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertTextEquals("18")
    }

    @Test
    fun empty_success_preserves_valid_zero_values() {
        render(
            khs = ApiResult.Success(SiapKhs()),
            irs = ApiResult.Success(SiapIrs()),
        )

        compose.onNodeWithTag("academic-stat-ipk-value").assertTextEquals("0.0")
        compose.onNodeWithTag("academic-stat-cumulative-sks-value").assertTextEquals("0")
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertTextEquals("0")
    }

    @Test
    fun partial_success_only_replaces_the_completed_source_skeletons() {
        render(
            khs = ApiResult.Success(SiapKhs(ipk = 3.5)),
            irs = null,
        )

        compose.onNodeWithTag("academic-stat-ipk-value").assertTextEquals("3.50")
        compose.onNodeWithTag("academic-stat-cumulative-sks-value").assertTextEquals("0")
        compose.onNodeWithTag("academic-stat-semester-sks-skeleton").assertIsDisplayed()
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertDoesNotExist()
    }

    @Test
    fun errors_finish_loading_and_show_unavailable_values() {
        val error = ApiResult.Error(message = "offline", type = ErrorType.NETWORK)
        render(khs = error, irs = error)

        compose.onNodeWithTag("academic-stat-ipk-skeleton").assertDoesNotExist()
        compose.onNodeWithTag("academic-stat-semester-sks-skeleton").assertDoesNotExist()
        compose.onNodeWithTag("academic-stat-ipk-value").assertTextEquals("—")
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertTextEquals("—")
    }

    @Test
    fun expired_session_is_completed_unavailable_not_loading() {
        val expired = ApiResult.Error(message = "expired", type = ErrorType.STALE_SESSION)
        render(khs = expired, irs = expired)

        compose.onNodeWithTag("academic-stat-ipk-skeleton").assertDoesNotExist()
        compose.onNodeWithTag("academic-stat-ipk-value").assertTextEquals("—")
        compose.onNodeWithTag("academic-stat-semester-sks-value").assertTextEquals("—")
    }

    private fun render(
        khs: ApiResult<SiapKhs>?,
        irs: ApiResult<SiapIrs>?,
    ) {
        compose.setContent {
            MaterialTheme {
                AcademicStatsContent(khs = khs, irs = irs)
            }
        }
    }
}
