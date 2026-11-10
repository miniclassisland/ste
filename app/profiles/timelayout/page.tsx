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
    BUILTIN_ACTIONS,
    EMPTY_GUID,
    isEmptyGuid,
    toUpstreamGuidOrEmpty,
} from "@/lib/types";
import {
    Button,
    Input,
    Switch,
    Spinner,
    Textarea,
    Checkbox,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { Select } from "@/components/CustomSelect";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
    Add16Regular,
    Add20Regular,
    Delete16Regular,
    Delete20Regular,
    Save20Regular,
    Code20Regular,
    Flash20Regular,
    Book20Regular,
    Clock20Regular,
    SplitHorizontal20Regular,
    Settings16Regular,
    Copy16Regular,
    ClipboardPaste16Regular,
    DocumentAdd16Regular,
    TextBulletListSquare20Regular,
    Timeline20Regular,
    ArrowRight16Regular,
    ArrowLeft16Regular,
    Dismiss16Regular,
    Alert16Regular,
    WeatherPartlyCloudyDay16Regular,
    ChevronUp16Regular,
    ChevronDown16Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type TimeLayoutsData = Record<string, TimeLayout>;
type SubjectsData = Record<string, Subject>;

const ATTACHED_CLASS_NOTIFICATION_ID = "08f0d9c3-c770-4093-a3d0-02f3d90c24bc";
const ATTACHED_LESSON_DISPLAY_ID = "58e5b69a-764a-472b-bcf7-003b6a8c7fdf";
const ATTACHED_WEATHER_ID = "7625de96-38aa-4b71-b478-3f156dd9458d";

/** 提取 HH:mm:ss */
function extractHHMMSS(item: TimeLayoutItem, field: "start" | "end"): string {
    const raw =
        field === "start"
            ? item.StartTime || item.StartSecond || ""
            : item.EndTime || item.EndSecond || "";
    if (!raw) return "08:00:00";
    const tIndex = raw.indexOf("T");
    const timePart = tIndex >= 0 ? raw.slice(tIndex + 1) : raw;
    const cleanPart = timePart.split(".")[0].split("+")[0].split("Z")[0];
    const parts = cleanPart.split(":");
    const hh = (parts[0] || "08").padStart(2, "0");
    const mm = (parts[1] || "00").padStart(2, "0");
    const ss = (parts[2] || "00").padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
}

function parseSecondsOfDay(timeStr: string): number {
    const parts = (timeStr || "08:00:00").trim().split(":");
    const h = Math.min(23, Math.max(0, parseInt(parts[0] || "8", 10) || 0));
    const m = Math.min(59, Math.max(0, parseInt(parts[1] || "0", 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(parts[2] || "0", 10) || 0));
    return h * 3600 + m * 60 + s;
}

function formatSecondsOfDay(totalSec: number): string {
    const clamped = Math.min(23 * 3600 + 59 * 60 + 59, Math.max(0, Math.round(totalSec)));
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 将时间文本转为上游兼容的 StartSecond 与 StartTime */
function toTimeStrings(timeStr: string): { iso: string; span: string } {
    const span = formatSecondsOfDay(parseSecondsOfDay(timeStr));
    return {
        iso: `1970-01-01T${span}`,
        span,
    };
}

function addMinutesToTimeStr(timeStr: string, mins: number): string {
    return formatSecondsOfDay(parseSecondsOfDay(timeStr) + mins * 60);
}

/** 计算持续时长显示文本 */
function formatDuration(startStr: string, endStr: string): string {
    const diff = Math.max(0, parseSecondsOfDay(endStr) - parseSecondsOfDay(startStr));
    const totalMinutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 根据时间自动排序并自动处理时间冲突 */
function sortAndResolveTimeConflicts(
    items: TimeLayoutItem[],
    activeIndex = -1
): { items: TimeLayoutItem[]; activeIndex: number } {
    const tagged = items.map((it, idx) => {
        const copy: TimeLayoutItem = { ...it };
        const startSec = parseSecondsOfDay(extractHHMMSS(copy, "start"));
        let endSec = parseSecondsOfDay(extractHHMMSS(copy, "end"));
        const isPoint = copy.TimeType === 2 || copy.TimeType === 3;
        if (isPoint) {
            endSec = startSec;
        } else if (endSec <= startSec) {
            endSec = Math.min(23 * 3600 + 59 * 60 + 59, startSec + 600);
        }
        return { copy, idx, startSec, endSec, isPoint };
    });

    tagged.sort((a, b) => {
        if (a.startSec !== b.startSec) return a.startSec - b.startSec;
        return a.idx - b.idx;
    });

    // 自动冲突处理：对于有持续时长的区间（上课 / 课间休息），若与下一段重叠则自动顺延后续时间段
    let prevIntervalEnd = -1;
    for (let i = 0; i < tagged.length; i++) {
        const cur = tagged[i];
        if (!cur.isPoint) {
            const duration = Math.max(60, cur.endSec - cur.startSec);
            if (prevIntervalEnd > cur.startSec) {
                cur.startSec = prevIntervalEnd;
                cur.endSec = Math.min(23 * 3600 + 59 * 60 + 59, cur.startSec + duration);
            }
            if (cur.endSec <= cur.startSec) {
                cur.endSec = Math.min(23 * 3600 + 59 * 60 + 59, cur.startSec + 60);
            }
            prevIntervalEnd = cur.endSec;
        }
        const sStr = toTimeStrings(formatSecondsOfDay(cur.startSec));
        const eStr = toTimeStrings(formatSecondsOfDay(cur.isPoint ? cur.startSec : cur.endSec));
        cur.copy.StartSecond = sStr.iso;
        cur.copy.StartTime = sStr.span;
        cur.copy.EndSecond = eStr.iso;
        cur.copy.EndTime = eStr.span;
    }

    const nextActiveIndex = tagged.findIndex((t) => t.idx === activeIndex);
    return {
        items: tagged.map((t) => t.copy),
        activeIndex: nextActiveIndex >= 0 ? nextActiveIndex : 0,
    };
}

/** 标准化时间表数据 */
function normalizeTimeLayoutsForSave(raw: TimeLayoutsData): TimeLayoutsData {
    const out: TimeLayoutsData = {};
    for (const [k, tl] of Object.entries(raw)) {
        const rawItems = Array.isArray(tl.Layouts)
            ? tl.Layouts.map((item) => {
                  const copy: TimeLayoutItem = { ...item };
                  if (copy.TimeType === 0) {
                      copy.DefaultClassId = toUpstreamGuidOrEmpty(copy.DefaultClassId);
                  }
                  if (copy.TimeType === 2 || copy.TimeType === 3) {
                      if (copy.StartSecond) copy.EndSecond = copy.StartSecond;
                      if (copy.StartTime) copy.EndTime = copy.StartTime;
                  }
                  if (copy.TimeType === 3) {
                      const rawAs = copy.ActionSet && typeof copy.ActionSet === "object" ? copy.ActionSet : {};
                      const rawActions = Array.isArray(rawAs.Actions)
                          ? rawAs.Actions
                          : Array.isArray((rawAs as Record<string, unknown>).ActionItems)
                            ? ((rawAs as Record<string, unknown>).ActionItems as ActionItem[])
                            : [];
                      copy.ActionSet = {
                          Name: typeof rawAs.Name === "string" ? rawAs.Name : "行动时间点",
                          IsEnabled: rawAs.IsEnabled !== false,
                          IsRevertEnabled: !!rawAs.IsRevertEnabled,
                          Guid:
                              typeof rawAs.Guid === "string" && rawAs.Guid
                                  ? rawAs.Guid
                                  : crypto.randomUUID(),
                          Actions: rawActions,
                      };
                  }
                  return copy;
              })
            : [];
        const sorted = sortAndResolveTimeConflicts(rawItems).items;
        out[k] = { ...tl, Layouts: sorted };
    }
    return out;
}

/** 全局一致的时间输入组件（时 / 分 / 秒，消除嵌套边框） */
function TimeInputGroup({
    value,
    onChange,
}: {
    value: string;
    onChange: (nextTime: string) => void;
}) {
    const parts = (value || "08:00:00").split(":");
    const hh = parts[0] || "08";
    const mm = parts[1] || "00";
    const ss = parts[2] || "00";

    function handlePartChange(partIdx: 0 | 1 | 2, rawVal: string) {
        const num = parseInt(rawVal, 10);
        const max = partIdx === 0 ? 23 : 59;
        const safeNum = Number.isNaN(num) ? 0 : Math.min(max, Math.max(0, num));
        const nextParts = [hh, mm, ss];
        nextParts[partIdx] = String(safeNum).padStart(2, "0");
        onChange(nextParts.join(":"));
    }

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr auto 1fr",
                alignItems: "center",
                gap: 6,
            }}
        >
            <Input
                size="small"
                type="number"
                min={0}
                max={23}
                value={String(parseInt(hh, 10) || 0)}
                onChange={(_, d) => handlePartChange(0, d.value)}
                style={{ width: "100%", textAlign: "center", fontFamily: "var(--font-mono)" }}
            />
            <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>:</span>
            <Input
                size="small"
                type="number"
                min={0}
                max={59}
                value={String(parseInt(mm, 10) || 0)}
                onChange={(_, d) => handlePartChange(1, d.value)}
                style={{ width: "100%", textAlign: "center", fontFamily: "var(--font-mono)" }}
            />
            <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>:</span>
            <Input
                size="small"
                type="number"
                min={0}
                max={59}
                value={String(parseInt(ss, 10) || 0)}
                onChange={(_, d) => handlePartChange(2, d.value)}
                style={{ width: "100%", textAlign: "center", fontFamily: "var(--font-mono)" }}
            />
        </div>
    );
}

export default function TimeLayoutPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [layouts, setLayouts] = useState<TimeLayoutsData>({});
    const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
    const [selectedItemIdx, setSelectedItemIdx] = useState<number>(0);

    // 右侧全高浮动时间点编辑边栏开关 + 移动设备三级层级 (1: 时间表列表, 2: 时间表编辑, 3: 编辑时间点)
    const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
    const [mobileLayer, setMobileLayer] = useState<1 | 2 | 3>(1);

    // 附加设置卡片折叠与子标签状态
    const [classNotifyExpanded, setClassNotifyExpanded] = useState(true);
    const [classNotifySubTab, setClassNotifySubTab] = useState<"prepare" | "on">("prepare");
    const [lessonDisplayExpanded, setLessonDisplayExpanded] = useState(true);
    const [weatherExpanded, setWeatherExpanded] = useState(true);

    // 视图切换：段落视图 / 时间轴视图
    const [viewMode, setViewMode] = useState<"segments" | "timeline">("segments");

    // 关联科目参考文件
    const [subjectFiles, setSubjectFiles] = useState<string[]>([]);
    const [selectedSubjectFile, setSelectedSubjectFile] = useState<string>("");
    const [subjects, setSubjects] = useState<SubjectsData>({});

    // 弹窗状态
    const [fileSettingsOpen, setFileSettingsOpen] = useState(false);
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [renameLayoutId, setRenameLayoutId] = useState<string | null>(null);
    const [renameLayoutText, setRenameLayoutText] = useState("");
    const [copiedLayoutCache, setCopiedLayoutCache] = useState<TimeLayout | null>(null);

    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const selectFile = useCallback(
        async (name: string) => {
            if (!accountId) return;
            setSelectedFile(name);
            setSelectedLayoutId(null);
            setSelectedItemIdx(0);
            setInspectorOpen(false);
            setMobileLayer(1);
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
        },
        [accountId]
    );

    const loadSubjectFile = useCallback(
        async (subFile: string) => {
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
        },
        [accountId]
    );

    const loadFiles = useCallback(async () => {
        if (!accountId) {
            setLoading(false);
            return;
        }
        setLoading(true);
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
            if (arr.length > 0 && (!selectedFile || !arr.includes(selectedFile))) {
                selectFile(arr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectFile, loadSubjectFile]); // eslint-disable-line react-hooks/exhaustive-deps

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
            setMsg({ type: "success", text: "时间表已保存" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查数据格式" });
        }
        setSaving(false);
    }

    async function handleCreateFile(e: React.FormEvent) {
        e.preventDefault();
        if (!newFileName.trim()) return;
        const name = newFileName.trim();
        try {
            await data.create(accountId, "TimeLayout", name);
            setMsg({ type: "success", text: `已创建 ${name}` });
            setShowCreate(false);
            setNewFileName("");
            await loadFiles();
            selectFile(name);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDeleteFile(name: string) {
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
        setSelectedItemIdx(0);
        setMobileLayer(2);
    }

    function duplicateLayout(id: string) {
        const source = layouts[id];
        if (!source) return;
        const cloned: TimeLayout = JSON.parse(JSON.stringify(source));
        setCopiedLayoutCache(cloned);
        try {
            void navigator.clipboard.writeText(JSON.stringify(cloned, null, 2));
        } catch {
            /* ignore */
        }
        const newId = crypto.randomUUID();
        const next: TimeLayoutsData = {
            ...layouts,
            [newId]: {
                ...cloned,
                Name: `${source.Name || "时间表"} 副本`,
            },
        };
        setLayouts(next);
        setSelectedLayoutId(newId);
        setSelectedItemIdx(0);
        setMsg({ type: "success", text: "已复制时间表并写入剪贴板" });
    }

    async function pasteLayoutFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim().startsWith("{")) {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                if (Array.isArray(parsed.Layouts)) {
                    const newId = crypto.randomUUID();
                    const tl: TimeLayout = {
                        Name: typeof parsed.Name === "string" ? parsed.Name : "粘贴的时间表",
                        Layouts: parsed.Layouts as TimeLayoutItem[],
                        AttachedObjects:
                            parsed.AttachedObjects && typeof parsed.AttachedObjects === "object"
                                ? (parsed.AttachedObjects as Record<string, unknown>)
                                : undefined,
                    };
                    const next = normalizeTimeLayoutsForSave({ ...layouts, [newId]: tl });
                    setLayouts(next);
                    setSelectedLayoutId(newId);
                    setSelectedItemIdx(0);
                    setMsg({ type: "success", text: "已从剪贴板导入时间表" });
                    return;
                }
            }
        } catch {
            /* fallback */
        }
        if (copiedLayoutCache) {
            const newId = crypto.randomUUID();
            const cloned: TimeLayout = JSON.parse(JSON.stringify(copiedLayoutCache));
            setLayouts((prev) => ({
                ...prev,
                [newId]: { ...cloned, Name: `${cloned.Name || "时间表"} 粘贴` },
            }));
            setSelectedLayoutId(newId);
            setSelectedItemIdx(0);
            setMsg({ type: "success", text: "已粘贴时间表" });
        } else {
            setMsg({ type: "error", text: "剪贴板中未检测到有效的时间表数据" });
        }
    }

    function deleteLayout(id: string) {
        const copy = { ...layouts };
        delete copy[id];
        setLayouts(copy);
        setSelectedLayoutId(Object.keys(copy)[0] || null);
        setSelectedItemIdx(0);
    }

    function updateLayoutName(id: string, name: string) {
        setLayouts((prev) => ({
            ...prev,
            [id]: { ...prev[id], Name: name },
        }));
    }

    function addTimeItem(defaultType: TimeType = 0) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const existing = current.Layouts || [];
        const lastEnd =
            existing.length > 0 ? extractHHMMSS(existing[existing.length - 1], "end") : "08:00:00";
        const nextEnd =
            defaultType === 2 || defaultType === 3
                ? lastEnd
                : addMinutesToTimeStr(lastEnd, defaultType === 0 ? 45 : 10);
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
        const rawItems = [...existing, newItem];
        const resolved = sortAndResolveTimeConflicts(rawItems, rawItems.length - 1);
        setLayouts({
            ...layouts,
            [selectedLayoutId]: { ...current, Layouts: resolved.items },
        });
        setSelectedItemIdx(resolved.activeIndex);
        setInspectorOpen(true);
        setMobileLayer(3);
    }

    function updateTimeItem(
        index: number,
        patch: Partial<TimeLayoutItem>,
        autoSortAndResolve = false
    ) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const items = [...(current.Layouts || [])];
        if (!items[index]) return;
        const nextItem: TimeLayoutItem = { ...items[index], ...patch };
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
        if (autoSortAndResolve) {
            const resolved = sortAndResolveTimeConflicts(items, index);
            setLayouts({
                ...layouts,
                [selectedLayoutId]: { ...current, Layouts: resolved.items },
            });
            setSelectedItemIdx(resolved.activeIndex);
        } else {
            setLayouts({
                ...layouts,
                [selectedLayoutId]: { ...current, Layouts: items },
            });
        }
    }

    function updateTimeItemClock(index: number, field: "start" | "end", timeVal: string) {
        if (!selectedLayoutId) return;
        const current = layouts[selectedLayoutId];
        if (!current) return;
        const item = current.Layouts?.[index];
        const { iso, span } = toTimeStrings(timeVal);
        if (field === "start") {
            if (item && (item.TimeType === 2 || item.TimeType === 3)) {
                updateTimeItem(
                    index,
                    {
                        StartSecond: iso,
                        StartTime: span,
                        EndSecond: iso,
                        EndTime: span,
                    },
                    true
                );
            } else {
                updateTimeItem(index, { StartSecond: iso, StartTime: span }, true);
            }
        } else {
            updateTimeItem(index, { EndSecond: iso, EndTime: span }, true);
        }
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
        setSelectedItemIdx((prev) => Math.max(0, Math.min(prev, items.length - 1)));
        if (items.length === 0) {
            setInspectorOpen(false);
            setMobileLayer(2);
        }
    }

    // ── 附加设置读写辅助 ──
    function getAttachedObject(item: TimeLayoutItem, key: string): Record<string, unknown> {
        const map = item.AttachedObjects || item.AttachableSettings || {};
        const val = map[key];
        return val && typeof val === "object" ? (val as Record<string, unknown>) : {};
    }

    function updateAttachedObject(
        index: number,
        key: string,
        patch: Record<string, unknown>
    ) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[index];
        if (!item) return;
        const existingMap = { ...(item.AttachedObjects || item.AttachableSettings || {}) };
        const prevObj = getAttachedObject(item, key);
        existingMap[key] = { ...prevObj, ...patch };
        updateTimeItem(index, { AttachedObjects: existingMap });
    }

    // ── 行动时间点编辑引擎辅助 ──
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

    function removeActionFromItem(itemIdx: number, actionIdx: number) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        updateItemActionSet(itemIdx, {
            Actions: (currentAs.Actions || []).filter((_, i) => i !== actionIdx),
        });
    }

    function updateActionSettingsInItem(
        itemIdx: number,
        actionIdx: number,
        settingsPatch: Record<string, unknown>
    ) {
        if (!selectedLayoutId) return;
        const item = layouts[selectedLayoutId]?.Layouts?.[itemIdx];
        if (!item) return;
        const currentAs = getItemActionSet(item);
        const nextActions = (currentAs.Actions || []).map((act, i) => {
            if (i !== actionIdx) return act;
            const base =
                act.Settings && typeof act.Settings === "object"
                    ? { ...(act.Settings as Record<string, unknown>) }
                    : {};
            return { ...act, Settings: { ...base, ...settingsPatch } };
        });
        updateItemActionSet(itemIdx, { Actions: nextActions });
    }

    const currentLayout = selectedLayoutId ? layouts[selectedLayoutId] : null;
    const currentItems = currentLayout?.Layouts || [];
    const safeSelectedIdx =
        currentItems.length === 0
            ? -1
            : Math.min(Math.max(0, selectedItemIdx), currentItems.length - 1);
    const selectedItem = safeSelectedIdx >= 0 ? currentItems[safeSelectedIdx] : null;

    const validSubjectEntries = Object.entries(subjects).filter(([sid]) => !isEmptyGuid(sid));

    function renderSegmentIcon(type: TimeType) {
        switch (type) {
            case 0:
                return <Book20Regular />;
            case 1:
                return <Clock20Regular />;
            case 2:
                return <SplitHorizontal20Regular />;
            case 3:
                return <Flash20Regular />;
            default:
                return <Book20Regular />;
        }
    }

    return (
        <div className="fade-in">
            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 12 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="tl-workbench">
                {/* ===== 第一层（左栏）：时间表列表与当前编辑文件 ===== */}
                <div className={`tl-col-left ${mobileLayer !== 1 ? "mobile-layer-hidden" : ""}`}>
                    <div className="tl-panel-header-box">
                        <span>时间表管理</span>
                    </div>

                    {/* 当前编辑文件卡片 */}
                    <div className="tl-panel-box">
                        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600 }}>当前编辑</span>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<DocumentAdd16Regular />}
                                onClick={() => setShowCreate(true)}
                                title="新建时间表文件"
                            />
                        </div>

                        {loading ? (
                            <Spinner size="tiny" />
                        ) : (
                            <Select
                                size="small"
                                value={selectedFile || ""}
                                onChange={(_, d) => {
                                    if (d.value) selectFile(d.value);
                                }}
                                style={{ width: "100%" }}
                            >
                                {fileList.length === 0 && <option value="">暂无文件</option>}
                                {fileList.map((f) => (
                                    <option key={f} value={f}>
                                        {f}
                                    </option>
                                ))}
                            </Select>
                        )}

                        <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Settings16Regular />}
                                onClick={() => setFileSettingsOpen(true)}
                                disabled={!selectedFile}
                            >
                                设置
                            </Button>
                            <ConfirmPopover
                                message={`确定要删除时间表文件 "${selectedFile}" 吗？`}
                                onConfirm={() => {
                                    if (selectedFile) void handleDeleteFile(selectedFile);
                                }}
                                confirmText="删除"
                                disabled={!selectedFile}
                            >
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Delete16Regular />}
                                    disabled={!selectedFile}
                                    style={{ color: "var(--danger-color)" }}
                                >
                                    删除
                                </Button>
                            </ConfirmPopover>
                        </div>
                    </div>

                    {/* 时间表列表 */}
                    <div className="tl-layout-list">
                        {Object.entries(layouts).map(([id, tl]) => (
                            <div
                                key={id}
                                className={`tl-layout-card ${selectedLayoutId === id ? "active" : ""}`}
                                onClick={() => {
                                    setSelectedLayoutId(id);
                                    setSelectedItemIdx(0);
                                    setMobileLayer(2);
                                }}
                            >
                                <span className="tl-layout-card-name">
                                    {tl.Name || id.slice(0, 8)}
                                </span>
                                <div
                                    className="tl-layout-card-actions"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Settings16Regular />}
                                        onClick={() => {
                                            setRenameLayoutId(id);
                                            setRenameLayoutText(tl.Name || "");
                                        }}
                                        title="重命名时间表"
                                    />
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Copy16Regular />}
                                        onClick={() => duplicateLayout(id)}
                                        title="复制时间表"
                                    />
                                    <ConfirmPopover
                                        message="确定要删除此时间表吗？"
                                        onConfirm={() => deleteLayout(id)}
                                        confirmText="删除"
                                    >
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Delete16Regular />}
                                            style={{ color: "var(--danger-color)" }}
                                            title="删除时间表"
                                        />
                                    </ConfirmPopover>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 左栏底部操作框 */}
                    <div className="tl-panel-box" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<Add16Regular />}
                            onClick={addLayout}
                            disabled={!selectedFile}
                            style={{ justifyContent: "flex-start" }}
                        >
                            添加新表
                        </Button>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ClipboardPaste16Regular />}
                            onClick={pasteLayoutFromClipboard}
                            disabled={!selectedFile}
                            style={{ justifyContent: "flex-start" }}
                        >
                            从剪贴板粘贴
                        </Button>
                    </div>
                </div>

                {/* ===== 第二层（中栏）：时间表编辑（时间点列表） ===== */}
                <div className={`tl-col-center ${mobileLayer !== 2 ? "mobile-layer-hidden" : ""}`}>
                    <div className="mobile-only-nav-bar">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ArrowLeft16Regular />}
                            onClick={() => setMobileLayer(1)}
                        >
                            返回时间表列表
                        </Button>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                            {currentLayout?.Name || "时间表编辑"}
                        </span>
                    </div>

                    <div className="tl-toolbar-card">
                        <div className="flex items-center gap-6" style={{ flexWrap: "wrap" }}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Book20Regular />}
                                onClick={() => addTimeItem(0)}
                                disabled={!selectedLayoutId}
                            >
                                添加上课
                                <Add16Regular style={{ marginLeft: 2 }} />
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Clock20Regular />}
                                onClick={() => addTimeItem(1)}
                                disabled={!selectedLayoutId}
                            >
                                添加课间
                                <Add16Regular style={{ marginLeft: 2 }} />
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<SplitHorizontal20Regular />}
                                onClick={() => addTimeItem(2)}
                                disabled={!selectedLayoutId}
                            >
                                添加分割线
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Flash20Regular />}
                                onClick={() => addTimeItem(3)}
                                disabled={!selectedLayoutId}
                            >
                                添加行动
                                <Add16Regular style={{ marginLeft: 2 }} />
                            </Button>
                        </div>

                        <div className="flex items-center gap-6">
                            <Button
                                size="small"
                                appearance="primary"
                                icon={<Save20Regular />}
                                onClick={handleSave}
                                disabled={saving || !selectedFile}
                            >
                                {saving ? <Spinner size="extra-tiny" /> : "保存"}
                            </Button>
                        </div>
                    </div>

                    <div className="tl-canvas-card">
                        {dataLoading ? (
                            <div className="empty-state" style={{ flex: 1 }}>
                                <Spinner size="medium" />
                            </div>
                        ) : !currentLayout ? (
                            <div className="empty-state" style={{ flex: 1 }}>
                                <div className="empty-state-text">请从左侧选择或添加一张时间表</div>
                            </div>
                        ) : viewMode === "segments" ? (
                            <div className="tl-segments-scroll">
                                {currentItems.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-text">
                                            当前时间表为空，请使用上方工具栏添加时间点
                                        </div>
                                    </div>
                                ) : (
                                    currentItems.map((item, idx) => {
                                        const startStr = extractHHMMSS(item, "start");
                                        const endStr = extractHHMMSS(item, "end");
                                        const isPoint = item.TimeType === 2 || item.TimeType === 3;
                                        const durStr = isPoint ? "" : formatDuration(startStr, endStr);
                                        const defaultSubName =
                                            item.TimeType === 0 &&
                                            item.DefaultClassId &&
                                            !isEmptyGuid(item.DefaultClassId)
                                                ? subjects[item.DefaultClassId]?.Name
                                                : "";

                                        return (
                                            <div
                                                key={idx}
                                                className={`tl-segment-row type-${item.TimeType ?? 0} ${
                                                    safeSelectedIdx === idx ? "selected" : ""
                                                }`}
                                                onClick={() => {
                                                    setSelectedItemIdx(idx);
                                                    setInspectorOpen(true);
                                                    setMobileLayer(3);
                                                }}
                                            >
                                                <div className="tl-segment-left">
                                                    <span className="tl-segment-icon">
                                                        {renderSegmentIcon(item.TimeType ?? 0)}
                                                    </span>
                                                    {item.TimeType === 2 ? (
                                                        <span
                                                            className="tl-segment-time"
                                                            style={{ color: "var(--text-secondary)" }}
                                                        >
                                                            {startStr} · 分割线
                                                        </span>
                                                    ) : (
                                                        <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                                            <span className="tl-segment-time">
                                                                {startStr}
                                                            </span>
                                                            {!isPoint && (
                                                                <>
                                                                    <ArrowRight16Regular
                                                                        style={{ color: "var(--text-secondary)" }}
                                                                    />
                                                                    <span className="tl-segment-time">
                                                                        {endStr}
                                                                    </span>
                                                                    <span className="tl-segment-duration">
                                                                        {durStr}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-6">
                                                    {item.TimeType === 0 && defaultSubName && (
                                                        <span className="badge badge-info">{defaultSubName}</span>
                                                    )}
                                                    {item.TimeType === 1 && (
                                                        <span className="badge badge-success">
                                                            {item.BreakName || "课间休息"}
                                                        </span>
                                                    )}
                                                    {item.TimeType === 3 && (
                                                        <span className="badge badge-warning">
                                                            {item.ActionSet?.Name || "行动时间点"}
                                                        </span>
                                                    )}
                                                    {item.IsHideDefault && (
                                                        <span
                                                            style={{
                                                                fontSize: 11,
                                                                color: "var(--text-tertiary)",
                                                            }}
                                                        >
                                                            默认隐藏
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        ) : (
                            <div className="tl-segments-scroll">
                                <div
                                    style={{
                                        padding: 12,
                                        borderRadius: 8,
                                        background: "var(--bg-subtle)",
                                        fontSize: 12.5,
                                        color: "var(--text-secondary)",
                                        marginBottom: 8,
                                    }}
                                >
                                    时间轴比例预览视图，点击任意时间块可在右侧面板直接编辑属性。
                                </div>
                                {currentItems.map((item, idx) => {
                                    const startStr = extractHHMMSS(item, "start");
                                    const endStr = extractHHMMSS(item, "end");
                                    const isPoint = item.TimeType === 2 || item.TimeType === 3;
                                    const durStr = isPoint ? "瞬时" : formatDuration(startStr, endStr);
                                    return (
                                        <div
                                            key={idx}
                                            className={`tl-segment-row ${safeSelectedIdx === idx ? "selected" : ""}`}
                                            style={{
                                                borderLeft: `4px solid ${
                                                    item.TimeType === 0
                                                        ? "var(--accent-color)"
                                                        : item.TimeType === 1
                                                          ? "var(--success-color)"
                                                          : "var(--warning-color)"
                                                }`,
                                            }}
                                            onClick={() => {
                                                setSelectedItemIdx(idx);
                                                setInspectorOpen(true);
                                                setMobileLayer(3);
                                            }}
                                        >
                                            <div className="flex items-center gap-10">
                                                {renderSegmentIcon(item.TimeType ?? 0)}
                                                <span className="mono-code" style={{ fontWeight: 600 }}>
                                                    {startStr} {!isPoint ? `- ${endStr}` : ""}
                                                </span>
                                            </div>
                                            <span className="mono-code" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                                {durStr}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="tl-view-switcher">
                            <button
                                type="button"
                                className={`tl-view-tab ${viewMode === "segments" ? "active" : ""}`}
                                onClick={() => setViewMode("segments")}
                            >
                                <TextBulletListSquare20Regular />
                                <span>段落视图</span>
                            </button>
                            <span style={{ color: "var(--border-color)" }}>|</span>
                            <button
                                type="button"
                                className={`tl-view-tab ${viewMode === "timeline" ? "active" : ""}`}
                                onClick={() => setViewMode("timeline")}
                            >
                                <Timeline20Regular />
                                <span>时间轴视图</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* ===== 第三层（右栏）：编辑时间点全高浮动侧边栏 ===== */}
                <div
                    className={`tl-col-right floating-inspector ${
                        !inspectorOpen ? "is-closed" : ""
                    } ${mobileLayer !== 3 ? "mobile-layer-hidden" : ""}`}
                >
                    <div className="tl-inspector-card">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-6">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<ArrowLeft16Regular />}
                                    className="mobile-only-back-btn"
                                    onClick={() => {
                                        setInspectorOpen(false);
                                        setMobileLayer(2);
                                    }}
                                    style={{ display: "none" }}
                                />
                                <span style={{ fontSize: 16, fontWeight: 700 }}>编辑时间点</span>
                            </div>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Dismiss16Regular />}
                                onClick={() => {
                                    setInspectorOpen(false);
                                    setMobileLayer(2);
                                }}
                                title="关闭"
                            />
                        </div>

                        {!selectedItem ? (
                            <div
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "var(--text-secondary)",
                                    fontSize: 13,
                                    textAlign: "center",
                                }}
                            >
                                在中间列表选择一个时间点进行编辑
                            </div>
                        ) : (
                            <>
                                {/* 开始时间 */}
                                <div className="form-group" style={{ marginBottom: 4 }}>
                                    <label className="form-label">开始时间</label>
                                    <TimeInputGroup
                                        value={extractHHMMSS(selectedItem, "start")}
                                        onChange={(val) =>
                                            updateTimeItemClock(safeSelectedIdx, "start", val)
                                        }
                                    />
                                </div>

                                {/* 结束时间 */}
                                {selectedItem.TimeType !== 2 && selectedItem.TimeType !== 3 && (
                                    <div className="form-group" style={{ marginBottom: 4 }}>
                                        <label className="form-label">结束时间</label>
                                        <TimeInputGroup
                                            value={extractHHMMSS(selectedItem, "end")}
                                            onChange={(val) =>
                                                updateTimeItemClock(safeSelectedIdx, "end", val)
                                            }
                                        />
                                    </div>
                                )}

                                {/* 默认课程 / 课间名称 */}
                                {selectedItem.TimeType === 0 && (
                                    <div className="form-group" style={{ marginBottom: 4 }}>
                                        <label className="form-label">默认课程</label>
                                        <Select
                                            size="small"
                                            value={
                                                isEmptyGuid(selectedItem.DefaultClassId)
                                                    ? EMPTY_GUID
                                                    : selectedItem.DefaultClassId || EMPTY_GUID
                                            }
                                            onChange={(_, d) =>
                                                updateTimeItem(safeSelectedIdx, {
                                                    DefaultClassId: toUpstreamGuidOrEmpty(d.value),
                                                })
                                            }
                                            style={{ width: "100%" }}
                                        >
                                            <option value={EMPTY_GUID}>未设置</option>
                                            {validSubjectEntries.map(([sid, sub]) => (
                                                <option key={sid} value={sid}>
                                                    {sub.Name}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                )}

                                {selectedItem.TimeType === 1 && (
                                    <div className="form-group" style={{ marginBottom: 4 }}>
                                        <label className="form-label">课间名称</label>
                                        <Input
                                            size="small"
                                            value={selectedItem.BreakName || ""}
                                            onChange={(_, d) =>
                                                updateTimeItem(safeSelectedIdx, { BreakName: d.value })
                                            }
                                            placeholder="输入课间显示名称"
                                            style={{ width: "100%" }}
                                        />
                                    </div>
                                )}

                                {/* 默认隐藏 */}
                                {selectedItem.TimeType !== 2 && (
                                    <div>
                                        <Checkbox
                                            label="默认隐藏"
                                            checked={!!selectedItem.IsHideDefault}
                                            onChange={(_, d) =>
                                                updateTimeItem(safeSelectedIdx, {
                                                    IsHideDefault: !!d.checked,
                                                })
                                            }
                                        />
                                    </div>
                                )}

                                {/* 行动菜单：比照客户端实现一致的行动编辑引擎 */}
                                {selectedItem.TimeType === 3 && (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 10,
                                            borderTop: "1px solid var(--border-color)",
                                            paddingTop: 10,
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span style={{ fontSize: 13.5, fontWeight: 600 }}>行动组设置</span>
                                            <Switch
                                                checked={getItemActionSet(selectedItem).IsEnabled !== false}
                                                onChange={(_, d) =>
                                                    updateItemActionSet(safeSelectedIdx, {
                                                        IsEnabled: d.checked,
                                                    })
                                                }
                                            />
                                        </div>

                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">行动组名称</label>
                                            <Input
                                                size="small"
                                                value={getItemActionSet(selectedItem).Name || ""}
                                                onChange={(_, d) =>
                                                    updateItemActionSet(safeSelectedIdx, { Name: d.value })
                                                }
                                                placeholder="输入行动组名称"
                                                style={{ width: "100%" }}
                                            />
                                        </div>

                                        <Checkbox
                                            label="允许恢复"
                                            checked={!!getItemActionSet(selectedItem).IsRevertEnabled}
                                            onChange={(_, d) =>
                                                updateItemActionSet(safeSelectedIdx, {
                                                    IsRevertEnabled: !!d.checked,
                                                })
                                            }
                                        />

                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">添加行动</label>
                                            <Select
                                                size="small"
                                                value=""
                                                onChange={(_, d) => {
                                                    if (d.value) addActionToItem(safeSelectedIdx, d.value);
                                                }}
                                                style={{ width: "100%" }}
                                            >
                                                <option value="">选择要添加的行动</option>
                                                {BUILTIN_ACTIONS.map((ba) => (
                                                    <option key={ba.id} value={ba.id}>
                                                        {ba.category} · {ba.name}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>

                                        {(getItemActionSet(selectedItem).Actions || []).map((act, aIdx) => {
                                            const meta = BUILTIN_ACTIONS.find((a) => a.id === act.Id);
                                            const s =
                                                act.Settings && typeof act.Settings === "object"
                                                    ? (act.Settings as Record<string, unknown>)
                                                    : {};
                                            return (
                                                <div
                                                    key={aIdx}
                                                    className="attached-setting-card"
                                                    style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                                                            {meta?.name || act.Id}
                                                        </span>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            icon={<Delete16Regular />}
                                                            onClick={() =>
                                                                removeActionFromItem(safeSelectedIdx, aIdx)
                                                            }
                                                            style={{ color: "var(--danger-color)" }}
                                                        />
                                                    </div>

                                                    {act.Id === "classisland.os.run" && (
                                                        <>
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">运行类型</label>
                                                                <Select
                                                                    size="small"
                                                                    value={String(s.RunType ?? "Application")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            RunType: d.value,
                                                                        })
                                                                    }
                                                                    style={{ width: "100%" }}
                                                                >
                                                                    <option value="Application">应用程序</option>
                                                                    <option value="Command">命令</option>
                                                                    <option value="File">文件</option>
                                                                    <option value="Folder">文件夹</option>
                                                                    <option value="Url">网页链接</option>
                                                                </Select>
                                                            </div>
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">目标值</label>
                                                                <Input
                                                                    size="small"
                                                                    value={String(s.Value ?? "")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Value: d.value,
                                                                        })
                                                                    }
                                                                    placeholder="路径、命令或链接"
                                                                    style={{ width: "100%" }}
                                                                />
                                                            </div>
                                                            {String(s.RunType ?? "Application") === "Application" && (
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">启动参数</label>
                                                                    <Input
                                                                        size="small"
                                                                        value={String(s.Args ?? "")}
                                                                        onChange={(_, d) =>
                                                                            updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                                Args: d.value,
                                                                            })
                                                                        }
                                                                        placeholder="可选启动参数"
                                                                        style={{ width: "100%" }}
                                                                    />
                                                                </div>
                                                            )}
                                                        </>
                                                    )}

                                                    {act.Id === "classisland.showNotification" && (
                                                        <>
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">遮罩文字</label>
                                                                <Input
                                                                    size="small"
                                                                    value={String(s.Mask ?? "")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Mask: d.value,
                                                                        })
                                                                    }
                                                                    placeholder="提醒遮罩标题"
                                                                    style={{ width: "100%" }}
                                                                />
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span style={{ fontSize: 12 }}>遮罩时长</span>
                                                                <div className="flex items-center gap-4">
                                                                    <Input
                                                                        size="small"
                                                                        type="number"
                                                                        value={String(s.MaskDurationSeconds ?? 5)}
                                                                        onChange={(_, d) =>
                                                                            updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                                MaskDurationSeconds: Number(d.value) || 5,
                                                                            })
                                                                        }
                                                                        style={{ width: 72 }}
                                                                    />
                                                                    <span style={{ fontSize: 12 }}>秒</span>
                                                                </div>
                                                            </div>
                                                            <Checkbox
                                                                label="启用遮罩语音"
                                                                checked={s.IsMaskSpeechEnabled !== false}
                                                                onChange={(_, d) =>
                                                                    updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                        IsMaskSpeechEnabled: !!d.checked,
                                                                    })
                                                                }
                                                            />
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">正文文字</label>
                                                                <Input
                                                                    size="small"
                                                                    value={String(s.Content ?? "")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Content: d.value,
                                                                        })
                                                                    }
                                                                    placeholder="提醒正文"
                                                                    style={{ width: "100%" }}
                                                                />
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <span style={{ fontSize: 12 }}>正文时长</span>
                                                                <div className="flex items-center gap-4">
                                                                    <Input
                                                                        size="small"
                                                                        type="number"
                                                                        value={String(s.ContentDurationSeconds ?? 10)}
                                                                        onChange={(_, d) =>
                                                                            updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                                ContentDurationSeconds: Number(d.value) || 0,
                                                                            })
                                                                        }
                                                                        style={{ width: 72 }}
                                                                    />
                                                                    <span style={{ fontSize: 12 }}>秒</span>
                                                                </div>
                                                            </div>
                                                            <Checkbox
                                                                label="启用正文语音"
                                                                checked={s.IsContentSpeechEnabled !== false}
                                                                onChange={(_, d) =>
                                                                    updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                        IsContentSpeechEnabled: !!d.checked,
                                                                    })
                                                                }
                                                            />
                                                        </>
                                                    )}

                                                    {act.Id === "classisland.notification.weather" && (
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">天气提醒类型</label>
                                                            <Select
                                                                size="small"
                                                                value={String(s.NotificationKind ?? 0)}
                                                                onChange={(_, d) =>
                                                                    updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                        NotificationKind: Number(d.value),
                                                                    })
                                                                }
                                                                style={{ width: "100%" }}
                                                            >
                                                                <option value="0">天气预报</option>
                                                                <option value="1">气象预警</option>
                                                                <option value="2">逐小时天气预报</option>
                                                            </Select>
                                                        </div>
                                                    )}

                                                    {act.Id === "classisland.broadcastSignal" && (
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">信号名称</label>
                                                            <Input
                                                                size="small"
                                                                value={String(s.SignalName ?? "")}
                                                                onChange={(_, d) =>
                                                                    updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                        SignalName: d.value,
                                                                    })
                                                                }
                                                                placeholder="输入广播信号名称"
                                                                style={{ width: "100%" }}
                                                            />
                                                        </div>
                                                    )}

                                                    {act.Id === "classisland.action.sleep" && (
                                                        <div className="flex items-center justify-between">
                                                            <span style={{ fontSize: 12 }}>等待时长</span>
                                                            <div className="flex items-center gap-4">
                                                                <Input
                                                                    size="small"
                                                                    type="number"
                                                                    value={String(s.Value ?? 5)}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Value: Number(d.value) || 1,
                                                                        })
                                                                    }
                                                                    style={{ width: 80 }}
                                                                />
                                                                <span style={{ fontSize: 12 }}>秒</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {act.Id === "classisland.settings" && (
                                                        <>
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">设置属性名</label>
                                                                <Input
                                                                    size="small"
                                                                    value={String(s.Name ?? "")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Name: d.value,
                                                                        })
                                                                    }
                                                                    placeholder="输入设置属性名称"
                                                                    style={{ width: "100%" }}
                                                                />
                                                            </div>
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                                <label className="form-label">设置目标值</label>
                                                                <Input
                                                                    size="small"
                                                                    value={String(s.Value ?? "")}
                                                                    onChange={(_, d) =>
                                                                        updateActionSettingsInItem(safeSelectedIdx, aIdx, {
                                                                            Value: d.value,
                                                                        })
                                                                    }
                                                                    placeholder="输入目标值"
                                                                    style={{ width: "100%" }}
                                                                />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* 更多选项（启用特定的提醒设置：比照上游客户端项目与属性名称实现） */}
                                {(selectedItem.TimeType === 0 || selectedItem.TimeType === 1) && (
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 10,
                                            borderTop: "1px solid var(--border-color)",
                                            paddingTop: 10,
                                        }}
                                    >
                                        <div className="flex items-center gap-6" style={{ fontSize: 13, fontWeight: 600 }}>
                                            <Settings16Regular />
                                            <span>更多选项</span>
                                        </div>

                                        {/* 1. 上课提醒设置 */}
                                        <div className="attached-setting-card">
                                            <div className="attached-setting-header">
                                                <div className="attached-setting-title">
                                                    <Alert16Regular />
                                                    <span>上课提醒设置</span>
                                                </div>
                                                <div className="attached-setting-controls">
                                                    <Switch
                                                        checked={
                                                            !!getAttachedObject(
                                                                selectedItem,
                                                                ATTACHED_CLASS_NOTIFICATION_ID
                                                            ).IsAttachSettingsEnabled
                                                        }
                                                        onChange={(_, d) =>
                                                            updateAttachedObject(
                                                                safeSelectedIdx,
                                                                ATTACHED_CLASS_NOTIFICATION_ID,
                                                                {
                                                                    IsAttachSettingsEnabled: d.checked,
                                                                }
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        size="small"
                                                        appearance="subtle"
                                                        icon={
                                                            classNotifyExpanded ? (
                                                                <ChevronUp16Regular />
                                                            ) : (
                                                                <ChevronDown16Regular />
                                                            )
                                                        }
                                                        onClick={() => setClassNotifyExpanded((prev) => !prev)}
                                                    />
                                                </div>
                                            </div>

                                            {classNotifyExpanded &&
                                                !!getAttachedObject(
                                                    selectedItem,
                                                    ATTACHED_CLASS_NOTIFICATION_ID
                                                ).IsAttachSettingsEnabled && (
                                                    <div className="attached-setting-body">
                                                        {selectedItem.TimeType === 0 ? (
                                                            <>
                                                                <div className="tab-bar" style={{ marginBottom: 6 }}>
                                                                    <button
                                                                        type="button"
                                                                        className={`tab-btn ${
                                                                            classNotifySubTab === "prepare" ? "active" : ""
                                                                        }`}
                                                                        onClick={() => setClassNotifySubTab("prepare")}
                                                                    >
                                                                        准备上课
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className={`tab-btn ${
                                                                            classNotifySubTab === "on" ? "active" : ""
                                                                        }`}
                                                                        onClick={() => setClassNotifySubTab("on")}
                                                                    >
                                                                        上课
                                                                    </button>
                                                                </div>

                                                                {classNotifySubTab === "prepare" ? (
                                                                    <>
                                                                        <Checkbox
                                                                            label="启用准备上课提醒"
                                                                            checked={
                                                                                getAttachedObject(
                                                                                    selectedItem,
                                                                                    ATTACHED_CLASS_NOTIFICATION_ID
                                                                                ).IsClassOnPreparingNotificationEnabled !== false
                                                                            }
                                                                            onChange={(_, d) =>
                                                                                updateAttachedObject(
                                                                                    safeSelectedIdx,
                                                                                    ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                    {
                                                                                        IsClassOnPreparingNotificationEnabled:
                                                                                            !!d.checked,
                                                                                    }
                                                                                )
                                                                            }
                                                                        />
                                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                                            <label className="form-label">准备上课提醒时间</label>
                                                                            <div className="flex items-center gap-6">
                                                                                <span style={{ fontSize: 12.5 }}>上课前</span>
                                                                                <Input
                                                                                    size="small"
                                                                                    type="number"
                                                                                    value={String(
                                                                                        getAttachedObject(
                                                                                            selectedItem,
                                                                                            ATTACHED_CLASS_NOTIFICATION_ID
                                                                                        ).ClassPreparingDeltaTime ?? 60
                                                                                    )}
                                                                                    onChange={(_, d) =>
                                                                                        updateAttachedObject(
                                                                                            safeSelectedIdx,
                                                                                            ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                            {
                                                                                                ClassPreparingDeltaTime:
                                                                                                    parseInt(d.value, 10) || 0,
                                                                                            }
                                                                                        )
                                                                                    }
                                                                                    style={{ flex: 1 }}
                                                                                />
                                                                                <span style={{ fontSize: 12.5 }}>秒</span>
                                                                            </div>
                                                                        </div>
                                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                                            <label className="form-label">准备上课遮罩文字</label>
                                                                            <Input
                                                                                size="small"
                                                                                value={String(
                                                                                    getAttachedObject(
                                                                                        selectedItem,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID
                                                                                    ).ClassOnPreparingMaskText ?? ""
                                                                                )}
                                                                                onChange={(_, d) =>
                                                                                    updateAttachedObject(
                                                                                        safeSelectedIdx,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                        {
                                                                                            ClassOnPreparingMaskText: d.value,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                placeholder="留空以继承默认设置"
                                                                                style={{ width: "100%" }}
                                                                            />
                                                                        </div>
                                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                                            <label className="form-label">准备上课提醒文字</label>
                                                                            <Input
                                                                                size="small"
                                                                                value={String(
                                                                                    getAttachedObject(
                                                                                        selectedItem,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID
                                                                                    ).ClassOnPreparingText ?? ""
                                                                                )}
                                                                                onChange={(_, d) =>
                                                                                    updateAttachedObject(
                                                                                        safeSelectedIdx,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                        {
                                                                                            ClassOnPreparingText: d.value,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                placeholder="留空以继承默认设置"
                                                                                style={{ width: "100%" }}
                                                                            />
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    /* 上课标签内只有启用上课提醒和遮罩文字两个选项 */
                                                                    <>
                                                                        <Checkbox
                                                                            label="启用上课提醒"
                                                                            checked={
                                                                                getAttachedObject(
                                                                                    selectedItem,
                                                                                    ATTACHED_CLASS_NOTIFICATION_ID
                                                                                ).IsClassOnNotificationEnabled !== false
                                                                            }
                                                                            onChange={(_, d) =>
                                                                                updateAttachedObject(
                                                                                    safeSelectedIdx,
                                                                                    ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                    {
                                                                                        IsClassOnNotificationEnabled:
                                                                                            !!d.checked,
                                                                                    }
                                                                                )
                                                                            }
                                                                        />
                                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                                            <label className="form-label">遮罩文字</label>
                                                                            <Input
                                                                                size="small"
                                                                                value={String(
                                                                                    getAttachedObject(
                                                                                        selectedItem,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID
                                                                                    ).ClassOnMaskText ?? ""
                                                                                )}
                                                                                onChange={(_, d) =>
                                                                                    updateAttachedObject(
                                                                                        safeSelectedIdx,
                                                                                        ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                        {
                                                                                            ClassOnMaskText: d.value,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                placeholder="留空以继承默认设置"
                                                                                style={{ width: "100%" }}
                                                                            />
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </>
                                                        ) : (
                                                            /* 课间休息 */
                                                            <>
                                                                <div className="tab-bar" style={{ marginBottom: 6 }}>
                                                                    <button type="button" className="tab-btn active">
                                                                        课间休息
                                                                    </button>
                                                                </div>
                                                                <Checkbox
                                                                    label="启用下课提醒"
                                                                    checked={
                                                                        getAttachedObject(
                                                                            selectedItem,
                                                                            ATTACHED_CLASS_NOTIFICATION_ID
                                                                        ).IsClassOffNotificationEnabled !== false
                                                                    }
                                                                    onChange={(_, d) =>
                                                                        updateAttachedObject(
                                                                            safeSelectedIdx,
                                                                            ATTACHED_CLASS_NOTIFICATION_ID,
                                                                            {
                                                                                IsClassOffNotificationEnabled: !!d.checked,
                                                                            }
                                                                        )
                                                                    }
                                                                />
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">下课提醒文字</label>
                                                                    <Input
                                                                        size="small"
                                                                        value={String(
                                                                            getAttachedObject(
                                                                                selectedItem,
                                                                                ATTACHED_CLASS_NOTIFICATION_ID
                                                                            ).ClassOffOverlayText ?? ""
                                                                        )}
                                                                        onChange={(_, d) =>
                                                                            updateAttachedObject(
                                                                                safeSelectedIdx,
                                                                                ATTACHED_CLASS_NOTIFICATION_ID,
                                                                                {
                                                                                    ClassOffOverlayText: d.value,
                                                                                }
                                                                            )
                                                                        }
                                                                        placeholder="留空以禁用"
                                                                        style={{ width: "100%" }}
                                                                    />
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                        </div>

                                        {/* 2. 课程显示设置 */}
                                        <div className="attached-setting-card">
                                            <div className="attached-setting-header">
                                                <div className="attached-setting-title">
                                                    <Book20Regular />
                                                    <span>课程显示设置</span>
                                                </div>
                                                <div className="attached-setting-controls">
                                                    <Switch
                                                        checked={
                                                            !!getAttachedObject(
                                                                selectedItem,
                                                                ATTACHED_LESSON_DISPLAY_ID
                                                            ).IsAttachSettingsEnabled
                                                        }
                                                        onChange={(_, d) =>
                                                            updateAttachedObject(
                                                                safeSelectedIdx,
                                                                ATTACHED_LESSON_DISPLAY_ID,
                                                                {
                                                                    IsAttachSettingsEnabled: d.checked,
                                                                }
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        size="small"
                                                        appearance="subtle"
                                                        icon={
                                                            lessonDisplayExpanded ? (
                                                                <ChevronUp16Regular />
                                                            ) : (
                                                                <ChevronDown16Regular />
                                                            )
                                                        }
                                                        onClick={() => setLessonDisplayExpanded((prev) => !prev)}
                                                    />
                                                </div>
                                            </div>

                                            {lessonDisplayExpanded &&
                                                !!getAttachedObject(
                                                    selectedItem,
                                                    ATTACHED_LESSON_DISPLAY_ID
                                                ).IsAttachSettingsEnabled && (
                                                    <div className="attached-setting-body">
                                                        <Checkbox
                                                            label="显示时间点附加信息"
                                                            checked={
                                                                getAttachedObject(
                                                                    selectedItem,
                                                                    ATTACHED_LESSON_DISPLAY_ID
                                                                ).ShowExtraInfoOnTimePoint !== false
                                                            }
                                                            onChange={(_, d) =>
                                                                updateAttachedObject(
                                                                    safeSelectedIdx,
                                                                    ATTACHED_LESSON_DISPLAY_ID,
                                                                    {
                                                                        ShowExtraInfoOnTimePoint: !!d.checked,
                                                                    }
                                                                )
                                                            }
                                                        />

                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">要显示的附加信息</label>
                                                            <Select
                                                                size="small"
                                                                value={String(
                                                                    getAttachedObject(
                                                                        selectedItem,
                                                                        ATTACHED_LESSON_DISPLAY_ID
                                                                    ).ExtraInfoType ?? 0
                                                                )}
                                                                onChange={(_, d) =>
                                                                    updateAttachedObject(
                                                                        safeSelectedIdx,
                                                                        ATTACHED_LESSON_DISPLAY_ID,
                                                                        {
                                                                            ExtraInfoType: Number(d.value),
                                                                        }
                                                                    )
                                                                }
                                                                style={{ width: "100%" }}
                                                            >
                                                                <option value="0">时间点持续时间</option>
                                                                <option value="1">已过时间 / 持续时间</option>
                                                                <option value="2">剩余时间 / 持续时间</option>
                                                                <option value="3">已过时间百分比</option>
                                                                <option value="4">剩余时间</option>
                                                                <option value="5">倒计时</option>
                                                            </Select>
                                                        </div>

                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">显示精确倒计时时长</label>
                                                            <div className="flex items-center gap-6">
                                                                <span style={{ fontSize: 12.5 }}>剩余</span>
                                                                <Input
                                                                    size="small"
                                                                    type="number"
                                                                    value={String(
                                                                        getAttachedObject(
                                                                            selectedItem,
                                                                            ATTACHED_LESSON_DISPLAY_ID
                                                                        ).ExtraInfo4ShowSecondsSeconds ?? 0
                                                                    )}
                                                                    onChange={(_, d) =>
                                                                        updateAttachedObject(
                                                                            safeSelectedIdx,
                                                                            ATTACHED_LESSON_DISPLAY_ID,
                                                                            {
                                                                                ExtraInfo4ShowSecondsSeconds:
                                                                                    parseInt(d.value, 10) || 0,
                                                                            }
                                                                        )
                                                                    }
                                                                    style={{ flex: 1 }}
                                                                />
                                                                <span style={{ fontSize: 12.5 }}>秒时</span>
                                                            </div>
                                                        </div>

                                                        <Checkbox
                                                            label="时间点结束倒计时"
                                                            checked={
                                                                !!getAttachedObject(
                                                                    selectedItem,
                                                                    ATTACHED_LESSON_DISPLAY_ID
                                                                ).IsCountdownEnabled
                                                            }
                                                            onChange={(_, d) =>
                                                                updateAttachedObject(
                                                                    safeSelectedIdx,
                                                                    ATTACHED_LESSON_DISPLAY_ID,
                                                                    {
                                                                        IsCountdownEnabled: !!d.checked,
                                                                    }
                                                                )
                                                            }
                                                        />

                                                        {!!getAttachedObject(
                                                            selectedItem,
                                                            ATTACHED_LESSON_DISPLAY_ID
                                                        ).IsCountdownEnabled && (
                                                            <div className="flex items-center gap-6">
                                                                <span style={{ fontSize: 12.5 }}>倒计时时长</span>
                                                                <Input
                                                                    size="small"
                                                                    type="number"
                                                                    value={String(
                                                                        getAttachedObject(
                                                                            selectedItem,
                                                                            ATTACHED_LESSON_DISPLAY_ID
                                                                        ).CountdownSeconds ?? 60
                                                                    )}
                                                                    onChange={(_, d) =>
                                                                        updateAttachedObject(
                                                                            safeSelectedIdx,
                                                                            ATTACHED_LESSON_DISPLAY_ID,
                                                                            {
                                                                                CountdownSeconds:
                                                                                    parseInt(d.value, 10) || 60,
                                                                            }
                                                                        )
                                                                    }
                                                                    style={{ flex: 1 }}
                                                                />
                                                                <span style={{ fontSize: 12.5 }}>秒</span>
                                                            </div>
                                                        )}

                                                        <Checkbox
                                                            label="使用模糊倒计时"
                                                            checked={
                                                                !!getAttachedObject(
                                                                    selectedItem,
                                                                    ATTACHED_LESSON_DISPLAY_ID
                                                                ).IsNonExactCountdownEnabled
                                                            }
                                                            onChange={(_, d) =>
                                                                updateAttachedObject(
                                                                    safeSelectedIdx,
                                                                    ATTACHED_LESSON_DISPLAY_ID,
                                                                    {
                                                                        IsNonExactCountdownEnabled: !!d.checked,
                                                                    }
                                                                )
                                                            }
                                                        />

                                                        <Checkbox
                                                            label="上课时仅显示当前课程"
                                                            checked={
                                                                !!getAttachedObject(
                                                                    selectedItem,
                                                                    ATTACHED_LESSON_DISPLAY_ID
                                                                ).ShowCurrentLessonOnlyOnClass
                                                            }
                                                            onChange={(_, d) =>
                                                                updateAttachedObject(
                                                                    safeSelectedIdx,
                                                                    ATTACHED_LESSON_DISPLAY_ID,
                                                                    {
                                                                        ShowCurrentLessonOnlyOnClass: !!d.checked,
                                                                    }
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                )}
                                        </div>

                                        {/* 3. 天气提醒设置 */}
                                        <div className="attached-setting-card">
                                            <div className="attached-setting-header">
                                                <div className="attached-setting-title">
                                                    <WeatherPartlyCloudyDay16Regular />
                                                    <span>天气提醒设置</span>
                                                </div>
                                                <div className="attached-setting-controls">
                                                    <Switch
                                                        checked={
                                                            !!getAttachedObject(
                                                                selectedItem,
                                                                ATTACHED_WEATHER_ID
                                                            ).IsAttachSettingsEnabled
                                                        }
                                                        onChange={(_, d) =>
                                                            updateAttachedObject(
                                                                safeSelectedIdx,
                                                                ATTACHED_WEATHER_ID,
                                                                {
                                                                    IsAttachSettingsEnabled: d.checked,
                                                                }
                                                            )
                                                        }
                                                    />
                                                    <Button
                                                        size="small"
                                                        appearance="subtle"
                                                        icon={
                                                            weatherExpanded ? (
                                                                <ChevronUp16Regular />
                                                            ) : (
                                                                <ChevronDown16Regular />
                                                            )
                                                        }
                                                        onClick={() => setWeatherExpanded((prev) => !prev)}
                                                    />
                                                </div>
                                            </div>

                                            {weatherExpanded &&
                                                !!getAttachedObject(
                                                    selectedItem,
                                                    ATTACHED_WEATHER_ID
                                                ).IsAttachSettingsEnabled && (
                                                    <div className="attached-setting-body">
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">气象预警提醒模式</label>
                                                            <Select
                                                                size="small"
                                                                value={String(
                                                                    getAttachedObject(selectedItem, ATTACHED_WEATHER_ID)
                                                                        .AlertShowMode ?? 2
                                                                )}
                                                                onChange={(_, d) =>
                                                                    updateAttachedObject(
                                                                        safeSelectedIdx,
                                                                        ATTACHED_WEATHER_ID,
                                                                        {
                                                                            AlertShowMode: Number(d.value),
                                                                        }
                                                                    )
                                                                }
                                                                style={{ width: "100%" }}
                                                            >
                                                                <option value="2">继承全局设置</option>
                                                                <option value="1">在此处启用</option>
                                                                <option value="0">在此处禁用</option>
                                                            </Select>
                                                        </div>

                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">天气预报提醒模式</label>
                                                            <Select
                                                                size="small"
                                                                value={String(
                                                                    getAttachedObject(selectedItem, ATTACHED_WEATHER_ID)
                                                                        .ForecastShowMode ?? 2
                                                                )}
                                                                onChange={(_, d) =>
                                                                    updateAttachedObject(
                                                                        safeSelectedIdx,
                                                                        ATTACHED_WEATHER_ID,
                                                                        {
                                                                            ForecastShowMode: Number(d.value),
                                                                        }
                                                                    )
                                                                }
                                                                style={{ width: "100%" }}
                                                            >
                                                                <option value="2">继承全局设置</option>
                                                                <option value="1">在此处启用</option>
                                                                <option value="0">在此处禁用</option>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* 右下角时间点类型快捷切换与删除栏（已移除顺序移动箭头，改为根据时间自动排序与冲突处理） */}
                    <div className="tl-type-bar">
                        <Button
                            size="small"
                            appearance={selectedItem?.TimeType === 0 ? "primary" : "subtle"}
                            icon={<Book20Regular />}
                            disabled={!selectedItem}
                            onClick={() => updateTimeItem(safeSelectedIdx, { TimeType: 0 })}
                            title="设为上课"
                        />
                        <Button
                            size="small"
                            appearance={selectedItem?.TimeType === 1 ? "primary" : "subtle"}
                            icon={<Clock20Regular />}
                            disabled={!selectedItem}
                            onClick={() => updateTimeItem(safeSelectedIdx, { TimeType: 1 })}
                            title="设为课间休息"
                        />
                        <Button
                            size="small"
                            appearance={selectedItem?.TimeType === 2 ? "primary" : "subtle"}
                            icon={<SplitHorizontal20Regular />}
                            disabled={!selectedItem}
                            onClick={() => updateTimeItem(safeSelectedIdx, { TimeType: 2 })}
                            title="设为分割线"
                        />
                        <Button
                            size="small"
                            appearance={selectedItem?.TimeType === 3 ? "primary" : "subtle"}
                            icon={<Flash20Regular />}
                            disabled={!selectedItem}
                            onClick={() => updateTimeItem(safeSelectedIdx, { TimeType: 3 })}
                            title="设为行动"
                        />
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<Delete20Regular />}
                            disabled={!selectedItem}
                            onClick={() => deleteTimeItem(safeSelectedIdx)}
                            style={{ color: "var(--danger-color)" }}
                            title="删除时间点"
                        />
                    </div>
                </div>
            </div>

            {/* 新建文件弹窗 */}
            {showCreate && (
                <Dialog open onOpenChange={() => setShowCreate(false)}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>新建时间表文件</DialogTitle>
                            <DialogContent>
                                <div className="form-group">
                                    <label className="form-label">文件名称</label>
                                    <Input
                                        value={newFileName}
                                        onChange={(_, d) => setNewFileName(d.value)}
                                        placeholder="输入名称"
                                        style={{ width: "100%" }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setShowCreate(false)}>
                                    取消
                                </Button>
                                <Button
                                    appearance="primary"
                                    onClick={handleCreateFile}
                                    disabled={!newFileName.trim()}
                                >
                                    创建
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 重命名单个时间表弹窗 */}
            {renameLayoutId && (
                <Dialog open onOpenChange={() => setRenameLayoutId(null)}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>时间表设置</DialogTitle>
                            <DialogContent>
                                <div className="form-group">
                                    <label className="form-label">时间表名称</label>
                                    <Input
                                        value={renameLayoutText}
                                        onChange={(_, d) => setRenameLayoutText(d.value)}
                                        style={{ width: "100%" }}
                                    />
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" onClick={() => setRenameLayoutId(null)}>
                                    取消
                                </Button>
                                <Button
                                    appearance="primary"
                                    onClick={() => {
                                        updateLayoutName(renameLayoutId, renameLayoutText);
                                        setRenameLayoutId(null);
                                    }}
                                >
                                    确定
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}

            {/* 当前编辑文件高级设置弹窗 */}
            {fileSettingsOpen && selectedFile && (
                <Dialog open onOpenChange={() => setFileSettingsOpen(false)}>
                    <DialogSurface style={{ minWidth: 560 }}>
                        <DialogBody>
                            <DialogTitle>文件设置 · {selectedFile}</DialogTitle>
                            <DialogContent>
                                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                    {subjectFiles.length > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">关联参考科目文件</label>
                                            <Select
                                                value={selectedSubjectFile}
                                                onChange={(_, d) => loadSubjectFile(d.value)}
                                                style={{ width: "100%" }}
                                            >
                                                {subjectFiles.map((sf) => (
                                                    <option key={sf} value={sf}>
                                                        {sf}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                                        <FileHistoryButton
                                            accountId={accountId}
                                            resourceType="TimeLayout"
                                            fileName={selectedFile}
                                            onLoadVersion={(content, version) => {
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
                                                    text: `已加载版本 v${version}`,
                                                });
                                            }}
                                            onError={(text) => setMsg({ type: "error", text })}
                                        />
                                        <DownloadPresetPopoverButton
                                            buttonText="导出文件"
                                            appearance="secondary"
                                            defaultFileName={`TimeLayout-${selectedFile}.json`}
                                            onFetchData={async () =>
                                                jsonMode ? JSON.parse(jsonText) : layouts
                                            }
                                            onError={(text) => setMsg({ type: "error", text })}
                                        />
                                        <Button
                                            appearance="secondary"
                                            icon={<Code20Regular />}
                                            onClick={() => {
                                                if (!jsonMode) {
                                                    setJsonText(JSON.stringify(layouts, null, 2));
                                                } else {
                                                    try {
                                                        setLayouts(
                                                            normalizeTimeLayoutsForSave(JSON.parse(jsonText))
                                                        );
                                                    } catch {
                                                        /* keep */
                                                    }
                                                }
                                                setJsonMode(!jsonMode);
                                            }}
                                        >
                                            {jsonMode ? "关闭源码视图" : "源码编辑"}
                                        </Button>
                                    </div>

                                    {jsonMode && (
                                        <div>
                                            <Textarea
                                                rows={12}
                                                value={jsonText}
                                                onChange={(_, d) => setJsonText(d.value)}
                                                style={{
                                                    width: "100%",
                                                    fontFamily: "var(--font-mono)",
                                                    fontSize: 12,
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button
                                    appearance="secondary"
                                    onClick={() => setFileSettingsOpen(false)}
                                >
                                    关闭
                                </Button>
                                <Button
                                    appearance="primary"
                                    icon={<Add20Regular />}
                                    onClick={async () => {
                                        await handleSave();
                                        setFileSettingsOpen(false);
                                    }}
                                >
                                    保存更改
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </div>
    );
}
