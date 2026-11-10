"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type {
    ClassPlan,
    ClassInfo,
    ClassPlanGroup,
    Subject,
    TimeLayout,
    TimeLayoutItem,
    TimeRule,
    AttachedObjectsMap,
} from "@/lib/types";
import {
    WEEKDAY_LABELS,
    WEEK_DIV_LABELS,
    EMPTY_GUID,
    GLOBAL_CLASSPLAN_GROUP_GUID,
    DEFAULT_CLASSPLAN_GROUP_GUID,
    normalizeGuidKey,
} from "@/lib/types";
import {
    Button, Input, Switch, Spinner,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { Select } from "@/components/CustomSelect";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    Code24Regular, Copy24Regular, Settings24Regular, Layer24Regular,
    Dismiss24Regular, ArrowLeft24Regular, Checkmark16Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

interface ClassPlanFileWrapper {
    ClassPlans: Record<string, ClassPlan>;
    ClassPlanGroups?: Record<string, ClassPlanGroup>;
    SelectedClassPlanGroupId?: string;
    IsOverlayClassPlanEnabled?: boolean;
    OverlayClassPlanId?: string | null;
    TempClassPlanId?: string | null;
    TempClassPlanSetupTime?: string;
}

function normalizeTimeStr(val?: string): string {
    if (!val) return "08:00";
    if (val.includes("T")) {
        const timePart = val.split("T")[1] || "08:00:00";
        return timePart.slice(0, 5);
    }
    return val.slice(0, 5);
}

function formatRuleBadge(rule?: TimeRule): string {
    if (!rule) return "不启用";
    const dayLabel = WEEKDAY_LABELS[rule.WeekDay] ?? `周${rule.WeekDay}`;
    const divTotal = rule.WeekCountDivTotal ?? 2;
    const div = rule.WeekCountDiv ?? 0;
    if (div === 0) return dayLabel;
    if (divTotal === 2 && (div === 1 || div === 2)) {
        return `${dayLabel} · ${WEEK_DIV_LABELS[div]}`;
    }
    return `${dayLabel} · ${div}/${divTotal}周`;
}

export default function ClassPlanPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [plans, setPlans] = useState<Record<string, ClassPlan>>({});
    const [classPlanGroups, setClassPlanGroups] = useState<Record<string, ClassPlanGroup>>({
        [GLOBAL_CLASSPLAN_GROUP_GUID]: { Name: "全局课表群", IsGlobal: true },
        [DEFAULT_CLASSPLAN_GROUP_GUID]: { Name: "默认课表群", IsGlobal: false },
    });
    const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>("all");
    const [newGroupName, setNewGroupName] = useState<string>("");
    const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);

    const [subjectsFiles, setSubjectsFiles] = useState<string[]>([]);
    const [selectedSubjectsFile, setSelectedSubjectsFile] = useState<string>("");
    const [subjectsMap, setSubjectsMap] = useState<Record<string, Subject>>({});

    const [timeLayoutFiles, setTimeLayoutFiles] = useState<string[]>([]);
    const [selectedTimeLayoutFile, setSelectedTimeLayoutFile] = useState<string>("");
    const [timeLayoutsMap, setTimeLayoutsMap] = useState<Record<string, TimeLayout>>({});

    const [selectedLessonIndex, setSelectedLessonIndex] = useState<number>(-1);
    const [rightTab, setRightTab] = useState<"subjects" | "copy" | "details">("subjects");
    const [copySourcePlanKey, setCopySourcePlanKey] = useState<string>("");
    const [showBreaksInSchedule, setShowBreaksInSchedule] = useState<boolean>(false);
    const [autoMoveNext, setAutoMoveNext] = useState<boolean>(true);
    const [showRefModal, setShowRefModal] = useState<boolean>(false);

    // 移动设备三级层级：1=文件与课表列表, 2=课表编辑区, 3=右侧面板（选择科目/复制课表/课表设置）
    const [mobileLayer, setMobileLayer] = useState<1 | 2 | 3>(1);

    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");

    const loadSubjectsFile = useCallback(async (fileName: string) => {
        if (!accountId || !fileName) {
            setSubjectsMap({});
            return;
        }
        try {
            const raw = await data.read(accountId, "Subjects", fileName);
            if (raw && typeof raw === "object") {
                const obj = raw as Record<string, unknown>;
                const map = (obj.Subjects && typeof obj.Subjects === "object"
                    ? obj.Subjects
                    : obj) as Record<string, Subject>;
                setSubjectsMap(map || {});
            } else {
                setSubjectsMap({});
            }
        } catch {
            setSubjectsMap({});
        }
    }, [accountId]);

    const loadTimeLayoutFile = useCallback(async (fileName: string) => {
        if (!accountId || !fileName) {
            setTimeLayoutsMap({});
            return;
        }
        try {
            const raw = await data.read(accountId, "TimeLayout", fileName);
            if (raw && typeof raw === "object") {
                const obj = raw as Record<string, unknown>;
                const map = (obj.TimeLayouts && typeof obj.TimeLayouts === "object"
                    ? obj.TimeLayouts
                    : obj) as Record<string, TimeLayout>;
                setTimeLayoutsMap(map || {});
            } else {
                setTimeLayoutsMap({});
            }
        } catch {
            setTimeLayoutsMap({});
        }
    }, [accountId]);

    const selectFile = useCallback(async (name: string) => {
        if (!accountId) return;
        setSelectedFile(name);
        setDataLoading(true);
        try {
            const content = await data.read(accountId, "ClassPlan", name);
            let parsedPlans: Record<string, ClassPlan> = {};
            let parsedGroups: Record<string, ClassPlanGroup> = {
                [GLOBAL_CLASSPLAN_GROUP_GUID]: { Name: "全局课表群", IsGlobal: true },
                [DEFAULT_CLASSPLAN_GROUP_GUID]: { Name: "默认课表群", IsGlobal: false },
            };
            if (content && typeof content === "object") {
                const obj = content as Record<string, unknown>;
                if (obj.ClassPlans && typeof obj.ClassPlans === "object") {
                    parsedPlans = obj.ClassPlans as Record<string, ClassPlan>;
                } else {
                    parsedPlans = obj as Record<string, ClassPlan>;
                }
                if (obj.ClassPlanGroups && typeof obj.ClassPlanGroups === "object") {
                    parsedGroups = {
                        ...parsedGroups,
                        ...(obj.ClassPlanGroups as Record<string, ClassPlanGroup>),
                    };
                }
            }
            setPlans(parsedPlans);
            setClassPlanGroups(parsedGroups);
            setJsonText(JSON.stringify({ ClassPlans: parsedPlans, ClassPlanGroups: parsedGroups }, null, 2));
            const keys = Object.keys(parsedPlans);
            setSelectedPlanKey(keys.length > 0 ? keys[0] : null);
            setSelectedLessonIndex(0);
        } catch {
            setPlans({});
            setJsonText("{}");
            setSelectedPlanKey(null);
        }
        setDataLoading(false);
    }, [accountId]);

    const loadAll = useCallback(async () => {
        if (!accountId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [cpFiles, subFiles, tlFiles] = await Promise.all([
                data.list(accountId, "ClassPlan").catch(() => [] as string[]),
                data.list(accountId, "Subjects").catch(() => [] as string[]),
                data.list(accountId, "TimeLayout").catch(() => [] as string[]),
            ]);
            const cpArr = Array.isArray(cpFiles) ? cpFiles : [];
            const subArr = Array.isArray(subFiles) ? subFiles : [];
            const tlArr = Array.isArray(tlFiles) ? tlFiles : [];

            setFileList(cpArr);
            setSubjectsFiles(subArr);
            setTimeLayoutFiles(tlArr);

            if (subArr.length > 0) {
                const subTarget = selectedSubjectsFile && subArr.includes(selectedSubjectsFile) ? selectedSubjectsFile : subArr[0];
                setSelectedSubjectsFile(subTarget);
                await loadSubjectsFile(subTarget);
            }
            if (tlArr.length > 0) {
                const tlTarget = selectedTimeLayoutFile && tlArr.includes(selectedTimeLayoutFile) ? selectedTimeLayoutFile : tlArr[0];
                setSelectedTimeLayoutFile(tlTarget);
                await loadTimeLayoutFile(tlTarget);
            }
            if (cpArr.length > 0 && (!selectedFile || !cpArr.includes(selectedFile))) {
                await selectFile(cpArr[0]);
            }
        } finally {
            setLoading(false);
        }
    }, [accountId, selectFile, loadSubjectsFile, loadTimeLayoutFile]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    useEffect(() => {
        if (!selectedPlanKey) return;
        const plan = plans[selectedPlanKey];
        if (!plan) return;
        const tlId = plan.TimeLayoutId;
        if (!tlId || isEmptyOrMissingLayout(tlId, timeLayoutsMap)) return;

        const targetLayout = findByGuid(timeLayoutsMap, tlId);
        const rawSegs = targetLayout?.Layouts || [];
        const classSegs = rawSegs.filter((s) => s.TimeType === 0);
        if (classSegs.length === 0) return;

        const currentClasses = plan.Classes || [];
        if (currentClasses.length === classSegs.length) return;

        const aligned: ClassInfo[] = classSegs.map((seg, idx) => {
            const existing = currentClasses[idx];
            if (existing) return existing;
            return {
                SubjectId: seg.DefaultClassId && !isEmptyGuidStr(seg.DefaultClassId) ? seg.DefaultClassId : EMPTY_GUID,
                IsChangedClass: false,
                IsEnabled: true,
                AttachedObjects: {},
            };
        });

        setPlans((prev) => ({
            ...prev,
            [selectedPlanKey]: {
                ...prev[selectedPlanKey],
                Classes: aligned,
            },
        }));
    }, [selectedPlanKey, plans[selectedPlanKey || ""]?.TimeLayoutId, timeLayoutsMap]); // eslint-disable-line react-hooks/exhaustive-deps

    function isEmptyGuidStr(id?: string): boolean {
        return !id || normalizeGuidKey(id) === normalizeGuidKey(EMPTY_GUID);
    }

    function findByGuid<T>(map: Record<string, T>, id?: string): T | undefined {
        if (!id) return undefined;
        if (map[id]) return map[id];
        const norm = normalizeGuidKey(id);
        for (const [k, v] of Object.entries(map)) {
            if (normalizeGuidKey(k) === norm) return v;
        }
        return undefined;
    }

    function isEmptyOrMissingLayout(id: string, map: Record<string, TimeLayout>): boolean {
        if (isEmptyGuidStr(id)) return true;
        return !findByGuid(map, id);
    }

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave: ClassPlanFileWrapper = {
                ClassPlans: plans,
                ClassPlanGroups: classPlanGroups,
            };
            if (jsonMode) {
                const parsed = JSON.parse(jsonText);
                if (parsed && typeof parsed === "object" && "ClassPlans" in parsed) {
                    payloadToSave = parsed as ClassPlanFileWrapper;
                    setPlans(payloadToSave.ClassPlans || {});
                    if (payloadToSave.ClassPlanGroups) {
                        setClassPlanGroups(payloadToSave.ClassPlanGroups);
                    }
                } else {
                    payloadToSave = { ClassPlans: parsed as Record<string, ClassPlan>, ClassPlanGroups: classPlanGroups };
                    setPlans(parsed as Record<string, ClassPlan>);
                }
            } else {
                setJsonText(JSON.stringify(payloadToSave, null, 2));
            }
            await data.write(accountId, "ClassPlan", selectedFile, payloadToSave);
            setMsg({ type: "success", text: "课表配置已保存" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查格式" });
        }
        setSaving(false);
    }

    async function handleCreate() {
        if (!newFileName.trim()) return;
        try {
            await data.create(accountId, "ClassPlan", newFileName.trim());
            setShowCreate(false);
            setNewFileName("");
            const list = await data.list(accountId, "ClassPlan");
            const arr = Array.isArray(list) ? list : [];
            setFileList(arr);
            selectFile(newFileName.trim());
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDelete(name: string) {
        try {
            await data.deleteData(accountId, "ClassPlan", name);
            if (selectedFile === name) {
                setSelectedFile(null);
                setPlans({});
                setSelectedPlanKey(null);
            }
            const list = await data.list(accountId, "ClassPlan");
            setFileList(Array.isArray(list) ? list : []);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    const currentPlan: ClassPlan | undefined = selectedPlanKey ? plans[selectedPlanKey] : undefined;

    function updateCurrentPlan(patch: Partial<ClassPlan>) {
        if (!selectedPlanKey || !currentPlan) return;
        setPlans((prev) => ({
            ...prev,
            [selectedPlanKey]: { ...prev[selectedPlanKey], ...patch },
        }));
    }

    function updateRule(patch: Partial<TimeRule>) {
        if (!currentPlan) return;
        const baseRule: TimeRule = currentPlan.TimeRule || {
            WeekDay: 1,
            WeekCountDiv: 0,
            WeekCountDivTotal: 2,
        };
        updateCurrentPlan({ TimeRule: { ...baseRule, ...patch } });
    }

    function addPlan() {
        const key = crypto.randomUUID();
        const firstTlId = Object.keys(timeLayoutsMap)[0] || EMPTY_GUID;
        const tl = findByGuid(timeLayoutsMap, firstTlId);
        const classSegs = (tl?.Layouts || []).filter((s) => s.TimeType === 0);
        const initialClasses: ClassInfo[] = classSegs.map((seg) => ({
            SubjectId: seg.DefaultClassId && !isEmptyGuidStr(seg.DefaultClassId) ? seg.DefaultClassId : EMPTY_GUID,
            IsChangedClass: false,
            IsEnabled: true,
            AttachedObjects: {},
        }));

        const activeGroupId =
            selectedGroupFilter !== "all" && classPlanGroups[selectedGroupFilter]
                ? selectedGroupFilter
                : GLOBAL_CLASSPLAN_GROUP_GUID;

        const newPlan: ClassPlan = {
            Name: `新课表 ${Object.keys(plans).length + 1}`,
            TimeLayoutId: firstTlId,
            TimeRule: { WeekDay: 1, WeekCountDiv: 0, WeekCountDivTotal: 2 },
            Classes: initialClasses,
            IsEnabled: true,
            IsOverlay: false,
            AssociatedGroup: activeGroupId,
            AttachedObjects: {},
        };
        setPlans((prev) => ({ ...prev, [key]: newPlan }));
        setSelectedPlanKey(key);
        setSelectedLessonIndex(0);
        setMobileLayer(2);
    }

    function duplicatePlan(sourceKey: string) {
        const src = plans[sourceKey];
        if (!src) return;
        const key = crypto.randomUUID();
        const cloned: ClassPlan = JSON.parse(JSON.stringify(src));
        cloned.Name = `${src.Name} - 副本`;
        setPlans((prev) => ({ ...prev, [key]: cloned }));
        setSelectedPlanKey(key);
        setMsg({ type: "success", text: `已复制课表「${src.Name}」` });
    }

    function createOverlayPlanFromCurrent() {
        if (!selectedPlanKey || !currentPlan) return;
        const key = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const cloned: ClassPlan = JSON.parse(JSON.stringify(currentPlan));
        cloned.Name = `${currentPlan.Name} - 临时层`;
        cloned.IsOverlay = true;
        cloned.OverlaySourceId = selectedPlanKey;
        cloned.OverlaySetupTime = nowIso;
        setPlans((prev) => ({ ...prev, [key]: cloned }));
        setSelectedPlanKey(key);
    }

    function copyLessonsFromAnotherPlan(sourceKey: string) {
        if (!selectedPlanKey || !currentPlan) return;
        const src = plans[sourceKey];
        if (!src) return;
        const currentLen = (currentPlan.Classes || []).length;
        const srcClasses = src.Classes || [];
        const nextClasses: ClassInfo[] = Array.from({ length: Math.max(currentLen, srcClasses.length) }).map((_, idx) => {
            const targetItem = (currentPlan.Classes || [])[idx];
            const srcItem = srcClasses[idx];
            if (!srcItem) return targetItem || { SubjectId: EMPTY_GUID };
            return {
                ...(targetItem || {}),
                SubjectId: srcItem.SubjectId,
                IsChangedClass: srcItem.IsChangedClass ?? false,
                IsEnabled: srcItem.IsEnabled ?? true,
                AttachedObjects: srcItem.AttachedObjects ? JSON.parse(JSON.stringify(srcItem.AttachedObjects)) : {},
            };
        });
        updateCurrentPlan({ Classes: currentLen > 0 ? nextClasses.slice(0, currentLen) : nextClasses });
        setMsg({ type: "success", text: `已将「${src.Name}」的课程排布复制到当前课表` });
    }

    function addClassPlanGroup() {
        const name = newGroupName.trim();
        if (!name) return;
        const id = crypto.randomUUID();
        setClassPlanGroups((prev) => ({
            ...prev,
            [id]: { Name: name, IsGlobal: false },
        }));
        setNewGroupName("");
        setSelectedGroupFilter(id);
    }

    function deleteClassPlanGroup(id: string) {
        if (id === GLOBAL_CLASSPLAN_GROUP_GUID || id === DEFAULT_CLASSPLAN_GROUP_GUID) return;
        setClassPlanGroups((prev) => {
            const copy = { ...prev };
            delete copy[id];
            return copy;
        });
        setPlans((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(next)) {
                if (v.AssociatedGroup === id) {
                    next[k] = { ...v, AssociatedGroup: GLOBAL_CLASSPLAN_GROUP_GUID };
                }
            }
            return next;
        });
        if (selectedGroupFilter === id) {
            setSelectedGroupFilter("all");
        }
    }

    function deletePlan(key: string) {
        setPlans((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        if (selectedPlanKey === key) {
            const remaining = Object.keys(plans).filter((k) => k !== key);
            setSelectedPlanKey(remaining.length > 0 ? remaining[0] : null);
        }
    }

    function assignSubjectToLesson(subjectId: string) {
        if (!currentPlan) return;
        const classes = [...(currentPlan.Classes || [])];
        if (classes.length === 0) return;
        const idx = selectedLessonIndex >= 0 && selectedLessonIndex < classes.length ? selectedLessonIndex : 0;
        classes[idx] = {
            ...classes[idx],
            SubjectId: subjectId,
        };
        updateCurrentPlan({ Classes: classes });
        if (autoMoveNext && idx + 1 < classes.length) {
            setSelectedLessonIndex(idx + 1);
        }
    }

    function updateLessonItem(idx: number, patch: Partial<ClassInfo>) {
        if (!currentPlan) return;
        const classes = [...(currentPlan.Classes || [])];
        if (idx < 0 || idx >= classes.length) return;
        classes[idx] = { ...classes[idx], ...patch };
        updateCurrentPlan({ Classes: classes });
    }

    function addManualLessonRow() {
        if (!currentPlan) return;
        const classes: ClassInfo[] = [
            ...(currentPlan.Classes || []),
            { SubjectId: EMPTY_GUID, IsChangedClass: false, IsEnabled: true, AttachedObjects: {} as AttachedObjectsMap },
        ];
        updateCurrentPlan({ Classes: classes });
        setSelectedLessonIndex(classes.length - 1);
    }

    function removeLessonRow(idx: number) {
        if (!currentPlan) return;
        const classes = (currentPlan.Classes || []).filter((_, i) => i !== idx);
        updateCurrentPlan({ Classes: classes });
        if (selectedLessonIndex >= classes.length) {
            setSelectedLessonIndex(Math.max(0, classes.length - 1));
        }
    }

    const boundTimeLayout: TimeLayout | undefined = currentPlan
        ? findByGuid(timeLayoutsMap, currentPlan.TimeLayoutId)
        : undefined;
    const allSegments: TimeLayoutItem[] = boundTimeLayout?.Layouts || [];
    const classSegments: TimeLayoutItem[] = allSegments.filter((s) => s.TimeType === 0);

    const visibleSubjectEntries = Object.entries(subjectsMap).filter(([id, sub]) => {
        if (isEmptyGuidStr(id)) return false;
        const n = (sub?.Name || "").trim();
        if (n === "???" || n === "") return false;
        return true;
    });

    const filteredPlanEntries = Object.entries(plans).filter(([, plan]) => {
        if (selectedGroupFilter === "all") return true;
        const grp = plan.AssociatedGroup || GLOBAL_CLASSPLAN_GROUP_GUID;
        return normalizeGuidKey(grp) === normalizeGuidKey(selectedGroupFilter);
    });

    if (loading) {
        return <div className="empty-state"><Spinner size="medium" label="加载课表编辑器中..." /></div>;
    }

    return (
        <div className="fade-in">
            {msg && (
                <MessageBar intent={msg.type} style={{ marginBottom: 12 }}>
                    <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
            )}

            <div className="tl-workbench">
                {/* ═══ 左栏：文件选择、基础配置与课表列表 (Layer 1) ═══ */}
                <div className={`tl-col-left ${mobileLayer !== 1 ? "mobile-layer-hidden" : ""}`}>
                    <div className="tl-panel-header-box">
                        <div className="tl-panel-header-title">课表管理</div>
                        <div className="tl-panel-header-subtitle">选择配置文件、课表群与课表</div>
                    </div>

                    <div className="tl-panel-box" style={{ gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                当前编辑
                            </span>
                            <Select
                                size="small"
                                value={selectedFile || ""}
                                onChange={(_, d) => selectFile(d.value)}
                                style={{ flex: 1, minWidth: 100 }}
                            >
                                {fileList.length === 0 && <option value="">暂无文件</option>}
                                {fileList.map((f) => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </Select>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <Button size="small" appearance="primary" icon={<Add24Regular />} onClick={() => setShowCreate(true)}>
                                新建文件
                            </Button>
                            <Button
                                size="small"
                                appearance="secondary"
                                icon={<Settings24Regular />}
                                onClick={() => setShowRefModal(true)}
                                title="关联参考档案与课表群设置"
                            >
                                基础配置
                            </Button>
                            {selectedFile && (
                                <>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="ClassPlan"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            let parsedPlans: Record<string, ClassPlan> = {};
                                            if (content && typeof content === "object") {
                                                const obj = content as Record<string, unknown>;
                                                parsedPlans = (obj.ClassPlans && typeof obj.ClassPlans === "object"
                                                    ? obj.ClassPlans
                                                    : obj) as Record<string, ClassPlan>;
                                                if (obj.ClassPlanGroups && typeof obj.ClassPlanGroups === "object") {
                                                    setClassPlanGroups((prev) => ({
                                                        ...prev,
                                                        ...(obj.ClassPlanGroups as Record<string, ClassPlanGroup>),
                                                    }));
                                                }
                                            }
                                            setPlans(parsedPlans);
                                            setJsonText(JSON.stringify({ ClassPlans: parsedPlans, ClassPlanGroups: classPlanGroups }, null, 2));
                                            const keys = Object.keys(parsedPlans);
                                            setSelectedPlanKey(keys.length > 0 ? keys[0] : null);
                                            setMsg({
                                                type: "success",
                                                text: isCurrent ? `已加载当前版本 v${version}` : `已加载历史版本 v${version}`,
                                            });
                                        }}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <DownloadPresetPopoverButton
                                        buttonText="导出"
                                        size="small"
                                        appearance="subtle"
                                        defaultFileName={`ClassPlan-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `ClassPlan-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "ClassPlans.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : { ClassPlans: plans, ClassPlanGroups: classPlanGroups })}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        size="small"
                                        appearance={jsonMode ? "primary" : "subtle"}
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) setJsonText(JSON.stringify({ ClassPlans: plans, ClassPlanGroups: classPlanGroups }, null, 2));
                                            setJsonMode(!jsonMode);
                                        }}
                                        title="切换源码模式"
                                    />
                                    <ConfirmPopover
                                        message={`确定删除课表配置文件 "${selectedFile}" 吗？`}
                                        onConfirm={() => handleDelete(selectedFile)}
                                        confirmText="删除"
                                    >
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Delete24Regular />}
                                            style={{ color: "var(--danger-color)" }}
                                            title="删除当前文件"
                                        />
                                    </ConfirmPopover>
                                </>
                            )}
                        </div>

                        {/* 课表群筛选 */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderTop: "1px solid var(--border-color)", paddingTop: 8 }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>课表群</span>
                            <Select
                                size="small"
                                value={selectedGroupFilter}
                                onChange={(_, d) => setSelectedGroupFilter(d.value)}
                                style={{ flex: 1 }}
                            >
                                <option value="all">全部课表群 ({Object.keys(plans).length})</option>
                                {Object.entries(classPlanGroups).map(([gid, g]) => (
                                    <option key={gid} value={gid}>{g.Name}</option>
                                ))}
                            </Select>
                        </div>
                    </div>

                    {/* 课表列表 */}
                    <div className="tl-layout-list">
                        {filteredPlanEntries.length === 0 ? (
                            <div className="empty-state" style={{ padding: "32px 12px" }}>
                                <p>暂无课表</p>
                            </div>
                        ) : (
                            filteredPlanEntries.map(([key, plan]) => {
                                const active = selectedPlanKey === key;
                                const tlName = findByGuid(timeLayoutsMap, plan.TimeLayoutId)?.Name || "未绑定时间表";
                                return (
                                    <div
                                        key={key}
                                        className={`tl-layout-card ${active ? "active" : ""}`}
                                        onClick={() => {
                                            setSelectedPlanKey(key);
                                            setSelectedLessonIndex(0);
                                            setMobileLayer(2);
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="tl-layout-card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{plan.Name || "未命名课表"}</span>
                                                {plan.IsOverlay && (
                                                    <span className="badge badge-warning" style={{ fontSize: 10, padding: "0 5px" }}>临时层</span>
                                                )}
                                                {plan.IsEnabled === false && (
                                                    <span className="badge badge-danger" style={{ fontSize: 10, padding: "0 5px" }}>禁用</span>
                                                )}
                                            </div>
                                            <div className="tl-layout-card-meta">
                                                {formatRuleBadge(plan.TimeRule)} · {tlName}
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<Copy24Regular />}
                                                onClick={() => duplicatePlan(key)}
                                                title="复制此课表"
                                            />
                                            <ConfirmPopover
                                                message={`确定要删除课表「${plan.Name || "未命名课表"}」吗？`}
                                                onConfirm={() => deletePlan(key)}
                                                confirmText="删除"
                                            >
                                                <Button
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={<Delete24Regular />}
                                                    style={{ color: "var(--danger-color)" }}
                                                    title="删除此课表"
                                                />
                                            </ConfirmPopover>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {selectedFile && (
                        <Button
                            appearance="primary"
                            icon={<Add24Regular />}
                            onClick={addPlan}
                            style={{ width: "100%" }}
                        >
                            新建课表
                        </Button>
                    )}
                </div>

                {/* ═══ 中栏：课表课程排布画布 (Layer 2) ═══ */}
                <div className={`tl-col-center ${mobileLayer === 1 ? "mobile-layer-hidden" : ""}`}>
                    <div className="mobile-only-nav-bar">
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ArrowLeft24Regular />}
                            onClick={() => setMobileLayer(1)}
                        >
                            返回课表列表
                        </Button>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {currentPlan?.Name || "编辑课表"}
                        </span>
                        <Button
                            size="small"
                            appearance="secondary"
                            onClick={() => {
                                setRightTab("details");
                                setMobileLayer(3);
                            }}
                        >
                            规则与复制
                        </Button>
                    </div>

                    {!selectedFile ? (
                        <div className="tl-canvas-card">
                            <div className="empty-state" style={{ flex: 1 }}>
                                <div className="empty-state-text">请在左侧选择或新建课表配置文件</div>
                            </div>
                        </div>
                    ) : dataLoading ? (
                        <div className="tl-canvas-card">
                            <div className="empty-state" style={{ flex: 1 }}><Spinner size="medium" /></div>
                        </div>
                    ) : jsonMode ? (
                        <div className="tl-canvas-card" style={{ padding: 16 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                <span style={{ fontWeight: 600 }}>JSON 源码编辑 — {selectedFile}</span>
                                <Button size="small" appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={saving}>
                                    {saving ? "保存中..." : "保存"}
                                </Button>
                            </div>
                            <div className="json-editor" style={{ flex: 1, display: "flex" }}>
                                <textarea
                                    value={jsonText}
                                    onChange={(e) => setJsonText(e.target.value)}
                                    style={{ flex: 1, height: "100%", minHeight: 0 }}
                                />
                            </div>
                        </div>
                    ) : !currentPlan ? (
                        <div className="tl-canvas-card">
                            <div className="empty-state" style={{ flex: 1 }}>
                                <div className="empty-state-text">请从左侧选择一个课表或点击「新建课表」</div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="tl-toolbar-card">
                                <div className="tl-toolbar-actions">
                                    <Button
                                        size="small"
                                        appearance={rightTab === "details" ? "primary" : "secondary"}
                                        icon={<Settings24Regular />}
                                        onClick={() => {
                                            setRightTab("details");
                                            if (window.innerWidth <= 768) setMobileLayer(3);
                                        }}
                                    >
                                        课表规则
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance={rightTab === "copy" ? "primary" : "secondary"}
                                        icon={<Copy24Regular />}
                                        onClick={() => {
                                            setRightTab("copy");
                                            if (window.innerWidth <= 768) setMobileLayer(3);
                                        }}
                                    >
                                        复制课表
                                    </Button>
                                    {!currentPlan.IsOverlay && (
                                        <Button
                                            size="small"
                                            appearance="subtle"
                                            icon={<Layer24Regular />}
                                            onClick={createOverlayPlanFromCurrent}
                                        >
                                            创建临时层
                                        </Button>
                                    )}
                                    {classSegments.length === 0 && (
                                        <Button size="small" appearance="subtle" icon={<Add24Regular />} onClick={addManualLessonRow}>
                                            添加节次
                                        </Button>
                                    )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>显示课间</span>
                                        <Switch
                                            checked={showBreaksInSchedule}
                                            onChange={(_, d) => setShowBreaksInSchedule(d.checked)}
                                        />
                                    </div>
                                    <Button
                                        size="small"
                                        appearance="primary"
                                        icon={<Save24Regular />}
                                        onClick={handleSave}
                                        disabled={saving}
                                    >
                                        {saving ? "保存中..." : "保存"}
                                    </Button>
                                </div>
                            </div>

                            <div className="tl-canvas-card">
                                <div className="tl-segments-scroll">
                                    {(() => {
                                        const classes = currentPlan.Classes || [];
                                        if (allSegments.length > 0 && showBreaksInSchedule) {
                                            let classCounter = -1;
                                            return allSegments.map((seg, rawIdx) => {
                                                if (seg.TimeType === 2) {
                                                    return (
                                                        <div key={rawIdx} className="tl-seg-divider">
                                                            <div className="tl-seg-divider-line" />
                                                            <span>分割线 {normalizeTimeStr(seg.StartTime)}</span>
                                                            <div className="tl-seg-divider-line" />
                                                        </div>
                                                    );
                                                }
                                                if (seg.TimeType !== 0) {
                                                    return (
                                                        <div key={rawIdx} className="tl-seg-row type-break" style={{ opacity: 0.72, cursor: "default" }}>
                                                            <span className="tl-seg-badge break">{seg.BreakName || "课间休息"}</span>
                                                            <span className="tl-seg-time">
                                                                {normalizeTimeStr(seg.StartTime)} - {normalizeTimeStr(seg.EndTime)}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                classCounter += 1;
                                                const lessonIdx = classCounter;
                                                const clsItem = classes[lessonIdx] || { SubjectId: EMPTY_GUID };
                                                const sub = findByGuid(subjectsMap, clsItem.SubjectId);
                                                const isRowSelected = selectedLessonIndex === lessonIdx;
                                                return (
                                                    <div
                                                        key={rawIdx}
                                                        className={`tl-seg-row type-class ${isRowSelected ? "selected" : ""}`}
                                                        onClick={() => {
                                                            setSelectedLessonIndex(lessonIdx);
                                                            setRightTab("subjects");
                                                            if (window.innerWidth <= 768) setMobileLayer(3);
                                                        }}
                                                    >
                                                        <span className="tl-seg-badge class">第 {lessonIdx + 1} 节</span>
                                                        <span className="tl-seg-time">
                                                            {normalizeTimeStr(seg.StartTime)} - {normalizeTimeStr(seg.EndTime)}
                                                        </span>
                                                        <span className="tl-seg-extra" style={{ fontWeight: 600, color: sub ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                                                            {sub ? `${sub.Name}${sub.TeacherName ? ` · ${sub.TeacherName}` : ""}` : "未分配科目"}
                                                        </span>
                                                    </div>
                                                );
                                            });
                                        }

                                        if (classes.length === 0) {
                                            return (
                                                <div className="empty-state" style={{ padding: "48px 0" }}>
                                                    <p>当前课表暂无节次，请在课表规则中绑定时间表或点击上方「添加节次」</p>
                                                </div>
                                            );
                                        }

                                        return classes.map((clsItem, idx) => {
                                            const seg = classSegments[idx];
                                            const sub = findByGuid(subjectsMap, clsItem.SubjectId);
                                            const isRowSelected = selectedLessonIndex === idx;
                                            return (
                                                <div
                                                    key={idx}
                                                    className={`tl-seg-row type-class ${isRowSelected ? "selected" : ""}`}
                                                    onClick={() => {
                                                        setSelectedLessonIndex(idx);
                                                        setRightTab("subjects");
                                                        if (window.innerWidth <= 768) setMobileLayer(3);
                                                    }}
                                                >
                                                    <span className="tl-seg-badge class">第 {idx + 1} 节</span>
                                                    <span className="tl-seg-time">
                                                        {seg ? `${normalizeTimeStr(seg.StartTime)} - ${normalizeTimeStr(seg.EndTime)}` : `第 ${idx + 1} 节课`}
                                                    </span>
                                                    <span className="tl-seg-extra" style={{ fontWeight: 600, color: sub ? "var(--text-primary)" : "var(--text-tertiary)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                                                        <span>{sub ? `${sub.Name}${sub.TeacherName ? ` · ${sub.TeacherName}` : ""}` : "未分配科目"}</span>
                                                        {clsItem.IsChangedClass && (
                                                            <span className="badge badge-warning" style={{ fontSize: 10 }}>换课</span>
                                                        )}
                                                        {classSegments.length === 0 && (
                                                            <Button
                                                                size="small"
                                                                appearance="subtle"
                                                                icon={<Delete24Regular />}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removeLessonRow(idx);
                                                                }}
                                                                style={{ color: "var(--danger-color)" }}
                                                            />
                                                        )}
                                                    </span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* ═══ 右栏：科目选择、复制课表与规则配置 (Layer 3) ═══ */}
                {currentPlan && (
                    <div className={`tl-col-right floating-inspector ${mobileLayer === 3 ? "" : "mobile-layer-hidden"}`}>
                        <div className="tl-inspector-card">
                            <div className="mobile-only-nav-bar" style={{ marginBottom: 4 }}>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<ArrowLeft24Regular />}
                                    onClick={() => setMobileLayer(2)}
                                >
                                    返回课表排布
                                </Button>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>
                                    {rightTab === "subjects" ? "选择科目" : rightTab === "copy" ? "复制课表" : "课表规则"}
                                </span>
                                <span />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, background: "var(--bg-subtle)", padding: 4, borderRadius: 8 }}>
                                <button
                                    type="button"
                                    className={`attached-tab-btn ${rightTab === "subjects" ? "active" : ""}`}
                                    style={{ borderBottom: "none", borderRadius: 6, background: rightTab === "subjects" ? "var(--bg-card)" : "transparent" }}
                                    onClick={() => setRightTab("subjects")}
                                >
                                    编辑科目
                                </button>
                                <button
                                    type="button"
                                    className={`attached-tab-btn ${rightTab === "copy" ? "active" : ""}`}
                                    style={{ borderBottom: "none", borderRadius: 6, background: rightTab === "copy" ? "var(--bg-card)" : "transparent" }}
                                    onClick={() => setRightTab("copy")}
                                >
                                    复制课表
                                </button>
                                <button
                                    type="button"
                                    className={`attached-tab-btn ${rightTab === "details" ? "active" : ""}`}
                                    style={{ borderBottom: "none", borderRadius: 6, background: rightTab === "details" ? "var(--bg-card)" : "transparent" }}
                                    onClick={() => setRightTab("details")}
                                >
                                    课表规则
                                </button>
                            </div>

                            {rightTab === "subjects" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
                                            当前选中：第 {Math.max(1, selectedLessonIndex + 1)} 节
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>选后自动下一节</span>
                                            <Switch
                                                checked={autoMoveNext}
                                                onChange={(_, d) => setAutoMoveNext(d.checked)}
                                            />
                                        </div>
                                    </div>

                                    {selectedLessonIndex >= 0 && currentPlan.Classes?.[selectedLessonIndex] && (
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--bg-subtle)", borderRadius: 8 }}>
                                            <span style={{ fontSize: 12.5 }}>标记本节课为临时换课</span>
                                            <Switch
                                                checked={!!currentPlan.Classes[selectedLessonIndex].IsChangedClass}
                                                onChange={(_, d) => updateLessonItem(selectedLessonIndex, { IsChangedClass: d.checked })}
                                            />
                                        </div>
                                    )}

                                    <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignContent: "start" }}>
                                        <button
                                            type="button"
                                            onClick={() => assignSubjectToLesson(EMPTY_GUID)}
                                            style={{
                                                padding: "10px 12px",
                                                borderRadius: 8,
                                                border: "1px dashed var(--border-color)",
                                                background: "var(--bg-subtle)",
                                                color: "var(--text-secondary)",
                                                cursor: "pointer",
                                                textAlign: "left",
                                                fontSize: 13,
                                            }}
                                        >
                                            清除科目
                                        </button>
                                        {visibleSubjectEntries.map(([subId, sub]) => {
                                            const currentSubId = currentPlan.Classes?.[selectedLessonIndex]?.SubjectId;
                                            const isSelected = currentSubId && normalizeGuidKey(currentSubId) === normalizeGuidKey(subId);
                                            return (
                                                <button
                                                    key={subId}
                                                    type="button"
                                                    onClick={() => assignSubjectToLesson(subId)}
                                                    style={{
                                                        padding: "10px 12px",
                                                        borderRadius: 8,
                                                        border: isSelected ? "1.5px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                        background: isSelected ? "var(--bg-accent-subtle)" : "var(--bg-card)",
                                                        color: "var(--text-primary)",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        gap: 8,
                                                        textAlign: "left",
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {sub.Name}
                                                        </div>
                                                        {sub.TeacherName && (
                                                            <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                {sub.TeacherName}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isSelected && <Checkmark16Regular style={{ color: "var(--accent-color)", flexShrink: 0 }} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {rightTab === "copy" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                    <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>从其他课表复制课程排布</div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                            选择同文件内的另一张课表，将其各节课科目复制到当前正在编辑的「{currentPlan.Name}」。
                                        </div>
                                        <Select
                                            size="small"
                                            value={copySourcePlanKey}
                                            onChange={(_, d) => setCopySourcePlanKey(d.value)}
                                        >
                                            <option value="">选择源课表</option>
                                            {Object.entries(plans)
                                                .filter(([k]) => k !== selectedPlanKey)
                                                .map(([k, p]) => (
                                                    <option key={k} value={k}>
                                                        {p.Name || "未命名课表"} ({formatRuleBadge(p.TimeRule)})
                                                    </option>
                                                ))}
                                        </Select>
                                        <Button
                                            size="small"
                                            appearance="primary"
                                            icon={<Copy24Regular />}
                                            disabled={!copySourcePlanKey}
                                            onClick={() => copyLessonsFromAnotherPlan(copySourcePlanKey)}
                                        >
                                            复制到当前课表
                                        </Button>
                                    </div>

                                    <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>克隆整张课表</div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                            在当前配置文件中创建一张与「{currentPlan.Name}」完全相同的课表副本。
                                        </div>
                                        <Button
                                            size="small"
                                            appearance="secondary"
                                            icon={<Copy24Regular />}
                                            onClick={() => selectedPlanKey && duplicatePlan(selectedPlanKey)}
                                        >
                                            创建课表副本
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {rightTab === "details" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontSize: 12 }}>课表名称</label>
                                        <Input
                                            size="small"
                                            value={currentPlan.Name || ""}
                                            onChange={(_, d) => updateCurrentPlan({ Name: d.value })}
                                        />
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontSize: 12 }}>关联时间表</label>
                                        <Select
                                            size="small"
                                            value={currentPlan.TimeLayoutId || ""}
                                            onChange={(_, d) => updateCurrentPlan({ TimeLayoutId: d.value })}
                                        >
                                            <option value={EMPTY_GUID}>未选择时间表</option>
                                            {Object.entries(timeLayoutsMap).map(([tlKey, tl]) => (
                                                <option key={tlKey} value={tlKey}>
                                                    {tl.Name || tlKey}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontSize: 12 }}>所属课表群</label>
                                        <Select
                                            size="small"
                                            value={currentPlan.AssociatedGroup || GLOBAL_CLASSPLAN_GROUP_GUID}
                                            onChange={(_, d) => updateCurrentPlan({ AssociatedGroup: d.value })}
                                        >
                                            {Object.entries(classPlanGroups).map(([gid, g]) => (
                                                <option key={gid} value={gid}>{g.Name}</option>
                                            ))}
                                        </Select>
                                    </div>

                                    {currentPlan.IsOverlay ? (
                                        <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-subtle)", fontSize: 12, color: "var(--text-secondary)" }}>
                                            当前课表为临时层课表，不受常规星期与周次规则控制。
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span style={{ fontSize: 12.5, fontWeight: 600 }}>按规则自动启用此课表</span>
                                                <Switch
                                                    checked={currentPlan.IsEnabled !== false}
                                                    onChange={(_, d) => updateCurrentPlan({ IsEnabled: d.checked })}
                                                />
                                            </div>

                                            {currentPlan.IsEnabled !== false && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border-color)" }}>
                                                    <div>
                                                        <label className="form-label" style={{ fontSize: 11 }}>启用星期</label>
                                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                                                            {Object.entries(WEEKDAY_LABELS).map(([dayNum, label]) => {
                                                                const num = parseInt(dayNum, 10);
                                                                const isDaySelected = (currentPlan.TimeRule?.WeekDay ?? 1) === num;
                                                                return (
                                                                    <button
                                                                        key={dayNum}
                                                                        type="button"
                                                                        onClick={() => updateRule({ WeekDay: num })}
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
                                                            <label className="form-label" style={{ fontSize: 11 }}>轮换周期周数</label>
                                                            <Select
                                                                size="small"
                                                                value={String(currentPlan.TimeRule?.WeekCountDivTotal ?? 2)}
                                                                onChange={(_, d) => updateRule({ WeekCountDivTotal: parseInt(d.value, 10) })}
                                                            >
                                                                <option value="2">每 2 周</option>
                                                                <option value="3">每 3 周</option>
                                                                <option value="4">每 4 周</option>
                                                                <option value="5">每 5 周</option>
                                                            </Select>
                                                        </div>
                                                        <div>
                                                            <label className="form-label" style={{ fontSize: 11 }}>生效周次</label>
                                                            <Select
                                                                size="small"
                                                                value={String(currentPlan.TimeRule?.WeekCountDiv ?? 0)}
                                                                onChange={(_, d) => updateRule({ WeekCountDiv: parseInt(d.value, 10) })}
                                                            >
                                                                <option value="0">不限周次</option>
                                                                {Array.from({ length: currentPlan.TimeRule?.WeekCountDivTotal ?? 2 }).map((_, idx) => (
                                                                    <option key={idx + 1} value={String(idx + 1)}>
                                                                        第 {idx + 1} 周
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

            {/* 基础配置（关联时间表/科目文件与课表群管理）弹窗 */}
            <Dialog open={showRefModal} onOpenChange={(_, d) => setShowRefModal(d.open)}>
                <DialogSurface style={{ maxWidth: 480 }}>
                    <DialogBody>
                        <DialogTitle
                            action={
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<Dismiss24Regular />}
                                    onClick={() => setShowRefModal(false)}
                                />
                            }
                        >
                            课表基础配置
                        </DialogTitle>
                        <DialogContent style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">参考时间表文件</label>
                                <Select
                                    value={selectedTimeLayoutFile}
                                    onChange={(_, d) => {
                                        setSelectedTimeLayoutFile(d.value);
                                        loadTimeLayoutFile(d.value);
                                    }}
                                    style={{ width: "100%" }}
                                >
                                    {timeLayoutFiles.length === 0 && <option value="">无时间表文件</option>}
                                    {timeLayoutFiles.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </Select>
                            </div>

                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">参考科目文件</label>
                                <Select
                                    value={selectedSubjectsFile}
                                    onChange={(_, d) => {
                                        setSelectedSubjectsFile(d.value);
                                        loadSubjectsFile(d.value);
                                    }}
                                    style={{ width: "100%" }}
                                >
                                    {subjectsFiles.length === 0 && <option value="">无科目文件</option>}
                                    {subjectsFiles.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </Select>
                            </div>

                            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                                <label className="form-label">课表群管理</label>
                                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                    <Input
                                        size="small"
                                        value={newGroupName}
                                        onChange={(_, d) => setNewGroupName(d.value)}
                                        placeholder="新建课表群名称"
                                        style={{ flex: 1 }}
                                    />
                                    <Button size="small" appearance="primary" icon={<Add24Regular />} onClick={addClassPlanGroup} disabled={!newGroupName.trim()}>
                                        新建
                                    </Button>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                                    {Object.entries(classPlanGroups).map(([gid, g]) => (
                                        <div key={gid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, background: "var(--bg-subtle)" }}>
                                            <span style={{ fontSize: 13 }}>{g.Name}</span>
                                            {gid !== GLOBAL_CLASSPLAN_GROUP_GUID && gid !== DEFAULT_CLASSPLAN_GROUP_GUID && (
                                                <Button
                                                    size="small"
                                                    appearance="subtle"
                                                    icon={<Delete24Regular />}
                                                    onClick={() => deleteClassPlanGroup(gid)}
                                                    style={{ color: "var(--danger-color)" }}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={() => setShowRefModal(false)}>完成</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

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
                                    placeholder="输入配置文件名称"
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
