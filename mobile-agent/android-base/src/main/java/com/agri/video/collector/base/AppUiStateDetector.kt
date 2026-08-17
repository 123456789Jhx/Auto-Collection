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
        val hasForegroundActivity = activityManager.runningAppProcesses.orEmpty().any { process ->
            process.processName == context.packageName &&
                process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
        AppUiState.classify(
            inspectionSucceeded = true,
            hasAppTask = hasAppTask,
            hasForegroundActivity = hasForegroundActivity,
        )
    } catch (_: Throwable) {
        AppUiState.UNKNOWN
    }
}
