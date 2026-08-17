package com.agri.video.collector.base

import android.app.ActivityManager
import android.content.Context
import android.content.Intent

class AppUiForegroundController(private val context: Context) {
    enum class Result {
        ALREADY_FOREGROUND,
        RESTORED_EXISTING_TASK,
        LAUNCHED_NEW_TASK,
        REMOVED_EXISTING_TASK,
        NO_UI_TASK,
        STATE_UNKNOWN,
        TASK_NOT_FOUND,
        LAUNCH_INTENT_UNAVAILABLE,
        REMOVE_TASK_FAILED,
        ACTION_FAILED,
    }

    @Synchronized
    fun ensureForeground(): Result = ensureForeground(AppUiStateDetector(context).detect())

    fun ensureForeground(state: AppUiState): Result = when (state) {
        AppUiState.FOREGROUND -> Result.ALREADY_FOREGROUND
        AppUiState.BACKGROUND -> restoreExistingTask()
        AppUiState.NOT_RUNNING -> launchNewTask()
        AppUiState.UNKNOWN -> Result.STATE_UNKNOWN
    }

    @Synchronized
    fun removeTask(): Result = removeTask(AppUiStateDetector(context).detect())

    fun removeTask(state: AppUiState): Result = when (state) {
        AppUiState.FOREGROUND,
        AppUiState.BACKGROUND -> removeMatchingTasks()
        AppUiState.NOT_RUNNING -> Result.NO_UI_TASK
        AppUiState.UNKNOWN -> Result.STATE_UNKNOWN
    }

    private fun restoreExistingTask(): Result = try {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return Result.ACTION_FAILED
        val appTask = activityManager.appTasks.firstOrNull { task ->
            task.taskInfo.baseIntent?.component?.packageName == context.packageName
        } ?: return Result.TASK_NOT_FOUND
        appTask.moveToFront()
        Result.RESTORED_EXISTING_TASK
    } catch (_: Throwable) {
        Result.ACTION_FAILED
    }

    private fun launchNewTask(): Result = try {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: return Result.LAUNCH_INTENT_UNAVAILABLE
        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
        context.startActivity(launchIntent)
        Result.LAUNCHED_NEW_TASK
    } catch (_: Throwable) {
        Result.ACTION_FAILED
    }

    private fun removeMatchingTasks(): Result = try {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return Result.REMOVE_TASK_FAILED
        val appTasks = activityManager.appTasks.filter { task ->
            task.taskInfo.baseIntent?.component?.packageName == context.packageName
        }
        if (appTasks.isEmpty()) return Result.NO_UI_TASK
        appTasks.forEach { appTask -> appTask.finishAndRemoveTask() }
        Result.REMOVED_EXISTING_TASK
    } catch (_: Throwable) {
        Result.REMOVE_TASK_FAILED
    }
}
