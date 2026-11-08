"use server";

import { cookies, headers } from "next/headers";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import { SteSecurityGatewayService } from "./server/proto";
import { registerConnectRoutes } from "./server/connect-routes";
import {
  verifyWebSession,
  isPasswordInitialized,
  getTenantAccount,
  listClients,
  listPairingCodes,
} from "./server/db";

const SESSION_COOKIE_NAME = "miniclassisland_ste_token";

// In-process ConnectES transport for Server Actions & SSR hydration
const connectTransport = createRouterTransport(registerConnectRoutes);
const connectGatewayClient = createClient(SteSecurityGatewayService, connectTransport);

async function getOriginFromHeaders(): Promise<string> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") || "http";
    const host = h.get("x-forwarded-host") || h.get("host") || "localhost:21196";
    return `${proto}://${host}`;
  } catch {
    return "http://localhost:21196";
  }
}

export async function getServerHydrationState() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || "";
    const originUrl = await getOriginFromHeaders();
    const authenticated = verifyWebSession(token);
    const passwordInitialized = isPasswordInitialized();

    if (!authenticated) {
      return {
        authenticated: false,
        passwordInitialized,
        token: "",
        account: null,
        initialClients: [],
        initialPairings: [],
      };
    }

    return {
      authenticated: true,
      passwordInitialized,
      token,
      account: getTenantAccount(originUrl),
      initialClients: listClients(),
      initialPairings: listPairingCodes(),
    };
  } catch {
    return {
      authenticated: false,
      passwordInitialized: true,
      token: "",
      account: null,
      initialClients: [],
      initialPairings: [],
    };
  }
}

export async function invokeConnectAction<T = unknown>(
  action: string,
  clientToken: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(SESSION_COOKIE_NAME)?.value || "";
  const effectiveToken = clientToken || cookieToken;
  const originUrl = await getOriginFromHeaders();

  const res = await connectGatewayClient.invoke(
    {
      Action: action,
      Token: effectiveToken,
      PayloadJson: JSON.stringify(payload ?? {}),
    },
    {
      headers: {
        "x-forwarded-host": originUrl.replace(/^https?:\/\//, ""),
        "x-forwarded-proto": originUrl.startsWith("https") ? "https" : "http",
      },
    }
  );

  if (!res.Ok) {
    throw new Error(res.Error || "请求处理失败");
  }

  const parsed = res.ResultJson ? JSON.parse(res.ResultJson) : null;

  // Sync HTTP-only / SSR cookie on login or logout so Next.js SSR Hydration works seamlessly
  if (action === "auth.login" && parsed && typeof parsed === "object" && "access_token" in parsed) {
    try {
      cookieStore.set(SESSION_COOKIE_NAME, String((parsed as { access_token: string }).access_token), {
        path: "/",
        maxAge: 30 * 24 * 3600,
        sameSite: "lax",
      });
    } catch {
      // Ignore cookie write errors if called outside action context
    }
  } else if (action === "auth.logout") {
    try {
      cookieStore.delete(SESSION_COOKIE_NAME);
    } catch {
      // Ignore
    }
  }

  return parsed as T;
}
