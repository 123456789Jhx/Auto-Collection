package com.agri.video.collector.base

import android.content.Context
import org.autojs.autojs.engine.ScriptEngineService
import org.autojs.autojs.execution.ExecutionConfig
import org.autojs.autojs.execution.ScriptExecution
import org.autojs.autojs.inrt.autojs.AutoJs
import org.autojs.autojs.script.JavaScriptFileSource
import org.json.JSONObject
import java.io.File

/** Runs the isolated AutoJS cleanup after the inner Agent has been disconnected. */
class AgentDisconnectCleanupCoordinator(private val context: Context) {
    data class Stage(val name: String, val status: String, val reason: String = "")
    data class Result(
        val success: Boolean,
        val status: String,
        val reason: String = "",
        val stages: List<Stage>,
    )

    @Synchronized
    fun run(
        deviceId: String,
        sessionId: String = "",
        reason: String = "LOCAL_STOP_BUTTON",
        stopAlreadyPerformed: Boolean = false,
    ): Result {
        val stopStage = if (stopAlreadyPerformed) {
            Stage("STOP_AGENT", "SUCCESS", "STOPPED_BEFORE_CLEANUP")
        } else {
            when (AgentRuntimeStopper(context).stop()) {
                AgentRuntimeStopper.Result.STOPPED -> Stage("STOP_AGENT", "SUCCESS")
                AgentRuntimeStopper.Result.ALREADY_STOPPED -> Stage("STOP_AGENT", "SKIPPED", "ALREADY_STOPPED")
                AgentRuntimeStopper.Result.STOP_FAILED -> Stage("STOP_AGENT", "FAILED", "STOP_FAILED")
            }
        }
        if (stopStage.status == "FAILED") {
            return Result(false, "FAILED", stopStage.reason, listOf(
                stopStage,
                Stage("EXIT_DOUYIN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
            ))
        }

        val cleanupKey = listOf(deviceId, sessionId, reason).joinToString(":")
        val preferences = context.getSharedPreferences(STORAGE_NAME, Context.MODE_PRIVATE)
        val cached = preferences.getString("result:$cleanupKey", null)?.let(::parseResult)
        if (cached != null) return cached

        val projectDir = File(context.filesDir, "project")
        val cleanupFile = File(projectDir, "app/emergency-agent-cleanup.js")
        if (!cleanupFile.isFile) {
            return failure(stopStage, "CLEANUP_SCRIPT_MISSING")
        }
        val request = JSONObject()
            .put("deviceId", deviceId)
            .put("sessionId", sessionId)
            .put("cleanupKey", cleanupKey)
            .put("reason", reason)
        preferences.edit().putString("request", request.toString()).apply()

        val execution = try {
            val service = AutoJs.instance.scriptEngineService
            service.execute(
                JavaScriptFileSource("emergency-agent-cleanup", cleanupFile),
                ExecutionConfig(workingDirectory = projectDir.path),
            )
        } catch (_: Throwable) {
            return failure(stopStage, "CLEANUP_START_FAILED")
        }
        val completed = waitForCompletion(execution, CLEANUP_TIMEOUT_MS)
        if (!completed) return failure(stopStage, "CLEANUP_TIMEOUT")
        val result = preferences.getString("result:$cleanupKey", null)?.let(::parseResult)
        return result ?: failure(stopStage, "CLEANUP_RESULT_MISSING")
    }

    private fun waitForCompletion(execution: ScriptExecution, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val destroyed = try { execution.engine?.isDestroyed ?: true } catch (_: Throwable) { true }
            if (destroyed) return true
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return false
    }

    private fun parseResult(raw: String): Result? = try {
        val json = JSONObject(raw)
        val status = json.optString("status", "FAILED")
        val cleanupStatus = if (status == "SUCCESS") "SUCCESS" else "FAILED"
        Result(
            success = cleanupStatus == "SUCCESS",
            status = cleanupStatus,
            reason = json.optString("reason", ""),
            stages = listOf(
                Stage("STOP_AGENT", "SUCCESS", "STOPPED_BEFORE_CLEANUP"),
                Stage("EXIT_DOUYIN", cleanupStatus, json.optString("reason", "")),
                Stage("OPEN_AGENT_HOME", cleanupStatus, json.optString("reason", "")),
            ),
        )
    } catch (_: Throwable) {
        null
    }

    private fun failure(stopStage: Stage, reason: String): Result = Result(
        success = false,
        status = "FAILED",
        reason = reason,
        stages = listOf(
            stopStage,
            Stage("EXIT_DOUYIN", "FAILED", reason),
            Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
        ),
    )

    companion object {
        private const val STORAGE_NAME = "autojs.localstorage.AgriVideoCollectorEmergencyCleanup"
        private const val CLEANUP_TIMEOUT_MS = 15_000L
        private const val POLL_INTERVAL_MS = 100L
    }
}
