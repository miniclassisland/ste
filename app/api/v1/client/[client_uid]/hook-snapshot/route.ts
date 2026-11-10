import { NextResponse } from "next/server";
import { markClientExtendEnabled, touchClientLastSeen } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ client_uid: string }> }
) {
  try {
    const { client_uid } = await context.params;
    const xff = request.headers.get("x-forwarded-for");
    const clientIp = xff ? xff.split(",")[0].trim() : "127.0.0.1";
    const extVer = (request.headers.get("x-extend-management-version") || "2.0.0.3").trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    markClientExtendEnabled(client_uid, String(body.pluginVersion || body.version || extVer), {
      isAppLocked:
        typeof body.isAppLocked === "boolean"
          ? body.isAppLocked
          : typeof body.is_app_locked === "boolean"
            ? body.is_app_locked
            : undefined,
      pluginSettings: body.pluginSettings ?? body.plugin_settings,
      pluginComponents: body.pluginComponents ?? body.plugin_components,
      hardwareInfo:
        (body.hardwareInfo as Record<string, unknown> | undefined) ??
        (body.hardware_info as Record<string, unknown> | undefined),
    });
    touchClientLastSeen(client_uid, clientIp);

    return NextResponse.json(
      { status: "ok", client_uid },
      {
        headers: {
          "X-MiniClassIsland-Server": "miniclassisland-ste",
          "X-Server-Flavor": "miniclassisland-ste",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Failed to save hook snapshot" },
      {
        status: 500,
        headers: {
          "X-MiniClassIsland-Server": "miniclassisland-ste",
          "X-Server-Flavor": "miniclassisland-ste",
        },
      }
    );
  }
}
