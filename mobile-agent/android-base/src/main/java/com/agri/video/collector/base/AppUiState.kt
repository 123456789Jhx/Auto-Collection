package com.agri.video.collector.base

enum class AppUiState(val wireValue: String) {
    FOREGROUND("foreground"),
    BACKGROUND("background"),
    NOT_RUNNING("not_running"),
    UNKNOWN("unknown");

    companion object {
        fun classify(
            inspectionSucceeded: Boolean,
            hasAppTask: Boolean,
            hasForegroundActivity: Boolean,
        ): AppUiState {
            if (!inspectionSucceeded) return UNKNOWN
            if (!hasAppTask) return NOT_RUNNING
            return if (hasForegroundActivity) FOREGROUND else BACKGROUND
        }
    }
}
