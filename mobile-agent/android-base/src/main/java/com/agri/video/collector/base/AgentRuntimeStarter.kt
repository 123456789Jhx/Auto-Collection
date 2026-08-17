package com.agri.video.collector.base

import android.content.Context
import org.autojs.autojs.engine.ScriptEngineService
import org.autojs.autojs.execution.ExecutionConfig
import org.autojs.autojs.execution.ScriptExecution
import org.autojs.autojs.inrt.autojs.AutoJs
import org.autojs.autojs.script.JavaScriptFileSource
import java.io.File

class AgentRuntimeStarter(private val context: Context) {
    enum class Result { ALREADY_RUNNING, STARTED, SCRIPT_MISSING, START_FAILED, READY_TIMEOUT }

    @Synchronized
    fun ensureStarted(): Result = try {
        val service = AutoJs.instance.scriptEngineService
        val projectDir = File(context.filesDir, "project")
        val mainFile = File(projectDir, "main.js")
        val watchdogFile = File(projectDir, "watchdog.js")
        if (!mainFile.isFile || !watchdogFile.isFile) return Result.SCRIPT_MISSING

        val runningPaths = runningPaths(service)
        val mainRunning = mainFile.canonicalPath in runningPaths
        val watchdogRunning = watchdogFile.canonicalPath in runningPaths
        val startedAt = System.currentTimeMillis()
        if (mainRunning && watchdogRunning && isAgentHeartbeatFresh(startedAt)) {
            return Result.ALREADY_RUNNING
        }

        val heartbeatBeforeStart = lastAgentHeartbeatAt()
        val config = ExecutionConfig(workingDirectory = projectDir.path)
        val mainExecution = if (!mainRunning) {
            service.execute(JavaScriptFileSource("main", mainFile), config)
        } else {
            null
        }
        if (!watchdogRunning) service.execute(JavaScriptFileSource("watchdog", watchdogFile), config)

        if (waitForAgentReady(service, mainFile, mainExecution, startedAt, heartbeatBeforeStart)) {
            Result.STARTED
        } else {
            Result.READY_TIMEOUT
        }
    } catch (_: Throwable) {
        Result.START_FAILED
    }

    private fun waitForAgentReady(
        service: ScriptEngineService,
        mainFile: File,
        mainExecution: ScriptExecution?,
        startedAt: Long,
        heartbeatBeforeStart: Long,
    ): Boolean {
        val deadline = startedAt + START_CONFIRM_TIMEOUT_MS
        var observedMainRunning = mainExecution == null && isRunning(service, mainFile)
        while (System.currentTimeMillis() < deadline) {
            val submittedEngine = mainExecution?.engine
            val mainRunning = isRunning(service, mainFile)
            if (mainRunning || submittedEngine?.isDestroyed == false) observedMainRunning = true

            val heartbeatAt = lastAgentHeartbeatAt()
            if (heartbeatAt > heartbeatBeforeStart && heartbeatAt >= startedAt && mainRunning) return true
            if (observedMainRunning && !mainRunning && submittedEngine?.isDestroyed != false) return false
            if (submittedEngine?.isDestroyed == true) return false
            Thread.sleep(START_CONFIRM_POLL_MS)
        }
        return false
    }

    private fun isRunning(service: ScriptEngineService, file: File): Boolean =
        file.canonicalPath in runningPaths(service)

    private fun runningPaths(service: ScriptEngineService): Set<String> =
        service.getScriptExecutions()
            .filter { execution -> execution.engine?.isDestroyed == false }
            .mapNotNull { execution ->
                (execution.source as? JavaScriptFileSource)?.file?.let { sourceFile ->
                    runCatching { sourceFile.canonicalPath }.getOrNull()
                }
            }
            .toSet()

    private fun lastAgentHeartbeatAt(): Long {
        val preferences = context.getSharedPreferences(AGENT_CONNECTION_STORAGE, Context.MODE_PRIVATE)
        return when (val value = preferences.all["lastSuccessAt"]) {
            is Number -> value.toLong()
            is String -> value.trim('"').toLongOrNull() ?: 0L
            else -> 0L
        }
    }

    private fun isAgentHeartbeatFresh(now: Long): Boolean {
        val lastSuccessAt = lastAgentHeartbeatAt()
        return lastSuccessAt > 0L && now - lastSuccessAt <= AGENT_HEARTBEAT_FRESH_MS
    }

    companion object {
        private const val AGENT_CONNECTION_STORAGE =
            "autojs.localstorage.AgriVideoCollectorAgentConnection"
        private const val START_CONFIRM_TIMEOUT_MS = 20_000L
        private const val START_CONFIRM_POLL_MS = 100L
        private const val AGENT_HEARTBEAT_FRESH_MS = 65_000L
    }
}
