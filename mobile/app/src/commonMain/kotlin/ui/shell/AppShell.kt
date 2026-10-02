package ac.undip.sso.ui.shell

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.push.NotificationHistoryStore
import ac.undip.sso.core.push.PushTargets
import ac.undip.sso.encodeUriComponent
import ac.undip.sso.uptimeMs
import ac.undip.sso.ui.feature.AssignmentDetailScreen
import ac.undip.sso.ui.feature.CourseDetailScreen
import ac.undip.sso.ui.feature.CoursesScreen
import ac.undip.sso.ui.feature.DashboardScreen
import ac.undip.sso.ui.feature.NotificationsScreen
import ac.undip.sso.ui.feature.IrsScreen
import ac.undip.sso.ui.feature.KhsScreen
import ac.undip.sso.ui.feature.NilaiDetailScreen
import ac.undip.sso.ui.feature.ProfileScreen
import ac.undip.sso.ui.feature.ScanScreen
import ac.undip.sso.ui.feature.ScheduleScreen
import ac.undip.sso.ui.feature.TasksScreen
import ac.undip.sso.ui.navigation.AppNavigation
import ac.undip.sso.ui.navigation.LocalAppNavigation
import ac.undip.sso.ui.theme.AppElevation
import ac.undip.sso.ui.theme.Primary
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.accentForeground
import ac.undip.sso.ui.theme.appCastAbove
import ac.undip.sso.ui.theme.appDepth
import ac.undip.sso.ui.theme.raisedSurfaceColor
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavBackStackEntry
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

/** Durasi transisi antar halaman (ms). Keluar lebih cepat daripada masuk,
 *  supaya perpindahan terasa responsif dan halaman baru yang datang tenang. */
