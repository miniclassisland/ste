"use client";

import React from "react";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import { ThemeModeToggle } from "@/lib/theme-context";
import { Button } from "@fluentui/react-components";
import { Navigation24Regular, SignOut20Regular } from "@fluentui/react-icons";

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
    title || (currentAccount ? currentAccount.name : "MINI ClassIsland STE");

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
          icon={<SignOut20Regular />}
          onClick={() => logout()}
        >
          退出登录
        </Button>
      </div>
    </header>
  );
}
