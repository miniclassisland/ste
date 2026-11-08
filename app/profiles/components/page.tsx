"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    ComponentProfile,
    ComponentLineSettings,
    ComponentSettingsItem,
    HorizontalAlignmentType,
    BuiltinComponentMeta,
} from "@/lib/types";
import {
    HORIZONTAL_ALIGNMENT_LABELS,
    BUILTIN_COMPONENTS,
    LEGACY_COMPONENT_GUID_MAP,
} from "@/lib/types";
import {
    Button, Input, Switch, Spinner, Textarea,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    ArrowUp24Regular, ArrowDown24Regular, ArrowLeft24Regular, ArrowRight24Regular,
    Code24Regular, Box16Regular, Box24Regular, Apps24Regular, Settings24Regular,
    Wrench24Regular, TextAlignDistributed24Regular, Copy24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type BottomTabKey = "library" | "settings" | "advanced" | "line";

interface ContainerStackEntry {
    /** 在父级列表中的索引 */
    indexInParent: number;
    /** 容器组件名称 */
    title: string;
    /** 容器组件 GUID */
    id: string;
}

/** 查找内置组件元数据 */
function findBuiltinMeta(id?: string): BuiltinComponentMeta | undefined {
    if (!id) return undefined;
    const lower = id.trim().toLowerCase();
    const mapped = LEGACY_COMPONENT_GUID_MAP[lower] || lower;
    return BUILTIN_COMPONENTS.find((c) => c.id.toLowerCase() === mapped);
}

/** 判断组件是否为容器组件 */
function isContainerComponent(item?: ComponentSettingsItem | null): boolean {
    if (!item) return false;
    const meta = findBuiltinMeta(item.Id);
    if (meta?.isContainer) return true;
    const settingsObj = item.Settings as Record<string, unknown> | undefined;
    return !!(settingsObj && typeof settingsObj === "object" && Array.isArray(settingsObj.Children));
}

/** 递归迁移旧版错误 GUID 并补齐容器默认结构 */
function migrateComponentItems(items: ComponentSettingsItem[]): { items: ComponentSettingsItem[]; migratedCount: number } {
    let migratedCount = 0;
    const next = items.map((rawItem) => {
        const item: ComponentSettingsItem = { ...rawItem };
        const rawId = (item.Id || "").trim().toLowerCase();
        if (LEGACY_COMPONENT_GUID_MAP[rawId]) {
            item.Id = LEGACY_COMPONENT_GUID_MAP[rawId];
            migratedCount++;
        }
        const meta = findBuiltinMeta(item.Id);
        if (meta) {
            if (!item.NameCache || item.NameCache === "滚动文本" || item.NameCache === "天气" || item.NameCache === "分隔线") {
                item.NameCache = meta.name;
            }
            if (item.Settings === undefined || item.Settings === null) {
                if (meta.defaultSettings) {
                    item.Settings = JSON.parse(JSON.stringify(meta.defaultSettings));
                }
            } else if (typeof item.Settings === "object" && meta.defaultSettings) {
                item.Settings = {
                    ...JSON.parse(JSON.stringify(meta.defaultSettings)),
                    ...(item.Settings as Record<string, unknown>),
                };
            }
        }
        // 递归处理容器子组件
        if (item.Settings && typeof item.Settings === "object") {
            const sObj = { ...(item.Settings as Record<string, unknown>) };
            if (Array.isArray(sObj.Children)) {
                const sub = migrateComponentItems(sObj.Children as ComponentSettingsItem[]);
                sObj.Children = sub.items;
                migratedCount += sub.migratedCount;
            } else if (meta?.isContainer) {
                sObj.Children = [];
            }
            item.Settings = sObj;
        }
        return item;
    });
    return { items: next, migratedCount };
}

/** 将任意后端读取的组件配置标准化为上游 ComponentProfile ({ Lines: [...] }) */
function normalizeComponentProfile(raw: unknown): { profile: ComponentProfile; migratedCount: number } {
    const defaultLine: ComponentLineSettings = {
        Children: [],
        IslandSeparationMode: 0,
        IsMainLine: true,
        IsNotificationEnabled: true,
        IsEnabled: true,
    };
    if (!raw || typeof raw !== "object") {
        return { profile: { Lines: [defaultLine] }, migratedCount: 0 };
    }
    let rawLines: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
        const hasChildren = raw.length > 0 && raw[0] && typeof raw[0] === "object" && "Children" in raw[0];
        if (hasChildren) {
            rawLines = raw as Array<Record<string, unknown>>;
        } else {
            rawLines = [{ Children: raw, IslandSeparationMode: 0, IsMainLine: true, IsNotificationEnabled: true, IsEnabled: true }];
        }
    } else {
        const obj = raw as Record<string, unknown>;
        if (Array.isArray(obj.Lines)) {
            rawLines = obj.Lines as Array<Record<string, unknown>>;
        }
    }
    if (rawLines.length === 0) {
        return { profile: { Lines: [defaultLine] }, migratedCount: 0 };
    }

    let totalMigrated = 0;
    const lines: ComponentLineSettings[] = rawLines.map((line, i) => {
        const rawChildren = Array.isArray(line.Children) ? (line.Children as ComponentSettingsItem[]) : [];
        const migrated = migrateComponentItems(rawChildren);
        totalMigrated += migrated.migratedCount;
        return {
            ...(line as unknown as ComponentLineSettings),
            Children: migrated.items,
            IslandSeparationMode: typeof line.IslandSeparationMode === "number" ? line.IslandSeparationMode : 0,
            IsMainLine: typeof line.IsMainLine === "boolean" ? line.IsMainLine : i === 0,
            IsNotificationEnabled: typeof line.IsNotificationEnabled === "boolean" ? line.IsNotificationEnabled : i === 0,
            IsEnabled: typeof line.IsEnabled === "boolean" ? line.IsEnabled : true,
            HideOnRule: !!line.HideOnRule,
        };
    });

    // 确保至少有一行是 IsMainLine 和 IsNotificationEnabled
    if (!lines.some((l) => l.IsMainLine)) lines[0].IsMainLine = true;
    if (!lines.some((l) => l.IsNotificationEnabled)) lines[0].IsNotificationEnabled = true;

    return { profile: { Lines: lines }, migratedCount: totalMigrated };
}

