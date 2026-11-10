"use client";

import React from "react";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { ThemeModeToggle } from "@/lib/theme-context";
import { Button } from "@fluentui/react-components";
import { Navigation24Regular, SignOut24Regular } from "@fluentui/react-icons";

export default function TopBar({
    title,
    onToggleMobileMenu,
}: {
    title?: string;
    onToggleMobileMenu?: () => void;
}) {
    const { currentAccount } = useAccount();
    const { logout } = useAuth();

    const displayTitle =
        title || (currentAccount ? `账户中心 · ${currentAccount.name}` : "MINI ClassIsland STE");

    return (
        <header className="topbar">
            <div className="topbar-left-wrap">
                {onToggleMobileMenu && (
                    <button
                        type="button"
                        className="mobile-menu-btn"
                        onClick={onToggleMobileMenu}
                        aria-label="打开导航菜单"
                        title="导航菜单"
                    >
                        <Navigation24Regular />
                    </button>
                )}
                <div className="topbar-title">{displayTitle}</div>
            </div>
            <div className="topbar-right">
                <ThemeModeToggle />
                <Button
                    appearance="subtle"
                    size="small"
                    className="topbar-logout-btn"
                    icon={<SignOut24Regular />}
                    onClick={() => logout()}
                    aria-label="登出"
                >
                    <span className="topbar-btn-label">登出</span>
                </Button>
            </div>
        </header>
    );
}
