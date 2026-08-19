package ac.undip.sso.ui.shell

import ac.undip.sso.core.data.PrefsPersistentCache
import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.ui.feature.DashboardScreen
import ac.undip.sso.ui.feature.IrsScreen
import ac.undip.sso.ui.feature.KhsScreen
import ac.undip.sso.ui.feature.ProfileScreen
import ac.undip.sso.ui.feature.ScanScreen
import ac.undip.sso.ui.feature.ScheduleScreen
import ac.undip.sso.ui.feature.TasksScreen
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

/** 5 destinations matching the design spec ("Dashboard, Tugas, Scan, Jadwal, Profile"). */
internal const val BottomBarLabelSizeSp = 10

enum class Tab(
    val route: String,
    val label: String,
) {
    Dashboard("dashboard", "Dashboard"),
    Tasks("tasks", "Tugas"),
    Scan("scan", "Scan"),
    Schedule("schedule", "Jadwal"),
    Profile("profile", "Profile"),
}

@Composable
fun AppShell(
    themeController: ThemeController,
    onLogout: () -> Unit = {},
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val context = LocalContext.current.applicationContext
    val repo = remember { SsoRepository(persistent = PrefsPersistentCache(context)) }

    Scaffold(
        bottomBar = { ShellBottomBar(currentRoute) { route -> navigate(navController, route) } },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { pad ->
        NavHost(
            navController = navController,
            startDestination = Tab.Dashboard.route,
            modifier = Modifier.fillMaxSize().padding(pad).statusBarsPadding(),
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

/** Compact text-only bottom navigation; labels remain accessible and tappable. */
@Composable
fun ShellBottomBar(
    currentRoute: String?,
    onSelect: (String) -> Unit,
) {
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Tab.entries.forEach { tab ->
            NavigationBarItem(
                selected = currentRoute == tab.route,
                onClick = { onSelect(tab.route) },
                icon = {},
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
                        selectedTextColor = accentForeground(),
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
            )
        }
    }
}
