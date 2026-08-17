package com.agri.video.collector.base

import android.content.Context
import org.autojs.autojs.engine.ScriptEngineService
import org.autojs.autojs.inrt.autojs.AutoJs
import org.autojs.autojs.script.JavaScriptFileSource
import java.io.File

class AgentRuntimeStopper(private val context: Context) {
    enum class Result { STOPPED, ALREADY_STOPPED, STOP_FAILED }

    @Synchronized
    fun stop(): Result = try {
        val service = AutoJs.instance.scriptEngineService
        val targetPaths = targetScriptPaths()
        val running = runningExecutions(service, targetPaths)
        if (running.isEmpty()) return Result.ALREADY_STOPPED
        running.forEach { execution -> execution.engine?.forceStop() }
        if (waitUntilStopped(service, targetPaths)) Result.STOPPED else Result.STOP_FAILED
    } catch (_: Throwable) {
        Result.STOP_FAILED
    }

    private fun targetScriptPaths(): Set<String> {
        val projectDir = File(context.filesDir, "project")
        return setOf(
            File(projectDir, "main.js").canonicalPath,
            File(projectDir, "watchdog.js").canonicalPath,
        )
    }

    private fun runningExecutions(
        service: ScriptEngineService,
        targetPaths: Set<String>,
    ) = service.getScriptExecutions()
        .filter { execution -> execution.engine?.isDestroyed == false }
        .filter { execution ->
            (execution.source as? JavaScriptFileSource)?.file?.let { sourceFile ->
                runCatching { sourceFile.canonicalPath in targetPaths }.getOrDefault(false)
            } == true
        }

    private fun waitUntilStopped(service: ScriptEngineService, targetPaths: Set<String>): Boolean {
        val deadline = System.currentTimeMillis() + STOP_CONFIRM_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (runningExecutions(service, targetPaths).isEmpty()) return true
            Thread.sleep(STOP_CONFIRM_POLL_MS)
        }
        return false
    }

    companion object {
        private const val STOP_CONFIRM_TIMEOUT_MS = 5_000L
        private const val STOP_CONFIRM_POLL_MS = 100L
    }
}
