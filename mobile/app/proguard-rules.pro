# R8 / ProGuard rules for release builds.
#
# The app uses kotlinx.serialization for API models, DataStore notification
# history and type-safe navigation routes. These are the upstream rules: they
# keep generated serializers and their Companion.serializer() entry points while
# still allowing model classes to be renamed by R8.
#
# Keep SourceFile/LineNumberTable so crash reports remain useful; the mapping
# file must still be archived by the release pipeline for retracing.

-keepattributes *Annotation*, InnerClasses
-keepattributes SourceFile,LineNumberTable
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class **$$serializer { *; }
-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}
