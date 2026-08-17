package ac.undip.sso.ui.shell

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.ui.feature.DashboardScreen
import ac.undip.sso.ui.feature.IrsScreen
import ac.undip.sso.ui.feature.KhsScreen
import ac.undip.sso.ui.feature.ProfileScreen
import ac.undip.sso.ui.feature.ScanScreen
import ac.undip.sso.ui.feature.ScheduleScreen
import ac.undip.sso.ui.feature.TasksScreen
import ac.undip.sso.ui.theme.Primary
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.SpaceDashboard
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

/** 5 destinations matching the design spec ("Dashboard, Tugas, Scan, Jadwal, Profile"). */
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
fun AppShell(onLogout: () -> Unit = {}) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val repo = remember { SsoRepository() }

    Scaffold(
        bottomBar = { ShellBottomBar(currentRoute) { route -> navigate(navController, route) } },
    ) { pad ->
        NavHost(
            navController = navController,
            startDestination = Tab.Dashboard.route,
            modifier = Modifier.fillMaxSize().padding(pad),
        ) {
            composable(Tab.Dashboard.route) {
                DashboardScreen(
                    repo = repo,
                    onOpenIrs = { navController.navigate("irs") },
                    onOpenKhs = { navController.navigate("khs") },
                    onOpenTasks = { navController.navigate("tasks") },
                )
            }
            composable(Tab.Tasks.route) { TasksScreen(repo) }
            composable(Tab.Scan.route) { ScanScreen() }
            composable(Tab.Schedule.route) { ScheduleScreen(repo) }
            composable(Tab.Profile.route) { ProfileScreen(repo, onOpenKhs = { navController.navigate("khs") }, onLogout = onLogout) }
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
        // Keep a single sane back stack; the center Scan FAB is a top-level tab.
        popUpTo(controller.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Bottom bar where the center (Scan) item is a raised round FAB. */
@Composable
fun ShellBottomBar(
    currentRoute: String?,
    onSelect: (String) -> Unit,
) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        Tab.entries.forEach { tab ->
            if (tab == Tab.Scan) {
                // Center slot: a filled raised teal circle. Tapping it navigates to scan.
                Box(
                    modifier =
                        Modifier
                            .navigationBarsPadding()
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.IconButton(
                        onClick = { onSelect(tab.route) },
                    ) {
                        Box(
                            modifier =
                                Modifier
                                    .size(52.dp)
                                    .background(color = Primary, shape = CircleShape)
                                    .border(4.dp, MaterialTheme.colorScheme.surface, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.QrCodeScanner,
                                contentDescription = "Scan",
                                tint = MaterialTheme.colorScheme.onPrimary,
                            )
                        }
                    }
                }
            } else {
                NavigationBarItem(
                    selected = currentRoute == tab.route,
                    onClick = { onSelect(tab.route) },
                    icon = { Icon(tab.icon, contentDescription = tab.label) },
                    label = { Text(tab.label) },
                    colors =
                        NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                        ),
                )
            }
        }
    }
}