export default function ComponentsPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [profile, setProfile] = useState<ComponentProfile>({
        Lines: [{ Children: [], IslandSeparationMode: 0, IsMainLine: true, IsNotificationEnabled: true, IsEnabled: true }],
    });
    const [selectedLineIdx, setSelectedLineIdx] = useState<number>(0);
    const [selectedCompIdx, setSelectedCompIdx] = useState<number>(-1);
    /** 容器层级栈：为空时编辑当前行的顶层 Children；非空时编辑栈顶容器的 Settings.Children */
    const [containerStack, setContainerStack] = useState<ContainerStackEntry[]>([]);
    const [activeTab, setActiveTab] = useState<BottomTabKey>("library");
    const [migratedLegacyCount, setMigratedLegacyCount] = useState<number>(0);

    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [customAddGuid, setCustomAddGuid] = useState("");
    const [customAddName, setCustomAddName] = useState("");

    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");

    const selectFile = useCallback(async (name: string) => {
        if (!accountId) return;
        setSelectedFile(name);
        setSelectedLineIdx(0);
        setSelectedCompIdx(-1);
        setContainerStack([]);
        setDataLoading(true);
        try {
            const content = await data.read(accountId, "Components", name);
            const { profile: normalized, migratedCount } = normalizeComponentProfile(content);
            setProfile(normalized);
            setMigratedLegacyCount(migratedCount);
            setJsonText(JSON.stringify(normalized, null, 2));
            if ((normalized.Lines[0]?.Children?.length || 0) > 0) {
                setSelectedCompIdx(0);
            }
        } catch {
            const { profile: fallback } = normalizeComponentProfile(null);
            setProfile(fallback);
            setMigratedLegacyCount(0);
            setJsonText(JSON.stringify(fallback, null, 2));
        }
        setDataLoading(false);
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const list = await data.list(accountId, "Components");
            const arr = Array.isArray(list) ? list : [];
            setFileList(arr);
            if (arr.length > 0 && !selectedFile) {
                selectFile(arr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectedFile, selectFile]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = profile;
            if (jsonMode) {
                const parsed = JSON.parse(jsonText);
                const { profile: normalized } = normalizeComponentProfile(parsed);
                payloadToSave = normalized;
                setProfile(normalized);
            } else {
                const { profile: normalized } = normalizeComponentProfile(profile);
                payloadToSave = normalized;
                setProfile(normalized);
                setJsonText(JSON.stringify(normalized, null, 2));
            }
            await data.write(accountId, "Components", selectedFile, payloadToSave);
            setMigratedLegacyCount(0);
            setMsg({ type: "success", text: "组件配置已保存并递增版本号" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查 JSON 格式" });
        }
        setSaving(false);
    }

    async function handleCreate() {
        if (!newFileName.trim()) return;
        try {
            await data.create(accountId, "Components", newFileName.trim());
            setShowCreate(false);
            setNewFileName("");
            const list = await data.list(accountId, "Components");
            const arr = Array.isArray(list) ? list : [];
            setFileList(arr);
            selectFile(newFileName.trim());
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDelete(name: string) {
        if (!confirm(`确定删除组件配置 "${name}" 吗？`)) return;
        try {
            await data.deleteData(accountId, "Components", name);
            if (selectedFile === name) {
                setSelectedFile(null);
                const { profile: fallback } = normalizeComponentProfile(null);
                setProfile(fallback);
            }
            loadFiles();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    const lines = profile.Lines || [];
    const currentLine: ComponentLineSettings | undefined = lines[selectedLineIdx];

    /** 获取当前激活作用域（行顶层或打开的容器）的组件数组 */
    function getActiveChildrenList(prof: ComponentProfile = profile, lineIdx: number = selectedLineIdx, stack: ContainerStackEntry[] = containerStack): ComponentSettingsItem[] {
        const line = prof.Lines[lineIdx];
        if (!line) return [];
        let list = line.Children || [];
        for (const entry of stack) {
            const container = list[entry.indexInParent];
            if (!container || !container.Settings || typeof container.Settings !== "object") return [];
            const sObj = container.Settings as Record<string, unknown>;
            list = Array.isArray(sObj.Children) ? (sObj.Children as ComponentSettingsItem[]) : [];
        }
        return list;
    }

    /** 更新当前激活作用域（行顶层或打开的容器）的组件数组 */
    function updateActiveChildrenList(updater: (prevList: ComponentSettingsItem[]) => ComponentSettingsItem[]) {
        setProfile((prev) => {
            const nextLines = prev.Lines.map((l, idx) => {
                if (idx !== selectedLineIdx) return l;
                if (containerStack.length === 0) {
                    return { ...l, Children: updater([...(l.Children || [])]) };
                }
                const cloneChildrenAtDepth = (items: ComponentSettingsItem[], depth: number): ComponentSettingsItem[] => {
                    const targetIdx = containerStack[depth].indexInParent;
                    return items.map((item, i) => {
                        if (i !== targetIdx) return item;
                        const sObj = (item.Settings && typeof item.Settings === "object")
                            ? { ...(item.Settings as Record<string, unknown>) }
                            : {};
                        const subList = Array.isArray(sObj.Children) ? [...(sObj.Children as ComponentSettingsItem[])] : [];
                        if (depth === containerStack.length - 1) {
                            sObj.Children = updater(subList);
                        } else {
                            sObj.Children = cloneChildrenAtDepth(subList, depth + 1);
                        }
                        return { ...item, Settings: sObj };
                    });
                };
                return { ...l, Children: cloneChildrenAtDepth([...(l.Children || [])], 0) };
            });
            return { ...prev, Lines: nextLines };
        });
    }

    const activeChildren = getActiveChildrenList();
    const currentComp: ComponentSettingsItem | undefined =
        selectedCompIdx >= 0 && selectedCompIdx < activeChildren.length
            ? activeChildren[selectedCompIdx]
            : undefined;
    const currentCompMeta = findBuiltinMeta(currentComp?.Id);

    // ── 行操作 (与上游 ComponentsSettingsPage 顶栏行操作对齐) ──
    function addLineBelow(afterIdx: number = lines.length - 1) {
        const insertAt = Math.max(0, afterIdx + 1);
        const newLine: ComponentLineSettings = {
            Children: [],
            IslandSeparationMode: 0,
            IsMainLine: lines.length === 0,
            IsNotificationEnabled: lines.length === 0,
            IsEnabled: true,
            HideOnRule: false,
        };
        setProfile((prev) => {
            const next = [...prev.Lines];
            next.splice(insertAt, 0, newLine);
            return { ...prev, Lines: next };
        });
        setSelectedLineIdx(insertAt);
        setContainerStack([]);
        setSelectedCompIdx(-1);
    }

    function removeLine(idx: number) {
        if (lines.length <= 1) return;
        setProfile((prev) => {
            const next = prev.Lines.filter((_, i) => i !== idx);
            if (!next.some((l) => l.IsMainLine)) next[0].IsMainLine = true;
            if (!next.some((l) => l.IsNotificationEnabled)) next[0].IsNotificationEnabled = true;
            return { ...prev, Lines: next };
        });
        setSelectedLineIdx(Math.max(0, idx - 1));
        setContainerStack([]);
        setSelectedCompIdx(-1);
    }

    function moveLine(idx: number, dir: -1 | 1) {
        const target = idx + dir;
        if (target < 0 || target >= lines.length) return;
        setProfile((prev) => {
            const next = [...prev.Lines];
            [next[idx], next[target]] = [next[target], next[idx]];
            return { ...prev, Lines: next };
        });
        setSelectedLineIdx(target);
    }

    function setMainLine(idx: number) {
        setProfile((prev) => ({
            ...prev,
            Lines: prev.Lines.map((l, i) => ({ ...l, IsMainLine: i === idx })),
        }));
    }

    function setNotificationLine(idx: number) {
        setProfile((prev) => ({
            ...prev,
            Lines: prev.Lines.map((l, i) => ({ ...l, IsNotificationEnabled: i === idx })),
        }));
    }

    function updateCurrentLine(patch: Partial<ComponentLineSettings>) {
        setProfile((prev) => {
            const next = prev.Lines.map((l, i) => {
                if (patch.IsMainLine && i !== selectedLineIdx) {
                    return { ...l, IsMainLine: false };
                }
                if (patch.IsNotificationEnabled && i !== selectedLineIdx) {
                    return { ...l, IsNotificationEnabled: false };
                }
                return i === selectedLineIdx ? { ...l, ...patch } : l;
            });
            return { ...prev, Lines: next };
        });
    }

    // ── 组件与容器操作 ──
    function addComponent(id: string, name: string) {
        const meta = findBuiltinMeta(id);
        const defaultSettings = meta?.defaultSettings
            ? JSON.parse(JSON.stringify(meta.defaultSettings))
            : undefined;
        const newComp: ComponentSettingsItem = {
            Id: meta?.id || id,
            NameCache: meta?.name || name,
            Settings: defaultSettings,
            HideOnRule: false,
            HorizontalAlignment: 1,
            IsResourceOverridingEnabled: false,
            IsCustomForegroundColorEnabled: false,
            IsCustomBackgroundColorEnabled: false,
            IsCustomBackgroundOpacityEnabled: false,
            IsCustomCornerRadiusEnabled: false,
            IsMinWidthEnabled: false,
            IsMaxWidthEnabled: false,
            IsFixedWidthEnabled: false,
            IsCustomMarginEnabled: false,
        };
        const newIdx = activeChildren.length;
        updateActiveChildrenList((prev) => [...prev, newComp]);
        setSelectedCompIdx(newIdx);
        if (meta?.hasSettings) {
            setActiveTab("settings");
        }
    }

    function duplicateComponent(idx: number) {
        const target = activeChildren[idx];
        if (!target) return;
        const cloned: ComponentSettingsItem = JSON.parse(JSON.stringify(target));
        updateActiveChildrenList((prev) => {
            const next = [...prev];
            next.splice(idx + 1, 0, cloned);
            return next;
        });
        setSelectedCompIdx(idx + 1);
    }

    function wrapInContainer(idx: number, containerId: string) {
        const target = activeChildren[idx];
        const containerMeta = findBuiltinMeta(containerId);
        if (!target || !containerMeta) return;
        const defaultContainerSettings = containerMeta.defaultSettings
            ? JSON.parse(JSON.stringify(containerMeta.defaultSettings))
            : { Children: [] };
        defaultContainerSettings.Children = [JSON.parse(JSON.stringify(target))];
        const wrapper: ComponentSettingsItem = {
            Id: containerMeta.id,
            NameCache: containerMeta.name,
            Settings: defaultContainerSettings,
            HideOnRule: false,
            HorizontalAlignment: 1,
        };
        updateActiveChildrenList((prev) => prev.map((c, i) => (i === idx ? wrapper : c)));
        setSelectedCompIdx(idx);
    }

    function removeComponent(idx: number) {
        updateActiveChildrenList((prev) => prev.filter((_, i) => i !== idx));
        setSelectedCompIdx((prev) => (prev === idx ? -1 : prev > idx ? prev - 1 : prev));
    }

    function moveComponent(idx: number, dir: -1 | 1) {
        const target = idx + dir;
        if (target < 0 || target >= activeChildren.length) return;
        updateActiveChildrenList((prev) => {
            const next = [...prev];
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
        setSelectedCompIdx(target);
    }

    function openContainerChildren(idx: number) {
        const comp = activeChildren[idx];
        if (!comp || !isContainerComponent(comp)) return;
        const meta = findBuiltinMeta(comp.Id);
        setContainerStack((prev) => [
            ...prev,
            {
                indexInParent: idx,
                title: comp.NameCache || meta?.name || "容器组件",
                id: comp.Id || "",
            },
        ]);
        const sObj = (comp.Settings && typeof comp.Settings === "object") ? (comp.Settings as Record<string, unknown>) : {};
        const subChildren = Array.isArray(sObj.Children) ? sObj.Children : [];
        setSelectedCompIdx(subChildren.length > 0 ? 0 : -1);
    }

    function popContainerTo(depth: number) {
        if (depth < 0) {
            const firstEntry = containerStack[0];
            setContainerStack([]);
            setSelectedCompIdx(firstEntry ? firstEntry.indexInParent : 0);
        } else {
            const nextEntry = containerStack[depth + 1];
            setContainerStack((prev) => prev.slice(0, depth + 1));
            setSelectedCompIdx(nextEntry ? nextEntry.indexInParent : 0);
        }
    }

    function updateCurrentComp(patch: Partial<ComponentSettingsItem>) {
        if (selectedCompIdx < 0) return;
        updateActiveChildrenList((prev) =>
            prev.map((c, i) => (i === selectedCompIdx ? { ...c, ...patch } : c))
        );
    }

    function updateCurrentCompSettings(patch: Record<string, unknown>) {
        if (!currentComp) return;
        const base =
            currentComp.Settings && typeof currentComp.Settings === "object"
                ? { ...(currentComp.Settings as Record<string, unknown>) }
                : currentCompMeta?.defaultSettings
                    ? JSON.parse(JSON.stringify(currentCompMeta.defaultSettings))
                    : {};
        updateCurrentComp({ Settings: { ...base, ...patch } });
    }

    /** 渲染特定内置组件的原位 1:1 专属设置面板 */
    function renderBuiltinComponentSettings(comp: ComponentSettingsItem) {
        const compId = (comp.Id || "").toLowerCase();
        const meta = findBuiltinMeta(compId);
        const s: Record<string, unknown> = {
            ...(meta?.defaultSettings ? JSON.parse(JSON.stringify(meta.defaultSettings)) : {}),
            ...(comp.Settings && typeof comp.Settings === "object" ? (comp.Settings as Record<string, unknown>) : {}),
        };

        // 1. 课程表 (ScheduleComponent - LessonControlSettings)
        if (compId === "1db2017d-e374-4bc6-9d57-0b4adf03a6b8") {
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div className="settings-section-title" style={{ marginBottom: 0 }}>时间点附加信息与倒计时</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>在当前时间点上显示附加信息</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>展开显示当前课程/课间的进度或剩余时间</div>
                            </div>
                            <Switch
                                checked={s.ShowExtraInfoOnTimePoint !== false}
                                onChange={(_, d) => updateCurrentCompSettings({ ShowExtraInfoOnTimePoint: d.checked })}
                            />
                        </div>

                        {s.ShowExtraInfoOnTimePoint !== false && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">附加信息类型</label>
                                    <Select
                                        value={String(s.ExtraInfoType ?? 0)}
                                        onChange={(_, d) => updateCurrentCompSettings({ ExtraInfoType: parseInt(d.value, 10) })}
                                    >
                                        <option value="0">时间点持续时间</option>
                                        <option value="1">已过时间 / 持续时间 (分)</option>
                                        <option value="2">剩余时间 / 持续时间 (分)</option>
                                        <option value="3">已过时间百分比 (%)</option>
                                        <option value="4">剩余时间</option>
                                        <option value="5">倒计时</option>
                                    </Select>
                                </div>
                                {Number(s.ExtraInfoType ?? 0) === 4 && (
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">剩余时间小于等于多少秒时显示秒数 (秒)</label>
                                        <Input
                                            type="number"
                                            value={String(s.ExtraInfo4ShowSecondsSeconds ?? 0)}
                                            onChange={(_, d) => updateCurrentCompSettings({ ExtraInfo4ShowSecondsSeconds: parseInt(d.value, 10) || 0 })}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>启用时间点结束倒计时</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>在上下课即将结束前显示倒计时进度</div>
                            </div>
                            <Switch
                                checked={s.IsCountdownEnabled !== false}
                                onChange={(_, d) => updateCurrentCompSettings({ IsCountdownEnabled: d.checked })}
                            />
                        </div>
                        {s.IsCountdownEnabled !== false && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center" }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">倒计时触发时长 (秒)</label>
                                    <Input
                                        type="number"
                                        value={String(s.CountdownSeconds ?? 60)}
                                        onChange={(_, d) => updateCurrentCompSettings({ CountdownSeconds: parseInt(d.value, 10) || 60 })}
                                    />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
                                    <span style={{ fontSize: 13 }}>使用非精确倒计时</span>
                                    <Switch
                                        checked={!!s.IsNonExactCountdownEnabled}
                                        onChange={(_, d) => updateCurrentCompSettings({ IsNonExactCountdownEnabled: d.checked })}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div className="settings-section-title" style={{ marginBottom: 0 }}>课程显示与占位设置</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">课程间距缩放</label>
                                <Input
                                    type="number"
                                    step={0.1}
                                    value={String(s.ScheduleSpacing ?? 1)}
                                    onChange={(_, d) => updateCurrentCompSettings({ ScheduleSpacing: parseFloat(d.value) || 1 })}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">明日课表预览模式</label>
                                <Select
                                    value={String(s.TomorrowScheduleShowMode ?? 1)}
                                    onChange={(_, d) => updateCurrentCompSettings({ TomorrowScheduleShowMode: parseInt(d.value, 10) })}
                                >
                                    <option value="0">不显示</option>
                                    <option value="1">放学后显示</option>
                                    <option value="2">总是显示</option>
                                    <option value="3">当天无展示课程时显示</option>
                                </Select>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13 }}>上课时仅显示当前课程</span>
                                <Switch
                                    checked={!!s.ShowCurrentLessonOnlyOnClass}
                                    onChange={(_, d) => updateCurrentCompSettings({ ShowCurrentLessonOnlyOnClass: d.checked })}
                                />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13 }}>淡化已结束的课程</span>
                                <Switch
                                    checked={s.FadeCompletedClasses !== false}
                                    onChange={(_, d) => updateCurrentCompSettings({ FadeCompletedClasses: d.checked })}
                                />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13 }}>隐藏已结束的课程</span>
                                <Switch
                                    checked={!!s.HideFinishedClass}
                                    onChange={(_, d) => updateCurrentCompSettings({ HideFinishedClass: d.checked })}
                                />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13 }}>高亮换课/临时层变动的课程</span>
                                <Switch
                                    checked={!!s.HighlightChangedClass}
                                    onChange={(_, d) => updateCurrentCompSettings({ HighlightChangedClass: d.checked })}
                                />
                            </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>无课程或全部结束时显示占位文本</span>
                                <Switch
                                    checked={s.ShowPlaceholderOnEmptyClassPlan !== false}
                                    onChange={(_, d) => updateCurrentCompSettings({ ShowPlaceholderOnEmptyClassPlan: d.checked })}
                                />
                            </div>
                            {s.ShowPlaceholderOnEmptyClassPlan !== false && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">今日无课程占位文本</label>
                                        <Input
                                            value={String(s.PlaceholderTextNoClass ?? "今天没有课程。")}
                                            onChange={(_, d) => updateCurrentCompSettings({ PlaceholderTextNoClass: d.value })}
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">课程全部结束占位文本</label>
                                        <Input
                                            value={String(s.PlaceholderTextAllClassEnded ?? "今日课程已全部结束。")}
                                            onChange={(_, d) => updateCurrentCompSettings({ PlaceholderTextAllClassEnded: d.value })}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // 2. 时钟 (ClockComponent - ClockComponentSettings)
        if (compId === "9e1af71d-8f77-4b21-a342-448787104dd9") {
            return (
                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="settings-section-title" style={{ marginBottom: 0 }}>时钟组件设置</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>显示秒数</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>以 HH:mm:ss 格式精确显示到秒</div>
                        </div>
                        <Switch
                            checked={!!s.ShowSeconds}
                            onChange={(_, d) => updateCurrentCompSettings({ ShowSeconds: d.checked })}
                        />
                    </div>
                    {!s.ShowSeconds && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>闪烁时间分隔符</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>不显示秒数时，每秒闪烁一次冒号分隔符</div>
                            </div>
                            <Switch
                                checked={s.FlashTimeSeparator !== false}
                                onChange={(_, d) => updateCurrentCompSettings({ FlashTimeSeparator: d.checked })}
                            />
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>显示真实系统时间</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>忽略应用设置中的时间偏移校准，直接显示系统时间</div>
                        </div>
                        <Switch
                            checked={!!s.ShowRealTime}
                            onChange={(_, d) => updateCurrentCompSettings({ ShowRealTime: d.checked })}
                        />
                    </div>
                </div>
            );
        }

        // 3. 天气简报 (WeatherComponent - WeatherComponentSettings)
        if (compId === "ca495086-e297-4beb-9603-c5c1c1a8551e") {
            return (
                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="settings-section-title" style={{ marginBottom: 0 }}>天气简报组件设置</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>显示主要天气信息</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>显示天气图标与指定的主要气象指标</div>
                        </div>
                        <Switch
                            checked={s.ShowMainWeatherInfo !== false}
                            onChange={(_, d) => updateCurrentCompSettings({ ShowMainWeatherInfo: d.checked })}
                        />
                    </div>
                    {s.ShowMainWeatherInfo !== false && (
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">主要天气信息类型</label>
                            <Select
                                value={String(s.MainWeatherInfoKind ?? 0)}
                                onChange={(_, d) => updateCurrentCompSettings({ MainWeatherInfoKind: parseInt(d.value, 10) })}
                            >
                                <option value="0">天气状况与气温</option>
                                <option value="1">相对湿度 (%)</option>
                                <option value="2">风向与风力</option>
                                <option value="3">空气质量指数</option>
                                <option value="4">大气压强</option>
                                <option value="5">体感温度 (℃)</option>
                            </Select>
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>显示气象预警</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>当所在地发布气象预警时在组件内展示</div>
                        </div>
                        <Switch
                            checked={s.ShowAlerts !== false}
                            onChange={(_, d) => updateCurrentCompSettings({ ShowAlerts: d.checked })}
                        />
                    </div>
                    {s.ShowAlerts !== false && (
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">预警标题显示模式</label>
                            <Select
                                value={String(s.AlertsTitleShowMode ?? 1)}
                                onChange={(_, d) => updateCurrentCompSettings({ AlertsTitleShowMode: parseInt(d.value, 10) })}
                            >
                                <option value="0">不显示文字标题（仅显示图标）</option>
                                <option value="1">仅当没有对应预警图标时显示文字</option>
                                <option value="2">总是显示预警文字标题</option>
                            </Select>
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>显示降水倒计时提示</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>显示距离降雨开始或雨停的预计分钟数</div>
                        </div>
                        <Switch
                            checked={s.ShowRainTime !== false}
                            onChange={(_, d) => updateCurrentCompSettings({ ShowRainTime: d.checked })}
                        />
                    </div>
                    {s.ShowRainTime !== false && (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 13 }}>模糊化较长时间的降水预测</span>
                            <Switch
                                checked={s.IsFuzzyLongRainCountdownEnabled !== false}
                                onChange={(_, d) => updateCurrentCompSettings({ IsFuzzyLongRainCountdownEnabled: d.checked })}
                            />
                        </div>
                    )}
                </div>
            );
        }

        // 4. 倒计时 (CountDownComponent - CountDownComponentSettings)
        if (compId === "7c645d35-8151-48ba-b4ac-15017460d994") {
            const source = Number(s.CountdownSource ?? 0);
            const extractDateInput = (iso?: unknown) => {
                if (typeof iso !== "string" || !iso) return new Date().toISOString().slice(0, 16);
                return iso.slice(0, 16);
            };
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div className="settings-section-title" style={{ marginBottom: 0 }}>倒计时基本与时间源设置</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">倒计时名称</label>
                                <Input
                                    value={String(s.CountDownName ?? "倒计时")}
                                    onChange={(_, d) => updateCurrentCompSettings({ CountDownName: d.value })}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">计时源类型</label>
                                <Select
                                    value={String(source)}
                                    onChange={(_, d) => updateCurrentCompSettings({ CountdownSource: parseInt(d.value, 10) })}
                                >
                                    <option value="0">固定目标时间</option>
                                    <option value="1">循环周期计时</option>
                                    <option value="2">今日剩余时间</option>
                                    <option value="3">本周剩余时间</option>
                                </Select>
                            </div>
                        </div>

                        {source === 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">开始时间（用于计算进度）</label>
                                    <Input
                                        type="datetime-local"
                                        value={extractDateInput(s.StartTime)}
                                        onChange={(_, d) => updateCurrentCompSettings({ StartTime: d.value ? `${d.value}:00` : s.StartTime })}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">目标结束时间</label>
                                    <Input
                                        type="datetime-local"
                                        value={extractDateInput(s.OverTime)}
                                        onChange={(_, d) => updateCurrentCompSettings({ OverTime: d.value ? `${d.value}:00` : s.OverTime })}
                                    />
                                </div>
                            </div>
                        )}

                        {source === 1 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">周期起始时间</label>
                                        <Input
                                            type="datetime-local"
                                            value={extractDateInput(s.CycleStartTime)}
                                            onChange={(_, d) => updateCurrentCompSettings({ CycleStartTime: d.value ? `${d.value}:00` : s.CycleStartTime })}
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">周期持续时长</label>
                                        <Input
                                            value={String(s.CycleDuration ?? "1.00:00:00")}
                                            onChange={(_, d) => updateCurrentCompSettings({ CycleDuration: d.value })}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: 13 }}>启用高级周期计时（前置/后置间隔与次数限制）</span>
                                    <Switch
                                        checked={!!s.IsAdvancedCycleTimingEnabled}
                                        onChange={(_, d) => updateCurrentCompSettings({ IsAdvancedCycleTimingEnabled: d.checked })}
                                    />
                                </div>
                                {!!s.IsAdvancedCycleTimingEnabled && (
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">前置时长</label>
                                            <Input
                                                value={String(s.CycleBeforeDuration ?? "00:00:00")}
                                                onChange={(_, d) => updateCurrentCompSettings({ CycleBeforeDuration: d.value })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">后置时长</label>
                                            <Input
                                                value={String(s.CycleAfterDuration ?? "00:00:00")}
                                                onChange={(_, d) => updateCurrentCompSettings({ CycleAfterDuration: d.value })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">循环次数上限</label>
                                            <Input
                                                type="number"
                                                value={String(s.IsCycleCountLimited ? (s.CycleCountLimit ?? 2) : 0)}
                                                onChange={(_, d) => {
                                                    const n = parseInt(d.value, 10) || 0;
                                                    updateCurrentCompSettings({
                                                        IsCycleCountLimited: n > 0,
                                                        CycleCountLimit: n > 0 ? n : 2,
                                                    });
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {(source === 2 || source === 3) && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">自然时间/课程时间模式</label>
                                    <Select
                                        value={String(s.NatureTimeUseMode ?? 0)}
                                        onChange={(_, d) => updateCurrentCompSettings({ NatureTimeUseMode: parseInt(d.value, 10) })}
                                    >
                                        <option value="0">自动（优先遵循当日课表起止时间）</option>
                                        <option value="1">强制使用自然日/自然周时间</option>
                                        <option value="2">强制仅使用课表上下学时间</option>
                                    </Select>
                                </div>
                                {source === 3 && (
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">每周起始日</label>
                                        <Select
                                            value={String(s.WeekCountdownStartDay ?? 1)}
                                            onChange={(_, d) => updateCurrentCompSettings({
                                                IsCustomWeekCountdownStartDayEnabled: true,
                                                WeekCountdownStartDay: parseInt(d.value, 10),
                                            })}
                                        >
                                            <option value="0">周日</option>
                                            <option value="1">周一</option>
                                            <option value="2">周二</option>
                                            <option value="3">周三</option>
                                            <option value="4">周四</option>
                                            <option value="5">周五</option>
                                            <option value="6">周六</option>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div className="settings-section-title" style={{ marginBottom: 0 }}>显示格式、进度条与外观</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">连接词文本</label>
                                <Input
                                    value={String(s.CountDownConnector ?? "还有")}
                                    onChange={(_, d) => updateCurrentCompSettings({ CountDownConnector: d.value })}
                                    placeholder="如：还有 / 距离"
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">时间格式字符串</label>
                                <Input
                                    value={String(s.CustomStringFormat ?? "%D天")}
                                    onChange={(_, d) => updateCurrentCompSettings({ CustomStringFormat: d.value })}
                                    placeholder="%D天 %H时 %M分 %S秒 (%P%)"
                                />
                                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                                    支持变量：%D(总天数) %H(总小时) %M(总分钟) %S(总秒) %h/%m/%s(余数时分秒) %P/%p(进度百分比)
                                </div>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "center" }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">数字高亮颜色</label>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        type="color"
                                        value={String(s.FontColor || "#FF0000").slice(0, 7)}
                                        onChange={(e) => updateCurrentCompSettings({ FontColor: e.target.value })}
                                        style={{ width: 32, height: 32, border: "none", background: "transparent", cursor: "pointer" }}
                                    />
                                    <Input
                                        value={String(s.FontColor ?? "#FF0000")}
                                        onChange={(_, d) => updateCurrentCompSettings({ FontColor: d.value })}
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">字体大小</label>
                                <Input
                                    type="number"
                                    value={String(s.FontSize ?? 16)}
                                    onChange={(_, d) => updateCurrentCompSettings({ FontSize: parseInt(d.value, 10) || 16 })}
                                />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: 12 }}>紧凑布局模式</span>
                                    <Switch
                                        checked={!!s.IsCompactModeEnabled}
                                        onChange={(_, d) => updateCurrentCompSettings({ IsCompactModeEnabled: d.checked })}
                                    />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: 12 }}>连接词也使用高亮色</span>
                                    <Switch
                                        checked={!!s.IsConnectorColorEmphasized}
                                        onChange={(_, d) => updateCurrentCompSettings({ IsConnectorColorEmphasized: d.checked })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>显示可视化进度条/进度环</span>
                                <Switch
                                    checked={!!s.ShowProgress}
                                    onChange={(_, d) => updateCurrentCompSettings({ ShowProgress: d.checked })}
                                />
                            </div>
                            {!!s.ShowProgress && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "center" }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">进度指示器样式</label>
                                        <Select
                                            value={String(s.ProgressBarMode ?? 0)}
                                            onChange={(_, d) => updateCurrentCompSettings({ ProgressBarMode: parseInt(d.value, 10) })}
                                        >
                                            <option value="0">环形进度</option>
                                            <option value="1">条形进度</option>
                                        </Select>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
                                        <span style={{ fontSize: 13 }}>反显剩余进度</span>
                                        <Switch
                                            checked={!!s.IsProgressInverted}
                                            onChange={(_, d) => updateCurrentCompSettings({ IsProgressInverted: d.checked })}
                                        />
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
                                        <span style={{ fontSize: 13 }}>使用主题强调色</span>
                                        <Switch
                                            checked={s.UseAccentOnProgressBar !== false}
                                            onChange={(_, d) => updateCurrentCompSettings({ UseAccentOnProgressBar: d.checked })}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // 5. 文本 (TextComponent - TextComponentSettings)
        if (compId === "ee8f66bd-c423-4e7c-ab46-aa9976b00e08") {
            return (
                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="settings-section-title" style={{ marginBottom: 0 }}>文本组件设置</div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">显示文本内容</label>
                        <Input
                            value={String(s.TextContent ?? "")}
                            onChange={(_, d) => updateCurrentCompSettings({ TextContent: d.value })}
                            placeholder="输入要在主界面显示的标语或文字..."
                        />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center" }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">字体大小</label>
                            <Input
                                type="number"
                                value={String(s.FontSize ?? 16)}
                                onChange={(_, d) => updateCurrentCompSettings({ FontSize: parseInt(d.value, 10) || 16 })}
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <label className="form-label" style={{ marginBottom: 0 }}>自定义字体颜色</label>
                                <Switch
                                    checked={!!s.UseCustomFontColor}
                                    onChange={(_, d) => updateCurrentCompSettings({ UseCustomFontColor: d.checked })}
                                />
                            </div>
                            {!!s.UseCustomFontColor && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        type="color"
                                        value={String(s.FontColor || "#FFFFFF").slice(0, 7)}
                                        onChange={(e) => updateCurrentCompSettings({ FontColor: e.target.value })}
                                        style={{ width: 32, height: 32, border: "none", background: "transparent", cursor: "pointer" }}
                                    />
                                    <Input
                                        value={String(s.FontColor ?? "#FFFFFF")}
                                        onChange={(_, d) => updateCurrentCompSettings({ FontColor: d.value })}
                                        style={{ flex: 1 }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        // 6. 轮播容器 (SlideComponent - SlideComponentSettings)
        if (compId === "7e19a113-d281-4f33-970a-834a0b78b5ad") {
            return (
                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="settings-section-title" style={{ marginBottom: 0 }}>轮播容器设置</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">轮播间隔时长 (秒)</label>
                            <Input
                                type="number"
                                value={String(s.SlideSeconds ?? 15)}
                                onChange={(_, d) => updateCurrentCompSettings({ SlideSeconds: parseFloat(d.value) || 15 })}
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">轮播切换模式</label>
                            <Select
                                value={String(s.SlideMode ?? 0)}
                                onChange={(_, d) => updateCurrentCompSettings({ SlideMode: parseInt(d.value, 10) })}
                            >
                                <option value="0">顺序循环</option>
                                <option value="1">随机展示</option>
                                <option value="2">往复乒乓</option>
                            </Select>
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>启用切换过渡动画</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>子组件轮播切换时播放平滑过渡动画</div>
                        </div>
                        <Switch
                            checked={!!s.IsAnimationEnabled}
                            onChange={(_, d) => updateCurrentCompSettings({ IsAnimationEnabled: d.checked })}
                        />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13 }}>满足规则时暂停轮播</span>
                        <Switch
                            checked={!!s.IsPauseOnRuleEnabled}
                            onChange={(_, d) => updateCurrentCompSettings({ IsPauseOnRuleEnabled: d.checked })}
                        />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13 }}>满足规则时停止轮播</span>
                        <Switch
                            checked={!!s.IsStopOnRuleEnabled}
                            onChange={(_, d) => updateCurrentCompSettings({ IsStopOnRuleEnabled: d.checked })}
                        />
                    </div>
                </div>
            );
        }

        // 7. 滚动容器 (RollingComponent - RollingComponentSettings)
        if (compId === "70fcd5ea-3fae-4e06-aca2-4f4df47f9acd") {
            return (
                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="settings-section-title" style={{ marginBottom: 0 }}>滚动容器设置</div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">滚动速度</label>
                        <Input
                            type="number"
                            value={String(s.SpeedPixelPerSecond ?? 40)}
                            onChange={(_, d) => updateCurrentCompSettings({ SpeedPixelPerSecond: parseFloat(d.value) || 40 })}
                        />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 600 }}>滚动一轮后暂停停留</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>每次滚动到指定偏移位置时暂停一段时间</div>
                        </div>
                        <Switch
                            checked={s.IsPauseEnabled !== false}
                            onChange={(_, d) => updateCurrentCompSettings({ IsPauseEnabled: d.checked })}
                        />
                    </div>
                    {s.IsPauseEnabled !== false && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">暂停停留时长 (秒)</label>
                                <Input
                                    type="number"
                                    value={String(s.PauseSeconds ?? 10)}
                                    onChange={(_, d) => updateCurrentCompSettings({ PauseSeconds: parseFloat(d.value) || 10 })}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">暂停位置水平偏移</label>
                                <Input
                                    type="number"
                                    value={String(s.PauseOffsetX ?? 0)}
                                    onChange={(_, d) => updateCurrentCompSettings({ PauseOffsetX: parseFloat(d.value) || 0 })}
                                />
                            </div>
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13 }}>满足规则时暂停滚动</span>
                        <Switch
                            checked={!!s.PauseOnRule}
                            onChange={(_, d) => updateCurrentCompSettings({ PauseOnRule: d.checked })}
                        />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13 }}>满足规则时停止滚动并归位</span>
                        <Switch
                            checked={!!s.StopOnRule}
                            onChange={(_, d) => updateCurrentCompSettings({ StopOnRule: d.checked })}
                        />
                    </div>
                </div>
            );
        }

        // 无独立设置项的内置组件（日期、分割线、分组容器、堆叠容器）或第三方插件组件
        return (
            <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {meta && !meta.hasSettings
                        ? `“${meta.name}”组件没有专属功能设置项（可在“高级设置”标签页配置外观、字体与边距${meta.isContainer ? "，或点击上方“管理子组件”编辑内部组件" : ""}）。`
                        : "自定义/插件组件专属设置 JSON："}
                </div>
                <Textarea
                    rows={5}
                    value={comp.Settings ? JSON.stringify(comp.Settings, null, 2) : ""}
                    onChange={(_, d) => {
                        try {
                            const parsed = d.value.trim() ? JSON.parse(d.value) : undefined;
                            updateCurrentComp({ Settings: parsed });
                        } catch {
                            // 允许正在输入中的半成品 JSON
                        }
                    }}
                    placeholder="无附加 Settings 或输入 JSON 对象"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
            </div>
        );
    }

    if (loading) {
        return <div className="empty-state"><Spinner size="medium" label="加载组件配置列表中..." /></div>;
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">组件布局配置</h1>
                    <p className="page-subtitle">原位对照 ClassIsland 客户端【设置 → 组件】多行视图、容器子组件栈、组件专属设置与高级布局覆盖</p>
                </div>
                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>新建配置</Button>
                    {selectedFile && (
                        <>
                            <FileHistoryButton
                                accountId={accountId}
                                resourceType="Components"
                                fileName={selectedFile}
                                onLoadVersion={(content, version, isCurrent) => {
                                    const { profile: normalized, migratedCount } = normalizeComponentProfile(content);
                                    setProfile(normalized);
                                    setMigratedLegacyCount(migratedCount);
                                    setJsonText(JSON.stringify(normalized, null, 2));
                                    setMsg({
                                        type: "success",
                                        text: isCurrent
                                            ? `已加载当前最新版本 v${version}`
                                            : `已加载历史版本 v${version} 到编辑器（点击「保存」将创建一个新版本）`,
                                    });
                                }}
                                onError={(text) => setMsg({ type: "error", text })}
                            />
                            <DownloadPresetPopoverButton
                                buttonText="导出 JSON"
                                appearance="secondary"
                                defaultFileName={`Components-${selectedFile}.json`}
                                suggestedNames={[
                                    { label: "具名区分文件", fileName: `Components-${selectedFile}.json` },
                                    { label: "档案原名", fileName: `${selectedFile}.json` },
                                    { label: "客户端标准资源名", fileName: "Components.json" },
                                ]}
                                onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : profile)}
                                onError={(text) => setMsg({ type: "error", text })}
                            />
                            <Button
                                icon={<Code24Regular />}
                                appearance={jsonMode ? "primary" : "subtle"}
                                onClick={() => {
                                    if (!jsonMode) setJsonText(JSON.stringify(profile, null, 2));
                                    setJsonMode(!jsonMode);
                                }}
                            >
                                {jsonMode ? "可视化模式" : "JSON 模式"}
                            </Button>
                            <Button appearance="secondary" icon={<ArrowSync24Regular />} onClick={() => selectFile(selectedFile)}>刷新</Button>
                            <Button appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={saving}>
                                {saving ? "保存中..." : "保存"}
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {msg && (
                <MessageBar intent={msg.type === "success" ? "success" : "error"} style={{ marginBottom: 16 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            {migratedLegacyCount > 0 && (
                <MessageBar intent="warning" style={{ marginBottom: 16 }}>
                    <MessageBarBody>
                        检测到 {migratedLegacyCount} 个旧版前端生成的组件 GUID，已自动修正为 ClassIsland 客户端真实内置组件 GUID。请点击右上角「保存」以同步更新到客户端。
                    </MessageBarBody>
                </MessageBar>
            )}

            {/* 顶部组件配置文件切换条（使主界面组件行视图与下方四标签面板获得 100% 宽度） */}
            <div className="card" style={{ padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>组件配置文件：</span>
                    {fileList.length === 0 ? (
                        <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>暂无组件配置</span>
                    ) : (
                        fileList.map((f) => (
                            <div
                                key={f}
                                onClick={() => selectFile(f)}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    height: 32,
                                    padding: "0 6px 0 12px",
                                    borderRadius: "var(--radius-sm)",
                                    border: selectedFile === f ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                                    background: selectedFile === f ? "var(--bg-accent-subtle)" : "var(--bg-subtle)",
                                    color: selectedFile === f ? "var(--accent-color)" : "var(--text-primary)",
                                    fontWeight: selectedFile === f ? 600 : 500,
                                    fontSize: 13,
                                    cursor: "pointer",
                                }}
                            >
                                <span>{f}</span>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Delete24Regular />}
                                    onClick={(e) => { e.stopPropagation(); handleDelete(f); }}
                                    style={{ color: "var(--danger-color)", minWidth: 22, height: 22, padding: 2 }}
                                    title="删除此组件配置文件"
                                />
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div>
                {/* 原位模拟上游 ComponentsSettingsPage 编辑器 */}
                <div style={{ minWidth: 0 }}>
                    {!selectedFile ? (
                        <div className="card"><div className="empty-state"><div className="empty-state-text">请从上方选择或新建一个组件配置文件</div></div></div>
                    ) : dataLoading ? (
                        <div className="card"><div className="empty-state"><Spinner size="medium" /></div></div>
                    ) : jsonMode ? (
                        <div className="card">
                            <div className="card-title">JSON 编辑器 — {selectedFile}</div>
                            <div className="json-editor">
                                <textarea
                                    value={jsonText}
                                    onChange={(e) => setJsonText(e.target.value)}
                                    style={{ minHeight: 540 }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            {/* ── 顶部：主界面行可视化预览区 (对应上游 ListBoxMainWindowLines) ── */}
                            <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>主界面组件行视图</span>
                                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                            共 {lines.length} 行 · 点击行内组件可直接编辑，双击容器组件可展开子组件
                                        </span>
                                    </div>
                                    <Button size="small" icon={<Add24Regular />} onClick={() => addLineBelow(selectedLineIdx)}>
                                        新增一行
                                    </Button>
                                </div>

                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {lines.map((line, lIdx) => {
                                        const isLineSelected = lIdx === selectedLineIdx;
                                        return (
                                            <div
                                                key={lIdx}
                                                onClick={() => {
                                                    if (selectedLineIdx !== lIdx) {
                                                        setSelectedLineIdx(lIdx);
                                                        setContainerStack([]);
                                                        setSelectedCompIdx((line.Children?.length || 0) > 0 ? 0 : -1);
                                                    }
                                                }}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                    padding: "10px 12px",
                                                    borderRadius: 10,
                                                    border: isLineSelected ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                    background: isLineSelected ? "var(--bg-accent-subtle)" : "var(--bg-subtle)",
                                                    cursor: "pointer",
                                                    transition: "all 0.12s ease",
                                                }}
                                            >
                                                {/* 行标题与状态徽标 */}
                                                <div style={{ minWidth: 112, display: "flex", flexDirection: "column", gap: 4 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <span style={{ fontWeight: 600, fontSize: 13 }}>第 {lIdx + 1} 行</span>
                                                        {line.IsEnabled === false && (
                                                            <span className="badge badge-danger" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                已禁用
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                                        {line.IsMainLine && (
                                                            <span className="badge badge-info" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                主要行
                                                            </span>
                                                        )}
                                                        {line.IsNotificationEnabled && (
                                                            <span className="badge badge-success" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                提醒行
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* 水平排列的组件胶囊条 (模拟客户端顶栏效果) */}
                                                <div
                                                    style={{
                                                        flex: 1,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        overflowX: "auto",
                                                        padding: "6px 10px",
                                                        borderRadius: 999,
                                                        background: "var(--bg-card)",
                                                        border: "1px solid var(--border-color)",
                                                        minHeight: 42,
                                                    }}
                                                >
                                                    {(line.Children || []).length === 0 ? (
                                                        <span style={{ fontSize: 12, color: "var(--text-tertiary)", paddingLeft: 6 }}>
                                                            此行暂无组件，请从下方“组件库”点击添加
                                                        </span>
                                                    ) : (
                                                        (line.Children || []).map((comp, cIdx) => {
                                                            const meta = findBuiltinMeta(comp.Id);
                                                            const isContainer = isContainerComponent(comp);
                                                            const isCompActive = isLineSelected && containerStack.length === 0 && selectedCompIdx === cIdx;
                                                            const isContainerOpen = isLineSelected && containerStack[0]?.indexInParent === cIdx;
                                                            const childCount = isContainer && comp.Settings && typeof comp.Settings === "object" && Array.isArray((comp.Settings as Record<string, unknown>).Children)
                                                                ? ((comp.Settings as Record<string, unknown>).Children as unknown[]).length
                                                                : 0;
                                                            return (
                                                                <div
                                                                    key={cIdx}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setSelectedLineIdx(lIdx);
                                                                        setContainerStack([]);
                                                                        setSelectedCompIdx(cIdx);
                                                                    }}
                                                                    onDoubleClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (isContainer) {
                                                                            setSelectedLineIdx(lIdx);
                                                                            setContainerStack([]);
                                                                            setTimeout(() => openContainerChildren(cIdx), 0);
                                                                        }
                                                                    }}
                                                                    style={{
                                                                        display: "inline-flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                        padding: "5px 12px",
                                                                        borderRadius: 999,
                                                                        background: isCompActive || isContainerOpen
                                                                            ? "var(--accent-color)"
                                                                            : "var(--bg-subtle)",
                                                                        color: isCompActive || isContainerOpen ? "#ffffff" : "var(--text-primary)",
                                                                        fontWeight: isCompActive || isContainerOpen ? 600 : 500,
                                                                        fontSize: 12.5,
                                                                        whiteSpace: "nowrap",
                                                                        cursor: "pointer",
                                                                        border: isCompActive || isContainerOpen
                                                                            ? "1px solid var(--accent-color)"
                                                                            : isContainer
                                                                                ? "1px dashed var(--accent-color)"
                                                                                : "1px solid var(--border-color)",
                                                                    }}
                                                                    title={isContainer ? "单击选中，双击展开容器子组件" : comp.Id}
                                                                >
                                                                    <span>{comp.NameCache || meta?.name || "未知组件"}</span>
                                                                    {isContainer && (
                                                                        <span
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setSelectedLineIdx(lIdx);
                                                                                setContainerStack([]);
                                                                                setTimeout(() => openContainerChildren(cIdx), 0);
                                                                            }}
                                                                            style={{
                                                                                display: "inline-flex",
                                                                                alignItems: "center",
                                                                                gap: 3,
                                                                                fontSize: 10,
                                                                                padding: "1px 5px",
                                                                                borderRadius: 99,
                                                                                background: isCompActive || isContainerOpen ? "rgba(255,255,255,0.22)" : "var(--bg-accent-subtle)",
                                                                                color: isCompActive || isContainerOpen ? "#ffffff" : "var(--accent-color)",
                                                                            }}
                                                                        >
                                                                            <Box16Regular style={{ width: 12, height: 12 }} />
                                                                            {childCount}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>

                                                {/* 行快捷操作按钮组 (对应上游行右侧按钮) */}
                                                <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                                                    <Button
                                                        size="small"
                                                        appearance={line.IsMainLine ? "primary" : "subtle"}
                                                        onClick={() => setMainLine(lIdx)}
                                                        title="设为主要行"
                                                    >
                                                        主行
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        appearance={line.IsNotificationEnabled ? "primary" : "subtle"}
                                                        onClick={() => setNotificationLine(lIdx)}
                                                        title="设为提醒显示行"
                                                    >
                                                        提醒
                                                    </Button>
                                                    <Button size="small" appearance="subtle" icon={<ArrowUp24Regular />} disabled={lIdx === 0} onClick={() => moveLine(lIdx, -1)} title="上移此行" />
                                                    <Button size="small" appearance="subtle" icon={<ArrowDown24Regular />} disabled={lIdx === lines.length - 1} onClick={() => moveLine(lIdx, 1)} title="下移此行" />
                                                    <Button size="small" appearance="subtle" icon={<Add24Regular />} onClick={() => addLineBelow(lIdx)} title="在下方插入新行" />
                                                    {lines.length > 1 && (
                                                        <Button size="small" appearance="subtle" icon={<Delete24Regular />} onClick={() => removeLine(lIdx)} title="删除此行" style={{ color: "var(--danger-color)" }} />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ── 容器子组件展开面板 (对应上游 GridComponentChildrenView) ── */}
                            {containerStack.length > 0 && (
                                <div className="card" style={{ padding: 14, marginBottom: 0, border: "1.5px solid var(--accent-color)", background: "var(--bg-accent-subtle)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13 }}>
                                            <Box16Regular style={{ color: "var(--accent-color)" }} />
                                            <span style={{ fontWeight: 600 }}>容器子组件视图：</span>
                                            <Button size="small" appearance="subtle" onClick={() => popContainerTo(-1)}>
                                                第 {selectedLineIdx + 1} 行
                                            </Button>
                                            {containerStack.map((entry, depth) => (
                                                <React.Fragment key={depth}>
                                                    <span style={{ color: "var(--text-tertiary)" }}>/</span>
                                                    <Button
                                                        size="small"
                                                        appearance={depth === containerStack.length - 1 ? "primary" : "subtle"}
                                                        onClick={() => popContainerTo(depth)}
                                                    >
                                                        {entry.title}
                                                    </Button>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            {containerStack.length > 1 && (
                                                <Button size="small" onClick={() => popContainerTo(containerStack.length - 2)}>
                                                    返回上一层容器
                                                </Button>
                                            )}
                                            <Button size="small" onClick={() => popContainerTo(-1)}>
                                                关闭子组件视图
                                            </Button>
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", padding: "8px 10px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
                                        {activeChildren.length === 0 ? (
                                            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                                                当前容器内暂无子组件，请从下方“组件库”点击添加
                                            </span>
                                        ) : (
                                            activeChildren.map((comp, cIdx) => {
                                                const meta = findBuiltinMeta(comp.Id);
                                                const isContainer = isContainerComponent(comp);
                                                const isSelected = selectedCompIdx === cIdx;
                                                return (
                                                    <div
                                                        key={cIdx}
                                                        onClick={() => setSelectedCompIdx(cIdx)}
                                                        onDoubleClick={() => { if (isContainer) openContainerChildren(cIdx); }}
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            padding: "5px 12px",
                                                            borderRadius: 999,
                                                            background: isSelected ? "var(--accent-color)" : "var(--bg-subtle)",
                                                            color: isSelected ? "#ffffff" : "var(--text-primary)",
                                                            border: isSelected ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                            fontWeight: isSelected ? 600 : 500,
                                                            fontSize: 12.5,
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <span>{comp.NameCache || meta?.name || "子组件"}</span>
                                                        {isContainer && <Box16Regular style={{ width: 13, height: 13 }} />}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ── 当前选中组件的操作条 ── */}
                            <div className="card" style={{ padding: "12px 16px", marginBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                                        {currentComp
                                            ? `当前选中：${currentComp.NameCache || currentCompMeta?.name || "组件"} (${containerStack.length > 0 ? `${containerStack[containerStack.length - 1].title} 内部` : `第 ${selectedLineIdx + 1} 行`} #${selectedCompIdx + 1})`
                                            : `当前作用域：${containerStack.length > 0 ? `容器「${containerStack[containerStack.length - 1].title}」` : `第 ${selectedLineIdx + 1} 行`}（未选中组件）`}
                                    </span>
                                </div>
                                {currentComp && (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                        {isContainerComponent(currentComp) && (
                                            <Button size="small" appearance="primary" icon={<Box24Regular />} onClick={() => openContainerChildren(selectedCompIdx)}>
                                                管理子组件
                                            </Button>
                                        )}
                                        <Button
                                            size="small"
                                            icon={<ArrowLeft24Regular />}
                                            disabled={selectedCompIdx <= 0}
                                            onClick={() => moveComponent(selectedCompIdx, -1)}
                                        >
                                            左移
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<ArrowRight24Regular />}
                                            disabled={selectedCompIdx >= activeChildren.length - 1}
                                            onClick={() => moveComponent(selectedCompIdx, 1)}
                                        >
                                            右移
                                        </Button>
                                        <Button size="small" icon={<Copy24Regular />} onClick={() => duplicateComponent(selectedCompIdx)}>
                                            创建副本
                                        </Button>
                                        <Select
                                            value=""
                                            onChange={(_, d) => {
                                                if (d.value) wrapInContainer(selectedCompIdx, d.value);
                                            }}
                                            style={{ width: 165 }}
                                        >
                                            <option value="">包裹到新容器...</option>
                                            <option value="c911d762-107f-40c6-84cc-0146ab3c86b1">包裹到分组容器</option>
                                            <option value="2d849ece-9f21-4c78-9434-415cfc283294">包裹到堆叠容器</option>
                                            <option value="7e19a113-d281-4f33-970a-834a0b78b5ad">包裹到轮播容器</option>
                                            <option value="70fcd5ea-3fae-4e06-aca2-4f4df47f9acd">包裹到滚动容器</option>
                                        </Select>
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Delete24Regular />}
                                            onClick={() => removeComponent(selectedCompIdx)}
                                            style={{ color: "var(--danger-color)" }}
                                        >
                                            删除组件
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* ── 底部四标签页切换器 (严格对应上游 ComponentsSettingsPage 底部 TabControl: 组件库 / 组件设置 / 高级设置 / 行设置) ── */}
                            <div className="tab-bar" style={{ marginBottom: 4 }}>
                                <Button
                                    appearance={activeTab === "library" ? "primary" : "subtle"}
                                    icon={<Apps24Regular />}
                                    onClick={() => setActiveTab("library")}
                                >
                                    组件库
                                </Button>
                                <Button
                                    appearance={activeTab === "settings" ? "primary" : "subtle"}
                                    icon={<Settings24Regular />}
                                    onClick={() => setActiveTab("settings")}
                                >
                                    组件设置
                                </Button>
                                <Button
                                    appearance={activeTab === "advanced" ? "primary" : "subtle"}
                                    icon={<Wrench24Regular />}
                                    onClick={() => setActiveTab("advanced")}
                                >
                                    高级设置
                                </Button>
                                <Button
                                    appearance={activeTab === "line" ? "primary" : "subtle"}
                                    icon={<TextAlignDistributed24Regular />}
                                    onClick={() => setActiveTab("line")}
                                >
                                    行设置 (第 {selectedLineIdx + 1} 行)
                                </Button>
                            </div>

                            {/* ── Tab 1: 组件库 (BUILTIN_COMPONENTS + 自定义 GUID) ── */}
                            {activeTab === "library" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                                        点击下方任意组件卡片，即可将其添加到{containerStack.length > 0 ? `容器「${containerStack[containerStack.length - 1].title}」内部` : `第 ${selectedLineIdx + 1} 行末尾`}：
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                                        {BUILTIN_COMPONENTS.map((bc) => (
                                            <div
                                                key={bc.id}
                                                className="card"
                                                style={{
                                                    padding: 14,
                                                    marginBottom: 0,
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    justifyContent: "space-between",
                                                    gap: 8,
                                                    cursor: "pointer",
                                                    border: bc.isContainer ? "1px dashed var(--accent-color)" : "1px solid var(--border-color)",
                                                }}
                                                onClick={() => addComponent(bc.id, bc.name)}
                                            >
                                                <div>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{bc.name}</span>
                                                        {bc.isContainer && (
                                                            <span className="badge badge-info" style={{ fontSize: 10, padding: "1px 6px", gap: 3 }}>
                                                                <Box16Regular style={{ width: 11, height: 11 }} />
                                                                容器
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{bc.desc}</div>
                                                </div>
                                                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 4 }}>
                                                    <span style={{ fontSize: 12, color: "var(--accent-color)", fontWeight: 600 }}>+ 添加</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="card" style={{ padding: 14, marginBottom: 0, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                                        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
                                            <label className="form-label">第三方插件组件 GUID</label>
                                            <Input
                                                value={customAddGuid}
                                                onChange={(_, d) => setCustomAddGuid(d.value)}
                                                placeholder="输入插件注册的组件 GUID..."
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0, width: 180 }}>
                                            <label className="form-label">显示名称备注</label>
                                            <Input
                                                value={customAddName}
                                                onChange={(_, d) => setCustomAddName(d.value)}
                                                placeholder="自定义组件"
                                            />
                                        </div>
                                        <Button
                                            icon={<Add24Regular />}
                                            disabled={!customAddGuid.trim()}
                                            onClick={() => {
                                                addComponent(customAddGuid.trim(), customAddName.trim() || "自定义组件");
                                                setCustomAddGuid("");
                                                setCustomAddName("");
                                            }}
                                        >
                                            添加插件组件
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* ── Tab 2: 组件设置 (对应上游各预置组件 SettingsControl) ── */}
                            {activeTab === "settings" && (
                                !currentComp ? (
                                    <div className="empty-state"><p>请先在上方行视图中点击选择一个组件</p></div>
                                ) : (
                                    renderBuiltinComponentSettings(currentComp)
                                )
                            )}

                            {/* ── Tab 3: 高级设置 (对应上游 ComponentAdvancedSettingsControl) ── */}
                            {activeTab === "advanced" && (
                                !currentComp ? (
                                    <div className="empty-state"><p>请先在上方行视图中点击选择一个组件</p></div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                        <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                            <div className="settings-section-title" style={{ marginBottom: 0 }}>基本标识与规则隐藏</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">组件类型标识</label>
                                                    <Input
                                                        value={currentComp.Id || ""}
                                                        onChange={(_, d) => updateCurrentComp({ Id: d.value })}
                                                    />
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">组件显示名称</label>
                                                    <Input
                                                        value={currentComp.NameCache || ""}
                                                        onChange={(_, d) => updateCurrentComp({ NameCache: d.value })}
                                                    />
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>满足规则时隐藏此组件</div>
                                                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>当触发指定的隐藏规则集时自动隐藏该组件</div>
                                                </div>
                                                <Switch
                                                    checked={!!currentComp.HideOnRule}
                                                    onChange={(_, d) => updateCurrentComp({ HideOnRule: d.checked })}
                                                />
                                            </div>
                                        </div>

                                        <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                            <div className="settings-section-title" style={{ marginBottom: 0 }}>布局、宽度与自定义边距</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">水平对齐方式</label>
                                                    <Select
                                                        value={String(currentComp.HorizontalAlignment ?? 1)}
                                                        onChange={(_, d) => updateCurrentComp({ HorizontalAlignment: parseInt(d.value, 10) as HorizontalAlignmentType })}
                                                    >
                                                        {(Object.entries(HORIZONTAL_ALIGNMENT_LABELS) as Array<[string, string]>).map(([k, label]) => (
                                                            <option key={k} value={k}>{label}</option>
                                                        ))}
                                                    </Select>
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">整体不透明度</label>
                                                    <Input
                                                        type="number"
                                                        step={0.05}
                                                        min={0}
                                                        max={1}
                                                        value={String(currentComp.Opacity ?? 1)}
                                                        onChange={(_, d) => updateCurrentComp({ Opacity: parseFloat(d.value) || 1 })}
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>固定宽度</label>
                                                        <Switch
                                                            checked={!!currentComp.IsFixedWidthEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsFixedWidthEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsFixedWidthEnabled && (
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.FixedWidth ?? 120)}
                                                            onChange={(_, d) => updateCurrentComp({ FixedWidth: parseFloat(d.value) || 0 })}
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>最小宽度</label>
                                                        <Switch
                                                            checked={!!currentComp.IsMinWidthEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsMinWidthEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsMinWidthEnabled && (
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MinWidth ?? 60)}
                                                            onChange={(_, d) => updateCurrentComp({ MinWidth: parseFloat(d.value) || 0 })}
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>最大宽度</label>
                                                        <Switch
                                                            checked={!!currentComp.IsMaxWidthEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsMaxWidthEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsMaxWidthEnabled && (
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MaxWidth ?? 300)}
                                                            onChange={(_, d) => updateCurrentComp({ MaxWidth: parseFloat(d.value) || 0 })}
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600 }}>自定义四周边距</span>
                                                <Switch
                                                    checked={!!currentComp.IsCustomMarginEnabled}
                                                    onChange={(_, d) => updateCurrentComp({ IsCustomMarginEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentComp.IsCustomMarginEnabled && (
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">左边距</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MarginLeft ?? 0)}
                                                            onChange={(_, d) => updateCurrentComp({ MarginLeft: parseFloat(d.value) || 0 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">上边距</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MarginTop ?? 0)}
                                                            onChange={(_, d) => updateCurrentComp({ MarginTop: parseFloat(d.value) || 0 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">右边距</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MarginRight ?? 0)}
                                                            onChange={(_, d) => updateCurrentComp({ MarginRight: parseFloat(d.value) || 0 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">下边距</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MarginBottom ?? 0)}
                                                            onChange={(_, d) => updateCurrentComp({ MarginBottom: parseFloat(d.value) || 0 })}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                            <div className="settings-section-title" style={{ marginBottom: 0 }}>自定义外观与字体大小覆盖</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>自定义前景色 (文字颜色)</label>
                                                        <Switch
                                                            checked={!!currentComp.IsCustomForegroundColorEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsCustomForegroundColorEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsCustomForegroundColorEnabled && (
                                                        <Input
                                                            value={currentComp.ForegroundColor || "#FFFFFF"}
                                                            onChange={(_, d) => updateCurrentComp({ ForegroundColor: d.value })}
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>自定义背景颜色</label>
                                                        <Switch
                                                            checked={!!currentComp.IsCustomBackgroundColorEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsCustomBackgroundColorEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsCustomBackgroundColorEnabled && (
                                                        <Input
                                                            value={currentComp.BackgroundColor || "#000000"}
                                                            onChange={(_, d) => updateCurrentComp({ BackgroundColor: d.value })}
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>自定义背景不透明度</label>
                                                        <Switch
                                                            checked={!!currentComp.IsCustomBackgroundOpacityEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsCustomBackgroundOpacityEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsCustomBackgroundOpacityEnabled && (
                                                        <Input
                                                            type="number"
                                                            step={0.05}
                                                            value={String(currentComp.BackgroundOpacity ?? 0.5)}
                                                            onChange={(_, d) => updateCurrentComp({ BackgroundOpacity: parseFloat(d.value) || 0 })}
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                        <label className="form-label" style={{ marginBottom: 0 }}>自定义背景圆角半径</label>
                                                        <Switch
                                                            checked={!!currentComp.IsCustomCornerRadiusEnabled}
                                                            onChange={(_, d) => updateCurrentComp({ IsCustomCornerRadiusEnabled: d.checked })}
                                                        />
                                                    </div>
                                                    {currentComp.IsCustomCornerRadiusEnabled && (
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.CustomCornerRadius ?? 8)}
                                                            onChange={(_, d) => updateCurrentComp({ CustomCornerRadius: parseFloat(d.value) || 0 })}
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600 }}>覆盖组件四级字体字号</span>
                                                <Switch
                                                    checked={!!currentComp.IsResourceOverridingEnabled}
                                                    onChange={(_, d) => updateCurrentComp({ IsResourceOverridingEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentComp.IsResourceOverridingEnabled && (
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">次级字号</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MainWindowSecondaryFontSize ?? 14)}
                                                            onChange={(_, d) => updateCurrentComp({ MainWindowSecondaryFontSize: parseFloat(d.value) || 14 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">正文字号</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MainWindowBodyFontSize ?? 16)}
                                                            onChange={(_, d) => updateCurrentComp({ MainWindowBodyFontSize: parseFloat(d.value) || 16 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">强调字号</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MainWindowEmphasizedFontSize ?? 18)}
                                                            onChange={(_, d) => updateCurrentComp({ MainWindowEmphasizedFontSize: parseFloat(d.value) || 18 })}
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <label className="form-label">大号字号</label>
                                                        <Input
                                                            type="number"
                                                            value={String(currentComp.MainWindowLargeFontSize ?? 20)}
                                                            onChange={(_, d) => updateCurrentComp({ MainWindowLargeFontSize: parseFloat(d.value) || 20 })}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            )}

                            {/* ── Tab 4: 行设置 (对应上游 MainWindowLineSettings) ── */}
                            {activeTab === "line" && currentLine && (
                                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                    <div className="settings-section-title" style={{ marginBottom: 0 }}>
                                        第 {selectedLineIdx + 1} 行属性设置
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>启用此行</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>关闭后主界面将不显示该行</div>
                                            </div>
                                            <Switch
                                                checked={currentLine.IsEnabled !== false}
                                                onChange={(_, d) => updateCurrentLine({ IsEnabled: d.checked })}
                                            />
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>主要行</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>作为主界面的主基准行</div>
                                            </div>
                                            <Switch
                                                checked={!!currentLine.IsMainLine}
                                                onChange={(_, d) => { if (d.checked) setMainLine(selectedLineIdx); }}
                                            />
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>承载提醒通知</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>提醒横幅与遮罩动画将在此行弹出</div>
                                            </div>
                                            <Switch
                                                checked={!!currentLine.IsNotificationEnabled}
                                                onChange={(_, d) => { if (d.checked) setNotificationLine(selectedLineIdx); }}
                                            />
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>满足规则时隐藏整行</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>触发行级规则集时自动隐藏该行</div>
                                            </div>
                                            <Switch
                                                checked={!!currentLine.HideOnRule}
                                                onChange={(_, d) => updateCurrentLine({ HideOnRule: d.checked })}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">分体主界面模式</label>
                                            <Select
                                                value={String(currentLine.IslandSeparationMode ?? 0)}
                                                onChange={(_, d) => updateCurrentLine({ IslandSeparationMode: parseInt(d.value, 10) })}
                                            >
                                                <option value="0">继承全局设置</option>
                                                <option value="1">禁用分体模式 (合并为整条顶栏)</option>
                                                <option value="2">启用分体模式 (各组件独立成岛)</option>
                                            </Select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">整行不透明度</label>
                                            <Input
                                                type="number"
                                                step={0.05}
                                                min={0}
                                                max={1}
                                                value={String(currentLine.Opacity ?? 1)}
                                                onChange={(_, d) => updateCurrentLine({ Opacity: parseFloat(d.value) || 1 })}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                <label className="form-label" style={{ marginBottom: 0 }}>自定义行文字颜色</label>
                                                <Switch
                                                    checked={!!currentLine.IsCustomForegroundColorEnabled}
                                                    onChange={(_, d) => updateCurrentLine({ IsCustomForegroundColorEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentLine.IsCustomForegroundColorEnabled && (
                                                <Input
                                                    value={currentLine.ForegroundColor || "#FFFFFF"}
                                                    onChange={(_, d) => updateCurrentLine({ ForegroundColor: d.value })}
                                                />
                                            )}
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                <label className="form-label" style={{ marginBottom: 0 }}>自定义行背景颜色</label>
                                                <Switch
                                                    checked={!!currentLine.IsCustomBackgroundColorEnabled}
                                                    onChange={(_, d) => updateCurrentLine({ IsCustomBackgroundColorEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentLine.IsCustomBackgroundColorEnabled && (
                                                <Input
                                                    value={currentLine.BackgroundColor || "#000000"}
                                                    onChange={(_, d) => updateCurrentLine({ BackgroundColor: d.value })}
                                                />
                                            )}
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                <label className="form-label" style={{ marginBottom: 0 }}>自定义行背景不透明度</label>
                                                <Switch
                                                    checked={!!currentLine.IsCustomBackgroundOpacityEnabled}
                                                    onChange={(_, d) => updateCurrentLine({ IsCustomBackgroundOpacityEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentLine.IsCustomBackgroundOpacityEnabled && (
                                                <Input
                                                    type="number"
                                                    step={0.05}
                                                    value={String(currentLine.BackgroundOpacity ?? 0.5)}
                                                    onChange={(_, d) => updateCurrentLine({ BackgroundOpacity: parseFloat(d.value) || 0 })}
                                                />
                                            )}
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                                <label className="form-label" style={{ marginBottom: 0 }}>自定义行圆角半径</label>
                                                <Switch
                                                    checked={!!currentLine.IsCustomCornerRadiusEnabled}
                                                    onChange={(_, d) => updateCurrentLine({ IsCustomCornerRadiusEnabled: d.checked })}
                                                />
                                            </div>
                                            {currentLine.IsCustomCornerRadiusEnabled && (
                                                <Input
                                                    type="number"
                                                    value={String(currentLine.CustomCornerRadius ?? 8)}
                                                    onChange={(_, d) => updateCurrentLine({ CustomCornerRadius: parseFloat(d.value) || 0 })}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>覆盖本行四级字体字号</span>
                                        <Switch
                                            checked={!!currentLine.IsResourceOverridingEnabled}
                                            onChange={(_, d) => updateCurrentLine({ IsResourceOverridingEnabled: d.checked })}
                                        />
                                    </div>
                                    {currentLine.IsResourceOverridingEnabled && (
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">次级字号</label>
                                                <Input
                                                    type="number"
                                                    value={String(currentLine.MainWindowSecondaryFontSize ?? 14)}
                                                    onChange={(_, d) => updateCurrentLine({ MainWindowSecondaryFontSize: parseFloat(d.value) || 14 })}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">正文字号</label>
                                                <Input
                                                    type="number"
                                                    value={String(currentLine.MainWindowBodyFontSize ?? 16)}
                                                    onChange={(_, d) => updateCurrentLine({ MainWindowBodyFontSize: parseFloat(d.value) || 16 })}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">强调字号</label>
                                                <Input
                                                    type="number"
                                                    value={String(currentLine.MainWindowEmphasizedFontSize ?? 18)}
                                                    onChange={(_, d) => updateCurrentLine({ MainWindowEmphasizedFontSize: parseFloat(d.value) || 18 })}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">大号字号</label>
                                                <Input
                                                    type="number"
                                                    value={String(currentLine.MainWindowLargeFontSize ?? 20)}
                                                    onChange={(_, d) => updateCurrentLine({ MainWindowLargeFontSize: parseFloat(d.value) || 20 })}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={showCreate} onOpenChange={(_, d) => setShowCreate(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>新建组件配置文件</DialogTitle>
                        <DialogContent>
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label className="form-label">配置名称</label>
                                <Input
                                    value={newFileName}
                                    onChange={(_, d) => setNewFileName(d.value)}
                                    placeholder="例如: default"
                                />
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setShowCreate(false)}>取消</Button>
                            <Button appearance="primary" onClick={handleCreate}>创建</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
}
