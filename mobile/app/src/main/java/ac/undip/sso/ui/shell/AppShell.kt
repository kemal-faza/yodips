package ac.undip.sso.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import ac.undip.sso.ui.theme.Primary

/** 5 destinations matching the design spec ("Dashboard, Tugas, Scan, Jadwal, Profile"). */
enum class Tab(val route: String, val label: String, val icon: ImageVector) {
    Dashboard("dashboard", "Dashboard", Icons.Filled.Home),
    Tasks("tasks", "Tugas", Icons.Filled.Checklist),
    Scan("scan", "Scan", Icons.Filled.QrCodeScanner),
    Schedule("schedule", "Jadwal", Icons.Filled.DateRange),
    Profile("profile", "Profile", Icons.Filled.Person),
}

@Composable
fun AppShell() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        bottomBar = { ShellBottomBar(currentRoute) { route -> navigate(navController, route) } },
    ) { pad ->
        NavHost(
            navController = navController,
            startDestination = Tab.Dashboard.route,
            modifier = Modifier.fillMaxSize().padding(pad),
        ) {
            composable(Tab.Dashboard.route) { Placeholder("Dashboard", "Ringkasan IPK, SKS, & tugas") }
            composable(Tab.Tasks.route) { Placeholder("Tugas", "Deadline Kulon") }
            composable(Tab.Scan.route) { Placeholder("Scan", "QR absensi") }
            composable(Tab.Schedule.route) { Placeholder("Jadwal", "Kalender jadwal kullah") }
            composable(Tab.Profile.route) { Placeholder("Profile", "Biodata & KHS") }
        }
    }
}

private fun navigate(
    controller: androidx.navigation.NavHostController,
    route: String,
) {
    controller.navigate(route) {
        // Use the FAB scan route as a modal-ish hop; keep a single back stack sane.
        popUpTo(controller.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Bottom bar where the center (Scan) item is a raised round FAB. */
@Composable
fun ShellBottomBar(currentRoute: String?, onSelect: (String) -> Unit) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        Tab.entries.forEach { tab ->
            if (tab == Tab.Scan) {
                // Center slot: a filled raised teal circle. Tapping it navigates to scan.
                Box(
                    modifier = Modifier
                        .navigationBarsPadding()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.IconButton(
                        onClick = { onSelect(tab.route) },
                    ) {
                        Box(
                            modifier = Modifier
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
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.primary,
                        indicatorColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                )
            }
        }
    }
}

@Composable
private fun Placeholder(title: String, subtitle: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}