package com.agri.video.collector.base

import java.net.URL
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object BaseConnectivityProtocol {
    const val DEVICE_STORAGE_NAME = "autojs.localstorage.AgriVideoCollectorDevice"
    const val DEVICE_ID_KEY = "deviceId"
    const val DEVICE_TOKEN_KEY = "deviceToken"

    fun heartbeatUrl(apiBaseUrl: String): String =
        "${apiBaseUrl.trim().trimEnd('/')}/mobile/base-connectivity/heartbeats"

    fun heartbeatBody(
        deviceId: String,
        screenState: ScreenState,
        appUiState: AppUiState,
    ): String = "{" +
        "\"deviceId\":\"${escapeJson(deviceId)}\"," +
        "\"screenState\":\"${screenState.wireValue}\"," +
        "\"appUiState\":\"${appUiState.wireValue}\"" +
        "}"

    fun canonicalRequest(method: String, url: String, timestamp: String, bodyHash: String): String {
        val parsed = URL(url)
        val path = parsed.path.ifBlank { "/" }
        val query = parsed.query.orEmpty()
        return listOf(method.uppercase(), path, query, timestamp, bodyHash).joinToString("\n")
    }

    fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).toHex()

    fun hmacSha256Hex(secret: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(value.toByteArray(Charsets.UTF_8)).toHex()
    }

    fun decodeStoredString(value: String?): String = value
        ?.trim()
        ?.removeSurrounding("\"")
        ?.replace("\\\"", "\"")
        ?.replace("\\\\", "\\")
        ?.trim()
        .orEmpty()

    private fun escapeJson(value: String): String = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
