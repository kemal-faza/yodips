# Keep kotlinx-serialization model classes (they use @Serializable + noarg).
-if @kotlinx.serialization.Serializable class ** 
-keepclassmembers class ** { 
    @kotlinx.serialization.Serializable <fields>; 
}
-keepclassmembers class * implements java.io.Serializable { *; }
