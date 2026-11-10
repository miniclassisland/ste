"use client";

import React, { useState, useEffect, useCallback } from "react";
import { data } from "@/lib/api";
import { useAccount } from "@/lib/account-context";
import type { Subject } from "@/lib/types";
import { isEmptyGuid } from "@/lib/types";
import {
    Button, Input, Switch, Spinner,
    Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
} from "@fluentui/react-components";
import { MessageBar, MessageBarBody } from "@/components/ToastMessageBar";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
    Add24Regular, Delete24Regular, Save24Regular, ArrowSync24Regular,
    ArrowUp24Regular, ArrowDown24Regular, Code24Regular, DismissCircle24Regular,
    ArrowLeft24Regular,
} from "@fluentui/react-icons";
import DownloadPresetPopoverButton from "@/components/DownloadPresetPopoverButton";
import FileHistoryButton from "@/components/FileHistoryButton";

type SubjectsData = Record<string, Subject>;

export default function SubjectsPage() {
    const { accountId } = useAccount();
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [subjects, setSubjects] = useState<SubjectsData>({});
    const [jsonMode, setJsonMode] = useState(false);
    const [jsonText, setJsonText] = useState("{}");
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [mobileLayer, setMobileLayer] = useState<1 | 2>(1);

    const selectFile = useCallback(async (name: string, enterMobileEditor = false) => {
        if (!accountId) return;
        setSelectedFile(name);
        if (enterMobileEditor) setMobileLayer(2);
        setDataLoading(true);
        setMsg(null);
        try {
            const content = await data.read(accountId, "Subjects", name);
            let parsed: SubjectsData = {};
            if (content && typeof content === "object") {
                const obj = content as Record<string, unknown>;
                if (obj.Subjects && typeof obj.Subjects === "object") {
                    parsed = obj.Subjects as SubjectsData;
                } else {
                    parsed = obj as SubjectsData;
                }
            }
            setSubjects(parsed);
            setJsonText(JSON.stringify(parsed, null, 2));
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "加载失败" });
            setSubjects({});
            setJsonText("{}");
        }
        setDataLoading(false);
    }, [accountId]);

    const loadFiles = useCallback(async () => {
        if (!accountId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const list = await data.list(accountId, "Subjects");
            const arr = Array.isArray(list) ? list : [];
            setFileList(arr);
            if (arr.length > 0 && (!selectedFile || !arr.includes(selectedFile))) {
                selectFile(arr[0]);
            }
        } catch {
            setFileList([]);
        }
        setLoading(false);
    }, [accountId, selectFile]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    async function handleSave() {
        if (!selectedFile) return;
        setSaving(true);
        setMsg(null);
        try {
            let payloadToSave = subjects;
            if (jsonMode) {
                payloadToSave = JSON.parse(jsonText) as SubjectsData;
                setSubjects(payloadToSave);
            } else {
                setJsonText(JSON.stringify(subjects, null, 2));
            }
            const wrapperPayload =
                payloadToSave && typeof payloadToSave === "object" && "Subjects" in payloadToSave
                    ? payloadToSave
                    : { Subjects: payloadToSave };
            await data.write(accountId, "Subjects", selectedFile, wrapperPayload);
            setMsg({ type: "success", text: "科目数据已保存" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "保存失败，请检查格式" });
        }
        setSaving(false);
    }

    async function handleCreateFile(e: React.FormEvent) {
        e.preventDefault();
        if (!newFileName.trim()) return;
        const name = newFileName.trim();
        try {
            await data.create(accountId, "Subjects", name);
            setMsg({ type: "success", text: `文件 "${name}" 已创建` });
            setShowCreate(false);
            setNewFileName("");
            await loadFiles();
            selectFile(name, true);
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
        }
    }

    async function handleDeleteFile(name: string) {
        try {
            await data.deleteData(accountId, "Subjects", name);
            if (selectedFile === name) {
                setSelectedFile(null);
                setSubjects({});
                setMobileLayer(1);
            }
            await loadFiles();
            setMsg({ type: "success", text: "文件已删除" });
        } catch (err: unknown) {
            setMsg({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
        }
    }

    function addSubject() {
        const id = crypto.randomUUID();
        const next: SubjectsData = {
            ...subjects,
            [id]: { Name: "新科目", Initial: "新", TeacherName: "", IsOutDoor: false, AttachedObjects: {} },
        };
        setSubjects(next);
        setJsonText(JSON.stringify(next, null, 2));
    }

    function updateSubject(id: string, field: keyof Subject, value: string | boolean) {
        const copy = { ...subjects };
        copy[id] = { ...copy[id], [field]: value };
        if (field === "Name" && typeof value === "string" && value.length > 0 && !copy[id].Initial) {
            copy[id].Initial = value[0];
        }
        setSubjects(copy);
        setJsonText(JSON.stringify(copy, null, 2));
    }

    function moveSubject(id: string, dir: -1 | 1) {
        const entries = Object.entries(subjects);
        const idx = entries.findIndex(([k]) => k === id);
        if (idx < 0) return;
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= entries.length) return;
        const temp = entries[idx];
        entries[idx] = entries[targetIdx];
        entries[targetIdx] = temp;
        const next = Object.fromEntries(entries);
        setSubjects(next);
        setJsonText(JSON.stringify(next, null, 2));
    }

    function deleteSubject(id: string) {
        const copy = { ...subjects };
        delete copy[id];
        setSubjects(copy);
        setJsonText(JSON.stringify(copy, null, 2));
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">科目管理</h1>
                    <p className="page-subtitle">管理 ClassIsland 科目档案</p>
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
                <div className={`profile-split-sidebar ${mobileLayer !== 1 ? "mobile-layer-hidden" : ""}`}>
                    <div className="card">
                        <div className="card-title">科目文件</div>
                        {loading ? (
                            <Spinner size="small" />
                        ) : fileList.length === 0 ? (
                            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>暂无文件</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {fileList.map((f) => (
                                    <div
                                        key={f}
                                        className={`sidebar-link ${selectedFile === f ? "active" : ""}`}
                                        onClick={() => selectFile(f, true)}
                                    >
                                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{f}</span>
                                        <ConfirmPopover
                                            message={`确定要删除科目文件 "${f}" 吗？`}
                                            onConfirm={() => handleDeleteFile(f)}
                                            confirmText="删除"
                                        >
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<Delete24Regular />}
                                                style={{ color: "var(--danger-color)" }}
                                            />
                                        </ConfirmPopover>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className={mobileLayer === 1 ? "mobile-layer-hidden" : ""} style={{ flex: 1, minWidth: 0 }}>
                    <div className="mobile-only-nav-bar" style={{ marginBottom: 12 }}>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ArrowLeft24Regular />}
                            onClick={() => setMobileLayer(1)}
                        >
                            返回文件列表
                        </Button>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedFile || "编辑科目"}</span>
                        <span />
                    </div>

                    {!selectedFile ? (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-state-text">请从左侧选择一个科目文件</div>
                            </div>
                        </div>
                    ) : dataLoading ? (
                        <div className="card">
                            <div className="empty-state"><Spinner size="medium" /></div>
                        </div>
                    ) : (
                        <div className="card">
                            <div className="flex items-center justify-between mb-16" style={{ flexWrap: "wrap", gap: 8 }}>
                                <div className="card-title" style={{ margin: 0 }}>
                                    编辑科目文件: {selectedFile} · {Object.keys(subjects).length} 门科目
                                </div>
                                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                                    <FileHistoryButton
                                        accountId={accountId}
                                        resourceType="Subjects"
                                        fileName={selectedFile}
                                        onLoadVersion={(content, version, isCurrent) => {
                                            let parsed: SubjectsData = {};
                                            if (content && typeof content === "object") {
                                                const obj = content as Record<string, unknown>;
                                                if (obj.Subjects && typeof obj.Subjects === "object") {
                                                    parsed = obj.Subjects as SubjectsData;
                                                } else {
                                                    parsed = obj as SubjectsData;
                                                }
                                            }
                                            setSubjects(parsed);
                                            setJsonText(JSON.stringify(parsed, null, 2));
                                            setMsg({
                                                type: "success",
                                                text: isCurrent
                                                    ? `已加载当前最新版本 v${version}`
                                                    : `已加载历史版本 v${version} 到编辑器`,
                                            });
                                        }}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <DownloadPresetPopoverButton
                                        buttonText="导出"
                                        appearance="secondary"
                                        defaultFileName={`Subjects-${selectedFile}.json`}
                                        suggestedNames={[
                                            { label: "具名区分文件", fileName: `Subjects-${selectedFile}.json` },
                                            { label: "档案原名", fileName: `${selectedFile}.json` },
                                            { label: "客户端标准资源名", fileName: "Subjects.json" },
                                        ]}
                                        onFetchData={async () => (jsonMode ? JSON.parse(jsonText) : subjects)}
                                        onError={(text) => setMsg({ type: "error", text })}
                                    />
                                    <Button
                                        appearance="subtle"
                                        icon={<Code24Regular />}
                                        onClick={() => {
                                            if (!jsonMode) {
                                                setJsonText(JSON.stringify(subjects, null, 2));
                                            } else {
                                                try {
                                                    setSubjects(JSON.parse(jsonText));
                                                } catch {
                                                    /* keep current */
                                                }
                                            }
                                            setJsonMode(!jsonMode);
                                        }}
                                    >
                                        {jsonMode ? "切换可视化编辑" : "JSON 源码"}
                                    </Button>
                                    {!jsonMode && (
                                        <Button appearance="secondary" icon={<Add24Regular />} onClick={addSubject}>
                                            添加科目
                                        </Button>
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
                            ) : Object.keys(subjects).length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-text">暂无科目，点击「添加科目」开始</div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {Object.entries(subjects).map(([id, sub], idx, arr) => {
                                        const isSpecialEmpty = isEmptyGuid(id);
                                        return (
                                        <div
                                            key={id}
                                            className="card"
                                            style={{
                                                padding: 16,
                                                margin: 0,
                                                border: isSpecialEmpty ? "1px dashed var(--accent-color)" : "1px solid var(--border-color)",
                                                background: isSpecialEmpty ? "var(--bg-accent-subtle)" : undefined,
                                            }}
                                        >
                                            {isSpecialEmpty && (
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent-color)", fontWeight: 600 }}>
                                                        <DismissCircle24Regular style={{ width: 16, height: 16 }} />
                                                        未分配科目的课程格默认指向此项
                                                    </span>
                                                    <Button
                                                        size="small"
                                                        appearance="subtle"
                                                        onClick={() => deleteSubject(id)}
                                                    >
                                                        从科目表移除此冗余项
                                                    </Button>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-12" style={{ flexWrap: "wrap" }}>
                                                <div
                                                    style={{
                                                        width: 44,
                                                        height: 44,
                                                        borderRadius: 8,
                                                        background: isSpecialEmpty
                                                            ? "var(--bg-subtle)"
                                                            : sub.IsOutDoor
                                                                ? "var(--success-color)"
                                                                : "var(--accent-color)",
                                                        color: isSpecialEmpty ? "var(--text-secondary)" : "white",
                                                        border: isSpecialEmpty ? "1px solid var(--border-color)" : "none",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontWeight: 700,
                                                        fontSize: 18,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {isSpecialEmpty ? "空" : (sub.Initial || sub.Name?.[0] || "?")}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 150 }}>
                                                    <label className="form-label">科目名称</label>
                                                    <Input
                                                        value={sub.Name || ""}
                                                        placeholder={isSpecialEmpty ? "未设置" : "输入科目名称"}
                                                        onChange={(_, d) => updateSubject(id, "Name", d.value)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div style={{ width: 90 }}>
                                                    <label className="form-label">简称</label>
                                                    <Input
                                                        value={sub.Initial || ""}
                                                        placeholder={isSpecialEmpty ? "空" : ""}
                                                        onChange={(_, d) => updateSubject(id, "Initial", d.value)}
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 150 }}>
                                                    <label className="form-label">任课教师</label>
                                                    <Input
                                                        value={sub.TeacherName || ""}
                                                        onChange={(_, d) => updateSubject(id, "TeacherName", d.value)}
                                                        placeholder="选填"
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="form-label">户外课程</label>
                                                    <Switch
                                                        checked={!!sub.IsOutDoor}
                                                        onChange={(_, d) => updateSubject(id, "IsOutDoor", d.checked)}
                                                    />
                                                </div>
                                                <div className="flex gap-4">
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<ArrowUp24Regular />}
                                                        disabled={idx === 0}
                                                        onClick={() => moveSubject(id, -1)}
                                                        title="上移"
                                                    />
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<ArrowDown24Regular />}
                                                        disabled={idx === arr.length - 1}
                                                        onClick={() => moveSubject(id, 1)}
                                                        title="下移"
                                                    />
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<Delete24Regular />}
                                                        onClick={() => deleteSubject(id)}
                                                        style={{ color: "var(--danger-color)" }}
                                                        title="删除科目"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })}
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
                            <DialogTitle>新建科目文件</DialogTitle>
                            <DialogContent>
                                <div className="form-group">
                                    <label className="form-label">文件名</label>
                                    <Input
                                        value={newFileName}
                                        onChange={(_, d) => setNewFileName(d.value)}
                                        placeholder="输入文件名称"
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
