package ac.undip.sso.ui.feature

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Claim the one attendance request shared by camera and gallery scans.
 * The claim stays held through network failures until the user explicitly
 * chooses "Scan lagi", so ambiguous outcomes cannot trigger an automatic retry.
 */
internal fun tryStartScanRequest(processing: AtomicBoolean): Boolean =
    processing.compareAndSet(false, true)
