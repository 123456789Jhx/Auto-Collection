import { DeleteOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntdApp, Button, Popconfirm, Select, Tooltip, type SelectProps } from "antd";
import { useDeferredValue, useState } from "react";
import {
  deleteAccountWarmupVocabulary,
  getAccountWarmupVocabulary,
  type AccountWarmupVocabularyEntry,
  type AccountWarmupVocabularyKind
} from "../../lib/api-client-account-warmup";
import {
  getSharedVocabularyDeleteError,
  getSharedVocabularyQueryState,
  resolveSharedVocabularyOption,
  sharedVocabularyInvalidationKey
} from "../../lib/account-warmup-form";

type VocabularyOption = {
  label: string;
  value: string;
  entry: AccountWarmupVocabularyEntry;
};

type SharedVocabularySelectProps = Omit<
  SelectProps<string[]>,
  "mode" | "options" | "optionRender" | "filterOption"
> & {
  kind: AccountWarmupVocabularyKind;
};

export function SharedVocabularySelect({ kind, onSearch, ...props }: SharedVocabularySelectProps) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const vocabularyQuery = useQuery({
    queryKey: ["accountWarmupVocabulary", kind, deferredQuery],
    queryFn: () => getAccountWarmupVocabulary(kind, deferredQuery, 100),
    staleTime: 30_000
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAccountWarmupVocabulary,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sharedVocabularyInvalidationKey(kind) });
    },
    onError: (error) => message.error(getSharedVocabularyDeleteError(error))
  });
  const options: VocabularyOption[] = (vocabularyQuery.data ?? []).map((entry) => ({
    label: entry.value,
    value: entry.value,
    entry
  }));
  const queryState = getSharedVocabularyQueryState(vocabularyQuery.isError);

  return (
    <div className="shared-vocabulary-select">
      <Select<string[]>
        {...props}
        mode="tags"
        showSearch
        filterOption={false}
        disabled={Boolean(props.disabled) || !queryState.allowManualInput}
        loading={vocabularyQuery.isFetching}
        options={options}
        classNames={{ popup: { root: "shared-vocabulary-dropdown" } }}
        onSearch={(value) => {
          setQuery(value);
          onSearch?.(value);
        }}
        optionRender={(option) => {
          const optionView = resolveSharedVocabularyOption(option.data);
          if (!optionView.entry) {
            return <span className="shared-vocabulary-option-text">{optionView.label}</span>;
          }
          const entry = optionView.entry;
          return (
            <div className="shared-vocabulary-option">
              <Tooltip title={entry.value} placement="topLeft">
                <span className="shared-vocabulary-option-text">{entry.value}</span>
              </Tooltip>
              <Popconfirm
                title="删除这条共享历史？"
                description="删除后不会移除表单中已经选择的标签。"
                okText="删除"
                cancelText="取消"
                onConfirm={(event) => {
                  event?.stopPropagation();
                  deleteMutation.mutate(entry.id);
                }}
              >
                <Button
                  className="shared-vocabulary-delete"
                  type="text"
                  danger
                  size="small"
                  aria-label={`删除 ${entry.value}`}
                  icon={<DeleteOutlined />}
                  loading={deleteMutation.isPending && deleteMutation.variables === entry.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              </Popconfirm>
            </div>
          );
        }}
      />
      {queryState.hint ? (
        <div className="shared-vocabulary-query-hint" role="status" aria-live="polite">
          {queryState.hint}
        </div>
      ) : null}
    </div>
  );
}
