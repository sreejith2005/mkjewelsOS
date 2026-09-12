const { withGradleProperties } = require("expo/config-plugins");

/**
 * Android build settings this project needs on a modest Windows host.
 *
 * A stock Expo build runs Gradle's JVM, a separate Kotlin compiler daemon, and
 * four parallel native toolchains — one per ABI. On a four-core machine with
 * roughly 4 GB free it is killed part-way through Kotlin compilation. These
 * settings bound each of those.
 *
 * They live in a plugin rather than as edits to the generated
 * `android/gradle.properties` so that `expo prebuild --clean` cannot drop them.
 *
 * On a machine with more headroom they can be raised — the build is slower this
 * way, not different. Override per invocation, for example:
 *
 *   ./gradlew assembleDebug -Dorg.gradle.jvmargs=-Xmx3072m
 */
const GRADLE_PROPERTIES = {
  /**
   * One ABI instead of four. Every Android phone this app targets is arm64.
   * A release for wider distribution should widen it at the command line
   * rather than by editing this file:
   *
   *   ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
   */
  reactNativeArchitectures: "arm64-v8a",

  // Kotlin compiled inside the Gradle JVM rather than in a daemon of its own,
  // which otherwise adds a second multi-hundred-megabyte process.
  "kotlin.compiler.execution.strategy": "in-process",
  "kotlin.incremental": "false",

  // A smaller heap than the 2 GB default, and one project at a time, so peak
  // usage is one toolchain rather than several.
  "org.gradle.jvmargs": "-Xmx1536m -XX:MaxMetaspaceSize=512m",
  "org.gradle.parallel": "false",
};

module.exports = function withAndroidBuildBudget(config) {
  return withGradleProperties(config, (modConfig) => {
    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      const existing = modConfig.modResults.find(
        (item) => item.type === "property" && item.key === key,
      );
      if (existing) existing.value = value;
      else modConfig.modResults.push({ type: "property", key, value });
    }
    return modConfig;
  });
};
