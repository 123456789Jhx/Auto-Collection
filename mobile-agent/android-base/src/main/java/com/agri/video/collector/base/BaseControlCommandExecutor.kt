package com.agri.video.collector.base

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class BaseControlCommandExecutor(private val context: Context) {
    data class Stage(val name: String, val status: String, val reason: String = "")
    data class ExitResult(
        val businessResult: String,
        val transportStatus: String,
        val stages: List<Stage>,
        val cleanupStages: List<Stage> = emptyList(),
    )
    data class Result(
        val success: Boolean,
        val action: String,
        val reason: String = "",
        val exitResult: ExitResult? = null,
    )

    fun execute(command: BaseControlClient.Command): Result = when (command.commandType) {
        "OPEN_AGENT_APP" -> ensureAppForeground()
        "START_AGENT" -> startAgent()
        "EXIT_AGENT_APP" -> exitAgentApp(command)
        else -> Result(false, "REJECTED", "UNSUPPORTED_BASE_COMMAND")
    }

    private fun ensureAppForeground(): Result {
        val appUiState = AppUiStateDetector(context).detect()
        if (!ensureScreenReady()) return Result(false, "SCREEN_NOT_READY", "SCREEN_UNLOCK_FAILED")
        val result = AppUiForegroundController(context).ensureForeground(appUiState)
        return Result(
            success = result in setOf(
                AppUiForegroundController.Result.ALREADY_FOREGROUND,
                AppUiForegroundController.Result.RESTORED_EXISTING_TASK,
                AppUiForegroundController.Result.LAUNCHED_NEW_TASK,
            ),
            action = result.name,
            reason = if (result.name.endsWith("FAILED") || result.name.endsWith("UNKNOWN")) result.name else "",
        )
    }

    private fun startAgent(): Result {
        val appUiState = AppUiStateDetector(context).detect()
        if (!ensureScreenReady()) return Result(false, "SCREEN_NOT_READY", "SCREEN_UNLOCK_FAILED")
        val appResult = AppUiForegroundController(context).ensureForeground(appUiState)
        if (appResult !in setOf(
                AppUiForegroundController.Result.ALREADY_FOREGROUND,
                AppUiForegroundController.Result.RESTORED_EXISTING_TASK,
                AppUiForegroundController.Result.LAUNCHED_NEW_TASK,
            )
        ) return Result(false, "APP_NOT_READY", appResult.name)

        val agentResult = AgentRuntimeStarter(context).ensureStarted()
        return Result(
            success = agentResult == AgentRuntimeStarter.Result.ALREADY_RUNNING ||
                agentResult == AgentRuntimeStarter.Result.STARTED,
            action = agentResult.name,
            reason = if (agentResult == AgentRuntimeStarter.Result.SCRIPT_MISSING ||
                agentResult == AgentRuntimeStarter.Result.START_FAILED ||
                agentResult == AgentRuntimeStarter.Result.READY_TIMEOUT
            ) agentResult.name else "",
        )
    }

    private fun exitAgentApp(command: BaseControlClient.Command): Result = exitLock.withLock {
        val malformedReason = payloadErrorReason(command)
        if (malformedReason != null) {
            return@withLock exitFailure(
                "MALFORMED_PAYLOAD",
                listOf(
                    Stage("STOP_AGENT", "FAILED", malformedReason),
                    Stage("EXIT_DOUYIN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("REMOVE_APP_TASK", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("LOCK_SCREEN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                ),
            )
        }

        val lockScreen = parseLockScreen(command.payload)
            ?: return@withLock exitFailure(
                "MALFORMED_PAYLOAD",
                listOf(
                    Stage("STOP_AGENT", "FAILED", "MALFORMED_LOCK_SCREEN"),
                    Stage("EXIT_DOUYIN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("REMOVE_APP_TASK", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                    Stage("LOCK_SCREEN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
                ),
            )

        val stages = mutableListOf<Stage>()
        val stopStage = when (AgentRuntimeStopper(context).stop()) {
            AgentRuntimeStopper.Result.STOPPED -> Stage("STOP_AGENT", "SUCCESS")
            AgentRuntimeStopper.Result.ALREADY_STOPPED -> Stage("STOP_AGENT", "SKIPPED", "ALREADY_STOPPED")
            AgentRuntimeStopper.Result.STOP_FAILED -> Stage("STOP_AGENT", "FAILED", "STOP_FAILED")
        }
        stages += stopStage
        if (stopStage.status == "FAILED") {
            stages += Stage("EXIT_DOUYIN", "SKIPPED", "PREVIOUS_STAGE_FAILED")
            stages += Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED")
            stages += Stage("REMOVE_APP_TASK", "SKIPPED", "PREVIOUS_STAGE_FAILED")
            stages += Stage("LOCK_SCREEN", "SKIPPED", "PREVIOUS_STAGE_FAILED")
            return@withLock exitFailure("STOP_AGENT_FAILED", stages)
        }

        val cleanupResult = AgentDisconnectCleanupCoordinator(context).run(
            deviceId = BaseConnectivityIdentity.load(context)?.deviceId ?: context.packageName,
            stopAlreadyPerformed = true,
        )
        stages += cleanupResult.stages.filter { it.name != "STOP_AGENT" }

        val removeStage = when (AppUiForegroundController(context).removeTask()) {
            AppUiForegroundController.Result.REMOVED_EXISTING_TASK -> Stage("REMOVE_APP_TASK", "SUCCESS")
            AppUiForegroundController.Result.NO_UI_TASK -> Stage("REMOVE_APP_TASK", "SKIPPED", "NO_UI_TASK")
            AppUiForegroundController.Result.STATE_UNKNOWN -> Stage("REMOVE_APP_TASK", "FAILED", "APP_UI_STATE_UNKNOWN")
            else -> Stage("REMOVE_APP_TASK", "FAILED", "REMOVE_TASK_FAILED")
        }
        stages += removeStage
        if (removeStage.status == "FAILED") {
            stages += Stage("LOCK_SCREEN", "SKIPPED", "PREVIOUS_STAGE_FAILED")
            return@withLock exitFailure("REMOVE_APP_TASK_FAILED", stages)
        }

        if (!lockScreen) {
            stages += Stage("LOCK_SCREEN", "SKIPPED", "NOT_REQUESTED")
            return@withLock exitDone(stages)
        }

        val lockStage = when (ScreenLockController(context).lock()) {
            ScreenLockController.Result.LOCKED -> Stage("LOCK_SCREEN", "SUCCESS")
            ScreenLockController.Result.ALREADY_LOCKED -> Stage("LOCK_SCREEN", "SKIPPED", "ALREADY_LOCKED")
            ScreenLockController.Result.LOCK_FAILED -> Stage("LOCK_SCREEN", "FAILED", "LOCK_FAILED")
        }
        stages += lockStage
        return@withLock if (lockStage.status == "FAILED") exitPartial(stages) else exitDone(stages)
    }

    private fun payloadErrorReason(command: BaseControlClient.Command): String? {
        if (command.payloadMalformed) return "MALFORMED_PAYLOAD"
        val keys = command.payload.keys()
        while (keys.hasNext()) {
            if (keys.next() != "lockScreen") return "UNKNOWN_PAYLOAD_KEY"
        }
        if (command.payload.has("lockScreen") && command.payload.opt("lockScreen") !is Boolean) {
            return "MALFORMED_LOCK_SCREEN"
        }
        return null
    }

    private fun parseLockScreen(payload: JSONObject): Boolean? {
        val keys = payload.keys()
        while (keys.hasNext()) {
            if (keys.next() != "lockScreen") return null
        }
        if (!payload.has("lockScreen")) return false
        return if (payload.opt("lockScreen") is Boolean) payload.getBoolean("lockScreen") else null
    }

    private fun exitDone(stages: List<Stage>): Result = exitResult("DONE", "DONE", stages)

    private fun exitPartial(stages: List<Stage>): Result = exitResult("PARTIAL", "DONE", stages)

    private fun exitFailure(action: String, stages: List<Stage>): Result =
        exitResult("FAILED", "FAILED", stages, action)

    private fun exitResult(
        businessResult: String,
        transportStatus: String,
        stages: List<Stage>,
        action: String = "EXIT_AGENT_APP",
    ): Result {
        // Exit must not leave the management UI waiting for the normal interval.
        BaseConnectivityService.requestImmediateHeartbeat(context)
        return Result(
            success = transportStatus == "DONE",
            action = action,
            reason = if (businessResult == "FAILED") action else "",
            exitResult = ExitResult(
                businessResult = businessResult,
                transportStatus = transportStatus,
                stages = canonicalStages(stages),
                cleanupStages = stages.filter { it.name == "EXIT_DOUYIN" || it.name == "OPEN_AGENT_HOME" },
            ),
        )
    }

    private fun canonicalStages(stages: List<Stage>): List<Stage> {
        val byName = stages.associateBy { it.name }
        return listOf(
            byName["STOP_AGENT"] ?: Stage("STOP_AGENT", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
            byName["EXIT_DOUYIN"] ?: Stage("EXIT_DOUYIN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
            byName["OPEN_AGENT_HOME"] ?: Stage("OPEN_AGENT_HOME", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
            byName["REMOVE_APP_TASK"] ?: Stage("REMOVE_APP_TASK", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
            byName["LOCK_SCREEN"] ?: Stage("LOCK_SCREEN", "SKIPPED", "PREVIOUS_STAGE_FAILED"),
        )
    }

    private fun ensureScreenReady(): Boolean =
        ScreenStateDetector(context).detect() != ScreenState.LOCKED ||
            BaseScreenUnlockActivity.unlock(context)

    companion object {
        private val exitLock = ReentrantLock()
    }
}
