package com.agri.video.collector.base

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant

class BaseControlClient(
    private val httpClient: OkHttpClient,
    private val identity: BaseConnectivityIdentity,
) {
    data class Command(
        val id: String,
        val commandType: String,
        val claimToken: String,
        val payload: JSONObject,
        val payloadMalformed: Boolean = false,
    )

    fun poll(config: BaseConnectivityConfig): Command? {
        val deviceId = URLEncoder.encode(identity.deviceId, Charsets.UTF_8.name())
        val url = "${config.apiBaseUrl}/mobile/base-control/commands?deviceId=$deviceId"
        val request = signedRequest("GET", url, "")
        return httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val data = JSONObject(response.body?.string().orEmpty()).optJSONArray("data") ?: return null
            if (data.length() == 0) return null
            val item = data.getJSONObject(0)
            val id = item.optString("id")
            val commandType = item.optString("commandType")
            val claimToken = item.optString("claimToken")
            val rawPayload = item.opt("payload")
            val payload = item.optJSONObject("payload") ?: JSONObject()
            val payloadMalformed = item.has("payload") && rawPayload !is JSONObject
            if (id.isBlank() || commandType.isBlank() || claimToken.isBlank()) null
            else Command(id, commandType, claimToken, payload, payloadMalformed)
        }
    }

    fun acknowledge(
        config: BaseConnectivityConfig,
        command: Command,
        result: BaseControlCommandExecutor.Result,
    ): Boolean {
        val exitResult = result.exitResult
        val body = JSONObject()
            .put("deviceId", identity.deviceId)
            .put("claimToken", command.claimToken)
            .put("status", exitResult?.transportStatus ?: if (result.success) "DONE" else "FAILED")
            .put("result", if (exitResult != null) exitAckResult(command, exitResult) else legacyResult(result))
            .toString()
        val url = "${config.apiBaseUrl}/mobile/base-control/commands/${command.id}/ack"
        return httpClient.newCall(signedRequest("POST", url, body)).execute().use { it.isSuccessful }
    }

    private fun legacyResult(result: BaseControlCommandExecutor.Result): JSONObject =
        JSONObject().put("action", result.action).put("reason", result.reason)

    private fun exitAckResult(
        command: Command,
        result: BaseControlCommandExecutor.ExitResult,
    ): JSONObject {
        val normalizedStages = normalizeExitStages(result.stages)
        return JSONObject()
            .put("commandType", command.commandType.takeIf { it == "EXIT_AGENT_APP" } ?: "EXIT_AGENT_APP")
            .put("result", result.businessResult)
            .put("stages", JSONArray().also { stages ->
                normalizedStages.forEach { stage ->
                    stages.put(
                        JSONObject()
                            .put("name", stage.name)
                            .put("status", stage.status)
                            .apply {
                                if (stage.reason.isNotBlank()) put("reason", stage.reason)
                            },
                    )
                }
            })
            .put("cleanupStages", JSONArray().also { stages ->
                result.cleanupStages.forEach { stage ->
                    stages.put(
                        JSONObject()
                            .put("name", stage.name)
                            .put("status", stage.status)
                            .apply {
                                if (stage.reason.isNotBlank()) put("reason", stage.reason)
                            },
                    )
                }
            })
    }

    private fun normalizeExitStages(
        stages: List<BaseControlCommandExecutor.Stage>,
    ): List<BaseControlCommandExecutor.Stage> {
        val byName = stages.associateBy { it.name }
        return EXIT_STAGE_NAMES.map { name ->
            byName[name] ?: BaseControlCommandExecutor.Stage(
                name = name,
                status = "SKIPPED",
                reason = "PREVIOUS_STAGE_FAILED",
            )
        }
    }

    private fun signedRequest(method: String, url: String, body: String): Request {
        val timestamp = Instant.now().toString()
        val bodyHash = BaseConnectivityProtocol.sha256Hex(body)
        val signature = BaseConnectivityProtocol.hmacSha256Hex(
            identity.deviceToken,
            BaseConnectivityProtocol.canonicalRequest(method, url, timestamp, bodyHash),
        )
        val builder = Request.Builder()
            .url(url)
            .header("X-Device-Id", identity.deviceId)
            .header("X-Device-Token", identity.deviceToken)
            .header("X-Timestamp", timestamp)
            .header("X-Body-SHA256", bodyHash)
            .header("X-Signature", signature)
        return if (method == "GET") builder.get().build()
        else builder.post(body.toRequestBody("application/json; charset=utf-8".toMediaType())).build()
    }

    companion object {
        private val EXIT_STAGE_NAMES = listOf("STOP_AGENT", "REMOVE_APP_TASK", "LOCK_SCREEN")
    }
}
