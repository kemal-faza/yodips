package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.UserMessages
import ac.undip.sso.core.scan.galleryScaleLadder

/**
 * Result of reading one QR from an image picked from the gallery. Raw decoder
 * errors never leave the Android layer: the screen only picks copy by type.
 */
internal sealed interface GalleryDecode {
    data class Qr(val token: String) : GalleryDecode

    /** The image opened, but no QR was detected at any attempted scale. */
    data object NoQr : GalleryDecode

    /** The file could not be decoded into a bitmap at all. */
    data object ImageUnreadable : GalleryDecode
}

/**
 * Targets to try after a full-resolution attempt, largest first. The shared
 * commonMain ladder keeps the PWA and Android retry policy identical.
 */
internal fun galleryRetryLongEdges(sourceLongEdge: Int?): List<Int> =
    galleryScaleLadder(sourceLongEdge)

/** User-facing copy for a failed gallery read; null when a QR was found. */
internal fun GalleryDecode.failureMessage(): String? =
    when (this) {
        is GalleryDecode.Qr -> null
        GalleryDecode.NoQr -> UserMessages.QR_NOT_FOUND
        GalleryDecode.ImageUnreadable -> UserMessages.PHOTO_UNREADABLE
    }
