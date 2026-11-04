package com.jewelos.mobile.recorder

import android.content.Context
import android.content.ContextWrapper
import android.test.AndroidTestCase
import java.io.File
import org.json.JSONObject

/** Run only the synthetic debug instrumentation suite; no server/account/audio needed. */
@Suppress("DEPRECATION")
class RecorderQueueTest : AndroidTestCase() {
  private lateinit var isolated: File
  private lateinit var testContext: Context
  override fun setUp() {
    super.setUp()
    isolated = File(context.cacheDir,"queue-test-${System.nanoTime()}").apply { mkdirs() }
    testContext = object : ContextWrapper(context) { override fun getNoBackupFilesDir() = isolated }
  }
  override fun tearDown() { isolated.deleteRecursively(); super.tearDown() }
  fun testCrashReplayKeepsChunkBeforeManifestAndAcknowledgesInOrder() {
    val first = RecorderQueue(testContext)
    val partial = ByteArray(642) { (it % 251).toByte() }
    first.append(0,ByteArray(64000) { 42 }); first.append(1,partial)
    // Fresh instance simulates a lost RN/service process; files own durable replay.
    val reopened = RecorderQueue(testContext)
    assertEquals(listOf(0,1),reopened.sequences())
    assertTrue(partial.contentEquals(reopened.read("chunk-1")))
    reopened.metadata(JSONObject().put("sequence", 2))
    reopened.acknowledge(0)
    assertEquals(listOf(1),RecorderQueue(testContext).sequences())
    assertTrue(reopened.queuedBytes() > 0)
  }
  fun testAckCannotEraseOnlyRecoveryEvidenceBeforeManifestIsDurable() {
    val queue = RecorderQueue(testContext)
    queue.metadata(JSONObject().put("sequence", 0))
    queue.append(0, ByteArray(642) { 42 })
    try { queue.acknowledge(0); fail("ACK before durable manifest must retain the chunk") } catch (_: IllegalArgumentException) {}
    val recovered = RecorderQueue(testContext)
    assertEquals(listOf(0), recovered.sequences())
    assertEquals(0, recovered.metadata()!!.getInt("sequence"))
    queue.metadata(JSONObject().put("sequence", 1))
    queue.acknowledge(0)
    assertTrue(RecorderQueue(testContext).sequences().isEmpty())
    assertEquals(1, RecorderQueue(testContext).metadata()!!.getInt("sequence"))
  }
  fun testStopReturnsWithoutJoiningCaptureAndWaitsToSealTail() {
    val service = RecorderService()
    fun field(name: String, value: Any) { service.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(service, value) }
    val queue = RecorderQueue(testContext)
    val meta = JSONObject().put("session", JSONObject().put("id", "test-session"))
      .put("state", "recording").put("sequence", 1).put("samples", 32000)
    val release = java.util.concurrent.CountDownLatch(1)
    val capture = Thread { release.await() }.apply { start() }
    field("queue", queue); field("meta", meta); field("captureThread", capture); field("captureComplete", false); field("destroyed", true)
    val stop = service.javaClass.getDeclaredMethod("stopCapture", String::class.java, String::class.java).apply { isAccessible = true }
    try {
      val started = android.os.SystemClock.elapsedRealtime()
      stop.invoke(service, "saving", null)
      assertTrue("Stop must not join capture", android.os.SystemClock.elapsedRealtime() - started < 1000)
      assertTrue(capture.isAlive)
      assertEquals("saving", queue.metadata()!!.getString("state"))
      assertTrue("Tail is not sealed before capture finishes", queue.metadata()!!.isNull("last_sequence"))
      // The capture tail can finish just before Stop takes the lock while the
      // thread is still emitting its final status. Liveness must not leave null.
      field("captureComplete", true)
      stop.invoke(service, "saving", null)
      assertEquals(0, queue.metadata()!!.getInt("last_sequence"))
    } finally { release.countDown(); capture.join(2000) }
  }
  fun testEncryptedAtRestAndTamperRejected() {
    val bytes = ByteArray(64000) { 0x41 }
    val queue = RecorderQueue(testContext); queue.append(0,bytes)
    val file = File(isolated,"recorder-v1/chunk-0")
    assertFalse(file.readBytes().contentEquals(bytes))
    val encrypted = file.readBytes(); encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte(); file.writeBytes(encrypted)
    try { queue.read("chunk-0"); fail("Tampered audio must never upload") } catch (_: javax.crypto.AEADBadTagException) {}
  }
  fun testConflictOddPcmAndQueueBoundNeverEvict() {
    val queue = RecorderQueue(testContext); queue.append(0,ByteArray(2))
    try { queue.append(0,ByteArray(2)); fail("duplicate write") } catch (_: IllegalArgumentException) {}
    try { queue.append(1,ByteArray(3)); fail("odd PCM") } catch (_: IllegalArgumentException) {}
    // Real encrypted writes prove the bound rather than mocking a size estimate.
    var sequence=1
    try { while(true) queue.append(sequence++,ByteArray(64000)) } catch (_: IllegalArgumentException) {}
    assertTrue(queue.queuedBytes() <= 64L*1024*1024)
    assertEquals(0, queue.sequences().first())
    assertEquals(2,queue.read("chunk-0")!!.size)
  }
}
