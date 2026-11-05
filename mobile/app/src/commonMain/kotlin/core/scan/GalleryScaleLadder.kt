package ac.undip.sso.core.scan

/**
 * Long edges retried (largest first) when a gallery photo fails at its first
 * attempted size. Same values as the Android implementation; the ladder stops
 * at 960 so a QR occupying only part of the frame is not lost.
 */
internal val GALLERY_RETRY_LONG_EDGES: List<Int> = listOf(1920, 1280, 960)

internal fun galleryScaleLadder(sourceLongEdge: Int?): List<Int> =
    if (sourceLongEdge == null) {
        GALLERY_RETRY_LONG_EDGES
    } else {
        GALLERY_RETRY_LONG_EDGES.filter { it < sourceLongEdge }
    }
