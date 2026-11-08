"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    ClassPlan,
    ClassInfo,
    TimeLayout,
    TimeLayoutItem,
    Subject,
    TimeRule,
    ClassPlanGroup,
} from "@/lib/types";
import {
    TIME_TYPE_LABELS,
    WEEKDAY_LABELS,
    EMPTY_GUID,
    isEmptyGuid,
    toUpstreamGuidOrEmpty,
} from "@/lib/types";
import {
    Button, Input, Switch, Spinner,
    MessageBar, MessageBarBody,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { Select } from "@/components/CustomSelect";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular, Code24Regular,
    Prohibited16Regular, Clock16Regular, Settings24Regular, Layer24Regular,
    Flash16Regular, BookOpen24Regular, ClipboardTextLtr24Regular, Copy24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type ClassPlansData = Record<string, ClassPlan>;
type ClassPlanGroupsData = Record<string, ClassPlanGroup>;
type TimeLayoutsData = Record<string, TimeLayout>;
type SubjectsData = Record<string, Subject>;

function formatItemTime(item: TimeLayoutItem): string {
    const startRaw = item.StartSecond || item.StartTime || "08:00";
    const endRaw = item.EndSecond || item.EndTime || "08:45";
    const parsePart = (raw: string) => {
        const t = raw.indexOf("T");
        const s = t >= 0 ? raw.slice(t + 1) : raw;
        const p = s.split(":");
        return `${(p[0] || "00").padStart(2, "0")}:${(p[1] || "00").padStart(2, "0")}`;
    };
    return `${parsePart(startRaw)} - ${parsePart(endRaw)}`;
}

/** 标准化课表对象：将空的 TimeLayoutId / AssociatedGroup / Classes[].SubjectId 统一转为 00000000-0000-0000-0000-000000000000 */
function normalizeClassPlansForSave(raw: ClassPlansData): ClassPlansData {
    const out: ClassPlansData = {};
    for (const [k, cp] of Object.entries(raw)) {
        const classes = Array.isArray(cp.Classes)
            ? cp.Classes.map((ci) => ({
                  ...ci,
                  SubjectId: toUpstreamGuidOrEmpty(ci.SubjectId),
                  IsEnabled: ci.IsEnabled !== false,
              }))
            : [];
        const tr = cp.TimeRule || { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 };
        out[k] = {
            ...cp,
            Name: cp.Name || "新课表",
            TimeLayoutId: toUpstreamGuidOrEmpty(cp.TimeLayoutId),
            AssociatedGroup: toUpstreamGuidOrEmpty(cp.AssociatedGroup),
            Classes: classes,
            TimeRule: {
                WeekDay: typeof tr.WeekDay === "number" ? tr.WeekDay : 1,
                WeekCountDiv: typeof tr.WeekCountDiv === "number" ? tr.WeekCountDiv : 0,
                WeekCountDivTotal: typeof tr.WeekCountDivTotal === "number" && tr.WeekCountDivTotal >= 2 ? tr.WeekCountDivTotal : 2,
            },
            IsEnabled: cp.IsEnabled !== false,
        };
    }
    return out;
}

const DEFAULT_GROUPS: ClassPlanGroupsData = {
    [EMPTY_GUID]: { Name: "默认", IsGlobal: false },
};

export default function ClassPlanPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [plans, setPlans] = useState<ClassPlansData>({});
    const [groups, setGroups] = useState<ClassPlanGroupsData>(DEFAULT_GROUPS);
    const [groupFilterId, setGroupFilterId] = useState<string>("__ALL__");
    const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
    /** 当前在中间课程表网格中选中的课程槽索引（对应 classes[selectedLessonIdx]） */
    const [selectedLessonIdx, setSelectedLessonIdx] = useState<number>(0);
    /** 右侧面板模式：'subject' (快速选科目网格) 或 'info' (课表详细信息与触发规则) */
    const [rightDrawerTab, setRightDrawerTab] = useState<"subject" | "info">("subject");
    /** 选完科目自动移动到下一个课程 (对应上游 Settings.IsProfileEditorClassInfoSubjectAutoMoveNextEnabled) */
    const [autoMoveNext, setAutoMoveNext] = useState<boolean>(true);
    /** 是否显示课间休息行 */
    const [showBreaks, setShowBreaks] = useState<boolean>(false);

    // 可选的时间表文件与科目文件
    const [tlFileList, setTlFileList] = useState<string[]>([]);
    const [selectedTlFile, setSelectedTlFile] = useState<string>("");
    const [subFileList, setSubFileList] = useState<string[]>([]);
    const [selectedSubFile, setSelectedSubFile] = useState<string>("");

    const [timeLayouts, setTimeLayouts] = useState<TimeLayoutsData>({});
    const [subjects, setSubjects] = useState<SubjectsData>({});

    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [newGroupName, setNewGroupName] = useState("");

    const selectFile = useCallback(async (name: string) => {
        if (!accountId) return;
        setSelectedFile(name);
        setSelectedPlanId(null);
        setSelectedLessonIdx(0);
        setDataLoading(true);
        try {
            const content = await data.read(accountId, "ClassPlan", name);
            let parsedPlans: ClassPlansData = {};
            let parsedGroups: ClassPlanGroupsData = { ...DEFAULT_GROUPS };
            if (content && typeof content === "object") {
                const obj = content as Record<string, unknown>;
                if (obj.ClassPlans && typeof obj.ClassPlans === "object") {
                    parsedPlans = obj.ClassPlans as ClassPlansData;
                    if (obj.ClassPlanGroups && typeof obj.ClassPlanGroups === "object") {
                        parsedGroups = {
                            ...DEFAULT_GROUPS,
                            ...(obj.ClassPlanGroups as ClassPlanGroupsData),
                        };
                    }
                } else {
                    parsedPlans = obj as ClassPlansData;
                }
            }
            const normalized = normalizeClassPlansForSave(parsedPlans);
            setPlans(normalized);
            setGroups(parsedGroups);
            setJsonText(JSON.stringify(normalized, null, 2));
            setSelectedPlanId(Object.keys(normalized)[0] || null);
        } catch {
            setPlans({});
            setGroups(DEFAULT_GROUPS);
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadReferenceTl = useCallback(async (fileName: string) => {
        if (!accountId || !fileName) return;
        setSelectedTlFile(fileName);
        try {
            const tlContent = await data.read(accountId, "TimeLayout", fileName);
            if (tlContent && typeof tlContent === "object") {
                const obj = tlContent as Record<string, unknown>;
                setTimeLayouts((obj.TimeLayouts as TimeLayoutsData) || (obj as TimeLayoutsData));
            }
        } catch {
            setTimeLayouts({});
        }
    }, [accountId]);

    const loadReferenceSub = useCallback(async (fileName: string) => {
        if (!accountId || !fileName) return;
        setSelectedSubFile(fileName);
        try {
            const subContent = await data.read(accountId, "Subjects", fileName);
            if (subContent && typeof subContent === "object") {
                const obj = subContent as Record<string, unknown>;
                setSubjects((obj.Subjects as SubjectsData) || (obj as SubjectsData));
            }
        } catch {
            setSubjects({});
        }
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        if (!accountId) return;
        try {
            const [cpFiles, tlFiles, subFiles] = await Promise.all([
                data.list(accountId, "ClassPlan"),
                data.list(accountId, "TimeLayout"),
                data.list(accountId, "Subjects"),
            ]);
            const cpArr = Array.isArray(cpFiles) ? cpFiles : [];
            const tlArr = Array.isArray(tlFiles) ? tlFiles : [];
            const subArr = Array.isArray(subFiles) ? subFiles : [];
            setFileList(cpArr);
            setTlFileList(tlArr);
            setSubFileList(subArr);

            if (tlArr.length > 0 && !selectedTlFile) {
                loadReferenceTl(tlArr[0]);
            }
            if (subArr.length > 0 && !selectedSubFile) {
                loadReferenceSub(subArr[0]);
            }
            if (cpArr.length > 0 && !selectedFile) {
                selectFile(cpArr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectedFile, selectedTlFile, selectedSubFile, selectFile, loadReferenceTl, loadReferenceSub]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = plans;
            if (jsonMode) {
                const parsed = JSON.parse(jsonText) as ClassPlansData;
                payloadToSave = normalizeClassPlansForSave(parsed);
                setPlans(payloadToSave);
            } else {
                payloadToSave = normalizeClassPlansForSave(plans);
                setPlans(payloadToSave);
                setJsonText(JSON.stringify(payloadToSave, null, 2));
            }
            const wrapperPayload =
                payloadToSave && typeof payloadToSave === "object" && "ClassPlans" in payloadToSave
                    ? payloadToSave
                    : { ClassPlans: payloadToSave, ClassPlanGroups: groups };
            await data.write(accountId, "ClassPlan", selectedFile, wrapperPayload);
            setMsg({ type: "success", text: "课表已保存并递增版本号" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查 JSON 格式" });
        }
        setSaving(false);
    }

    async function handleCreate() {
        if (!newFileName.trim()) return;
        try {
            await data.create(accountId, "ClassPlan", newFileName.trim());
            setShowCreate(false);
            setNewFileName("");
            const cpFiles = await data.list(accountId, "ClassPlan");
            setFileList(Array.isArray(cpFiles) ? cpFiles : []);
            selectFile(newFileName.trim());
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDelete(name: string) {
        if (!confirm(`确定删除课表文件 "${name}" 吗？`)) return;
        try {
            await data.deleteData(accountId, "ClassPlan", name);
            if (selectedFile === name) {
                setSelectedFile(null);
                setPlans({});
                setSelectedPlanId(null);
            }
            loadFiles();
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    /** 根据选中时间表的上课时间点 (TimeType === 0) 自动生成/对齐 Classes 数组，使用 00000000-0000-0000-0000-000000000000 表示空科目 */
    function buildClassesFromTimeLayout(tlId: string, existingClasses?: ClassInfo[]): ClassInfo[] {
        if (isEmptyGuid(tlId)) return existingClasses || [];
        const tl = timeLayouts[tlId];
        if (!tl || !Array.isArray(tl.Layouts)) return existingClasses || [];
        const classItems = tl.Layouts.filter((item) => item.TimeType === 0);
        return classItems.map((item, idx) => {
            const prev = existingClasses?.[idx];
            if (prev && !isEmptyGuid(prev.SubjectId)) {
                return { ...prev, SubjectId: toUpstreamGuidOrEmpty(prev.SubjectId) };
            }
            return {
                SubjectId: toUpstreamGuidOrEmpty(item.DefaultClassId),
                IsChangedClass: prev?.IsChangedClass ?? false,
                IsEnabled: prev?.IsEnabled ?? true,
            };
        });
    }

    function addPlan() {
        const id = crypto.randomUUID();
        const defaultTlId = Object.keys(timeLayouts)[0] || EMPTY_GUID;
        const targetGroup = groupFilterId !== "__ALL__" ? groupFilterId : EMPTY_GUID;
        const newPlan: ClassPlan = {
            Name: "新课表",
            TimeLayoutId: defaultTlId,
            Classes: buildClassesFromTimeLayout(defaultTlId),
            TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
            IsEnabled: true,
            IsOverlay: false,
            AssociatedGroup: targetGroup,
        };
        setPlans((prev) => ({ ...prev, [id]: newPlan }));
        setSelectedPlanId(id);
        setSelectedLessonIdx(0);
        setRightDrawerTab("info");
    }

    function duplicatePlan(sourceId: string) {
        const src = plans[sourceId];
        if (!src) return;
        const id = crypto.randomUUID();
        const cloned: ClassPlan = JSON.parse(JSON.stringify(src));
        cloned.Name = `${src.Name || "课表"} - 副本`;
        setPlans((prev) => ({ ...prev, [id]: cloned }));
        setSelectedPlanId(id);
        setSelectedLessonIdx(0);
    }

    function createTempOverlayPlan(sourceId: string) {
        const src = plans[sourceId];
        if (!src) return;
        const id = crypto.randomUUID();
        const overlay: ClassPlan = JSON.parse(JSON.stringify(src));
        overlay.Name = `${src.Name || "课表"} (临时层)`;
        overlay.IsOverlay = true;
        overlay.OverlaySourceId = sourceId;
        overlay.OverlaySetupTime = new Date().toISOString();
        setPlans((prev) => ({ ...prev, [id]: overlay }));
        setSelectedPlanId(id);
        setSelectedLessonIdx(0);
    }

    function removePlan(id: string) {
        setPlans((prev) => {
            const next = { ...prev };
            delete next[id];
            const keys = Object.keys(next);
            if (selectedPlanId === id) {
                setSelectedPlanId(keys[0] || null);
            }
            return next;
        });
    }

    const currentPlan = selectedPlanId ? plans[selectedPlanId] : undefined;
    const currentTlId = currentPlan ? toUpstreamGuidOrEmpty(currentPlan.TimeLayoutId) : EMPTY_GUID;
    const currentTl = !isEmptyGuid(currentTlId) ? timeLayouts[currentTlId] : undefined;
    const currentTlClassTimePoints = (currentTl?.Layouts || []).filter((item) => item.TimeType === 0);

    function updatePlan(patch: Partial<ClassPlan>) {
        if (!selectedPlanId || !currentPlan) return;
        setPlans((prev) => ({
            ...prev,
            [selectedPlanId]: { ...prev[selectedPlanId], ...patch },
        }));
    }

    function handleTimeLayoutChange(newTlIdRaw: string) {
        if (!currentPlan) return;
        const newTlId = toUpstreamGuidOrEmpty(newTlIdRaw);
        const syncedClasses = buildClassesFromTimeLayout(newTlId, currentPlan.Classes);
        updatePlan({ TimeLayoutId: newTlId, Classes: syncedClasses });
    }

    function updateRule(patch: Partial<TimeRule>) {
        if (!currentPlan) return;
        const nextRule: TimeRule = {
            ...(currentPlan.TimeRule || { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 }),
            ...patch,
        };
        if (nextRule.WeekCountDiv > nextRule.WeekCountDivTotal) {
            nextRule.WeekCountDiv = 0;
        }
        updatePlan({ TimeRule: nextRule });
    }

    function selectSubjectForCurrentLesson(subjectIdRaw: string) {
        if (!currentPlan) return;
        const totalSlots = Math.max(currentTlClassTimePoints.length, (currentPlan.Classes || []).length);
        if (totalSlots === 0) return;
        const targetIdx = Math.min(Math.max(0, selectedLessonIdx), totalSlots - 1);
        const normalizedSubId = toUpstreamGuidOrEmpty(subjectIdRaw);

        const baseClasses =
            currentPlan.Classes && currentPlan.Classes.length === totalSlots
                ? [...currentPlan.Classes]
                : buildClassesFromTimeLayout(currentTlId, currentPlan.Classes);

        baseClasses[targetIdx] = {
            ...(baseClasses[targetIdx] || { IsEnabled: true }),
            SubjectId: normalizedSubId,
            IsChangedClass: currentPlan.IsOverlay ? true : baseClasses[targetIdx]?.IsChangedClass,
        };
        updatePlan({ Classes: baseClasses });

        if (autoMoveNext && targetIdx + 1 < totalSlots) {
            setSelectedLessonIdx(targetIdx + 1);
        }
    }

    function updateLessonAt(idx: number, patch: Partial<ClassInfo>) {
        if (!currentPlan) return;
        const totalSlots = Math.max(currentTlClassTimePoints.length, (currentPlan.Classes || []).length);
        const baseClasses =
            currentPlan.Classes && currentPlan.Classes.length === totalSlots
                ? [...currentPlan.Classes]
                : buildClassesFromTimeLayout(currentTlId, currentPlan.Classes);
        if (!baseClasses[idx]) return;
        baseClasses[idx] = { ...baseClasses[idx], ...patch };
        updatePlan({ Classes: baseClasses });
    }

    function addClassSlot() {
        if (!currentPlan) return;
        const next = [
            ...(currentPlan.Classes || []),
            { SubjectId: EMPTY_GUID, IsEnabled: true, IsChangedClass: false },
        ];
        updatePlan({ Classes: next });
        setSelectedLessonIdx(next.length - 1);
    }

    function removeClassSlot(idx: number) {
        if (!currentPlan) return;
        const next = (currentPlan.Classes || []).filter((_, i) => i !== idx);
        updatePlan({ Classes: next });
        setSelectedLessonIdx((prev) => Math.max(0, Math.min(prev, next.length - 1)));
    }

    function addClassPlanGroup() {
        if (!newGroupName.trim()) return;
        const gid = crypto.randomUUID();
        setGroups((prev) => ({
            ...prev,
            [gid]: { Name: newGroupName.trim(), IsGlobal: false },
        }));
        setNewGroupName("");
    }

    // 过滤出非 00000000-0000-0000-0000-000000000000 的真实科目供右侧选课盘渲染
    const validSubjectEntries = Object.entries(subjects).filter(([sid]) => !isEmptyGuid(sid));

    // 按课表群过滤课表列表
    const filteredPlanEntries = Object.entries(plans).filter(([, cp]) => {
        if (groupFilterId === "__ALL__") return true;
        const cpGroup = toUpstreamGuidOrEmpty(cp.AssociatedGroup);
        return cpGroup === groupFilterId;
    });

    if (loading) {
        return <div className="empty-state"><Spinner size="medium" label="加载课表配置中..." /></div>;
    }

    const totalClassSlots = currentPlan
        ? Math.max(currentTlClassTimePoints.length, (currentPlan.Classes || []).length)
        : 0;

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">课表编辑器</h1>
                    <p className="page-subtitle">原位对照 ClassIsland【档案编辑 → 课表】三栏布局：课表与触发规则列表、时间轴课程表、右侧快速选课盘与多周轮换规则</p>
                </div>
                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                    <Button appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>新建课表文件</Button>
                    {selectedFile && (
                        <>
                            <FileHistoryButton
                                accountId={accountId}
                                resourceType="ClassPlan"
                                fileName={selectedFile}
                                onLoadVersion={(content, version, isCurrent) => {
                                    let parsedPlans: ClassPlansData = {};
                                    if (content && typeof content === "object") {
                                        const obj = content as Record<string, unknown>;
                                        if (obj.ClassPlans && typeof obj.ClassPlans === "object") {
                                            parsedPlans = obj.ClassPlans as ClassPlansData;
                                        } else {
                                            parsedPlans = obj as ClassPlansData;
                                        }
                                    }
                                    const normalized = normalizeClassPlansForSave(parsedPlans);
                                    setPlans(normalized);
                                    setJsonText(JSON.stringify(normalized, null, 2));
                                    setSelectedPlanId(Object.keys(normalized)[0] || null);
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
                                defaultFileName={`ClassPlan-${selectedFile}.json`}
                                suggestedNames={[
                                    { label: "具名区分文件", fileName: `ClassPlan-${selectedFile}.json` },
                                    { label: "档案原名", fileName: `${selectedFile}.json` },
                                    { label: "客户端标准资源名", fileName: "ClassPlan.json" },
                                ]}
                                onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : { ClassPlans: plans, ClassPlanGroups: groups })}
                                onError={(text) => setMsg({ type: "error", text })}
                            />
                            <Button
                                icon={<Code24Regular />}
                                appearance={jsonMode ? "primary" : "subtle"}
                                onClick={() => {
                                    if (!jsonMode) setJsonText(JSON.stringify(plans, null, 2));
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

            {/* 顶部课表文件与关联参考库工具条（消除原本四栏并排挤压，完整释放三栏编辑宽度） */}
            <div className="card" style={{ padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>课表文件：</span>
                    {fileList.length === 0 ? (
                        <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>暂无课表文件</span>
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
                                    title="删除此课表文件"
                                />
                            </div>
                        ))
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>参考时间表：</span>
                        <Select size="small" value={selectedTlFile} onChange={(_, d) => loadReferenceTl(d.value)} style={{ width: 140 }}>
                            {tlFileList.length === 0 && <option value="">(无时间表文件)</option>}
                            {tlFileList.map((f) => (
                                <option key={f} value={f}>{f}</option>
                            ))}
                        </Select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>参考科目库：</span>
                        <Select size="small" value={selectedSubFile} onChange={(_, d) => loadReferenceSub(d.value)} style={{ width: 140 }}>
                            {subFileList.length === 0 && <option value="">(无科目文件)</option>}
                            {subFileList.map((f) => (
                                <option key={f} value={f}>{f}</option>
                            ))}
                        </Select>
                    </div>
                </div>
            </div>

            <div>
                {/* 原位三栏课表编辑器 (对应上游 ProfileSettingsWindow ClassPlans Tab) */}
                <div style={{ minWidth: 0 }}>
                    {!selectedFile ? (
                        <div className="card"><div className="empty-state"><div className="empty-state-text">请从上方选择或新建一个课表文件</div></div></div>
                    ) : dataLoading ? (
                        <div className="card"><div className="empty-state"><Spinner size="medium" /></div></div>
                    ) : jsonMode ? (
                        <div className="card">
                            <div className="card-title">JSON 编辑器 — {selectedFile}</div>
                            <div className="json-editor">
                                <textarea
                                    value={jsonText}
                                    onChange={(e) => setJsonText(e.target.value)}
                                    style={{ minHeight: 520 }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="classplan-3col-grid">
                            {/* ── 第一栏：课表群筛选 + 课表列表（含上游触发规则与时间表徽标） ── */}
                            <div className="card" style={{ padding: 14, marginBottom: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <Select
                                        size="small"
                                        value={groupFilterId}
                                        onChange={(_, d) => setGroupFilterId(d.value)}
                                        style={{ flex: 1 }}
                                    >
                                        <option value="__ALL__">全部课表群 ({Object.keys(plans).length})</option>
                                        {Object.entries(groups).map(([gid, g]) => (
                                            <option key={gid} value={gid}>
                                                课表群: {g.Name || (isEmptyGuid(gid) ? "默认" : gid.slice(0, 6))}
                                            </option>
                                        ))}
                                    </Select>
                                </div>

                                <div style={{ display: "flex", gap: 6 }}>
                                    <Button size="small" appearance="primary" icon={<Add24Regular />} onClick={addPlan} style={{ flex: 1 }}>
                                        添加课表
                                    </Button>
                                    {selectedPlanId && (
                                        <Button size="small" icon={<Copy24Regular />} onClick={() => duplicatePlan(selectedPlanId)} title="复制当前选中课表">
                                            复制
                                        </Button>
                                    )}
                                </div>

                                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 520, overflowY: "auto" }}>
                                    {filteredPlanEntries.length === 0 ? (
                                        <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: 12, textAlign: "center" }}>
                                            当前筛选下暂无课表
                                        </div>
                                    ) : (
                                        filteredPlanEntries.map(([id, cp]) => {
                                            const isSelected = selectedPlanId === id;
                                            const tlId = toUpstreamGuidOrEmpty(cp.TimeLayoutId);
                                            const tlObj = !isEmptyGuid(tlId) ? timeLayouts[tlId] : undefined;
                                            const div = cp.TimeRule?.WeekCountDiv ?? 0;
                                            const total = cp.TimeRule?.WeekCountDivTotal ?? 2;
                                            const weekDayLabel = WEEKDAY_LABELS[cp.TimeRule?.WeekDay ?? 1] || "周一";

                                            return (
                                                <div
                                                    key={id}
                                                    className={`sidebar-link ${isSelected ? "active" : ""}`}
                                                    onClick={() => {
                                                        setSelectedPlanId(id);
                                                        setSelectedLessonIdx(0);
                                                    }}
                                                    style={{
                                                        flexDirection: "column",
                                                        alignItems: "stretch",
                                                        gap: 6,
                                                        padding: "9px 10px",
                                                        border: isSelected ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                    }}
                                                >
                                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                                                        <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {cp.Name || "未命名课表"}
                                                        </span>
                                                        {cp.IsOverlay && (
                                                            <span className="badge badge-info" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                临时层
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* 上游风格胶囊标签行：触发星期 + 多周轮换 + 时间表名称 */}
                                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                                                        {cp.IsEnabled === false ? (
                                                            <span className="badge badge-danger" style={{ fontSize: 10, padding: "1px 6px", gap: 3 }}>
                                                                <Prohibited16Regular style={{ width: 11, height: 11 }} />
                                                                不自动启用
                                                            </span>
                                                        ) : (
                                                            <>
                                                                <span className="badge badge-info" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                    {weekDayLabel}
                                                                </span>
                                                                {div > 0 && (
                                                                    <span className="badge badge-warning" style={{ fontSize: 10, padding: "1px 6px" }}>
                                                                        {div}/{total}周
                                                                    </span>
                                                                )}
                                                            </>
                                                        )}
                                                        <span
                                                            className={`badge ${isEmptyGuid(tlId) || !tlObj ? "badge-warning" : ""}`}
                                                            style={{
                                                                fontSize: 10,
                                                                padding: "1px 6px",
                                                                gap: 3,
                                                                background: !(isEmptyGuid(tlId) || !tlObj) ? "var(--bg-subtle)" : undefined,
                                                                color: !(isEmptyGuid(tlId) || !tlObj) ? "var(--text-secondary)" : undefined,
                                                            }}
                                                        >
                                                            <Clock16Regular style={{ width: 11, height: 11 }} />
                                                            {isEmptyGuid(tlId) ? "未设置时间表" : (tlObj?.Name || "未知时间表")}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* ── 第二栏（中间）：课表工具栏 + 状态提示栏 + 课程时间轴表格 ── */}
                            {!currentPlan ? (
                                <div className="card"><div className="empty-state"><div className="empty-state-text">请从左侧选择或添加一个课表</div></div></div>
                            ) : (
                                <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                    {/* 顶部 CommandBar (对应上游课表顶部工具栏) */}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, borderBottom: "1px solid var(--border-color)", paddingBottom: 10 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontWeight: 700, fontSize: 15 }}>{currentPlan.Name || "未命名课表"}</span>
                                            <Button
                                                size="small"
                                                icon={<Settings24Regular />}
                                                appearance={rightDrawerTab === "info" ? "primary" : "secondary"}
                                                onClick={() => setRightDrawerTab("info")}
                                            >
                                                课表信息与触发规则
                                            </Button>
                                            {!currentPlan.IsOverlay && (
                                                <Button
                                                    size="small"
                                                    icon={<Layer24Regular />}
                                                    onClick={() => selectedPlanId && createTempOverlayPlan(selectedPlanId)}
                                                    title="基于此课表创建临时换课层"
                                                >
                                                    创建临时层
                                                </Button>
                                            )}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <Switch checked={showBreaks} onChange={(_, d) => setShowBreaks(d.checked)} />
                                                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>显示课间/行动时间点</span>
                                            </div>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<Delete24Regular />}
                                                onClick={() => selectedPlanId && removePlan(selectedPlanId)}
                                                style={{ color: "var(--danger-color)" }}
                                            >
                                                删除课表
                                            </Button>
                                        </div>
                                    </div>

                                    {/* 时间表未设置提醒条 (对应上游 InfoBar) */}
                                    {isEmptyGuid(currentTlId) && (
                                        <MessageBar intent="warning">
                                            <MessageBarBody>
                                                此课表尚未关联时间表。请在右侧「课表信息」中选择一个有效的时间表，以便对齐每日上课时间点。
                                            </MessageBarBody>
                                        </MessageBar>
                                    )}
                                    {!isEmptyGuid(currentTlId) && !currentTl && (
                                        <MessageBar intent="warning">
                                            <MessageBarBody>
                                                此课表关联的时间表在当前参考时间表文件「{selectedTlFile}」中不存在，请切换左侧参考时间表文件或重新绑定时间表。
                                            </MessageBarBody>
                                        </MessageBar>
                                    )}
                                    {currentPlan.IsOverlay && (
                                        <MessageBar intent="info">
                                            <MessageBarBody>
                                                当前课表为<strong>临时层课表</strong>，将在预定日期覆盖原课表并在过期后自动清除。
                                            </MessageBarBody>
                                        </MessageBar>
                                    )}

                                    {/* 课程表主网格 (对应上游 DataGrid: 启用 | 时间 | 科目) */}
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        {totalClassSlots === 0 && (!showBreaks || (currentTl?.Layouts || []).length === 0) ? (
                                            <div className="empty-state" style={{ padding: 28 }}>
                                                <div className="empty-state-text">当前课表暂无课程节次，请先绑定时间表或点击下方「手动添加节次」</div>
                                            </div>
                                        ) : showBreaks && currentTl ? (
                                            // 混排展示时间表所有时间点（上课 + 课间 + 分割线 + 行动）
                                            (() => {
                                                let lessonCounter = -1;
                                                return (currentTl.Layouts || []).map((tlItem, rawIdx) => {
                                                    if (tlItem.TimeType !== 0) {
                                                        return (
                                                            <div
                                                                key={`nonclass-${rawIdx}`}
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    justifyContent: "space-between",
                                                                    padding: "6px 12px",
                                                                    borderRadius: 6,
                                                                    background: "var(--bg-subtle)",
                                                                    borderLeft: tlItem.TimeType === 3 ? "3px solid var(--warning-color)" : "3px solid var(--success-color)",
                                                                    fontSize: 12,
                                                                    color: "var(--text-secondary)",
                                                                }}
                                                            >
                                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                                                    {tlItem.TimeType === 2 ? (
                                                                        "── 分割线 ──"
                                                                    ) : tlItem.TimeType === 1 ? (
                                                                        `${formatItemTime(tlItem)} · ${tlItem.BreakName || "课间休息"}`
                                                                    ) : (
                                                                        <>
                                                                            {formatItemTime(tlItem)} ·
                                                                            <Flash16Regular style={{ color: "var(--warning-color)" }} />
                                                                            行动 ({tlItem.ActionSet?.Name || "行动时间点"})
                                                                        </>
                                                                    )}
                                                                </span>
                                                                <span>{TIME_TYPE_LABELS[tlItem.TimeType]}</span>
                                                            </div>
                                                        );
                                                    }
                                                    lessonCounter++;
                                                    const cIdx = lessonCounter;
                                                    const ci: ClassInfo = currentPlan.Classes?.[cIdx] || {
                                                        SubjectId: toUpstreamGuidOrEmpty(tlItem.DefaultClassId),
                                                        IsEnabled: true,
                                                    };
                                                    const isRowSelected = selectedLessonIdx === cIdx;
                                                    const subId = toUpstreamGuidOrEmpty(ci.SubjectId);
                                                    const isEmptySub = isEmptyGuid(subId);
                                                    const subObj = !isEmptySub ? subjects[subId] : undefined;

                                                    return (
                                                        <div
                                                            key={`lesson-${cIdx}`}
                                                            onClick={() => {
                                                                setSelectedLessonIdx(cIdx);
                                                                setRightDrawerTab("subject");
                                                            }}
                                                            style={{
                                                                display: "grid",
                                                                gridTemplateColumns: "46px auto 1fr auto",
                                                                alignItems: "center",
                                                                gap: 8,
                                                                padding: "8px 10px",
                                                                borderRadius: 8,
                                                                border: isRowSelected ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                                background: isRowSelected ? "var(--bg-accent-subtle)" : "var(--bg-card)",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                                <Switch
                                                                    checked={ci.IsEnabled !== false}
                                                                    onChange={(_, d) => updateLessonAt(cIdx, { IsEnabled: d.checked })}
                                                                />
                                                            </div>
                                                            <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                                                第{cIdx + 1}节 {formatItemTime(tlItem)}
                                                            </div>
                                                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                                <span
                                                                    style={{
                                                                        display: "inline-flex",
                                                                        alignItems: "center",
                                                                        justifyContent: "center",
                                                                        width: 26,
                                                                        height: 26,
                                                                        flexShrink: 0,
                                                                        borderRadius: 6,
                                                                        background: isEmptySub ? "var(--bg-subtle)" : "var(--accent-color)",
                                                                        color: isEmptySub ? "var(--text-secondary)" : "#ffffff",
                                                                        border: isEmptySub ? "1px solid var(--border-color)" : "none",
                                                                        fontWeight: 700,
                                                                        fontSize: 12,
                                                                    }}
                                                                >
                                                                    {isEmptySub ? "空" : (subObj?.Initial || subObj?.Name?.[0] || "?")}
                                                                </span>
                                                                <span style={{ fontWeight: isEmptySub ? 400 : 600, color: isEmptySub ? "var(--text-tertiary)" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                                    {isEmptySub ? "（未设置科目）" : (subObj?.Name || `未知科目`)}
                                                                </span>
                                                                {subObj?.TeacherName && (
                                                                    <span style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                                                        ({subObj.TeacherName})
                                                                    </span>
                                                                )}
                                                                {ci.IsChangedClass && (
                                                                    <span className="badge badge-warning" style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}>
                                                                        换课
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div onClick={(e) => e.stopPropagation()}>
                                                                {!isEmptySub && (
                                                                    <Button
                                                                        size="small"
                                                                        appearance="subtle"
                                                                        onClick={() => updateLessonAt(cIdx, { SubjectId: EMPTY_GUID })}
                                                                        title="将此节设为空科目"
                                                                    >
                                                                        置空
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()
                                        ) : (
                                            // 标准仅展示上课节次模式 (与上游默认视图一致)
                                            Array.from({ length: totalClassSlots }).map((_, cIdx) => {
                                                const tlItem = currentTlClassTimePoints[cIdx];
                                                const ci: ClassInfo = currentPlan.Classes?.[cIdx] || {
                                                    SubjectId: toUpstreamGuidOrEmpty(tlItem?.DefaultClassId),
                                                    IsEnabled: true,
                                                };
                                                const isRowSelected = selectedLessonIdx === cIdx;
                                                const subId = toUpstreamGuidOrEmpty(ci.SubjectId);
                                                const isEmptySub = isEmptyGuid(subId);
                                                const subObj = !isEmptySub ? subjects[subId] : undefined;

                                                return (
                                                    <div
                                                        key={cIdx}
                                                        onClick={() => {
                                                            setSelectedLessonIdx(cIdx);
                                                            setRightDrawerTab("subject");
                                                        }}
                                                        style={{
                                                            display: "grid",
                                                            gridTemplateColumns: "46px auto 1fr auto",
                                                            alignItems: "center",
                                                            gap: 8,
                                                            padding: "8px 10px",
                                                            borderRadius: 8,
                                                            border: isRowSelected ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                            background: isRowSelected ? "var(--bg-accent-subtle)" : "var(--bg-card)",
                                                            cursor: "pointer",
                                                            opacity: ci.IsEnabled === false ? 0.55 : 1,
                                                        }}
                                                    >
                                                        <div onClick={(e) => e.stopPropagation()} title="是否启用本节课">
                                                            <Switch
                                                                checked={ci.IsEnabled !== false}
                                                                onChange={(_, d) => updateLessonAt(cIdx, { IsEnabled: d.checked })}
                                                            />
                                                        </div>
                                                        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                                            第{cIdx + 1}节 {tlItem ? formatItemTime(tlItem) : ""}
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                            <span
                                                                style={{
                                                                    display: "inline-flex",
                                                                    alignItems: "center",
                                                                    justifyContent: "center",
                                                                    width: 26,
                                                                    height: 26,
                                                                    flexShrink: 0,
                                                                    borderRadius: 6,
                                                                    background: isEmptySub ? "var(--bg-subtle)" : "var(--accent-color)",
                                                                    color: isEmptySub ? "var(--text-secondary)" : "#ffffff",
                                                                    border: isEmptySub ? "1px solid var(--border-color)" : "none",
                                                                    fontWeight: 700,
                                                                    fontSize: 12,
                                                                }}
                                                            >
                                                                {isEmptySub ? "空" : (subObj?.Initial || subObj?.Name?.[0] || "?")}
                                                            </span>
                                                            <span style={{ fontWeight: isEmptySub ? 400 : 600, color: isEmptySub ? "var(--text-tertiary)" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                                {isEmptySub ? "（未设置科目）" : (subObj?.Name || `未知科目`)}
                                                            </span>
                                                            {subObj?.TeacherName && (
                                                                <span style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                                                    ({subObj.TeacherName})
                                                                </span>
                                                            )}
                                                            {ci.IsChangedClass && (
                                                                <span className="badge badge-warning" style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}>
                                                                    换课
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                                                            {!isEmptySub && (
                                                                <Button
                                                                    size="small"
                                                                    appearance="subtle"
                                                                    onClick={() => updateLessonAt(cIdx, { SubjectId: EMPTY_GUID })}
                                                                    title="将此节设为空科目"
                                                                >
                                                                    置空
                                                                </Button>
                                                            )}
                                                            {currentTlClassTimePoints.length === 0 && (
                                                                <Button
                                                                    size="small"
                                                                    appearance="subtle"
                                                                    icon={<Delete24Regular />}
                                                                    onClick={() => removeClassSlot(cIdx)}
                                                                    style={{ color: "var(--danger-color)" }}
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {/* 底部辅助操作栏 */}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                                        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                                            提示：点击任意节次后，在右侧「编辑科目」面板点击科目简称即可填入
                                        </span>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            {!isEmptyGuid(currentTlId) && currentTl && (
                                                <Button
                                                    size="small"
                                                    onClick={() =>
                                                        updatePlan({
                                                            Classes: buildClassesFromTimeLayout(currentTlId, currentPlan.Classes),
                                                        })
                                                    }
                                                >
                                                    按时间表同步节数 ({currentTlClassTimePoints.length} 节)
                                                </Button>
                                            )}
                                            <Button size="small" icon={<Add24Regular />} onClick={addClassSlot}>
                                                手动添加节次
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── 第三栏（右侧）：原位对照上游 TabControl（编辑科目选课盘 / 课表详细信息与 TimeRuleEditControl） ── */}
                            <div className="card" style={{ padding: 16, marginBottom: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
                                    <Button
                                        size="small"
                                        icon={<BookOpen24Regular />}
                                        appearance={rightDrawerTab === "subject" ? "primary" : "subtle"}
                                        onClick={() => setRightDrawerTab("subject")}
                                        style={{ flex: 1 }}
                                    >
                                        编辑科目
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<ClipboardTextLtr24Regular />}
                                        appearance={rightDrawerTab === "info" ? "primary" : "subtle"}
                                        onClick={() => setRightDrawerTab("info")}
                                        style={{ flex: 1 }}
                                    >
                                        课表信息
                                    </Button>
                                </div>

                                {!currentPlan ? (
                                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", textAlign: "center", padding: 20 }}>
                                        未选择课表
                                    </div>
                                ) : rightDrawerTab === "subject" ? (
                                    /* 右侧面板 1：原位复刻上游科目简称网格选课盘 + 选完自动下一节 */
                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                                                正在编辑：第 {selectedLessonIdx + 1} 节课
                                            </span>
                                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                                共 {totalClassSlots} 节
                                            </span>
                                        </div>

                                        {/* 特殊 00000000-0000-0000-0000-000000000000 空科目快捷砖块 */}
                                        <div
                                            onClick={() => selectSubjectForCurrentLesson(EMPTY_GUID)}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                padding: "8px 12px",
                                                borderRadius: 8,
                                                border: isEmptyGuid(currentPlan.Classes?.[selectedLessonIdx]?.SubjectId)
                                                    ? "1.5px solid var(--accent-color)"
                                                    : "1px dashed var(--border-color)",
                                                background: isEmptyGuid(currentPlan.Classes?.[selectedLessonIdx]?.SubjectId)
                                                    ? "var(--bg-accent-subtle)"
                                                    : "var(--bg-subtle)",
                                                cursor: "pointer",
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <span
                                                    style={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: 6,
                                                        background: "var(--bg-card)",
                                                        border: "1px solid var(--border-color)",
                                                        color: "var(--text-secondary)",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontWeight: 700,
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    空
                                                </span>
                                                <div>
                                                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>（空 / 未设置科目）</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                                                        点击将当前节次设为空课程
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 上游科目简称宫格 (ListBoxSubjects WrapPanel) */}
                                        <div
                                            style={{
                                                display: "grid",
                                                gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
                                                gap: 8,
                                                maxHeight: 380,
                                                overflowY: "auto",
                                                padding: 2,
                                            }}
                                        >
                                            {validSubjectEntries.map(([sid, sub]) => {
                                                const activeSubId = toUpstreamGuidOrEmpty(currentPlan.Classes?.[selectedLessonIdx]?.SubjectId);
                                                const isCurrentSub = activeSubId === sid;
                                                return (
                                                    <div
                                                        key={sid}
                                                        onClick={() => selectSubjectForCurrentLesson(sid)}
                                                        style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            padding: "10px 6px",
                                                            borderRadius: 8,
                                                            border: isCurrentSub ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                            background: isCurrentSub ? "var(--bg-accent-subtle)" : "var(--bg-subtle)",
                                                            cursor: "pointer",
                                                            textAlign: "center",
                                                            gap: 2,
                                                        }}
                                                        title={`${sub.Name}${sub.TeacherName ? ` (${sub.TeacherName})` : ""}`}
                                                    >
                                                        <span style={{ fontSize: 18, fontWeight: 700, color: isCurrentSub ? "var(--accent-color)" : "var(--text-primary)" }}>
                                                            {sub.Initial || sub.Name?.[0] || "?"}
                                                        </span>
                                                        <span style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                                            {sub.Name}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* 底部：选完科目自动移动到下一个课程 (对应上游 CheckBox) */}
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                            <span style={{ fontSize: 12.5 }}>选完科目自动移动到下一个课程</span>
                                            <Switch checked={autoMoveNext} onChange={(_, d) => setAutoMoveNext(d.checked)} />
                                        </div>
                                    </div>
                                ) : (
                                    /* 右侧面板 2：原位复刻上游 ClassPlansInfoEditor + TimeRuleEditControl */
                                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">课表名称</label>
                                            <Input
                                                value={currentPlan.Name || ""}
                                                onChange={(_, d) => updatePlan({ Name: d.value })}
                                            />
                                        </div>

                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">使用的时间表</label>
                                            <Select
                                                value={currentTlId}
                                                onChange={(_, d) => handleTimeLayoutChange(d.value)}
                                            >
                                                <option value={EMPTY_GUID}>（未设置时间表）</option>
                                                {Object.entries(timeLayouts).map(([tlId, tl]) => (
                                                    <option key={tlId} value={tlId}>
                                                        {tl.Name || tlId.slice(0, 8)}
                                                    </option>
                                                ))}
                                                {!isEmptyGuid(currentTlId) && !timeLayouts[currentTlId] && (
                                                    <option value={currentTlId}>未知时间表</option>
                                                )}
                                            </Select>
                                        </div>

                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">所属课表群</label>
                                            <Select
                                                value={toUpstreamGuidOrEmpty(currentPlan.AssociatedGroup)}
                                                onChange={(_, d) => updatePlan({ AssociatedGroup: toUpstreamGuidOrEmpty(d.value) })}
                                            >
                                                <option value={EMPTY_GUID}>默认课表群</option>
                                                {Object.entries(groups)
                                                    .filter(([gid]) => !isEmptyGuid(gid))
                                                    .map(([gid, g]) => (
                                                        <option key={gid} value={gid}>{g.Name}</option>
                                                    ))}
                                            </Select>
                                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                                <Input
                                                    size="small"
                                                    value={newGroupName}
                                                    onChange={(_, d) => setNewGroupName(d.value)}
                                                    placeholder="新建课表群名称..."
                                                    style={{ flex: 1 }}
                                                />
                                                <Button size="small" icon={<Add24Regular />} onClick={addClassPlanGroup} disabled={!newGroupName.trim()}>
                                                    新建群
                                                </Button>
                                            </div>
                                        </div>

                                        {!currentPlan.IsOverlay && (
                                            <>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: 13 }}>自动启用此课表</div>
                                                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>按下方时间规则自动加载该课表</div>
                                                    </div>
                                                    <Switch
                                                        checked={currentPlan.IsEnabled !== false}
                                                        onChange={(_, d) => updatePlan({ IsEnabled: d.checked })}
                                                    />
                                                </div>

                                                {/* 原位复刻上游 TimeRuleEditControl: 星期 7 列胶囊 + 每 N 周的第 k 周 */}
                                                {currentPlan.IsEnabled !== false && (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border-color)" }}>
                                                        <div style={{ fontSize: 12, fontWeight: 600 }}>触发规则</div>

                                                        <div>
                                                            <label className="form-label" style={{ fontSize: 11 }}>每周启用星期</label>
                                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                                                                {WEEKDAY_LABELS.map((label, dayIdx) => {
                                                                    const isDaySelected = (currentPlan.TimeRule?.WeekDay ?? 1) === dayIdx;
                                                                    return (
                                                                        <button
                                                                            key={dayIdx}
                                                                            type="button"
                                                                            onClick={() => updateRule({ WeekDay: dayIdx })}
                                                                            style={{
                                                                                padding: "6px 0",
                                                                                borderRadius: 6,
                                                                                border: isDaySelected ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                                                background: isDaySelected ? "var(--accent-color)" : "var(--bg-card)",
                                                                                color: isDaySelected ? "#ffffff" : "var(--text-primary)",
                                                                                fontWeight: isDaySelected ? 700 : 500,
                                                                                fontSize: 11.5,
                                                                                cursor: "pointer",
                                                                            }}
                                                                        >
                                                                            {label.replace("周", "")}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                            <div>
                                                                <label className="form-label" style={{ fontSize: 11 }}>轮换周期总周数</label>
                                                                <Select
                                                                    size="small"
                                                                    value={String(currentPlan.TimeRule?.WeekCountDivTotal ?? 2)}
                                                                    onChange={(_, d) => updateRule({ WeekCountDivTotal: parseInt(d.value, 10) })}
                                                                >
                                                                    <option value="2">每 2 周 (单双周)</option>
                                                                    <option value="3">每 3 周</option>
                                                                    <option value="4">每 4 周</option>
                                                                    <option value="5">每 5 周</option>
                                                                </Select>
                                                            </div>
                                                            <div>
                                                                <label className="form-label" style={{ fontSize: 11 }}>第几周生效</label>
                                                                <Select
                                                                    size="small"
                                                                    value={String(currentPlan.TimeRule?.WeekCountDiv ?? 0)}
                                                                    onChange={(_, d) => updateRule({ WeekCountDiv: parseInt(d.value, 10) })}
                                                                >
                                                                    <option value="0">每周均启用 (不轮换)</option>
                                                                    {Array.from({ length: currentPlan.TimeRule?.WeekCountDivTotal ?? 2 }).map((_, idx) => (
                                                                        <option key={idx + 1} value={String(idx + 1)}>
                                                                            第 {idx + 1} 周 {(currentPlan.TimeRule?.WeekCountDivTotal ?? 2) === 2 ? (idx === 0 ? "(单周)" : "(双周)") : ""}
                                                                        </option>
                                                                    ))}
                                                                </Select>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={showCreate} onOpenChange={(_, d) => setShowCreate(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>新建课表配置文件</DialogTitle>
                        <DialogContent>
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label className="form-label">文件名称</label>
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
