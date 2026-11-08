import { NextResponse } from "next/server";
import { buildManagementPreset } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const classIdentity = url.searchParams.get("class_identity") || undefined;
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:21196";
  const originUrl = `${proto}://${host}`;

  const preset = buildManagementPreset(classIdentity, originUrl);
  return NextResponse.json(preset, {
    headers: {
      "Content-Disposition": 'attachment; filename="ManagementPreset.json"',
    },
  });
}
