"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const baseInputClasses =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-500";

export function FieldWrapper({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

export function TextInput({
  label,
  error,
  required,
  ...rest
}: { label: string; error?: string; required?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldWrapper label={label} error={error} required={required}>
      <input className={baseInputClasses} required={required} {...rest} />
    </FieldWrapper>
  );
}

export function TextArea({
  label,
  error,
  required,
  ...rest
}: { label: string; error?: string; required?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldWrapper label={label} error={error} required={required}>
      <textarea className={baseInputClasses} required={required} rows={2} {...rest} />
    </FieldWrapper>
  );
}

export function SelectInput({
  label,
  error,
  required,
  children,
  ...rest
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldWrapper label={label} error={error} required={required}>
      <select className={baseInputClasses} required={required} {...rest}>
        {children}
      </select>
    </FieldWrapper>
  );
}
