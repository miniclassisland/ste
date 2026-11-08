"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    TimeLayout,
    TimeLayoutItem,
    TimeType,
    Subject,
    ActionSet,
    ActionItem,
} from "@/lib/types";
import {
    TIME_TYPE_LABELS,
    BUILTIN_ACTIONS,
    EMPTY_GUID,
    isEmptyGuid,
    toUpstreamGuidOrEmpty,
} from "@/lib/types";
import {
    Button, Input, Switch, Spinner, Textarea,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    ArrowUp24Regular, ArrowDown24Regular, Code24Regular, ArrowSort24Regular,
    Flash16Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type TimeLayoutsData = Record<string, TimeLayout>;
type SubjectsData = Record<string, Subject>;

/** 从 StartSecond (ISO) 或 StartTime (HH:mm:ss) 提取 HH:mm */
function extractHHMM(item: TimeLayoutItem, field: "start" | "end"): string {
    const raw = field === "start" ? (item.StartSecond || item.StartTime || "") : (item.EndSecond || item.EndTime || "");
    if (!raw) return "08:00";
    const tIndex = raw.indexOf("T");
    const timePart = tIndex >= 0 ? raw.slice(tIndex + 1) : raw;
    const parts = timePart.split(":");
    return `${(parts[0] || "08").padStart(2, "0")}:${(parts[1] || "00").padStart(2, "0")}`;
}

/** 将 HH:mm 转为上游兼容的 StartSecond (1970-01-01THH:mm:00) 和 StartTime (HH:mm:00) */
function toTimeStrings(hhmm: string): { iso: string; span: string } {
    const [h, m] = (hhmm || "08:00").split(":").map((v) => parseInt(v, 10) || 0);
    const span = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    return {
        iso: `1970-01-01T${span}`,
        span,
    };
}

function addMinutesToHHMM(hhmm: string, mins: number): string {
    const [h, m] = (hhmm || "08:00").split(":").map((v) => parseInt(v, 10) || 0);
    const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + mins));
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/** 标准化时间表数据（确保 DefaultClassId 空值规范为 00000000-0000-0000-0000-000000000000 且 TimeType=3 包含 ActionSet 结构） */
function normalizeTimeLayoutsForSave(raw: TimeLayoutsData): TimeLayoutsData {
    const out: TimeLayoutsData = {};
    for (const [k, tl] of Object.entries(raw)) {
        const items = Array.isArray(tl.Layouts) ? tl.Layouts.map((item) => {
            const copy: TimeLayoutItem = { ...item };
            if (copy.TimeType === 0) {
                copy.DefaultClassId = toUpstreamGuidOrEmpty(copy.DefaultClassId);
            }
            if (copy.TimeType === 2 || copy.TimeType === 3) {
                // 分割线和行动的结束时间必须与开始时间一致
                if (copy.StartSecond) copy.EndSecond = copy.StartSecond;
                if (copy.StartTime) copy.EndTime = copy.StartTime;
            }
            if (copy.TimeType === 3) {
                const rawAs = (copy.ActionSet && typeof copy.ActionSet === "object") ? copy.ActionSet : {};
                const rawActions = Array.isArray(rawAs.Actions)
                    ? rawAs.Actions
                    : Array.isArray((rawAs as Record<string, unknown>).ActionItems)
                        ? ((rawAs as Record<string, unknown>).ActionItems as ActionItem[])
                        : [];
                copy.ActionSet = {
                    Name: typeof rawAs.Name === "string" ? rawAs.Name : "行动时间点",
                    IsEnabled: rawAs.IsEnabled !== false,
                    IsRevertEnabled: !!rawAs.IsRevertEnabled,
                    Guid: typeof rawAs.Guid === "string" && rawAs.Guid ? rawAs.Guid : crypto.randomUUID(),
                    Actions: rawActions,
                };
            }
            return copy;
        }) : [];
        out[k] = { ...tl, Layouts: items };
    }
    return out;
}

