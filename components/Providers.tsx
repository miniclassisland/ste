"use client";

import React, { createContext, useContext } from "react";
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  SSRProvider,
  RendererProvider,
  createDOMRenderer,
  renderToStyleElements,
} from "@fluentui/react-components";
import type { Theme } from "@fluentui/react-components";
import { useServerInsertedHTML } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { AccountProvider } from "@/lib/account-context";
import { ThemeModeProvider, useThemeMode } from "@/lib/theme-context";
import type { AccountOut, ClientDeviceOut, PairingCodeOut } from "@/lib/types";

const FONT_BASE =
  "'Google Sans Flex', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_MONO = "'Google Sans Code', 'Noto Sans SC', monospace";

const miniclassislandLightTheme: Theme = {
  ...webLightTheme,
  fontFamilyBase: FONT_BASE,
  fontFamilyMonospace: FONT_MONO,
};

const miniclassislandDarkTheme: Theme = {
  ...webDarkTheme,
  fontFamilyBase: FONT_BASE,
  fontFamilyMonospace: FONT_MONO,
  colorNeutralForegroundOnBrand: "#ffffff",
  colorBrandBackground: "#2899f5",
  colorBrandBackgroundHover: "#4baeff",
  colorBrandBackgroundPressed: "#0078d4",
};

export interface HydrationInitialState {
  authenticated: boolean;
  passwordInitialized: boolean;
  token: string;
  account: (AccountOut & { server_url?: string }) | null;
  initialClients: ClientDeviceOut[];
  initialPairings: PairingCodeOut[];
}

const HydrationDataContext = createContext<HydrationInitialState>({
  authenticated: false,
  passwordInitialized: true,
  token: "",
  account: null,
  initialClients: [],
  initialPairings: [],
});

export function useHydrationData() {
  return useContext(HydrationDataContext);
}

function FluentThemeWrapper({
  children,
  hydrationValue,
}: {
  children: React.ReactNode;
  hydrationValue: HydrationInitialState;
}) {
  const { resolvedTheme } = useThemeMode();
  return (
    <FluentProvider
      theme={
        resolvedTheme === "dark"
          ? miniclassislandDarkTheme
          : miniclassislandLightTheme
      }
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      <HydrationDataContext.Provider value={hydrationValue}>
        <AuthProvider
          initialAuthenticated={hydrationValue.authenticated}
          initialPasswordInitialized={hydrationValue.passwordInitialized}
          initialToken={hydrationValue.token}
        >
          <AccountProvider initialAccount={hydrationValue.account}>
            {children}
          </AccountProvider>
        </AuthProvider>
      </HydrationDataContext.Provider>
    </FluentProvider>
  );
}

export default function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: HydrationInitialState;
}) {
  const [renderer] = React.useState(() => createDOMRenderer());
  const didRenderRef = React.useRef(false);

  useServerInsertedHTML(() => {
    if (didRenderRef.current) return;
    didRenderRef.current = true;
    return <>{renderToStyleElements(renderer)}</>;
  });

  const hydrationValue: HydrationInitialState = initialState || {
    authenticated: false,
    passwordInitialized: true,
    token: "",
    account: null,
    initialClients: [],
    initialPairings: [],
  };

  return (
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <ThemeModeProvider>
          <FluentThemeWrapper hydrationValue={hydrationValue}>
            {children}
          </FluentThemeWrapper>
        </ThemeModeProvider>
      </SSRProvider>
    </RendererProvider>
  );
}
