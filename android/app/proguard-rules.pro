# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Quicky GooglePlayBilling local plugin (Monetization PRD §5.3) —
# Capacitor discovers plugins by scanning for @CapacitorPlugin classes;
# keep it intact if minification is ever enabled (it is currently off).
-keep class com.quicky.plugin.googleplaybilling.** { *; }

# Capacitor plugin entry points in general (same reason as above).
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