export default function TimeLayoutPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [layouts, setLayouts] = useState<TimeLayoutsData>({});
    const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);

    // 关联科目参考文件（供默认科目选择）
    const [subjectFiles, setSubjectFiles] = useState<string[]>([]);
    const [selectedSubjectFile, setSelectedSubjectFile] = useState<string>("");
    const [subjects, setSubjects] = useState<SubjectsData>({});

    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");

    const selectFile = useCallback(async (name: string) => {
        if (!accountId) return;
        setSelectedFile(name);
        setSelectedLayoutId(null);
        setDataLoading(true);
        try {
            const content = await data.read(accountId, "TimeLayout", name);
            let parsed: TimeLayoutsData = {};
            if (content && typeof content === "object") {
                const obj = content as Record<string, unknown>;
                if (obj.TimeLayouts && typeof obj.TimeLayouts === "object") {
                    parsed = obj.TimeLayouts as TimeLayoutsData;
                } else {
                    parsed = obj as TimeLayoutsData;
                }
            }
            const normalized = normalizeTimeLayoutsForSave(parsed);
            setLayouts(normalized);
            setJsonText(JSON.stringify(normalized, null, 2));
            const firstId = Object.keys(normalized)[0] || null;
            setSelectedLayoutId(firstId);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "加载失败" });
            setLayouts({});
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadSubjectFile = useCallback(async (subFile: string) => {
        if (!accountId || !subFile) return;
        setSelectedSubjectFile(subFile);
        try {
            const subData = await data.read(accountId, "Subjects", subFile);
            if (subData && typeof subData === "object") {
                const obj = subData as Record<string, unknown>;
                if (obj.Subjects && typeof obj.Subjects === "object") {
                    setSubjects(obj.Subjects as SubjectsData);
                } else {
                    setSubjects(obj as SubjectsData);
                }
            }
        } catch {
            setSubjects({});
        }
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const [list, subList] = await Promise.all([
                data.list(accountId, "TimeLayout"),
                data.list(accountId, "Subjects"),
            ]);
            const arr = Array.isArray(list) ? list : [];
            const sArr = Array.isArray(subList) ? subList : [];
            setFileList(arr);
            setSubjectFiles(sArr);
            if (sArr.length > 0 && !selectedSubjectFile) {
                loadSubjectFile(sArr[0]);
            }
            if (arr.length > 0 && !selectedFile) {
                selectFile(arr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectedFile, selectedSubjectFile, selectFile, loadSubjectFile]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = layouts;
            if (jsonMode) {
                const rawParsed = JSON.parse(jsonText) as TimeLayoutsData;
                payloadToSave = normalizeTimeLayoutsForSave(rawParsed);
                setLayouts(payloadToSave);
            } else {
                payloadToSave = normalizeTimeLayoutsForSave(layouts);
                setLayouts(payloadToSave);
                setJsonText(JSON.stringify(payloadToSave, null, 2));
            }
            const wrapperPayload =
                payloadToSave && typeof payloadToSave === "object" && "TimeLayouts" in payloadToSave
                    ? payloadToSave
                    : { TimeLayouts: payloadToSave };
            await data.write(accountId, "TimeLayout", selectedFile, wrapperPayload);
            setMsg({ type: "success", text: "时间表已保存并递增版本号" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查 JSON 格式" });
        }
        setSaving(false);
    }

    async function handleCreateFile(e: React.FormEvent) {
        e.preventDefault();
        if (!newFileName.trim()) return;
        const name = newFileName.trim();
        try {
            await data.create(accountId, "TimeLayout", name);
            setMsg({ type: "success", text: `文件 "${name}" 已创建` });
            setShowCreate(false);
            setNewFileName("");
            await loadFiles();
            selectFile(name);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDeleteFile(name: string) {
        if (!confirm(`确定要删除时间表文件 "${name}" 吗？`)) return;
        try {
            await data.deleteData(accountId, "TimeLayout", name);
            if (selectedFile === name) {
                setSelectedFile(null);
                setLayouts({});
                setSelectedLayoutId(null);
            }
            await loadFiles();
            setMsg({ type: "success", text: "文件已删除" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    function addLayout() {
        const id = crypto.randomUUID();
        const next: TimeLayoutsData = {
            ...layouts,
            [id]: { Name: "新时间表", Layouts: [] },
        };
        setLayouts(next);
        setSelectedLayoutId(id);
    }

    function deleteLayout(id: string) {
        if (!confirm("确定要删除此时间表吗？")) return;
        const copy = { ...layouts };
        delete copy[id];
        setLayouts(copy);
        setSelectedLayoutId(Object.keys(copy)[0] || null);
    }

    function updateLayoutName(id: string, name: string) {
        setLayouts((prev) => ({
            ...prev,
            [id]: { ...prev[id], Name: name },
        }));
    }

    /** 添加时间点（自动顺延上一项结束时间，支持 TimeType 0=上课, 1=课间, 2=分割线, 3=行动） */
    function addTimeItem(defaultType: TimeType = 0) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const existing = current.Layouts || [];
        const lastEnd = existing.length > 0 ? extractHHMM(existing[existing.length - 1], "end") : "08:00";
        const nextEnd =
            defaultType === 2 || defaultType === 3
                ? lastEnd
                : addMinutesToHHMM(lastEnd, defaultType === 0 ? 40 : 10);
        const startStr = toTimeStrings(lastEnd);
        const endStr = toTimeStrings(nextEnd);
        const newItem: TimeLayoutItem = {
            StartSecond: startStr.iso,
            EndSecond: endStr.iso,
            StartTime: startStr.span,
            EndTime: endStr.span,
            TimeType: defaultType,
            IsHideDefault: false,
            DefaultClassId: EMPTY_GUID,
            BreakName: "",
            ActionSet:
                defaultType === 3
                    ? {
                          Name: "行动时间点",
                          IsEnabled: true,
                          IsRevertEnabled: false,
                          Guid: crypto.randomUUID(),
                          Actions: [
                              {
                                  Id: "classisland.showNotification",
                                  Settings: {
                                      Mask: "提醒",
                                      MaskDurationSeconds: 5,
                                      IsMaskSpeechEnabled: true,
                                      Content: "",
                                      ContentDurationSeconds: 10,
                                      IsContentSpeechEnabled: true,
                                      IsAdvancedSettingsEnabled: false,
                                      IsEffectEnabled: true,
                                      IsSoundEffectEnabled: true,
                                      IsTopmostEnabled: true,
                                      CustomSoundEffectPath: "",
                                      IsWaitForCompleteEnabled: false,
                                  },
                              },
                          ],
                      }
                    : null,
        };
        const items = [...existing, newItem];
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: items },
        });
    }

    function updateTimeItem(index: number, patch: Partial<TimeLayoutItem>) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const items = [...(current.Layouts || [])];
        const nextItem: TimeLayoutItem = { ...items[index], ...patch };
        // 若切换为分割线 (2) 或行动 (3)，将结束时间对齐到开始时间
        if (nextItem.TimeType === 2 || nextItem.TimeType === 3) {
            nextItem.EndSecond = nextItem.StartSecond;
            nextItem.EndTime = nextItem.StartTime;
        }
        if (nextItem.TimeType === 3 && (!nextItem.ActionSet || typeof nextItem.ActionSet !== "object")) {
            nextItem.ActionSet = {
                Name: "行动时间点",
                IsEnabled: true,
                IsRevertEnabled: false,
                Guid: crypto.randomUUID(),
                Actions: [],
            };
        }
        items[index] = nextItem;
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: items },
        });
    }

    function updateTimeItemClock(index: number, field: "start" | "end", hhmm: string) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const item = current.Layouts?.[index];
        const { iso, span } = toTimeStrings(hhmm);
        if (field === "start") {
            if (item && (item.TimeType === 2 || item.TimeType === 3)) {
                updateTimeItem(index, { StartSecond: iso, StartTime: span, EndSecond: iso, EndTime: span });
            } else {
                updateTimeItem(index, { StartSecond: iso, StartTime: span });
            }
        } else {
            updateTimeItem(index, { EndSecond: iso, EndTime: span });
        }
    }

    function moveTimeItem(index: number, dir: -1 | 1) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const items = [...(current.Layouts || [])];
        const target = index + dir;
        if (target < 0 || target >= items.length) return;
        [items[index], items[target]] = [items[target], items[index]];
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: items },
        });
    }

    function sortTimeItemsByStart() {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const items = [...(current.Layouts || [])].sort((a, b) =>
            extractHHMM(a, "start").localeCompare(extractHHMM(b, "start"))
        );
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: items },
        });
    }

    function deleteTimeItem(index: number) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const items = (current.Layouts || []).filter((_, idx) => idx !== index);
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: items },
        });
    }

    // ── 行动时间点 (TimeType === 3, ActionSet) 编辑辅助函数 ──
    function getItemActionSet(item: TimeLayoutItem): ActionSet {
        const raw = item.ActionSet && typeof item.ActionSet === "object" ? item.ActionSet : {};
        const actions = Array.isArray(raw.Actions)
            ? raw.Actions
            : Array.isArray((raw as Record<string, unknown>).ActionItems)
                ? ((raw as Record<string, unknown>).ActionItems as ActionItem[])
                : [];
        return {
            Name: typeof raw.Name === "string" ? raw.Name : "行动时间点",
            IsEnabled: raw.IsEnabled !== false,
            IsRevertEnabled: !!raw.IsRevertEnabled,
            Guid: typeof raw.Guid === "string" && raw.Guid ? raw.Guid : crypto.randomUUID(),
            Actions: actions,
        };
    }

    function updateItemActionSet(itemIdx: number, patch: Partial<ActionSet>) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        updateTimeItem(itemIdx, {
            ActionSet: { ...currentAs, ...patch },
        });
    }

    function addActionToItem(itemIdx: number, actionId: string) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        const meta = BUILTIN_ACTIONS.find((a) => a.id === actionId);
        const newAction: ActionItem = {
            Id: actionId,
            Settings: meta?.defaultSettings ? JSON.parse(JSON.stringify(meta.defaultSettings)) : {},
        };
        updateItemActionSet(itemIdx, {
            Actions: [...(currentAs.Actions || []), newAction],
        });
    }

    function updateActionInItem(itemIdx: number, actionIdx: number, patch: Partial<ActionItem>) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        const nextActions = (currentAs.Actions || []).map((act, i) =>
            i === actionIdx ? { ...act, ...patch } : act
        );
        updateItemActionSet(itemIdx, { Actions: nextActions });
    }

    function updateActionSettingsInItem(itemIdx: number, actionIdx: number, settingsPatch: Record<string, unknown>) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        const target = currentAs.Actions?.[actionIdx];
        if (!target) return;
        const baseSettings =
            target.Settings && typeof target.Settings === "object"
                ? { ...(target.Settings as Record<string, unknown>) }
                : {};
        updateActionInItem(itemIdx, actionIdx, {
            Settings: { ...baseSettings, ...settingsPatch },
        });
    }

    function removeActionFromItem(itemIdx: number, actionIdx: number) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        updateItemActionSet(itemIdx, {
            Actions: (currentAs.Actions || []).filter((_, i) => i !== actionIdx),
        });
    }

    function moveActionInItem(itemIdx: number, actionIdx: number, dir: -1 | 1) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        const list = [...(currentAs.Actions || [])];
        const target = actionIdx + dir;
        if (target < 0 || target >= list.length) return;
        [list[actionIdx], list[target]] = [list[target], list[actionIdx]];
        updateItemActionSet(itemIdx, { Actions: list });
    }

    /** 渲染单个 ActionItem 的参数配置表单（原位对齐上游各 Action SettingsControl） */
    function renderActionItemEditor(itemIdx: number, actionIdx: number, action: ActionItem) {
        const meta = BUILTIN_ACTIONS.find((a) => a.id === action.Id);
        const s: Record<string, unknown> = {
            ...(meta?.defaultSettings ? JSON.parse(JSON.stringify(meta.defaultSettings)) : {}),
            ...(action.Settings && typeof action.Settings === "object" ? (action.Settings as Record<string, unknown>) : {}),
        };

        if (action.Id === "classisland.os.run") {
            return (
                <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>运行类型</label>
                        <Select
                            size="small"
                            value={String(s.RunType ?? "Application")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { RunType: d.value })}
                        >
                            <option value="Application">应用程序</option>
                            <option value="Command">终端命令</option>
                            <option value="File">打开文件</option>
                            <option value="Folder">打开文件夹</option>
                            <option value="Url">打开网页链接</option>
                        </Select>
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>路径 / 命令 / 网址</label>
                        <Input
                            size="small"
                            value={String(s.Value ?? "")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Value: d.value })}
                            placeholder="例如 notepad.exe 或 https://..."
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>启动参数（可选）</label>
                        <Input
                            size="small"
                            value={String(s.Args ?? "")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Args: d.value })}
                            placeholder="命令行参数"
                            style={{ width: "100%" }}
                        />
                    </div>
                </div>
            );
        }

        if (action.Id === "classisland.showNotification") {
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 8, alignItems: "center" }}>
                        <div>
                            <label className="form-label" style={{ fontSize: 11 }}>提醒遮罩标题</label>
                            <Input
                                size="small"
                                value={String(s.Mask ?? "")}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Mask: d.value })}
                                placeholder="顶栏横幅标题..."
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div>
                            <label className="form-label" style={{ fontSize: 11 }}>遮罩时长 (秒)</label>
                            <Input
                                size="small"
                                type="number"
                                value={String(s.MaskDurationSeconds ?? 5)}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { MaskDurationSeconds: parseFloat(d.value) || 5 })}
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 14 }}>
                            <Switch
                                checked={s.IsMaskSpeechEnabled !== false}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { IsMaskSpeechEnabled: d.checked })}
                            />
                            <span style={{ fontSize: 11 }}>朗读遮罩</span>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 8, alignItems: "center" }}>
                        <div>
                            <label className="form-label" style={{ fontSize: 11 }}>提醒正文内容（可选）</label>
                            <Input
                                size="small"
                                value={String(s.Content ?? "")}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Content: d.value })}
                                placeholder="遮罩结束后展示的正文说明..."
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div>
                            <label className="form-label" style={{ fontSize: 11 }}>正文时长 (秒)</label>
                            <Input
                                size="small"
                                type="number"
                                value={String(s.ContentDurationSeconds ?? 10)}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { ContentDurationSeconds: parseFloat(d.value) || 10 })}
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 14 }}>
                            <Switch
                                checked={s.IsContentSpeechEnabled !== false}
                                onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { IsContentSpeechEnabled: d.checked })}
                            />
                            <span style={{ fontSize: 11 }}>朗读正文</span>
                        </div>
                    </div>
                </div>
            );
        }

        if (action.Id === "classisland.notification.weather") {
            return (
                <div style={{ marginTop: 8, maxWidth: 280 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>天气提醒类型</label>
                    <Select
                        size="small"
                        value={String(s.NotificationKind ?? 0)}
                        onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { NotificationKind: parseInt(d.value, 10) })}
                    >
                        <option value="0">今日天气预报</option>
                        <option value="1">气象灾害预警</option>
                        <option value="2">逐小时天气预报</option>
                    </Select>
                </div>
            );
        }

        if (action.Id === "classisland.broadcastSignal") {
            return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>广播信号名称</label>
                        <Input
                            size="small"
                            value={String(s.SignalName ?? "")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { SignalName: d.value })}
                            placeholder="输入自定义信号标识..."
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 14 }}>
                        <Switch
                            checked={!!s.IsRevert}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { IsRevert: d.checked })}
                        />
                        <span style={{ fontSize: 11 }}>恢复信号状态</span>
                    </div>
                </div>
            );
        }

        if (action.Id === "classisland.action.sleep") {
            return (
                <div style={{ marginTop: 8, maxWidth: 220 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>等待秒数</label>
                    <Input
                        size="small"
                        type="number"
                        value={String(s.Value ?? 5)}
                        onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Value: parseFloat(d.value) || 1 })}
                        style={{ width: "100%" }}
                    />
                </div>
            );
        }

        if (action.Id === "classisland.settings") {
            return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>设置属性名</label>
                        <Input
                            size="small"
                            value={String(s.Name ?? "")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Name: d.value })}
                            placeholder="如 IsMainWindowVisible / Opacity"
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: 11 }}>目标值</label>
                        <Input
                            size="small"
                            value={String(s.Value ?? "")}
                            onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Value: d.value })}
                            placeholder="如 true / 0.8"
                            style={{ width: "100%" }}
                        />
                    </div>
                </div>
            );
        }

        if (action.Id === "classisland.app.restart") {
            return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <Switch
                        checked={!!s.Value}
                        onChange={(_, d) => updateActionSettingsInItem(itemIdx, actionIdx, { Value: d.checked })}
                    />
                    <span style={{ fontSize: 12 }}>以静默模式重启</span>
                </div>
            );
        }

        if (action.Id === "classisland.app.quit") {
            return null;
        }

        // 自定义或插件行动 JSON 参数编辑
        return (
            <div style={{ marginTop: 8 }}>
                <label className="form-label" style={{ fontSize: 11 }}>行动参数 JSON</label>
                <Textarea
                    rows={2}
                    value={action.Settings ? JSON.stringify(action.Settings) : "{}"}
                    onChange={(_, d) => {
                        try {
                            updateActionInItem(itemIdx, actionIdx, { Settings: JSON.parse(d.value) });
                        } catch {
                            /* keep typing */
                        }
                    }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: "100%" }}
                />
            </div>
        );
    }

    const currentLayout = selectedLayoutId ? layouts[selectedLayoutId] : null;
    // 过滤出非 000...000 的真实科目列表供下拉选择
    const validSubjectEntries = Object.entries(subjects).filter(([sid]) => !isEmptyGuid(sid));

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">时间表编辑器</h1>
                    <p className="page-subtitle">管理 ClassIsland 时间表档案 — 支持上课、课间、分割线与自动化行动时间点编辑</p>
                </div>
                <div className="flex gap-8">
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>新建文件</Button>
                    <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={loadFiles}>刷新</Button>
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="profile-split-layout">
                {/* 左侧文件列表 */}
                <div className="profile-split-sidebar">
                    <div className="card">
                        <div className="card-title">时间表文件</div>
                        {loading ? (
                            <Spinner size="small" />
                        ) : fileList.length === 0 ? (
                            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>暂无文件</div>
                        ) : (
                            fileList.map((f) => (
                                <div
                                    key={f}
                                    className={`sidebar-link ${selectedFile === f ? "active" : ""}`}
                                    onClick={() => selectFile(f)}
                                >
                                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f}</span>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<Delete24Regular />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteFile(f);
                                        }}
                                        style={{ color: "var(--danger-color)", minWidth: 24, padding: 2 }}
                                    />
                                </div>
                            ))
                        )}
                    </div>

                    {selectedFile && !jsonMode && (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16">
                                <div className="card-title" style={{ margin: 0 }}>时间表列表</div>
                                <Button size="small" appearance="subtle" icon={<Add24Regular />} onClick={addLayout}>
                                    添加
                                </Button>
                            </div>
                            {Object.keys(layouts).length === 0 ? (
                                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>暂无时间表</div>
                            ) : (
                                Object.entries(layouts).map(([id, tl]) => (
                                    <div
                                        key={id}
                                        className={`sidebar-link ${selectedLayoutId === id ? "active" : ""}`}
                                        onClick={() => setSelectedLayoutId(id)}
                                    >
                                        <span style={{ flex: 1 }}>{tl.Name || id.slice(0, 8)}</span>
                                        <span className="badge badge-info">{(tl.Layouts || []).length}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* 右侧编辑器 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {!selectedFile ? (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-state-text">请从左侧选择一个时间表文件开始编辑</div>
                            </div>
                        </div>
                    ) : dataLoading ? (
                        <div className="card">
                            <div className="empty-state"><Spinner size="medium" /></div>
                        </div>
                    ) : (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16" style={{ flexWrap: "wrap", gap: 8 }}>
                                <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                    {currentLayout && !jsonMode && (
                                        <Input
                                            value={currentLayout.Name || ""}
                                            onChange={(_, d) => selectedLayoutId && updateLayoutName(selectedLayoutId, d.value)}
                                            placeholder="时间表名称"
                                            style={{ width: 220, fontWeight: 600 }}
                                        />
                                    )}
                                    {jsonMode && <div className="card-title" style={{ margin: 0 }}>JSON 源码模式</div>}
                                    {!jsonMode && subjectFiles.length > 0 && (
                                        <Select
                                            size="small"
                                            value={selectedSubjectFile}
                                            onChange={(_, d) => loadSubjectFile(d.value)}
                                            style={{ width: 170 }}
                                            title="选择用于设置默认科目的科目库文件"
                                        >
                                            {subjectFiles.map((sf) => (
                                                <option key={sf} value={sf}>参考科目库: {sf}</option>
                                            ))}
                                        </Select>
                                    )}
                                </div>
                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="TimeLayout"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            let parsed: TimeLayoutsData = {};
                                            if (content && typeof content === "object") {
                                                const obj = content as Record<string, unknown>;
                                                if (obj.TimeLayouts && typeof obj.TimeLayouts === "object") {
                                                    parsed = obj.TimeLayouts as TimeLayoutsData;
                                                } else {
                                                    parsed = obj as TimeLayoutsData;
                                                }
                                            }
                                            const normalized = normalizeTimeLayoutsForSave(parsed);
                                            setLayouts(normalized);
                                            setJsonText(JSON.stringify(normalized, null, 2));
                                            setSelectedLayoutId(Object.keys(normalized)[0] || null);
                                            setMsg({
                                                type: "success",
                                                text: isCurrent
                                                    ? `已加载当前最新版本 v${version}`
                                                    : `已加载历史版本 v${version} 到编辑器（点击「保存」将创建一个新版本，不会覆盖历史版本）`,
                                            });
                                        }}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <DownloadPresetPopoverButton
                                        buttonText="导出 JSON"
                                        appearance="secondary"
                                        defaultFileName={`TimeLayout-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `TimeLayout-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "TimeLayout.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : layouts)}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) {
                                                setJsonText(JSON.stringify(layouts, null, 2));
                                            } else {
                                                try {
                                                    setLayouts(normalizeTimeLayoutsForSave(JSON.parse(jsonText)));
                                                } catch {
                                                    /* keep current */
                                                }
                                            }
                                            setJsonMode(!jsonMode);
                                        }}
                                    >
                                        {jsonMode ? "切换可视化编辑" : "JSON 源码"}
                                    </Button>
                                    {!jsonMode && selectedLayoutId && (
                                        <>
                                            <Button
                                                appearance="secondary"
                                                size="small"
                                                icon={<Add24Regular />}
                                                onClick={() => addTimeItem(0)}
                                            >
                                                上课
                                            </Button>
                                            <Button
                                                appearance="secondary"
                                                size="small"
                                                icon={<Add24Regular />}
                                                onClick={() => addTimeItem(1)}
                                            >
                                                课间
                                            </Button>
                                            <Button
                                                appearance="secondary"
                                                size="small"
                                                icon={<Add24Regular />}
                                                onClick={() => addTimeItem(2)}
                                            >
                                                分割线
                                            </Button>
                                            <Button
                                                appearance="secondary"
                                                size="small"
                                                icon={<Flash16Regular />}
                                                onClick={() => addTimeItem(3)}
                                            >
                                                行动
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<ArrowSort24Regular />}
                                                onClick={sortTimeItemsByStart}
                                                title="按开始时间自动排序"
                                            >
                                                按时间排序
                                            </Button>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Delete24Regular />}
                                                onClick={() => deleteLayout(selectedLayoutId)}
                                                style={{ color: "var(--danger-color)" }}
                                            >
                                                删除此时间表
                                            </Button>
                                        </>
                                    )}
                                    <Button appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={saving}>
                                        {saving ? <Spinner size="tiny" /> : "保存"}
                                    </Button>
                                </div>
                            </div>

                            {jsonMode ? (
                                <div className="json-editor">
                                    <textarea
                                        value={jsonText}
                                        onChange={(e) => setJsonText(e.target.value)}
                                        style={{ minHeight: 420 }}
                                    />
                                </div>
                            ) : !currentLayout ? (
                                <div className="empty-state">
                                    <div className="empty-state-text">请选择或新建一个时间表</div>
                                </div>
                            ) : (
                                <div>
                                    <div className="timeline-editor">
                                        {(currentLayout.Layouts || []).length === 0 ? (
                                            <div className="empty-state">
                                                <div className="empty-state-text">暂无时间段，点击上方「上课 / 课间 / 分割线 / 行动」按钮添加</div>
                                            </div>
                                        ) : (
                                            (currentLayout.Layouts || []).map((item, idx, arr) => {
                                                const startHHMM = extractHHMM(item, "start");
                                                const endHHMM = extractHHMM(item, "end");
                                                const isPointTime = item.TimeType === 2 || item.TimeType === 3;
                                                const defaultSubId = isEmptyGuid(item.DefaultClassId) ? EMPTY_GUID : (item.DefaultClassId || EMPTY_GUID);
                                                const actionSet = item.TimeType === 3 ? getItemActionSet(item) : null;

                                                return (
                                                    <div
                                                        key={idx}
                                                        className={`timeline-item type-${item.TimeType ?? 0}`}
                                                        style={{
                                                            flexDirection: "column",
                                                            alignItems: "stretch",
                                                            gap: 10,
                                                        }}
                                                    >
                                                        {/* 第一行：时间选择器 + 类型 + 基础属性 + 操作按钮 */}
                                                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: "100%" }}>
                                                            {/* 时间选择区（加宽至 176px 彻底解决 07:30 AM 截断问题） */}
                                                            <div className="flex items-center gap-6" style={{ flexShrink: 0 }}>
                                                                <Input
                                                                    type="time"
                                                                    size="small"
                                                                    value={startHHMM}
                                                                    onChange={(_, d) => updateTimeItemClock(idx, "start", d.value)}
                                                                    style={{ width: 176, minWidth: 172 }}
                                                                    title="开始时间点"
                                                                />
                                                                {!isPointTime && (
                                                                    <>
                                                                        <span style={{ color: "var(--text-secondary)" }}>→</span>
                                                                        <Input
                                                                            type="time"
                                                                            size="small"
                                                                            value={endHHMM}
                                                                            onChange={(_, d) => updateTimeItemClock(idx, "end", d.value)}
                                                                            style={{ width: 176, minWidth: 172 }}
                                                                            title="结束时间点"
                                                                        />
                                                                    </>
                                                                )}
                                                            </div>

                                                            {/* 时间点类型 */}
                                                            <Select
                                                                size="small"
                                                                value={String(item.TimeType ?? 0)}
                                                                onChange={(_, d) => updateTimeItem(idx, { TimeType: Number(d.value) as TimeType })}
                                                                style={{ width: 124 }}
                                                            >
                                                                {Object.entries(TIME_TYPE_LABELS).map(([val, label]) => (
                                                                    <option key={val} value={val}>{label}</option>
                                                                ))}
                                                            </Select>

                                                            {/* 类型专属内联字段 */}
                                                            <div className="flex items-center gap-8" style={{ flex: 1, flexWrap: "wrap", minWidth: 220 }}>
                                                                {item.TimeType === 0 && (
                                                                    <Select
                                                                        size="small"
                                                                        value={defaultSubId}
                                                                        onChange={(_, d) =>
                                                                            updateTimeItem(idx, {
                                                                                DefaultClassId: toUpstreamGuidOrEmpty(d.value),
                                                                            })
                                                                        }
                                                                        style={{ width: 210 }}
                                                                    >
                                                                        <option value={EMPTY_GUID}>默认科目: （空 / 未设置）</option>
                                                                        {validSubjectEntries.map(([sid, sub]) => (
                                                                            <option key={sid} value={sid}>
                                                                                默认: {sub.Name}
                                                                            </option>
                                                                        ))}
                                                                    </Select>
                                                                )}

                                                                {item.TimeType === 1 && (
                                                                    <Input
                                                                        size="small"
                                                                        value={item.BreakName || ""}
                                                                        onChange={(_, d) => updateTimeItem(idx, { BreakName: d.value })}
                                                                        placeholder="课间名称 (默认: 课间休息 / 大课间 / 午休)"
                                                                        style={{ width: 240 }}
                                                                    />
                                                                )}

                                                                {item.TimeType === 2 && (
                                                                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                                        ── 课程分段分割线（用于分隔上午/下午/晚自习） ──
                                                                    </span>
                                                                )}

                                                                {item.TimeType === 3 && actionSet && (
                                                                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                                                        <span className="badge badge-warning" style={{ gap: 4 }}>
                                                                            <Flash16Regular />
                                                                            自动化行动 ({(actionSet.Actions || []).length} 项)
                                                                        </span>
                                                                        <Input
                                                                            size="small"
                                                                            value={actionSet.Name || ""}
                                                                            onChange={(_, d) => updateItemActionSet(idx, { Name: d.value })}
                                                                            placeholder="行动组名称备注"
                                                                            style={{ width: 170 }}
                                                                        />
                                                                    </div>
                                                                )}

                                                                {(item.TimeType === 0 || item.TimeType === 1) && (
                                                                    <div className="flex items-center gap-4">
                                                                        <Switch
                                                                            checked={!!item.IsHideDefault}
                                                                            onChange={(_, d) => updateTimeItem(idx, { IsHideDefault: d.checked })}
                                                                        />
                                                                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>默认隐藏</span>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* 排序与删除 */}
                                                            <div className="flex gap-4">
                                                                <Button
                                                                    appearance="subtle"
                                                                    size="small"
                                                                    icon={<ArrowUp24Regular />}
                                                                    disabled={idx === 0}
                                                                    onClick={() => moveTimeItem(idx, -1)}
                                                                    title="上移"
                                                                />
                                                                <Button
                                                                    appearance="subtle"
                                                                    size="small"
                                                                    icon={<ArrowDown24Regular />}
                                                                    disabled={idx === arr.length - 1}
                                                                    onClick={() => moveTimeItem(idx, 1)}
                                                                    title="下移"
                                                                />
                                                                <Button
                                                                    appearance="subtle"
                                                                    size="small"
                                                                    icon={<Delete24Regular />}
                                                                    onClick={() => deleteTimeItem(idx)}
                                                                    style={{ color: "var(--danger-color)" }}
                                                                    title="删除时间点"
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* 第二行（仅当 TimeType === 3 行动时显示）：原位 ActionSet 行动列表编辑器 */}
                                                        {item.TimeType === 3 && actionSet && (
                                                            <div
                                                                style={{
                                                                    marginTop: 4,
                                                                    padding: 12,
                                                                    borderRadius: 8,
                                                                    background: "rgba(255, 193, 7, 0.05)",
                                                                    border: "1px dashed rgba(255, 193, 7, 0.35)",
                                                                    display: "flex",
                                                                    flexDirection: "column",
                                                                    gap: 10,
                                                                }}
                                                            >
                                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                                                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                                                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                                                            达到时间点 {startHHMM} 时执行的行动列表
                                                                        </span>
                                                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                                            <Switch
                                                                                checked={actionSet.IsEnabled !== false}
                                                                                onChange={(_, d) => updateItemActionSet(idx, { IsEnabled: d.checked })}
                                                                            />
                                                                            <span style={{ fontSize: 12 }}>启用行动组</span>
                                                                        </div>
                                                                    </div>
                                                                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                                                        <Select
                                                                            size="small"
                                                                            value=""
                                                                            onChange={(_, d) => {
                                                                                if (d.value) addActionToItem(idx, d.value);
                                                                            }}
                                                                            style={{ width: 220 }}
                                                                        >
                                                                            <option value="">+ 添加要执行的行动...</option>
                                                                            {BUILTIN_ACTIONS.map((ba) => (
                                                                                <option key={ba.id} value={ba.id}>
                                                                                    [{ba.category}] {ba.name}
                                                                                </option>
                                                                            ))}
                                                                        </Select>
                                                                    </div>
                                                                </div>

                                                                {(actionSet.Actions || []).length === 0 ? (
                                                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "6px 0" }}>
                                                                        此行动时间点暂未配置行动项，请从右上方下拉框选择添加（如：显示提醒、运行程序、广播信号等）。
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                                        {(actionSet.Actions || []).map((act, aIdx, aArr) => {
                                                                            const actMeta = BUILTIN_ACTIONS.find((a) => a.id === act.Id);
                                                                            return (
                                                                                <div
                                                                                    key={aIdx}
                                                                                    className="card"
                                                                                    style={{
                                                                                        margin: 0,
                                                                                        padding: 10,
                                                                                        border: "1px solid var(--border-color)",
                                                                                    }}
                                                                                >
                                                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                                                            <span className="badge badge-info">#{aIdx + 1}</span>
                                                                                            <Select
                                                                                                size="small"
                                                                                                value={act.Id}
                                                                                                onChange={(_, d) => {
                                                                                                    const nextMeta = BUILTIN_ACTIONS.find((a) => a.id === d.value);
                                                                                                    updateActionInItem(idx, aIdx, {
                                                                                                        Id: d.value,
                                                                                                        Settings: nextMeta?.defaultSettings
                                                                                                            ? JSON.parse(JSON.stringify(nextMeta.defaultSettings))
                                                                                                            : {},
                                                                                                    });
                                                                                                }}
                                                                                                style={{ width: 220 }}
                                                                                            >
                                                                                                {BUILTIN_ACTIONS.map((ba) => (
                                                                                                    <option key={ba.id} value={ba.id}>
                                                                                                        {ba.name}
                                                                                                    </option>
                                                                                                ))}
                                                                                                {!actMeta && (
                                                                                                    <option value={act.Id}>自定义行动</option>
                                                                                                )}
                                                                                            </Select>
                                                                                            <Input
                                                                                                size="small"
                                                                                                value={act.Id}
                                                                                                onChange={(_, d) => updateActionInItem(idx, aIdx, { Id: d.value })}
                                                                                                placeholder="行动 ID"
                                                                                                style={{ width: 210, fontFamily: "var(--font-mono)", fontSize: 11 }}
                                                                                                title="可直接输入第三方插件注册的 Action ID"
                                                                                            />
                                                                                            {actMeta && (
                                                                                                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                                                                                    {actMeta.desc}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                        <div className="flex gap-4">
                                                                                            <Button
                                                                                                size="small"
                                                                                                appearance="subtle"
                                                                                                icon={<ArrowUp24Regular />}
                                                                                                disabled={aIdx === 0}
                                                                                                onClick={() => moveActionInItem(idx, aIdx, -1)}
                                                                                            />
                                                                                            <Button
                                                                                                size="small"
                                                                                                appearance="subtle"
                                                                                                icon={<ArrowDown24Regular />}
                                                                                                disabled={aIdx === aArr.length - 1}
                                                                                                onClick={() => moveActionInItem(idx, aIdx, 1)}
                                                                                            />
                                                                                            <Button
                                                                                                size="small"
                                                                                                appearance="subtle"
                                                                                                icon={<Delete24Regular />}
                                                                                                onClick={() => removeActionFromItem(idx, aIdx)}
                                                                                                style={{ color: "var(--danger-color)" }}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                    {renderActionItemEditor(idx, aIdx, act)}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showCreate && (
                <Dialog open onOpenChange={() => setShowCreate(false)}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>新建时间表文件</DialogTitle>
                            <DialogContent>
                                <div className="form-group">
                                    <label className="form-label">文件名</label>
                                    <Input
                                        value={newFileName}
                                        onChange={(_, d) => setNewFileName(d.value)}
                                        placeholder="如 default 或 weekday"
                                        style={{ width: "100%" }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setShowCreate(false)}>取消</Button>
                                <Button appearance="primary" onClick={handleCreateFile} disabled={!newFileName.trim()}>创建</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
