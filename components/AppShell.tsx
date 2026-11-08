"use client";

import React from "react";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account-context";
import { usePathname } from "next/navigation";
import { ThemeModeToggle } from "@/lib/theme-context";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import RateLimitBanner from "./RateLimitBanner";
import LoginPage from "@/app/login/page";

const SHELL_EXCLUDED_PATHS = ["/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { accountId } = useAccount();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const isExcluded = SHELL_EXCLUDED_PATHS.some((p) => pathname.startsWith(p));
  const showFullShell = !isLoading && isAuthenticated && !isExcluded;

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, accountId]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (showFullShell) {
      root.removeAttribute("data-auth-bg");
    } else {
      root.setAttribute("data-auth-bg", "1");
    }
  }, [showFullShell]);

  if (isLoading && !isExcluded) {
    return null;
  }

  return (
    <>
      <RateLimitBanner />

      {showFullShell ? (
        <div className="app-layout">
          {mobileMenuOpen && (
            <div
              className="sidebar-backdrop"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
          )}
          <Sidebar
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
          />
          <div className="main-area">
            <TopBar onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)} />
            <main key={accountId || "default"} className="content-area fade-in">
              {children}
            </main>
          </div>
        </div>
      ) : (
        <>
          <ThemeModeToggle floating />
          {isExcluded ? children : <LoginPage />}
        </>
      )}
    </>
  );
}
