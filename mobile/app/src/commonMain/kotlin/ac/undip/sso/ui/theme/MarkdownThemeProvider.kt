package ac.undip.sso.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.MarkdownColors
import com.mikepenz.markdown.model.MarkdownTypography

/**
 * Typography hierarchy untuk konten instruktur (deskripsi tugas Kulon, render
 * markdown-it via mikepenz `Markdown`). Semantics (heading/paragraph/list/link)
 * dari HTML di-map ke design system aplikasi — bukan gaya default renderer.
 *
 * Kontrak (di-assert di MarkdownThemeProviderTest):
 *  - heading size mengecil seiring level (h1 > h2 > h3 > ... > body)
 *  - heading bold (>= SemiBold)
 *  - paragraph punya lineHeight nyaman (> fontSize * 1.5)
 *  - link underlined + pakai warna aksen aplikasi
 */
data class MarkdownDocStyle(
    val h1: TextStyle,
    val h2: TextStyle,
    val h3: TextStyle,
    val h4: TextStyle,
    val h5: TextStyle,
    val h6: TextStyle,
    val paragraph: TextStyle,
    val bullet: TextStyle,
    val ordered: TextStyle,
    val quote: TextStyle,
    val inlineCode: TextStyle,
    val text: TextStyle,
    val link: TextLinkStyles,
    val linkColor: Color,
)

@Composable
fun appMarkdownDocStyle(): MarkdownDocStyle = appMarkdownDocStyle(
    headingColor = MaterialTheme.colorScheme.onSurface,
    bodyColor = MaterialTheme.colorScheme.onSurface,
    mutedColor = MaterialTheme.colorScheme.onSurfaceVariant,
    linkColor = accentForeground(),
)

/**
 * Builder murni (non-Composable) agar bisa di-unit-test di JVM tanpa runtime
 * Compose. Warna yang sama dipakai heading+body; muted untuk quote.
 */
fun appMarkdownDocStyle(
    headingColor: Color,
    bodyColor: Color,
    mutedColor: Color,
    linkColor: Color,
): MarkdownDocStyle {
    val headingBase = TextStyle(
        color = headingColor,
        fontWeight = FontWeight.SemiBold,
    )
    fun heading(size: TextUnit) = headingBase.copy(fontSize = size, lineHeight = (size.value * 1.3).sp)
    return MarkdownDocStyle(
        h1 = heading(24.sp),
        h2 = heading(20.sp),
        h3 = heading(17.sp),
        h4 = heading(16.sp),
        h5 = heading(15.sp),
        h6 = heading(15.sp),
        paragraph = TextStyle(
            color = bodyColor,
            fontSize = 15.sp,
            lineHeight = 24.sp,
        ),
        bullet = TextStyle(
            color = bodyColor,
            fontSize = 15.sp,
            lineHeight = 24.sp,
        ),
        ordered = TextStyle(
            color = bodyColor,
            fontSize = 15.sp,
            lineHeight = 24.sp,
        ),
        quote = TextStyle(
            color = mutedColor,
            fontSize = 15.sp,
            lineHeight = 24.sp,
        ),
        inlineCode = TextStyle(
            color = bodyColor,
            fontSize = 14.sp,
            lineHeight = 22.sp,
        ),
        text = TextStyle(color = bodyColor),
        link = TextLinkStyles(
            style = SpanStyle(
                color = linkColor,
                textDecoration = TextDecoration.Underline,
            ),
        ),
        linkColor = linkColor,
    )
}

@Composable
fun rememberMarkdownTheme(style: MarkdownDocStyle): MarkdownTypography =
    markdownTypography(
        text = style.text,
        code = style.inlineCode,
        inlineCode = style.inlineCode,
        h1 = style.h1,
        h2 = style.h2,
        h3 = style.h3,
        h4 = style.h4,
        h5 = style.h5,
        h6 = style.h6,
        quote = style.quote,
        paragraph = style.paragraph,
        ordered = style.ordered,
        bullet = style.bullet,
        list = style.paragraph,
        textLink = style.link,
    )

@Composable
fun rememberMarkdownColors(style: MarkdownDocStyle): MarkdownColors =
    markdownColor(
        text = style.text.color,
        codeBackground = MaterialTheme.colorScheme.surfaceVariant,
        inlineCodeBackground = MaterialTheme.colorScheme.surfaceVariant,
        dividerColor = MaterialTheme.colorScheme.outlineVariant,
        tableBackground = MaterialTheme.colorScheme.surfaceVariant,
    )
