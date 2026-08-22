package ac.undip.sso.ui.shell

import android.os.SystemClock
import ac.undip.sso.core.data.EncryptedPersistentCache
import ac.undip.sso.core.data.PrefsPersistentCache
import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.push.PushTargets
import ac.undip.sso.core.session.KeystoreTokenCipher
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.feature.DashboardScreen
import ac.undip.sso.ui.feature.IrsScreen
import ac.undip.sso.ui.feature.KhsScreen
import ac.undip.sso.ui.feature.ProfileScreen
import ac.undip.sso.ui.feature.ScanScreen
import ac.undip.sso.ui.feature.ScheduleScreen
import ac.undip.sso.ui.feature.TasksScreen
import ac.undip.sso.ui.theme.Primary
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.SpaceDashboard
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

/** 5 destinations matching the design spec ("Dashboard, Tugas, Scan, Jadwal, Profile"). */
internal const val BottomBarLabelSizeSp = 10

/** Min gap (ms) between two accepted bottom-tab taps. Collapses machine-gun taps
 *  (esp. onto the heavy Scan/QR camera screen) into one navigation per window,
 *  so the camera is not torn down & re-bound in a tight loop that janks the UI. */
internal const val TabTapDebounceMs = 250L

enum class Tab(
    val route: String,
    val label: String,
    val icon: ImageVector,
) {
    Dashboard("dashboard", "Dashboard", Icons.Filled.SpaceDashboard),
    Tasks("tasks", "Tugas", Icons.Filled.Checklist),
    Scan("scan", "Scan", Icons.Filled.QrCodeScanner),
    Schedule("schedule", "Jadwal", Icons.Filled.DateRange),
    Profile("profile", "Profile", Icons.Filled.Person),
}

@Composable
fun AppShell(
    tokenStore: TokenStore,
    themeController: ThemeController,
    onLogout: () -> Unit = {},
    initialNavTarget: String? = null,
    onNavConsumed: () -> Unit = {},
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val context = LocalContext.current.applicationContext
    // Encrypt cache payloads (incl. the PII-bearing profile) at rest via the same
    // Android-KeyStore-backed cipher as the token store — never plaintext on disk.
    val repo =
        remember {
            SsoRepository(
                persistent =
                    EncryptedPersistentCache(
                        KeystoreTokenCipher(context),
                        PrefsPersistentCache(context),
                    ),
                tokenStore = tokenStore,
            )
        }

    Scaffold(
        bottomBar = { ShellBottomBar(currentRoute) { route -> navigate(navController, route) } },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { pad ->
        NavHost(
            navController = navController,
            startDestination = Tab.Dashboard.route,
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(pad)
                    // The emulator has a 145px display-cutout inset but only an
                    // 84px status-bar inset. safeDrawing uses the larger bound,
                    // preventing content from entering the cutout area.
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
        ) {
            composable(Tab.Dashboard.route) {
                DashboardScreen(
                    repo = repo,
                    onOpenIrs = { navController.navigate("irs") },
                    onOpenKhs = { navController.navigate("khs") },
                )
            }
            composable(Tab.Tasks.route) { TasksScreen(repo) }
            composable(Tab.Scan.route) { ScanScreen(repo) }
            composable(Tab.Schedule.route) { ScheduleScreen(repo) }
            composable(Tab.Profile.route) { ProfileScreen(repo, themeController, onLogout = onLogout) }
            composable("khs") { KhsScreen(repo, onBack = { navController.popBackStack() }) }
            composable("irs") { IrsScreen(repo, onBack = { navController.popBackStack() }) }
        }

        // Push tap-navigation: FCM data.target -> tab route. Runs after the
        // NavHost is composed so the graph exists; consumed exactly once per
        // delivered target (MainActivity nulls it back via onNavConsumed).
        LaunchedEffect(initialNavTarget) {
            val route =
                when (initialNavTarget) {
                    PushTargets.TASKS -> Tab.Tasks.route
                    PushTargets.SCHEDULE -> Tab.Schedule.route
                    else -> null
                } ?: return@LaunchedEffect
            navigate(navController, route)
            onNavConsumed()
        }
    }
}

private fun navigate(
    controller: NavHostController,
    route: String,
) {
    controller.navigate(route) {
        // Keep a single sane back stack; Scan is a top-level tab.
        popUpTo(controller.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Horizontal gutter so the outer nav items clear the screen edges. */
private val BarHorizontalPadding = 12.dp

/** Bottom bar per reference design: 4 icon+label items + a raised round Scan FAB.
 *  The bar's background spans the full viewport width; only the content inside is
 *  inset by [BarHorizontalPadding] so the outer icons clear the screen edges. */
@Composable
fun ShellBottomBar(
    currentRoute: String?,
    onSelect: (String) -> Unit,
) {
    // Last accepted tap timestamp; throttles bottom-tab spam so the heavy
    // Scan/QR camera is not torn down & re-bound on every rapid tap.
    var lastTapAt by remember { mutableStateOf(Long.MIN_VALUE) }
    fun throttled(route: String) {
        val now = SystemClock.uptimeMillis()
        // Guard the very first tap: Long.MIN_VALUE is the "never tapped yet"
        // sentinel; subtracting it from a real uptime overflows (which would
        // block every tap), so treat it as always allowed.
        val isFirst = lastTapAt == Long.MIN_VALUE
        if (isFirst || now - lastTapAt >= TabTapDebounceMs) {
            lastTapAt = now
            onSelect(route)
        }
    }
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = BarHorizontalPadding),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Tab.entries.forEach { tab ->
                if (tab == Tab.Scan) {
                    // Center slot: raised dark-teal FAB — the big circle. Enlarged so it
                    // clearly reads bigger; protrudes above the bar via natural overflow
                    // (no fill* modifier: a fill inflated the M3 NavigationBar height and
                    // blanked content). No label (the reference shows only 4 labels).
                    Box(
                        modifier =
                            Modifier
                                .weight(1f)
                                .navigationBarsPadding()
                                .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                    Box(
                        modifier =
                            Modifier
                                .size(78.dp)
                                .clip(CircleShape)
                                .background(Primary)
                                .border(6.dp, MaterialTheme.colorScheme.surface, CircleShape)
                                .clickable { throttled(tab.route) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.QrCodeScanner,
                            contentDescription = tab.label,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(54.dp),
                        )
                    }
                }
            } else {
                NavigationBarItem(
                    selected = currentRoute == tab.route,
                    onClick = { throttled(tab.route) },
                    modifier = Modifier.weight(1f),
                    icon = { Icon(tab.icon, contentDescription = tab.label) },
                    label = {
                        Text(
                            tab.label,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = BottomBarLabelSizeSp.sp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    alwaysShowLabel = true,
                    colors =
                        NavigationBarItemDefaults.colors(
                            selectedIconColor = accentForeground(),
                            selectedTextColor = accentForeground(),
                            indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                        ),
                )
            }
        }
        }
    }
}
