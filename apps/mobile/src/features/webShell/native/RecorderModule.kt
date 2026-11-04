package com.jewelos.mobile.recorder

import android.app.ActivityManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject

class RecorderModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "JewelOSRecorder"
  @ReactMethod fun bridgeToken(promise: Promise) {
    // Per-shell capability, never persisted or used as a server credential.
    val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
    promise.resolve(bytes.joinToString("") { "%02x".format(it.toInt() and 255) })
  }
  @ReactMethod fun command(raw: String, promise: Promise) {
    try {
      val command = JSONObject(raw)
      val kind = command.getString("kind")
      require(kind in setOf("recorder.start", "recorder.pause", "recorder.resume", "recorder.stop", "recorder.status"))
      if (kind == "recorder.status") {
        promise.resolve(RecorderService.snapshot(context).toString()); return
      }
      val refresh = kind == "recorder.start" && RecorderService.snapshot(context).optString("sessionId") == command.getJSONObject("session").getString("id")
      if ((kind == "recorder.start" && !refresh) || kind == "recorder.resume") {
        require(Build.VERSION.SDK_INT >= 26) { "unsupported_device" }
        val activity = context.currentActivity ?: throw IllegalStateException("activity_required")
        val importance = ActivityManager.RunningAppProcessInfo().also { ActivityManager.getMyMemoryState(it) }.importance
        require(!activity.isFinishing && importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) { "activity_required" }
        require(ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "permission_denied" }
        if (Build.VERSION.SDK_INT >= 33) require(ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { "permission_denied" }
      }
      val intent = Intent(context, RecorderService::class.java).putExtra("command", raw)
      if (kind == "recorder.start" || kind == "recorder.resume") ContextCompat.startForegroundService(context, intent)
      else context.startService(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      val code = error.message?.takeIf { it in setOf("permission_denied","unsupported_device","activity_required") } ?: "command_rejected"
      promise.reject(code, code)
    }
  }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
  init { emitter = { value -> if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("JewelOSRecorder", value.toString()) } }
  companion object { var emitter: ((JSONObject) -> Unit)? = null }
}
class RecorderPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(RecorderModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
