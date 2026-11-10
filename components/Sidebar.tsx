"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WEB_VERSION } from "@/lib/version";
import {
    Link24Regular,
    Settings24Regular,
    Book24Regular,
    Clock24Regular,
    Board24Regular,
    ShieldTask24Regular,
    Apps24Regular,
    Key24Regular,
    Laptop24Regular,
    Dismiss24Regular,
    Grid24Regular,
    Document24Regular,
    ChevronDown16Regular,
    ChevronRight16Regular,
    ShieldKeyhole24Regular,
} from "@fluentui/react-icons";

interface NavItem {
    label: string;
    href: string;
    icon: React.ReactNode;
    exact?: boolean;
}

const PROFILE_NAV_ITEMS: NavItem[] = [
    { label: "时间表", href: "/profiles/timelayout", icon: <Clock24Regular /> },
    { label: "课表", href: "/profiles/classplan", icon: <Board24Regular /> },
    { label: "科目", href: "/profiles/subjects", icon: <Book24Regular /> },
    { label: "策略", href: "/profiles/policy", icon: <ShieldTask24Regular /> },
    { label: "设置", href: "/profiles/settings", icon: <Settings24Regular /> },
    { label: "组件", href: "/profiles/components", icon: <Apps24Regular /> },
    { label: "凭据", href: "/profiles/credentials", icon: <Key24Regular /> },
];

const SETTINGS_NAV_ITEMS: NavItem[] = [
    { label: "安全设置", href: "/security", icon: <ShieldKeyhole24Regular />, exact: true },
    { label: "配对码管理", href: "/pairing", icon: <Link24Regular /> },
    { label: "预注册客户端", href: "/pre-registration", icon: <Laptop24Regular /> },
];

export default function Sidebar({
    mobileOpen = false,
    onCloseMobile,
}: {
    mobileOpen?: boolean;
    onCloseMobile?: () => void;
}) {
    const pathname = usePathname();
    const [profilesOpen, setProfilesOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(() =>
        SETTINGS_NAV_ITEMS.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    );

    useEffect(() => {
        if (pathname.startsWith("/profiles")) {
            setProfilesOpen(true);
        }
        if (SETTINGS_NAV_ITEMS.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))) {
            setSettingsOpen(true);
        }
    }, [pathname]);

    function checkItemActive(item: NavItem) {
        return item.exact
            ? pathname === item.href
            : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
    }

    return (
        <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
            <div className="sidebar-header">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.svg" alt="MINI ClassIsland STE" className="sidebar-logo" />
                <div className="sidebar-title" style={{ whiteSpace: "nowrap" }}>MINI ClassIsland STE</div>
                {onCloseMobile && (
                    <button
                        type="button"
                        className="mobile-drawer-close"
                        onClick={onCloseMobile}
                        aria-label="关闭导航菜单"
                    >
                        <Dismiss24Regular />
                    </button>
                )}
            </div>

            <nav className="sidebar-nav">
                <div className="sidebar-section" style={{ gap: 4 }}>
                    <Link
                        href="/"
                        className={`sidebar-link ${pathname === "/" || pathname === "/dashboard" || pathname === "/accounts" ? "active" : ""}`}
                    >
                        <Grid24Regular />
                        <span>状态速览</span>
                    </Link>

                    <Link
                        href="/clients"
                        className={`sidebar-link ${pathname.startsWith("/clients") || pathname.startsWith("/audit") || pathname.startsWith("/notifications") ? "active" : ""}`}
                    >
                        <Laptop24Regular />
                        <span>客户端</span>
                    </Link>

                    <div>
                        <button
                            type="button"
                            className="sidebar-group-toggle"
                            onClick={() => setProfilesOpen((v) => !v)}
                        >
                            <span className="sidebar-group-toggle-left">
                                <Document24Regular />
                                <span>配置管理</span>
                            </span>
                            {profilesOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                        </button>
                        {profilesOpen && (
                            <div className="sidebar-sub-items">
                                {PROFILE_NAV_ITEMS.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`sidebar-link ${checkItemActive(item) ? "active" : ""}`}
                                    >
                                        {item.icon}
                                        <span>{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <button
                            type="button"
                            className="sidebar-group-toggle"
                            onClick={() => setSettingsOpen((v) => !v)}
                        >
                            <span className="sidebar-group-toggle-left">
                                <Settings24Regular />
                                <span>设置</span>
                            </span>
                            {settingsOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                        </button>
                        {settingsOpen && (
                            <div className="sidebar-sub-items">
                                {SETTINGS_NAV_ITEMS.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`sidebar-link ${checkItemActive(item) ? "active" : ""}`}
                                    >
                                        {item.icon}
                                        <span>{item.label}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <div className="sidebar-sketch-footer">
                <div className="sidebar-footer-links">
                    <a
                        href="https://github.com/miniclassisland/ste"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sidebar-footer-link"
                    >
                        GitHub
                    </a>
                </div>
                <div className="sidebar-version-bar">
                    版本 {WEB_VERSION}
                </div>
            </div>
        </aside>
    );
}
