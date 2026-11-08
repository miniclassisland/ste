import { NextResponse } from "next/server";
import { consumeDownloadToken } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    if (!token) {
      return NextResponse.json({ detail: "Missing token" }, { status: 403 });
    }
    const content = consumeDownloadToken(token);
    return NextResponse.json(content);
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Invalid or expired download token" },
      { status: 403 }
    );
  }
}
