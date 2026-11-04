package com.jewelos.mobile.recorder

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.media.*
import android.os.*
import android.util.Base64
import org.json.JSONObject
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Owns capture independently of WebView/RN timers; never restarts the microphone after process death. */
class RecorderService : Service() {
  private var initialized = false
  private lateinit var queue: RecorderQueue
  @Volatile private var meta: JSONObject? = null
  private val lock = Any()
  private var mic: AudioRecord? = null
  @Volatile private var capturing = false
  @Volatile private var destroyed = false
  @Volatile private var captureThread: Thread? = null
  private var captureComplete = true // guarded by lock; thread liveness includes code after tail sealing
  private var sessionGeneration = 0L
  @Volatile private var ticket: String? = null
  @Volatile private var token: String? = null
  @Volatile private var tokenUntil = 0L
  @Volatile private var uploadUrl: String? = null
  private var requestId = "native"
  private var lastLevel = 0.0
  private var network = "offline"
  private var retryAt = 0L
  private var failures = 0
  private val worker = Executors.newSingleThreadScheduledExecutor()
  private var focus: AudioFocusRequest? = null
  private var wakelock: PowerManager.WakeLock? = null
  private val audio by lazy { getSystemService(AUDIO_SERVICE) as AudioManager }
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    try {
    queue = RecorderQueue(this)
    meta = queue.metadata()
    meta?.let {
      if (it.optString("state") == "recording") { it.put("state", "needs_attention").put("error", "interrupted"); queue.metadata(it) }
      // A crash after a chunk rename but before manifest update must replay that chunk.
      it.put("sequence", maxOf(it.optInt("sequence"), (queue.sequences().maxOrNull() ?: -1) + 1)); queue.metadata(it)
      if (it.optString("state") == "saving") { it.put("last_sequence", it.getInt("sequence")-1); queue.metadata(it) }
    }
    } catch (_: Exception) {
      RecorderModule.emitter?.invoke(JSONObject().put("kind","recorder.error").put("state","needs_attention").put("error","queue_unavailable")); stopSelf(); return
    }
    initialized = true
    worker.scheduleWithFixedDelay({ try { drain() } catch (error: Exception) { if(error is javax.crypto.AEADBadTagException || error.message in listOf("ingestion_rejected","scope_mismatch","ack_mismatch")) fail("ingestion_rejected"); failures = minOf(failures+1, 5); retryAt = System.currentTimeMillis() + minOf(30000L, 1000L shl failures); network = if(token == null && ticket == null) "ticket_required" else "offline"; emit() } }, 0, 2, java.util.concurrent.TimeUnit.SECONDS)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if(!initialized) return START_NOT_STICKY
    try {
      if (intent?.action == "stop") { stopCapture("saving"); return START_NOT_STICKY }
      val value = JSONObject(intent?.getStringExtra("command") ?: return START_NOT_STICKY)
      requestId = value.getString("requestId")
      val kind = value.getString("kind")
      run {
        if (kind != "recorder.start") require(value.getString("sessionId") == meta?.getJSONObject("session")?.getString("id"))
        when (kind) {
          "recorder.start" -> synchronized(lock) {
            val session = value.getJSONObject("session")
            val previous = meta
            require(previous == null || previous.getJSONObject("session").getString("id") == session.getString("id") || previous.optString("state") == "processing") { "device_busy" }
            val fresh = previous == null || previous.getJSONObject("session").getString("id") != session.getString("id")
            if (fresh) {
              queue.clearCompleted()
              sessionGeneration++
              meta = JSONObject().put("session", session).put("state", "paused").put("sequence", session.optInt("next_sequence",0)).put("samples",0).put("last_sequence", JSONObject.NULL)
            } else {
              for (id in arrayOf("tenant_id","branch_id","employee_id","device_id")) require(previous!!.getJSONObject("session").getString(id) == session.getString(id))
            }
            val uri = java.net.URI(value.getString("upload_url"))
            require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null)
            require(java.time.Instant.parse(value.getString("expires_at")).toEpochMilli() > System.currentTimeMillis())
            uploadUrl = uri.toString().trimEnd('/')
            ticket = value.getString("ticket"); token = null
            persist()
            if (fresh) startCapture() else { notification(); emit() }
          }
          "recorder.resume" -> synchronized(lock) { require(meta?.optString("state") in listOf("paused", "needs_attention")); require(uploadUrl != null && (ticket != null || token != null)) { "ticket_required" }; startCapture() }
          "recorder.pause" -> stopCapture("paused")
          "recorder.stop" -> stopCapture("saving")
        }
      }
    } catch (_: Exception) { fail("command_rejected") }
    return START_NOT_STICKY
  }
  private fun startCapture() {
    if (capturing) return
    require(captureThread?.isAlive != true) { "capture_stopping" }
    require(meta?.optString("state") !in listOf("saving","processing"))
    require(meta!!.getLong("samples") < MAX_SAMPLES) { "session_limit" }
    require(queue.queuedBytes() + CHUNK + 28 <= QUEUE_LIMIT) { "queue_full" }
    notification(true)
    focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setOnAudioFocusChangeListener({ change -> if (change < 0) stopCapture("needs_attention", "interrupted") }, Handler(mainLooper)).build()
    require(audio.requestAudioFocus(focus!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "audio_busy" }
    val record = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.MIC)
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
      .setBufferSizeInBytes(maxOf(CHUNK,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT))).build()
    mic = record
    require(record.state == AudioRecord.STATE_INITIALIZED) { "microphone_unavailable" }
    if (Build.VERSION.SDK_INT >= 29) record.registerAudioRecordingCallback(mainExecutor, object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
        if (configs.any { it.clientAudioSessionId == record.audioSessionId && it.isClientSilenced }) stopCapture("needs_attention", "interrupted")
      }
    })
    mic = record
    record.startRecording()
    capturing = true
    captureComplete = false
    meta!!.put("state", "recording").remove("error"); persist()
    wakelock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JewelOS:recorder").apply { setReferenceCounted(false); acquire(4 * 60 * 60 * 1000L) }
    captureThread = Thread({
      val pending = ByteArray(CHUNK)
      var used = 0
      try {
        while (capturing) {
          val n = record.read(pending, used, pending.size - used, AudioRecord.READ_BLOCKING)
          if (n < 0) { if (capturing) throw IllegalStateException("microphone_unavailable"); break }
          if (n == 0) continue
          used += n
          if (used == CHUNK) {
            append(pending)
            used = 0
            if (meta!!.getLong("samples") >= MAX_SAMPLES || queue.queuedBytes() + CHUNK + 28 > QUEUE_LIMIT) {
              capturing = false
              synchronized(lock) { meta!!.put("state","needs_attention").put("error",if(meta!!.getLong("samples") >= MAX_SAMPLES) "session_limit" else "queue_full"); persist() }
            }
          }
        }
      } catch (_: Exception) { fail("capture_failed") }
      finally {
        try { if (used > 0) append(pending.copyOf(used - used % 2)) } catch (_: Exception) { fail("storage_failed") }
        try { record.stop() } catch (_: Exception) {}
        record.release(); mic = null
        focus?.let { audio.abandonAudioFocusRequest(it) }; focus = null
        wakelock?.let { if(it.isHeld) it.release() }; wakelock = null
        synchronized(lock) { captureComplete = true; if(meta?.optString("state") == "saving") { meta!!.put("last_sequence",meta!!.getInt("sequence")-1); persist() } }
        if(!destroyed) notification(false)
        emit()
      }
    }, "JewelOS-capture").apply { start() }
    notification(); emit()
  }
  private fun append(bytes: ByteArray) {
    if (bytes.isEmpty()) return
    synchronized(lock) {
      val value = meta!!
      val sequence = value.getInt("sequence")
      queue.append(sequence, bytes)
      value.put("sequence", sequence+1).put("samples",value.getLong("samples") + bytes.size/2)
      var peak = 0
      for (i in bytes.indices step 2) peak = maxOf(peak, kotlin.math.abs(((bytes[i].toInt() and 255) or (bytes[i+1].toInt() shl 8)).toShort().toInt()))
      lastLevel = peak / 32768.0
      persist(); emit()
    }
  }
  private fun stopCapture(state: String, error: String? = null) {
    capturing = false
    // Unblock read off the Android main thread. Capture still owns the tail and
    // release; commands never join it or wait for the platform stop call.
    val stopping = mic
    if (stopping != null) Thread({ try { stopping.stop() } catch (_: Exception) {} }, "JewelOS-stop").start()
    synchronized(lock) {
      val value = meta ?: return
      if (value.optString("state") == "processing") return
      val target = if (value.optString("state") == "saving") "saving" else state
      value.put("state", target)
      if (error != null) value.put("error",error)
      if (target == "saving") value.put("last_sequence", if(!captureComplete) JSONObject.NULL else value.getInt("sequence")-1)
      persist(); emit(); if(!destroyed) notification(captureThread?.isAlive == true)
    }
  }
  private fun persist() { meta?.let { queue.metadata(it) }; liveSnapshot = status() }
  private fun status(): JSONObject = JSONObject().put("kind","recorder.status").put("requestId",requestId)
    .put("sessionId",meta?.getJSONObject("session")?.getString("id") ?: JSONObject.NULL)
    .put("session",meta?.optJSONObject("session") ?: JSONObject.NULL)
    .put("state",meta?.optString("state") ?: "idle").put("sequence",meta?.optInt("sequence") ?: 0)
    .put("queuedBytes",queue.queuedBytes()).put("level",lastLevel).put("elapsedMs",(meta?.optLong("samples") ?: 0L)*1000/16000)
    .put("network",network).put("error",meta?.optString("error") ?: "")
  private fun emit() { synchronized(lock) { liveSnapshot = status(); RecorderModule.emitter?.invoke(liveSnapshot!!) } }
  private fun fail(code: String) { capturing = false; if(captureThread?.isAlive != true) { try { mic?.release() } catch (_: Exception) {}; mic=null; focus?.let { audio.abandonAudioFocusRequest(it) }; focus=null }; synchronized(lock) { if(captureThread?.isAlive != true) captureComplete = true; meta?.put("state","needs_attention")?.put("error",code); persist(); emit(); if(!destroyed) try { notification(false) } catch (_: Exception) { stopSelf() } } }
  private fun notification(recording: Boolean = capturing || captureThread?.isAlive == true) {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel("recorder", "Recording", NotificationManager.IMPORTANCE_LOW))
    val stop = PendingIntent.getService(this,0,Intent(this,RecorderService::class.java).setAction("stop"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val open = PendingIntent.getActivity(this,0,packageManager.getLaunchIntentForPackage(packageName),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val note = Notification.Builder(this,"recorder").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("JewelOS recording")
      .setContentText(if(capturing) "Microphone active - tap Stop to save" else "Recording paused or saving - open JewelOS for status")
      .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null,"Stop and save",stop).build()).build()
    if(Build.VERSION.SDK_INT >= 29) startForeground(7193,note,if(recording) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(7193,note)
  }
  private fun post(path: String, body: JSONObject, bearer: String? = null): JSONObject {
    val connection = URL(uploadUrl!!.trimEnd('/') + path).openConnection() as HttpsURLConnection
    connection.instanceFollowRedirects = false; connection.connectTimeout = 10000; connection.readTimeout = 15000
    connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type","application/json")
    if(bearer != null) connection.setRequestProperty("Authorization","Bearer $bearer")
    try {
      connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      if (connection.responseCode == 401 || connection.responseCode == 403) { token = null; network = "ticket_required"; throw IllegalStateException("ticket_required") }
      if(connection.responseCode == 409 || connection.responseCode == 400) throw IllegalStateException("ingestion_rejected")
      require(connection.responseCode in 200..299) { "upload_failed" }
      return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
    } finally { connection.disconnect() }
  }
  private fun drain() {
    if (destroyed || meta == null || uploadUrl == null || meta?.optString("error") == "ingestion_rejected" || System.currentTimeMillis() < retryAt) return
    if(token == null || tokenUntil <= System.currentTimeMillis()) {
      val fresh = ticket ?: run { network="ticket_required"; emit(); return }
      ticket = null // single-use; uncertain redemption requires a fresh ticket, never a new session
      val lease = post("/v1/connect",JSONObject().put("ticket",fresh))
      val scope = meta!!.getJSONObject("session")
      val bound = lease.getJSONObject("session")
      for(id in arrayOf("id","device_id","tenant_id","branch_id","employee_id")) require(scope.getString(id) == bound.getString(id)) { "scope_mismatch" }
      token = lease.getString("ingest_token"); tokenUntil = java.time.Instant.parse(lease.getString("expires_at")).toEpochMilli()
    }
    network = "uploading"
    for(sequence in queue.sequences()) {
      if(destroyed) return
      val bytes = queue.read("chunk-$sequence") ?: continue
      val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
      val scope = meta!!.getJSONObject("session")
      val body = JSONObject().put("session_id",scope.getString("id")).put("sequence",sequence).put("sha256",hash).put("data",Base64.encodeToString(bytes,Base64.NO_WRAP))
      for(id in arrayOf("device_id","tenant_id","branch_id","employee_id")) body.put(id,scope.getString(id))
      val ack = post("/v1/chunks",body,token)
      require(ack.getInt("sequence") == sequence && ack.getString("sha256") == hash && ack.getInt("next_sequence") > sequence) { "ack_mismatch" }
      synchronized(lock) { queue.acknowledge(sequence); emit() }
    }
    val commit = synchronized(lock) {
      if(meta!!.optString("state") == "saving" && queue.sequences().isEmpty() && captureThread?.isAlive != true) {
        val scope = meta!!.getJSONObject("session")
        val body = JSONObject().put("session_id",scope.getString("id")).put("last_sequence",meta!!.getInt("last_sequence"))
        for(id in arrayOf("device_id","tenant_id","branch_id","employee_id")) body.put(id,scope.getString(id))
        Pair(sessionGeneration, body)
      } else null
    }
    if (commit != null) {
      // No service/manifest lock crosses the network. Commands remain responsive.
      post("/v1/commit",commit.second,token)
      synchronized(lock) {
        if (!destroyed && sessionGeneration == commit.first &&
          meta?.getJSONObject("session")?.getString("id") == commit.second.getString("session_id") &&
          meta?.optString("state") == "saving" && queue.sequences().isEmpty() && captureThread?.isAlive != true) {
          meta!!.put("state","processing"); persist(); emit()
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        }
      }
    }
    failures=0; retryAt=0; network="connected"; emit()
  }
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopCapture(if(meta?.optString("state") == "saving") "saving" else "needs_attention","foreground_timeout")
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
  }
  override fun onDestroy() { destroyed=true; if(!initialized) { worker.shutdownNow(); super.onDestroy(); return }; stopCapture(if(meta?.optString("state") == "saving") "saving" else "needs_attention","interrupted"); worker.shutdownNow(); ticket=null;token=null;liveSnapshot=null;super.onDestroy() }
  companion object {
    private const val CHUNK=64000
    private const val QUEUE_LIMIT=64L*1024*1024
    private const val MAX_SAMPLES=4L*60*60*16000
    @Volatile private var liveSnapshot: JSONObject? = null
    fun snapshot(context: Context): JSONObject {
      liveSnapshot?.let { return JSONObject(it.toString()) }
      return try {
        val queue = RecorderQueue(context)
        val meta = queue.metadata()
        JSONObject().put("kind","recorder.status").put("sessionId",meta?.getJSONObject("session")?.getString("id") ?: JSONObject.NULL)
          .put("session",meta?.optJSONObject("session") ?: JSONObject.NULL)
          .put("state",if(meta?.optString("state") == "recording") "needs_attention" else meta?.optString("state") ?: "idle")
          .put("error",if(meta?.optString("state") == "recording") "interrupted" else meta?.optString("error") ?: "")
          .put("sequence",maxOf(meta?.optInt("sequence") ?: 0,(queue.sequences().maxOrNull() ?: -1)+1)).put("queuedBytes",queue.queuedBytes())
      } catch (_: Exception) { JSONObject().put("kind","recorder.error").put("state","needs_attention").put("error","queue_unavailable") }
    }
  }
}
