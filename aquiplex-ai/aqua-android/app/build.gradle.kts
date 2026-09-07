import java.util.Properties

val signingProperties = Properties()
val signingFile = rootProject.file("keystore.properties")

signingFile.inputStream().use {
    signingProperties.load(it)
}

plugins {
    id("com.android.application")
}

android {
    namespace = "com.aquiplex.aqua"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.aquiplex.aqua"
        minSdk = 23
        targetSdk = 36
        versionCode = 3
        versionName = "1.1"
    }

    signingConfigs {
        create("release") {
            storeFile = file(signingProperties["AQUA_UPLOAD_KEYSTORE"] as String)
            storeType = "JKS"
            storePassword = signingProperties["AQUA_UPLOAD_STORE_PASSWORD"] as String
            keyAlias = signingProperties["AQUA_UPLOAD_ALIAS"] as String
            keyPassword = signingProperties["AQUA_UPLOAD_KEY_PASSWORD"] as String
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
}

// --- OAuth return-hop executable spec ---------------------------------------
// AuthCallback.java is deliberately free of Android imports so its whole decision
// surface can be verified on a plain JDK: no emulator, no test framework, no new
// dependency. src/harness is not part of any Android source set, so none of this
// reaches the APK. Also runnable standalone via tools/verify-authcallback.sh.
val compileAuthCallbackHarness by tasks.registering(JavaCompile::class) {
    source("src/main/java/com/aquiplex/aqua/AuthCallback.java",
           "src/harness/java/com/aquiplex/aqua/AuthCallbackHarness.java")
    classpath = files()
    destinationDirectory.set(layout.buildDirectory.dir("harness/classes"))
    options.release.set(11)
}

val checkAuthCallback by tasks.registering(JavaExec::class) {
    group = "verification"
    description = "Runs the AuthCallback OAuth return-hop executable spec."
    dependsOn(compileAuthCallbackHarness)
    classpath = files(layout.buildDirectory.dir("harness/classes"))
    mainClass.set("com.aquiplex.aqua.AuthCallbackHarness")
}

tasks.named("check") { dependsOn(checkAuthCallback) }
