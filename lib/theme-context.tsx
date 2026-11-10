"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
    WeatherSunny20Regular,
    WeatherMoon20Regular,
    DarkTheme20Regular,
} from "@fluentui/react-icons";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "miniclassisland_theme_mode";

interface ThemeModeContextValue {
    mode: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setMode: (mode: ThemeMode) => void;
    cycleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
    mode: "system",
    resolvedTheme: "light",
    setMode: () => {},
    cycleMode: () => {},
});

function getSystemDark(): boolean {
    if (typeof window === "undefined") return false;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return true;
    }
    if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark") {
        return true;
    }
    return false;
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setModeState] = useState<ThemeMode>(() => {
        if (typeof window === "undefined") return "system";
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === "light" || saved === "dark" || saved === "system") {
                return saved;
            }
        } catch {
            /* ignore */
        }
        return "system";
    });
    const [systemDark, setSystemDark] = useState<boolean>(() => getSystemDark());

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === "light" || saved === "dark" || saved === "system") {
                setModeState(saved);
            }
        } catch {
            /* ignore */
        }
        if (window.matchMedia) {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            setSystemDark(mq.matches);
            const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
            mq.addEventListener("change", handler);
            return () => mq.removeEventListener("change", handler);
        }
        setSystemDark(getSystemDark());
        return undefined;
    }, []);

    const resolvedTheme: ResolvedTheme = mode === "system"
        ? (systemDark ? "dark" : "light")
        : mode;

    useEffect(() => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        root.setAttribute("data-theme", resolvedTheme);
        root.setAttribute("data-theme-mode", mode);
        root.style.colorScheme = resolvedTheme;
    }, [resolvedTheme, mode]);

    const setMode = useCallback((next: ThemeMode) => {
        setModeState(next);
        if (typeof window !== "undefined") {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        }
    }, []);

    const cycleMode = useCallback(() => {
        setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
    }, [mode, setMode]);

    return (
        <ThemeModeContext.Provider value={{ mode, resolvedTheme, setMode, cycleMode }}>
            {children}
        </ThemeModeContext.Provider>
    );
}

export function useThemeMode() {
    return useContext(ThemeModeContext);
}

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
    system: "自动深色",
    light: "浅色模式",
    dark: "深色模式",
};

/**
 * 主题切换组件：三个仅图标分段按钮并排切换（自动跟随系统 / 浅色 / 深色）。
 */
export function ThemeModeToggle({
    floating = false,
}: {
    floating?: boolean;
    compact?: boolean;
}) {
    const { mode, setMode } = useThemeMode();

    return (
        <div
            className={floating ? "theme-switcher-floating" : "theme-switcher-group"}
            role="group"
            aria-label="主题外观切换"
        >
            <button
                type="button"
                className={`theme-segment-btn ${mode === "system" ? "active" : ""}`}
                onClick={() => setMode("system")}
                title="自动深色"
                aria-label="自动深色"
                aria-pressed={mode === "system"}
                style={{ width: 28, padding: 0 }}
            >
                <DarkTheme20Regular style={{ width: 16, height: 16 }} />
            </button>
            <button
                type="button"
                className={`theme-segment-btn ${mode === "light" ? "active" : ""}`}
                onClick={() => setMode("light")}
                title="浅色模式"
                aria-label="浅色模式"
                aria-pressed={mode === "light"}
                style={{ width: 28, padding: 0 }}
            >
                <WeatherSunny20Regular style={{ width: 16, height: 16 }} />
            </button>
            <button
                type="button"
                className={`theme-segment-btn ${mode === "dark" ? "active" : ""}`}
                onClick={() => setMode("dark")}
                title="深色模式"
                aria-label="深色模式"
                aria-pressed={mode === "dark"}
                style={{ width: 28, padding: 0 }}
            >
                <WeatherMoon20Regular style={{ width: 16, height: 16 }} />
            </button>
        </div>
    );
}
