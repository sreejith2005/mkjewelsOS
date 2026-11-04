package com.jewelos.mobile.recorder

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Private, authenticated encryption. Chunk files are the journal; a lost manifest never loses a committed chunk. */
class RecorderQueue(context: Context) {
  private val dir = File(context.noBackupFilesDir, "recorder-v1").apply { mkdirs() }
  private val key: SecretKey = KeyStore.getInstance("AndroidKeyStore").run {
    load(null)
    (getKey("jewelos-recorder-v1", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder("jewelos-recorder-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generateKey()
    }
  }
  @Synchronized fun read(name: String): ByteArray? {
    val file = AtomicFile(File(dir, name))
    if (!file.baseFile.exists()) return null
    val bytes = file.readFully()
    require(bytes.size >= 29) { "queue_corrupt" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
  }
  @Synchronized fun write(name: String, bytes: ByteArray) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    val encrypted = cipher.iv + cipher.doFinal(bytes)
    val file = AtomicFile(File(dir, name))
    val stream = file.startWrite()
    try { stream.write(encrypted); file.finishWrite(stream) } catch (e: Exception) { file.failWrite(stream); throw e }
  }
  @Synchronized fun metadata(): JSONObject? = read("session")?.let { JSONObject(String(it, Charsets.UTF_8)) }
  @Synchronized fun metadata(value: JSONObject) = write("session", value.toString().toByteArray(Charsets.UTF_8))
  @Synchronized fun sequences(): List<Int> = dir.listFiles().orEmpty().mapNotNull {
    Regex("chunk-(\\d+)").matchEntire(it.name)?.groupValues?.get(1)?.toIntOrNull()
  }.sorted()
  @Synchronized fun queuedBytes(): Long = sequences().sumOf { File(dir, "chunk-$it").length() }
  @Synchronized fun append(sequence: Int, bytes: ByteArray) {
    require(bytes.isNotEmpty() && bytes.size % 2 == 0 && bytes.size <= 64000) { "invalid_pcm" }
    require(queuedBytes() + bytes.size + 28 <= 64L * 1024 * 1024) { "queue_full" }
    require(!File(dir, "chunk-$sequence").exists()) { "sequence_conflict" }
    write("chunk-$sequence", bytes)
  }
  @Synchronized fun acknowledge(sequence: Int) {
    // Never remove the journal's only recovery evidence before its counter is durable.
    require((metadata()?.optInt("sequence", -1) ?: -1) > sequence) { "manifest_not_durable" }
    AtomicFile(File(dir, "chunk-$sequence")).delete()
  }
  @Synchronized fun clearCompleted() { require(sequences().isEmpty()); AtomicFile(File(dir,"session")).delete() }
}
