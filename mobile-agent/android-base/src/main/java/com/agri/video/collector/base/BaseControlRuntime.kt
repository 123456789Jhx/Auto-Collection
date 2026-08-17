package com.agri.video.collector.base

import android.content.Context
import okhttp3.OkHttpClient

class BaseControlRuntime(
    private val context: Context,
    private val httpClient: OkHttpClient,
) {
    private var activeCommandId: String? = null
    private var pendingCommand: BaseControlClient.Command? = null
    private var pendingResult: BaseControlCommandExecutor.Result? = null
    private val completedResultsByCommandId = LinkedHashMap<String, BaseControlCommandExecutor.Result>()

    @Synchronized
    fun runOnce() {
        val config = BaseConnectivityConfig.load(context) ?: return
        val identity = BaseConnectivityIdentity.load(context) ?: return
        val client = BaseControlClient(httpClient, identity)

        val awaitingAck = pendingCommand
        val completedResult = pendingResult
        if (awaitingAck != null && completedResult != null) {
            if (client.acknowledge(config, awaitingAck, completedResult)) clearExecution()
            return
        }

        if (activeCommandId != null) return
        val command = client.poll(config) ?: return
        activeCommandId = command.id
        val cachedResult = completedResultsByCommandId[command.id]
        if (cachedResult != null) {
            pendingCommand = command
            pendingResult = cachedResult
            if (client.acknowledge(config, command, cachedResult)) clearExecution()
            return
        }
        val result = try {
            BaseControlCommandExecutor(context).execute(command)
        } catch (_: Throwable) {
            executionFailureResult(command)
        }
        pendingCommand = command
        pendingResult = result
        cacheCompletedResult(command.id, result)
        try {
            if (client.acknowledge(config, command, result)) clearExecution()
        } finally {
            if (pendingCommand == null) activeCommandId = null
        }
    }

    private fun executionFailureResult(
        command: BaseControlClient.Command,
    ): BaseControlCommandExecutor.Result = if (command.commandType == "EXIT_AGENT_APP") {
        BaseControlCommandExecutor.Result(
            success = false,
            action = "EXECUTION_FAILED",
            reason = "UNEXPECTED_ERROR",
            exitResult = BaseControlCommandExecutor.ExitResult(
                businessResult = "FAILED",
                transportStatus = "FAILED",
                stages = listOf(
                    BaseControlCommandExecutor.Stage("STOP_AGENT", "FAILED", "UNEXPECTED_ERROR"),
                    BaseControlCommandExecutor.Stage(
                        "REMOVE_APP_TASK",
                        "SKIPPED",
                        "PREVIOUS_STAGE_FAILED",
                    ),
                    BaseControlCommandExecutor.Stage(
                        "LOCK_SCREEN",
                        "SKIPPED",
                        "PREVIOUS_STAGE_FAILED",
                    ),
                ),
            ),
        )
    } else {
        BaseControlCommandExecutor.Result(false, "EXECUTION_FAILED", "UNEXPECTED_ERROR")
    }

    private fun clearExecution() {
        pendingCommand = null
        pendingResult = null
        activeCommandId = null
    }

    private fun cacheCompletedResult(
        commandId: String,
        result: BaseControlCommandExecutor.Result,
    ) {
        completedResultsByCommandId[commandId] = result
        while (completedResultsByCommandId.size > MAX_COMPLETED_RESULT_CACHE_SIZE) {
            val eldest = completedResultsByCommandId.keys.firstOrNull() ?: return
            completedResultsByCommandId.remove(eldest)
        }
    }

    companion object {
        private const val MAX_COMPLETED_RESULT_CACHE_SIZE = 8
    }
}
