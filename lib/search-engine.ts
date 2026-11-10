export interface SearchToken {
    key?: string;
    value: string;
}

export function parseSearchTokens(rawQuery: string): SearchToken[] {
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];
    const tokens = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    return tokens.map((token) => {
        const colonIdx = token.indexOf(":");
        if (colonIdx > 0) {
            return {
                key: token.slice(0, colonIdx).toLowerCase(),
                value: token.slice(colonIdx + 1).replace(/^"|"$/g, ""),
            };
        }
        return {
            value: token.replace(/^"|"$/g, ""),
        };
    });
}

export function matchesWildcardOrSubstring(target: string | null | undefined, pattern: string): boolean {
    const str = String(target ?? "");
    if (!pattern) return true;
    if (pattern.includes("*")) {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
        return new RegExp(`^${escaped}$`, "i").test(str);
    }
    return str.toLowerCase().includes(pattern.toLowerCase());
}

export function matchAdvancedQuery<T>(
    item: T,
    rawQuery: string,
    config: {
        fields: Record<string, (item: T) => string | boolean | number | Array<string | null | undefined> | null | undefined>;
        freeText: (item: T) => Array<string | null | undefined>;
    }
): boolean {
    const tokens = parseSearchTokens(rawQuery);
    if (tokens.length === 0) return true;

    for (const token of tokens) {
        if (token.key && token.key in config.fields) {
            const rawVal = config.fields[token.key](item);
            const targetVal = token.value.toLowerCase();
            if (Array.isArray(rawVal)) {
                const hit = rawVal.some((v) => matchesWildcardOrSubstring(v, token.value));
                if (!hit) return false;
            } else if (typeof rawVal === "boolean") {
                const boolStr = rawVal ? "true" : "false";
                if (boolStr !== targetVal) return false;
            } else {
                if (!matchesWildcardOrSubstring(String(rawVal ?? ""), token.value)) return false;
            }
            continue;
        }
        const kw = token.value;
        const candidates = config.freeText(item);
        const hit = candidates.some((c) => matchesWildcardOrSubstring(c, kw));
        if (!hit) return false;
    }

    return true;
}
