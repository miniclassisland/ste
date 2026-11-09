"use client";

import React, { useMemo } from "react";
import { Dropdown, Option } from "@fluentui/react-components";

export interface CustomSelectChangeData {
    value: string;
}

export interface CustomSelectProps {
    value?: string | number;
    defaultValue?: string | number;
    onChange?: (event: React.SyntheticEvent | Event, data: CustomSelectChangeData) => void;
    size?: "small" | "medium" | "large";
    disabled?: boolean;
    style?: React.CSSProperties;
    className?: string;
    children?: React.ReactNode;
    placeholder?: string;
    id?: string;
    title?: string;
    "aria-label"?: string;
}

interface ParsedOption {
    value: string;
    label: string;
    disabled?: boolean;
}

function extractText(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") {
        return "";
    }
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(extractText).join("");
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
        return extractText(node.props.children);
    }
    return "";
}

function collectOptions(children: React.ReactNode): ParsedOption[] {
    const result: ParsedOption[] = [];
    React.Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return;
        const props = child.props as {
            value?: string | number;
            disabled?: boolean;
            children?: React.ReactNode;
        };
        if (child.type === React.Fragment) {
            result.push(...collectOptions(props.children));
            return;
        }
        const label = extractText(props.children).trim();
        const val = props.value !== undefined ? String(props.value) : label;
        result.push({
            value: val,
            label: label || val,
            disabled: props.disabled,
        });
    });
    return result;
}

/**
 * 统一的 Fluent UI 下拉选择器，完全替代浏览器原生 <select>，
 * 保持与原 Fluent <Select> 相同的 children (<option>) 与 onChange(_, { value }) 调用签名。
 */
export function Select({
    value,
    defaultValue,
    onChange,
    size = "medium",
    disabled = false,
    style,
    className,
    children,
    placeholder,
    id,
    title,
    "aria-label": ariaLabel,
}: CustomSelectProps) {
    const options = useMemo(() => collectOptions(children), [children]);

    const currentVal =
        value !== undefined
            ? String(value)
            : defaultValue !== undefined
            ? String(defaultValue)
            : options[0]?.value ?? "";

    const matchedOption = useMemo(
        () => options.find((o) => o.value === currentVal),
        [options, currentVal]
    );

    const displayValue = matchedOption
        ? matchedOption.label
        : currentVal || placeholder || options[0]?.label || "";

    const mergedStyle: React.CSSProperties = {
        minWidth: size === "small" ? 110 : 140,
        ...style,
    };

    return (
        <Dropdown
            id={id}
            title={title}
            aria-label={ariaLabel || title || placeholder || "下拉选择"}
            size={size}
            disabled={disabled}
            className={`custom-fluent-dropdown custom-fluent-dropdown-${size} ${className || ""}`.trim()}
            style={mergedStyle}
            value={displayValue}
            selectedOptions={[currentVal]}
            placeholder={placeholder}
            positioning={{ autoSize: "height" }}
            onOptionSelect={(ev, data) => {
                if (data.optionValue !== undefined) {
                    onChange?.(ev, { value: data.optionValue });
                }
            }}
        >
            {options.map((opt, idx) => (
                <Option
                    key={`${opt.value}-${idx}`}
                    value={opt.value}
                    text={opt.label}
                    disabled={opt.disabled}
                >
                    {opt.label}
                </Option>
            ))}
        </Dropdown>
    );
}

export default Select;
