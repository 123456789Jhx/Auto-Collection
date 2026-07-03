import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton } from "antd";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { getRecordDates, getRecordDeviceSummary, getRecords } from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle } from "../lib/display-maps";
import { sceneText, statusText } from "../lib/display-maps";

type RecordDeviceSummary = {
  deviceCode?: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  totalCount: number;
  videoCount: number;
  liveCount: number;
  latestRecordAt?: string | null;
  deviceStatus?: string;
  lastHeartbeatAt?: string | null;
};

type RecordDateSummary = {
  recordDate: string;
  totalCount: number;
  videoCount: number;
  liveCount: number;
  latestRecordAt?: string | null;
};

type CollectionRecord = {
  id: string;
  createdAt?: string;
  sceneType?: string;
  authorName?: string | null;
  keyword?: string | null;
  matchedKeywords?: string[] | null;
  titleText?: string | null;
  subtitleText?: string | null;
  metricsText?: string | null;
  hotCommentsJson?: string[] | null;
  screenText?: string | null;
};

type Pagination = {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
};

type DisplayRecord = CollectionRecord & {
  duplicateCount: number;
  duplicateIds: string[];
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function nextDate(value?: string) {
  if (!value) return undefined;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return undefined;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setDate(date.getDate() + 1);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`;
}

function matchedKeywordText(value?: string[] | null) {
  return Array.isArray(value) && value.length ? value.join("、") : "-";
}

function compactText(value?: string | null, fallback = "-", maxLength = 64) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sceneTone(value?: string | null) {
  if (value === "live") return "green";
  if (value === "video") return "blue";
  return "gray";
}

function normalizeRecordText(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[，。,.！!？?；;：:、]/g, "")
    .trim()
    .slice(0, 96);
}

function recordDedupKey(record: CollectionRecord) {
  return [
    record.sceneType || "",
    normalizeRecordText(record.authorName),
    normalizeRecordText(record.titleText),
    normalizeRecordText(record.subtitleText),
    normalizeRecordText(record.screenText)
  ].join("|");
}

function compactDuplicateRecords(records: CollectionRecord[]) {
  const byKey = new Map<string, DisplayRecord>();
  records.forEach((record) => {
    const key = recordDedupKey(record);
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.duplicateCount += 1;
      existing.duplicateIds.push(record.id);
      return;
    }
    byKey.set(key || record.id, {
      ...record,
      duplicateCount: 1,
      duplicateIds: [record.id]
    });
  });
  return Array.from(byKey.values());
}

function statusTone(value?: string | null) {
  if (value === "error" || value === "risk_control") return "red";
  if (value === "offline" || value === "stopped") return "gray";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "amber";
  return "green";
}

export function RecordsPage() {
  const [selectedDeviceCode, setSelectedDeviceCode] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [previewRecordId, setPreviewRecordId] = useState("");
  const [sceneType, setSceneType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(20);

  const summaryQuery = useQuery({
    queryKey: ["record-device-summary"],
    queryFn: () => getRecordDeviceSummary(),
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const summaries = useMemo(() => (summaryQuery.data ?? []) as RecordDeviceSummary[], [summaryQuery.data]);
  const selectedDevice = useMemo(
    () => summaries.find((item) => item.deviceCode === selectedDeviceCode) ?? null,
    [selectedDeviceCode, summaries]
  );

  const dateQuery = useQuery({
    queryKey: ["record-dates", selectedDeviceCode],
    queryFn: () => getRecordDates(selectedDeviceCode),
    enabled: !!selectedDeviceCode,
    refetchInterval: selectedDeviceCode && autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const dates = useMemo(() => (dateQuery.data ?? []) as RecordDateSummary[], [dateQuery.data]);
  const selectedDateSummary = useMemo(
    () => dates.find((item) => item.recordDate === selectedDate) ?? null,
    [dates, selectedDate]
  );

  const recordsQuery = useQuery({
    queryKey: ["records", selectedDeviceCode, selectedDate, sceneType, keyword, recordsPage, recordsPageSize],
    queryFn: () => getRecords({
      deviceCode: selectedDeviceCode,
      sceneType,
      keyword,
      createdFrom: selectedDate,
      createdTo: nextDate(selectedDate),
      page: recordsPage,
      pageSize: recordsPageSize
    }),
    enabled: !!selectedDeviceCode && !!selectedDate,
    refetchInterval: selectedDeviceCode && selectedDate && autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const records = useMemo(() => (recordsQuery.data?.data ?? []) as CollectionRecord[], [recordsQuery.data]);
  const displayRecords = useMemo(() => compactDuplicateRecords(records), [records]);
  const recordsPagination = (recordsQuery.data?.pagination ?? {}) as Pagination;
  const selectedRecord = useMemo(
    () => displayRecords.find((item) => item.id === previewRecordId) ?? displayRecords[0] ?? null,
    [previewRecordId, displayRecords]
  );

  if (summaryQuery.isLoading) return <Skeleton active />;
  if (summaryQuery.isError) return <Alert type="error" message="采集记录加载失败" description={summaryQuery.error.message} showIcon />;

  const totalRecords = summaries.reduce((sum, item) => sum + Number(item.totalCount || 0), 0);
  const videoRecords = summaries.reduce((sum, item) => sum + Number(item.videoCount || 0), 0);
  const liveRecords = summaries.reduce((sum, item) => sum + Number(item.liveCount || 0), 0);
  const activeDevices = summaries.filter((item) => Number(item.totalCount || 0) > 0).length;

  const refreshAll = () => {
    void summaryQuery.refetch();
    if (selectedDeviceCode) void dateQuery.refetch();
    if (selectedDeviceCode && selectedDate) void recordsQuery.refetch();
  };

  const openDevice = (deviceCode?: string) => {
    if (!deviceCode) return;
    setSelectedDeviceCode(deviceCode);
    setSelectedDate("");
    setPreviewRecordId("");
    setSceneType("");
    setKeyword("");
    setRecordsPage(1);
  };

  const openDate = (date: string) => {
    setSelectedDate(date);
    setPreviewRecordId("");
    setRecordsPage(1);
  };

  const backToDevices = () => {
    setSelectedDeviceCode("");
    setSelectedDate("");
    setPreviewRecordId("");
    setSceneType("");
    setKeyword("");
    setRecordsPage(1);
  };

  const backToDates = () => {
    setSelectedDate("");
    setPreviewRecordId("");
    setRecordsPage(1);
  };

  const applyRecordFilters = () => {
    setPreviewRecordId("");
    setRecordsPage(1);
    void recordsQuery.refetch();
  };

  const totalPages = Math.max(1, Number(recordsPagination.totalPages || 1));
  const totalItems = Number(recordsPagination.totalItems || 0);
  const renderRecordPagination = () => (
    <div className="ops-pagination">
      <div className="ops-small">
        原始 {totalItems} 条，本页 {records.length} 条，合并后 {displayRecords.length} 条
      </div>
      <div className="ops-pagination-controls">
        <button className="ops-btn" type="button" disabled={recordsPage <= 1} onClick={() => setRecordsPage((page) => Math.max(1, page - 1))}>上一页</button>
        <span className="ops-page-indicator">{recordsPage} / {totalPages}</span>
        <button className="ops-btn" type="button" disabled={recordsPage >= totalPages} onClick={() => setRecordsPage((page) => Math.min(totalPages, page + 1))}>下一页</button>
        <select className="ops-input compact" value={recordsPageSize} onChange={(event) => { setRecordsPageSize(Number(event.currentTarget.value)); setRecordsPage(1); }}>
          <option value={10}>10条/页</option>
          <option value={20}>20条/页</option>
          <option value={50}>50条/页</option>
        </select>
      </div>
    </div>
  );

  const renderToolbar = (extra?: ReactNode) => (
    <div className="ops-toolbar">
      {extra}
      <button className="ops-btn" type="button" onClick={refreshAll}>刷新</button>
      <select className="ops-input" value={autoRefreshSeconds} onChange={(event) => setAutoRefreshSeconds(Number(event.currentTarget.value))}>
        <option value={5}>5秒刷新</option>
        <option value={15}>15秒刷新</option>
        <option value={30}>30秒刷新</option>
        <option value={0}>暂停刷新</option>
      </select>
    </div>
  );

  const renderStats = () => (
    <section className="ops-stats four">
      <div className="ops-stat">
        <div className="ops-stat-label">总记录</div>
        <div className="ops-stat-value">{totalRecords}</div>
        <div className="ops-stat-note">后台已收到的采集内容</div>
      </div>
      <div className="ops-stat">
        <div className="ops-stat-label">视频</div>
        <div className="ops-stat-value">{videoRecords}</div>
        <div className="ops-stat-note">短视频来源</div>
      </div>
      <div className="ops-stat">
        <div className="ops-stat-label">直播</div>
        <div className="ops-stat-value">{liveRecords}</div>
        <div className="ops-stat-note">直播间来源</div>
      </div>
      <div className="ops-stat">
        <div className="ops-stat-label">有记录设备</div>
        <div className="ops-stat-value">{activeDevices}</div>
        <div className="ops-stat-note">最近采集：{formatDateTime(summaries[0]?.latestRecordAt)}</div>
      </div>
    </section>
  );

  if (!selectedDeviceCode) {
    return (
      <div className="ops-page">
        <header className="ops-topbar">
          <div>
            <h1>采集记录</h1>
            <p>先选择手机，再选择日期，最后查看当天采集内容，保留原来的记录查看路径。</p>
          </div>
          {renderToolbar()}
        </header>

        {renderStats()}

        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>按手机查看采集记录</span>
            <span className="ops-small">点击手机卡片进入日期列表</span>
          </div>
          <div className="ops-panel-body">
            {summaries.length === 0 ? <div className="ops-empty">暂无设备采集记录</div> : null}
            <div className="ops-card-grid">
              {summaries.map((item) => (
                <button
                  className="ops-device-card"
                  disabled={!item.deviceCode}
                  key={item.deviceCode || item.deviceName}
                  type="button"
                  onClick={() => openDevice(item.deviceCode)}
                >
                  <div className="ops-card-head">
                    <div>
                      <div className="ops-title">{deviceDisplayName(item)}</div>
                      <div className="ops-small">{deviceSubTitle(item)}</div>
                    </div>
                    <span className={`ops-tag ${statusTone(item.deviceStatus)}`}>{statusText(item.deviceStatus)}</span>
                  </div>
                  <div className="ops-mini-stats">
                    <div className="ops-mini-stat"><span>总采集</span><strong>{item.totalCount}</strong></div>
                    <div className="ops-mini-stat"><span>视频</span><strong>{item.videoCount}</strong></div>
                    <div className="ops-mini-stat"><span>直播</span><strong>{item.liveCount}</strong></div>
                  </div>
                  <div className="ops-card-meta">
                    <span>最近采集</span>
                    <strong>{formatDateTime(item.latestRecordAt)}</strong>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!selectedDevice) {
    return (
      <div className="ops-page">
        <header className="ops-topbar">
          <div>
            <h1>采集记录</h1>
            <p>所选设备不在当前汇总中，请返回设备列表重新选择。</p>
          </div>
          {renderToolbar(<button className="ops-btn" type="button" onClick={backToDevices}>返回手机列表</button>)}
        </header>
      </div>
    );
  }

  if (!selectedDate) {
    return (
      <div className="ops-page">
        <header className="ops-topbar">
          <div>
            <h1>{deviceDisplayName(selectedDevice)}</h1>
            <p>选择日期后查看当天采集记录，日期卡片按后台返回的记录日汇总展示。</p>
          </div>
          {renderToolbar(<button className="ops-btn" type="button" onClick={backToDevices}>返回手机列表</button>)}
        </header>

        <section className="ops-stats four">
          <div className="ops-stat">
            <div className="ops-stat-label">设备总记录</div>
            <div className="ops-stat-value">{selectedDevice.totalCount}</div>
            <div className="ops-stat-note">设备编号：{selectedDevice.deviceCode}</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">视频</div>
            <div className="ops-stat-value">{selectedDevice.videoCount}</div>
            <div className="ops-stat-note">短视频采集</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">直播</div>
            <div className="ops-stat-value">{selectedDevice.liveCount}</div>
            <div className="ops-stat-note">直播间采集</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">设备状态</div>
            <div className="ops-stat-value">{statusText(selectedDevice.deviceStatus)}</div>
            <div className="ops-stat-note">最近采集：{formatDateTime(selectedDevice.latestRecordAt)}</div>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>采集日期</span>
            <span className="ops-small">点击日期卡片进入当天内容列表</span>
          </div>
          <div className="ops-panel-body">
            {dateQuery.isLoading ? <Skeleton active /> : null}
            {dateQuery.isError ? <Alert type="error" message="采集日期加载失败" description={dateQuery.error.message} showIcon /> : null}
            {!dateQuery.isLoading && !dateQuery.isError && dates.length === 0 ? <div className="ops-empty">这台手机还没有采集日期</div> : null}
            <div className="ops-card-grid">
              {dates.map((item) => (
                <button className="ops-device-card" key={item.recordDate} type="button" onClick={() => openDate(item.recordDate)}>
                  <div className="ops-card-head">
                    <div>
                      <div className="ops-title">{item.recordDate}</div>
                      <div className="ops-small">最近采集：{formatDateTime(item.latestRecordAt)}</div>
                    </div>
                    <span className="ops-tag blue">{item.totalCount} 条</span>
                  </div>
                  <div className="ops-mini-stats">
                    <div className="ops-mini-stat"><span>总采集</span><strong>{item.totalCount}</strong></div>
                    <div className="ops-mini-stat"><span>视频</span><strong>{item.videoCount}</strong></div>
                    <div className="ops-mini-stat"><span>直播</span><strong>{item.liveCount}</strong></div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ops-page">
      <header className="ops-topbar">
        <div>
          <h1>采集记录</h1>
          <p>{deviceDisplayName(selectedDevice)} · {selectedDate}，查看当天采集内容和详情。</p>
        </div>
        {renderToolbar(
          <>
            <button className="ops-btn" type="button" onClick={backToDates}>返回日期</button>
            <button className="ops-btn" type="button" onClick={backToDevices}>返回手机列表</button>
          </>
        )}
      </header>

      <section className="ops-filter-panel three">
        <div className="ops-field">
          <label htmlFor="records-current-device">当前手机</label>
          <input id="records-current-device" className="ops-input" readOnly value={`${deviceDisplayName(selectedDevice)} / ${selectedDevice.deviceCode}`} />
        </div>
        <div className="ops-field">
          <label htmlFor="records-scene">来源</label>
          <select id="records-scene" className="ops-input" value={sceneType} onChange={(event) => { setSceneType(event.currentTarget.value); setRecordsPage(1); }}>
            <option value="">全部来源</option>
            <option value="video">视频</option>
            <option value="live">直播</option>
          </select>
        </div>
        <div className="ops-field">
          <label htmlFor="records-keyword">关键词</label>
          <input id="records-keyword" className="ops-input" value={keyword} onChange={(event) => { setKeyword(event.currentTarget.value); setRecordsPage(1); }} placeholder="标题 / 作者 / 命中词" />
        </div>
        <button className="ops-btn" type="button" onClick={applyRecordFilters}>应用筛选</button>
      </section>

      <section className="ops-workbench wide-side">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <span>内容列表</span>
            <span className="ops-small">{deviceDisplayName(selectedDevice)} · {selectedDate} · 同页重复已合并</span>
          </div>
          {recordsQuery.isLoading ? <div className="ops-panel-body"><Skeleton active /></div> : null}
          {recordsQuery.isError ? <div className="ops-panel-body"><Alert type="error" message="采集记录加载失败" description={recordsQuery.error.message} showIcon /></div> : null}
          {!recordsQuery.isLoading && !recordsQuery.isError ? (
            <>
              {renderRecordPagination()}
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>采集时间</th>
                      <th>内容</th>
                      <th>来源</th>
                      <th>作者 / 搜索词</th>
                      <th>命中原因</th>
                      <th>指标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRecords.length === 0 ? (
                      <tr><td className="ops-empty" colSpan={6}>当前条件下没有采集记录</td></tr>
                    ) : displayRecords.map((record) => (
                      <tr key={record.id} className={record.id === selectedRecord?.id ? "selected" : ""} onClick={() => setPreviewRecordId(record.id)}>
                        <td>
                          <div>{formatDateTime(record.createdAt)}</div>
                          {record.duplicateCount > 1 ? <span className="ops-tag amber">重复 {record.duplicateCount} 条</span> : null}
                        </td>
                        <td>
                          <div className="ops-title">{compactText(record.titleText, "未识别标题", 72)}</div>
                          <div className="ops-small">{compactText(record.subtitleText, "", 88)}</div>
                        </td>
                        <td><span className={`ops-tag ${sceneTone(record.sceneType)}`}>{sceneText(record.sceneType)}</span></td>
                        <td>
                          <div>{record.authorName || "-"}</div>
                          <div className="ops-small">{record.keyword || "无搜索词"}</div>
                        </td>
                        <td>{matchedKeywordText(record.matchedKeywords)}</td>
                        <td>{compactText(record.metricsText, "-", 42)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderRecordPagination()}
            </>
          ) : null}
        </div>

        <aside className="ops-panel">
          <div className="ops-panel-head">
            <span>记录详情</span>
            <span className={`ops-tag ${sceneTone(selectedRecord?.sceneType)}`}>{selectedRecord ? sceneText(selectedRecord.sceneType) : "未选择"}</span>
          </div>
          <div className="ops-panel-body">
            <div className="ops-kv">
              <div className="ops-k">设备</div><div>{deviceDisplayName(selectedDevice)}</div>
              <div className="ops-k">设备名称</div><div>{selectedDevice.deviceName || "-"}</div>
              <div className="ops-k">设备状态</div><div><span className={`ops-tag ${statusTone(selectedDevice.deviceStatus)}`}>{statusText(selectedDevice.deviceStatus)}</span></div>
              <div className="ops-k">日期记录</div><div>{selectedDateSummary?.totalCount ?? records.length} 条</div>
              <div className="ops-k">视频 / 直播</div><div>{selectedDateSummary?.videoCount ?? 0} / {selectedDateSummary?.liveCount ?? 0}</div>
              <div className="ops-k">最近采集</div><div>{formatDateTime(selectedDateSummary?.latestRecordAt || selectedDevice.latestRecordAt)}</div>
              <div className="ops-k">重复合并</div><div>{selectedRecord?.duplicateCount && selectedRecord.duplicateCount > 1 ? `同页合并 ${selectedRecord.duplicateCount} 条` : "无重复"}</div>
            </div>

            {selectedRecord ? (
              <>
                <div className="ops-panel-note" style={{ marginTop: 14 }}>标题 / 文案</div>
                <div className="ops-title" style={{ marginTop: 6 }}>{selectedRecord.titleText || "-"}</div>
                {selectedRecord.subtitleText ? <div className="ops-small" style={{ marginTop: 4 }}>{selectedRecord.subtitleText}</div> : null}

                <div className="ops-kv" style={{ marginTop: 14 }}>
                  <div className="ops-k">作者</div><div>{selectedRecord.authorName || "-"}</div>
                  <div className="ops-k">搜索词</div><div>{selectedRecord.keyword || "-"}</div>
                  <div className="ops-k">命中词</div><div>{matchedKeywordText(selectedRecord.matchedKeywords)}</div>
                  <div className="ops-k">指标</div><div>{selectedRecord.metricsText || "-"}</div>
                </div>

                {selectedRecord.hotCommentsJson?.length ? (
                  <>
                    <div className="ops-panel-note" style={{ marginTop: 14 }}>热门评论</div>
                    <div className="ops-log-box">{selectedRecord.hotCommentsJson.map((comment, index) => `${index + 1}. ${comment}`).join("\n")}</div>
                  </>
                ) : null}

                {selectedRecord.screenText ? (
                  <>
                    <div className="ops-panel-note" style={{ marginTop: 14 }}>屏幕文本</div>
                    <div className="ops-log-box">{selectedRecord.screenText}</div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="ops-empty">请选择一条采集记录</div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
