package com.agri.video.collector.base

import android.app.ActivityManager
import android.content.Context

class AppUiStateDetector(private val context: Context) {
    fun detect(): AppUiState = try {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return AppUiState.UNKNOWN
        val hasAppTask = activityManager.appTasks.any { appTask ->
            appTask.taskInfo.baseIntent?.component?.packageName == context.packageName
        }
        // A foreground service also raises this process to foreground priority.
        // Only the top activity can prove that the App UI itself is visible.
        val hasForegroundActivity = activityManager.getRunningTasks(1)
            .firstOrNull()
            ?.topActivity
            ?.packageName == context.packageName
        AppUiState.classify(
            inspectionSucceeded = true,
            hasAppTask = hasAppTask,
            hasForegroundActivity = hasForegroundActivity,
        )
    } catch (_: Throwable) {
        AppUiState.UNKNOWN
    }
}
