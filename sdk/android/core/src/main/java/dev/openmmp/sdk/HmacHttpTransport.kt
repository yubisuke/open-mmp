package dev.openmmp.sdk

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class HmacHttpTransport(private val configuration: OpenMmpConfiguration) : OpenMmpTransport {
  override fun enroll(installationId: String): InstallationCredential {
    val response = request("/v1/installations", JSONObject().put("installation_id", installationId).toString(), null)
    check(response.status == 201) { "installation_enrollment_failed:${response.status}" }
    val value = JSONObject(response.body)
    return InstallationCredential(value.getString("installation_key_id"), value.getString("installation_secret"))
  }

  override fun deliver(credential: InstallationCredential, events: List<QueuedEvent>): Boolean =
    request("/v1/events/batch", EventFactory.envelope(events, configuration.sdkVersion, configuration.wrapperVersion), credential).status == 202

  override fun deleteInstallation(credential: InstallationCredential, installationId: String): Boolean =
    request("/v1/privacy/installation", JSONObject().put("installation_id", installationId).toString(), credential).status == 201

  private fun request(path: String, body: String, credential: InstallationCredential?): Response {
    val bytes = body.toByteArray(Charsets.UTF_8)
    val timestamp = System.currentTimeMillis().toString()
    val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(18).also { java.security.SecureRandom().nextBytes(it) })
    val bodyDigest = sha256(bytes)
    val installationKeyId = credential?.keyId ?: "-"
    val signing = listOf("open-mmp-sdk-v1", "POST", path, configuration.sdkKeyId, installationKeyId, timestamp, nonce, bodyDigest).joinToString("\n")
    val secret = credential?.secret ?: configuration.sdkSecret
    val signature = hmac(secret, signing)
    val connection = URL(configuration.endpoint.trimEnd('/') + path).openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.doOutput = true
    connection.connectTimeout = configuration.timeoutMs
    connection.readTimeout = configuration.timeoutMs
    connection.setRequestProperty("content-type", "application/json")
    connection.setRequestProperty("x-openmmp-sdk-key-id", configuration.sdkKeyId)
    if (credential != null) connection.setRequestProperty("x-openmmp-installation-key-id", credential.keyId)
    connection.setRequestProperty("x-openmmp-timestamp-ms", timestamp)
    connection.setRequestProperty("x-openmmp-nonce", nonce)
    connection.setRequestProperty("x-openmmp-signature", signature)
    connection.outputStream.use { it.write(bytes) }
    val status = connection.responseCode
    val stream = if (status in 200..399) connection.inputStream else connection.errorStream
    return Response(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
  }

  private fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
  private fun hmac(secret: String, value: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  }
  private data class Response(val status: Int, val body: String)
}
