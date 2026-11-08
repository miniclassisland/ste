import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import AppShell from "@/components/AppShell";
import { getServerHydrationState } from "@/lib/actions";

export const metadata: Metadata = {
  title: "MINI ClassIsland STE",
  description: "MINI ClassIsland 集控管理平台",
  icons: {
    icon: "/icon.svg",
  },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialState = await getServerHydrationState();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body{background-color:#f5f5f5;margin:0}html[data-theme="dark"],html[data-theme="dark"] body{background-color:#121212}@media(prefers-color-scheme:dark){html:not([data-theme="light"]),html:not([data-theme="light"]) body{background-color:#121212}}html[data-auth-bg="1"],html[data-auth-bg="1"] body,html[data-auth-bg="1"] .fui-FluentProvider{background-color:#0078d4!important}html[data-theme="dark"][data-auth-bg="1"],html[data-theme="dark"][data-auth-bg="1"] body,html[data-theme="dark"][data-auth-bg="1"] .fui-FluentProvider{background-color:#0d1520!important}@media(prefers-color-scheme:dark){html:not([data-theme="light"])[data-auth-bg="1"],html:not([data-theme="light"])[data-auth-bg="1"] body,html:not([data-theme="light"])[data-auth-bg="1"] .fui-FluentProvider{background-color:#0d1520!important}}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var R=document.documentElement,m=localStorage.getItem("miniclassisland_theme_mode")||"system",d=m==="dark"||(m==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches),r=d?"dark":"light";R.setAttribute("data-theme",r);R.setAttribute("data-theme-mode",m);R.style.colorScheme=r;var p=location.pathname||"/",t=localStorage.getItem("miniclassisland_auth_token")||${JSON.stringify(initialState.token)};if(/^\\/(login)(\\/|$)/.test(p)||!t)R.setAttribute("data-auth-bg","1");}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers initialState={initialState}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
