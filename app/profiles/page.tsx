"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProfilesIndexPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/profiles/timelayout");
    }, [router]);
    return null;
}
