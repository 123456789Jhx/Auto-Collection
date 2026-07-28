import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type TableColumnsType
} from "antd";
import { useMemo, useState } from "react";
import {
  createRemoteScriptConfig,
  deleteRemoteScriptConfig,
  getRemoteScriptConfigs,
  getRemoteScriptDefinitions,
  updateRemoteScriptConfig,
  type RemoteScriptConfig,
  type RemoteScriptStatus
} from "../lib/api-client-remote-scripts";
import {
  RemoteScriptConfigModal,
  type RemoteScriptConfigSavePayload
} from "./RemoteScriptConfigModal";
import { RemoteScriptBindingsModal } from "./RemoteScriptBindingsModal";

const statusOptions = [
  { value: "ENABLED", label: "已启用" },
  { value: "DISABLED", label: "已停用" }
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function RemoteScriptsPage() {
  const queryClient = useQueryClient();
  const [scriptKey, setScriptKey] = useState<string>();
  const [status, setStatus] = useState<RemoteScriptStatus>();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<RemoteScriptConfig | null>(null);
  const [bindingConfig, setBindingConfig] = useState<RemoteScriptConfig | null>(null);

  const definitionsQuery = useQuery({
    queryKey: ["remoteScriptDefinitions"],
    queryFn: getRemoteScriptDefinitions
  });
  const configsQuery = useQuery({
    queryKey: ["remoteScriptConfigs", scriptKey, status, keyword, page, pageSize],
    queryFn: () => getRemoteScriptConfigs({ scriptKey, status, keyword, page, pageSize })
  });
  const definitionNames = useMemo(
    () => new Map((definitionsQuery.data ?? []).map((item) => [
      item.scriptKey,
      item.scriptName || item.displayName || item.scriptKey
    ])),
    [definitionsQuery.data]
  );

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: ["remoteScriptConfigs"] });
  }

  const saveMutation = useMutation({
    mutationFn: (input: RemoteScriptConfigSavePayload) => input.mode === "create"
      ? createRemoteScriptConfig(input.payload)
      : updateRemoteScriptConfig(input.id, input.payload),
    onSuccess: async () => {
      message.success(editingConfig ? "配置已更新" : "配置已创建");
      setModalOpen(false);
      setEditingConfig(null);
      await refreshList();
    },
    onError: (error: Error) => message.error(error.message || "配置保存失败")
  });
  const statusMutation = useMutation({
    mutationFn: (config: RemoteScriptConfig) => updateRemoteScriptConfig(config.id, {
      status: config.status === "ENABLED" ? "DISABLED" : "ENABLED"
    }),
    onSuccess: async (config) => {
      message.success(config.status === "ENABLED" ? "配置已启用" : "配置已停用");
      await refreshList();
    },
    onError: (error: Error) => message.error(error.message || "状态更新失败")
  });
  const deleteMutation = useMutation({
    mutationFn: deleteRemoteScriptConfig,
    onSuccess: async () => {
      message.success("配置已删除");
      await refreshList();
    },
    onError: (error: Error) => message.error(error.message || "删除失败")
  });

  const columns: TableColumnsType<RemoteScriptConfig> = [
    {
      title: "配置名",
      dataIndex: "configName",
      render: (value: string, record) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          {record.remark ? <div><Typography.Text type="secondary">{record.remark}</Typography.Text></div> : null}
        </div>
      )
    },
    {
      title: "类型",
      dataIndex: "scriptKey",
      render: (value: string) => definitionNames.get(value) ?? value
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: RemoteScriptStatus) => (
        <Tag color={value === "ENABLED" ? "green" : "default"}>
          {value === "ENABLED" ? "已启用" : "已停用"}
        </Tag>
      )
    },
    { title: "Revision", dataIndex: "revision", width: 100 },
    { title: "绑定数", dataIndex: "bindingCount", width: 90 },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: formatDate
    },
    {
      title: "操作",
      key: "actions",
      width: 340,
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingConfig(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Button type="text" icon={<LinkOutlined />} onClick={() => setBindingConfig(record)}>
            绑定设备
          </Button>
          <Button
            type="text"
            icon={record.status === "ENABLED" ? <StopOutlined /> : <CheckCircleOutlined />}
            loading={statusMutation.isPending && statusMutation.variables?.id === record.id}
            onClick={() => statusMutation.mutate(record)}
          >
            {record.status === "ENABLED" ? "停用" : "启用"}
          </Button>
          <Popconfirm
            title="删除配置"
            description={`确定删除“${record.configName}”吗？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteMutation.mutate(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const definitions = definitionsQuery.data ?? [];

  return (
    <div className="ops-page">
      <div className="ops-page-header">
        <div>
          <Typography.Title level={3}>远程脚本</Typography.Title>
          <Typography.Text type="secondary">共 {configsQuery.data?.total ?? 0} 条配置</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void configsQuery.refetch()} loading={configsQuery.isFetching} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!definitions.some((item) => item.status === "ENABLED")}
            onClick={() => {
              setEditingConfig(null);
              setModalOpen(true);
            }}
          >
            新建配置
          </Button>
        </Space>
      </div>

      <section className="ops-panel">
        <div className="ops-panel-body">
          <Space wrap style={{ marginBottom: 16 }}>
            <Select
              allowClear
              placeholder="全部脚本类型"
              style={{ width: 220 }}
              loading={definitionsQuery.isLoading}
              value={scriptKey}
              options={definitions.map((item) => ({
                value: item.scriptKey,
                label: item.scriptName || item.displayName || item.scriptKey
              }))}
              onChange={(value) => {
                setScriptKey(value);
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 140 }}
              value={status}
              options={statusOptions}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
            <Input.Search
              allowClear
              placeholder="搜索配置名或备注"
              style={{ width: 280 }}
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => {
                setKeyword(value.trim());
                setPage(1);
              }}
            />
          </Space>
          <Table<RemoteScriptConfig>
            rowKey="id"
            columns={columns}
            dataSource={configsQuery.data?.data ?? []}
            loading={configsQuery.isLoading || configsQuery.isFetching}
            scroll={{ x: 980 }}
            pagination={{
              current: page,
              pageSize,
              total: configsQuery.data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`
            }}
            onChange={(pagination) => {
              setPage(pagination.current ?? 1);
              setPageSize(pagination.pageSize ?? 10);
            }}
          />
        </div>
      </section>

      <RemoteScriptConfigModal
        open={modalOpen}
        config={editingConfig}
        definitions={definitions}
        loading={saveMutation.isPending}
        onCancel={() => {
          setModalOpen(false);
          setEditingConfig(null);
        }}
        onSave={(payload) => saveMutation.mutate(payload)}
      />
      <RemoteScriptBindingsModal
        open={Boolean(bindingConfig)}
        config={bindingConfig}
        onCancel={() => setBindingConfig(null)}
      />
    </div>
  );
}
