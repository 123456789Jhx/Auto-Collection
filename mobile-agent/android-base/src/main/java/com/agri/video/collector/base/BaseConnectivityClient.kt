package com.agri.video.collector.base

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.time.Instant

class BaseConnectivityClient(
    private val httpClient: OkHttpClient,
    private val identity: BaseConnectivityIdentity,
) {
    data class Result(
        val success: Boolean,
        val receivedAt: String? = null,
        val offlineThresholdSeconds: Int = BaseConnectivityStateStore.DEFAULT_THRESHOLD_SECONDS,
        val httpStatus: Int = 0,
        val failureKind: String = "",
    )

    fun report(config: BaseConnectivityConfig, screenState: ScreenState, appUiState: AppUiState): Result {
        val url = BaseConnectivityProtocol.heartbeatUrl(config.apiBaseUrl)
        val body = BaseConnectivityProtocol.heartbeatBody(identity.deviceId, screenState, appUiState)
        val timestamp = Instant.now().toString()
        val bodyHash = BaseConnectivityProtocol.sha256Hex(body)
        val signature = BaseConnectivityProtocol.hmacSha256Hex(
            identity.deviceToken,
            BaseConnectivityProtocol.canonicalRequest("POST", url, timestamp, bodyHash),
        )
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .header("X-Device-Id", identity.deviceId)
            .header("X-Device-Token", identity.deviceToken)
            .header("X-Timestamp", timestamp)
            .header("X-Body-SHA256", bodyHash)
            .header("X-Signature", signature)
            .build()

        return try {
            httpClient.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return Result(false, httpStatus = response.code, failureKind = "http")
                }
                val json = JSONObject(responseBody)
                Result(
                    success = true,
                    receivedAt = json.optString("receivedAt").ifBlank { null },
                    offlineThresholdSeconds = json.optInt(
                        "offlineThresholdSeconds",
                        BaseConnectivityStateStore.DEFAULT_THRESHOLD_SECONDS,
                    ).coerceIn(15, 150),
                    httpStatus = response.code,
                )
            }
        } catch (_: java.net.SocketTimeoutException) {
            Result(false, failureKind = "timeout")
        } catch (_: Throwable) {
            Result(false, failureKind = "network")
        }
    }
}
