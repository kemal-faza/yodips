package ac.undip.sso.core.push

/** Nilai kanonis data.target payload FCM (kontrak spec §6). */
object PushTargets {
    const val TASKS = "tasks"
    const val SCHEDULE = "schedule"
}

/** Normalisasi target push -> nilai kanonis atau null (tanpa throw). */
fun normalizeNavTarget(raw: String?): String? =
    when (raw?.trim()?.lowercase()) {
        PushTargets.TASKS -> PushTargets.TASKS
        PushTargets.SCHEDULE -> PushTargets.SCHEDULE
        else -> null
    }