internal const val NavEnterDurationMs = 300
internal const val NavExitDurationMs = 220

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
    repo: SsoRepository,
    themeController: ThemeController,
    onLogout: () -> Unit = {},
    initialNavTarget: String? = null,
    onNavConsumed: () -> Unit = {},
    notificationHistory: NotificationHistoryStore? = null,
    debugContent: (@Composable () -> Unit)? = null,
) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    // Selected task handed to the detail sub-screen (navigated by id so the
    // back stack stays light; the screen re-fetches detail from the api).
    var selectedTask by remember { mutableStateOf<KulonAssignment?>(null) }
    // Selected course handed to the course-detail sub-screen (same pattern as
    // selectedTask — route carries only the id, the full object rides here).
    var selectedCourse by remember { mutableStateOf<KulonCourse?>(null) }
    // Selected KHS grade handed to the nilai-detail sub-screen (route carries
    // only the id; the row (nama matkul utk judul) rides here).
    var selectedNilai by remember { mutableStateOf<ac.undip.sso.core.network.SiapNilai?>(null) }

    CompositionLocalProvider(
        LocalAppNavigation provides AppNavigation(
            onNavigateDashboard = {
                navigate(navController, Tab.Dashboard.route)
            },
        ),
    ) {
        Scaffold(
            bottomBar = { ShellBottomBar(currentRoute) { route -> navigate(navController, route) } },
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
        ) { pad ->
        NavHost(
            navController = navController,
            startDestination = Tab.Dashboard.route,
            // Halaman baru masuk dari KANAN dan halaman lama keluar ke KIRI;
            // saat back arahnya dibalik. Sebelumnya semua perpindahan hanya
            // cross-fade, jadi maju & mundur terasa sama saja.
            //
            // Pindah tab mengikuti urutan bottom bar (seperti pager): pindah ke
            // tab yang ada di KANAN → konten bergerak KANAN→KIRI, pindah ke tab
            // di KIRI → konten bergerak KIRI→KANAN. Detail screen tetap push
            // dari kanan; pop tetap ke kanan.
            enterTransition = {
                slideIntoContainer(
                    tabSlideDirection() ?: AnimatedContentTransitionScope.SlideDirection.Left,
                    tween(NavEnterDurationMs, easing = FastOutSlowInEasing),
                )
            },
            exitTransition = {
                slideOutOfContainer(
                    tabSlideDirection() ?: AnimatedContentTransitionScope.SlideDirection.Left,
                    tween(NavExitDurationMs, easing = LinearOutSlowInEasing),
                )
            },
            popEnterTransition = {
                slideIntoContainer(
                    AnimatedContentTransitionScope.SlideDirection.Right,
                    tween(NavExitDurationMs, easing = LinearOutSlowInEasing),
                )
            },
            popExitTransition = {
                slideOutOfContainer(
                    AnimatedContentTransitionScope.SlideDirection.Right,
                    tween(NavEnterDurationMs, easing = FastOutSlowInEasing),
                )
            },
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
                    onOpenNotifications = { navController.navigate("notifications") },
                    onOpenCourses = { navController.navigate("courses") },
                )
            }
            composable(Tab.Tasks.route) {
                TasksScreen(repo, onOpenDetail = { task ->
                    selectedTask = task
                    navController.navigate("task/${task.id}")
                })
            }
            composable(Tab.Scan.route) { ScanScreen(repo) }
            composable(Tab.Schedule.route) { ScheduleScreen(repo) }
            composable(Tab.Profile.route) {
                ProfileScreen(
                    repo = repo,
                    themeController = themeController,
                    onLogout = onLogout,
                    debugContent = debugContent,
                )
            }
            composable("khs") {
                KhsScreen(
                    repo = repo,
                    onBack = { navController.popBackStack() },
                    onOpenNilaiDetail = { nilai ->
                        selectedNilai = nilai
                        // detailId (`id#nim#kode`) memuat `#` yg akan dipecah
                        // Navigation Compose sbg fragment → URL-encode dulu.
                        nilai.detailId?.let { navController.navigate("nilai/${encodeUriComponent(it)}") }
                    },
                )
            }
            composable("nilai/{nilaiId}") {
                val nilai = selectedNilai
                if (nilai?.detailId == null) {
                    navController.popBackStack()
                } else {
                    NilaiDetailScreen(
                        repo = repo,
                        nilaiId = nilai.detailId!!,
                        mataKuliah = nilai.mataKuliah,
                        onBack = { navController.popBackStack() },
                    )
                }
            }
            composable("irs") { IrsScreen(repo, onBack = { navController.popBackStack() }) }
            composable("notifications") {
                val history = notificationHistory
                if (history != null) {
                    NotificationsScreen(
                        history = history,
                        onBack = { navController.popBackStack() },
                        onOpenTarget = { target ->
                            when (target) {
                                PushTargets.TASKS -> navigate(navController, Tab.Tasks.route)
                                PushTargets.SCHEDULE -> navigate(navController, Tab.Schedule.route)
                                else -> Unit
                            }
                        },
                    )
                }
            }
            composable("courses") {
                CoursesScreen(
                    repo = repo,
                    onOpenCourse = { course ->
                        selectedCourse = course
                        navController.navigate("courses/${course.id}")
                    },
                    onBack = { navController.popBackStack() },
                )
            }
            composable("courses/{courseId}") {
                val course = selectedCourse
                if (course == null) {
                    navController.popBackStack()
                } else {
                    CourseDetailScreen(
                        repo = repo,
                        courseId = course.id,
                        courseName = course.fullname,
                        semester = course.semester,
                        onOpenAssignment = { task ->
                            selectedTask = task
                            navController.navigate("task/${task.id}")
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
            }
            composable("task/{taskId}") {
                val task = selectedTask
                if (task != null) {
                    AssignmentDetailScreen(
                        repo = repo,
                        assignment = task,
                        onBack = { navController.popBackStack() },
                    )
                }
            }
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
}

/**
 * Arah slide untuk perpindahan antar tab top-level: `Left` kalau tab tujuan ada
 * di kanan tab asal (konten bergerak kanan→kiri), `Right` kalau di kiri
 * (konten bergerak kiri→kanan). Null kalau salah satu sisi bukan tab — mis.
 * masuk ke layar detail — supaya arah push/pop biasa yang dipakai.
 */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.tabSlideDirection():
    AnimatedContentTransitionScope.SlideDirection? {
    val from = Tab.entries.indexOfFirst { it.route == initialState.destination.route }
    val to = Tab.entries.indexOfFirst { it.route == targetState.destination.route }
    if (from < 0 || to < 0) return null
    return if (to > from) {
        AnimatedContentTransitionScope.SlideDirection.Left
    } else {
        AnimatedContentTransitionScope.SlideDirection.Right
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
        val now = uptimeMs()
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
        // Bar bawah mengambang di atas halaman yang men-scroll: bayangan yang
        // jatuh ke bawah saja tidak terlihat di dasar layar, jadi ditambah
        // gradien yang naik ke atas konten.
        modifier =
            Modifier
                .appCastAbove()
                .appDepth(AppElevation.Lifted),
        containerColor = raisedSurfaceColor(),
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
                    // Center slot: raised dark-teal FAB — the big circle. Melebar
                    // mengikuti lebar slot sampai maksimal 78dp, lalu `aspectRatio`
                    // mengunci 1:1 supaya lingkarannya selalu bulat (dulu `size(78.dp)`
                    // mentok ke lebar slot di layar sempit, jadi tampak elips). Karena
                    // tingginya ikut lebar (bukan `fill*` bebas), tinggi bar tidak
                    // ikut membengkak. No label (the reference shows only 4 labels).
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
                                // Tanpa kabut: bayangan FAB jatuh ke bottom bar
                                // yang lebih terang, jadi bayangan platform saja
                                // sudah terbaca — sama seperti di tema terang.
                                .appDepth(AppElevation.Floating, CircleShape, haze = false)
                                // `widthIn` DI LUAR `fillMaxWidth`: batas 78dp
                                // dipasang lebih dulu, baru lebar slot mengisi
                                // sampai batas itu (urutan terbalik bikin
                                // `widthIn` tak berefek dan lingkaran ikut
                                // membesar selebar layar lebar). Lalu dikunci
                                // 1:1 — dulu `size(78.dp)` mentok ke lebar slot
                                // di layar sempit (< 78dp), jadi tampak elips.
                                .widthIn(max = 78.dp)
                                .fillMaxWidth()
                                .aspectRatio(1f)
                                .clip(CircleShape)
                                // Bola teal: bibir atas menangkap cahaya, bawahnya
                                // menggelap, jadi bentuknya terbaca sebagai volume.
                                .background(
                                    Brush.verticalGradient(listOf(lerp(Primary, Color.White, 0.22f), Primary)),
                                    CircleShape,
                                )
                                .border(6.dp, raisedSurfaceColor(), CircleShape)
                                .clickable { throttled(tab.route) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.QrCodeScanner,
                            contentDescription = tab.label,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            // Separuh diameter lingkaran: ikon ikut mengecil saat
                            // lingkarannya mengecil, jadi sudutnya tidak pernah
                            // menyentuh bibir lingkaran.
                            modifier = Modifier.fillMaxSize(0.5f),
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
                            // Indikator tab aktif: sebelumnya `surfaceVariant`, yang
                            // nyaris sama dengan warna bar-nya sendiri di kedua tema.
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        ),
                )
            }
        }
        }
    }
}
