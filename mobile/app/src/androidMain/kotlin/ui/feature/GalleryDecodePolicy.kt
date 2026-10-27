package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.UserMessages

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
 * Long edges retried (largest first) when the full-resolution photo yields no
 * QR. A phone photo can defeat the MLKit detector at its native size even when
 * the same photo decodes once reduced — verified on a 2160x3840 Galaxy A55
 * photo: native size returned 0 codes, 1920/1280/960 returned the QR. The
 * ladder deliberately stops at 960: smaller images risk losing a QR that
 * occupies only part of the frame.
 */
internal val GALLERY_RETRY_LONG_EDGES: List<Int> = listOf(1920, 1280, 960)

/**
 * Targets to try after a full-resolution attempt, largest first. Only sizes
 * strictly below the source are produced: a small screenshot is never
 * upscaled nor re-processed at the size that just failed. When the source
 * dimensions are unknown (the full decode failed, e.g. out of memory), the
 * whole ladder is used because decoding with a target size is memory-bounded.
 */
internal fun galleryRetryLongEdges(sourceLongEdge: Int?): List<Int> =
    if (sourceLongEdge == null) {
        GALLERY_RETRY_LONG_EDGES
    } else {
        GALLERY_RETRY_LONG_EDGES.filter { it < sourceLongEdge }
    }

/** User-facing copy for a failed gallery read; null when a QR was found. */
internal fun GalleryDecode.failureMessage(): String? =
    when (this) {
        is GalleryDecode.Qr -> null
        GalleryDecode.NoQr -> UserMessages.QR_NOT_FOUND
        GalleryDecode.ImageUnreadable -> UserMessages.PHOTO_UNREADABLE
    }
