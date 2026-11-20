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

# ---- Release shrinking (R8) — Play asked for obfuscated DEX (2026-11-12) ----
# Everything the WebView reaches by NAME must survive: Capacitor finds plugins by
# annotation + reflection, Cordova by the class names in config.xml. So the bridge
# and every plugin package are kept whole; R8 still shrinks/obfuscates the rest
# (androidx, Google libs, Kotlin).
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @android.webkit.JavascriptInterface <methods>;
}
-keep class org.apache.cordova.** { *; }
-keep class nl.xservices.plugins.** { *; }
-keep class com.megster.cordova.** { *; }
-keep class com.shopbookidris.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.aparajita.capacitor.** { *; }
-keep class io.capawesome.capacitorjs.** { *; }
-keep class ee.forgr.capacitor.** { *; }
# SQLCipher (sqlite plugin) is called from native code.
-keep class net.zetetic.** { *; }
-keep class net.sqlcipher.** { *; }
-dontwarn net.zetetic.**
-dontwarn net.sqlcipher.**
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
