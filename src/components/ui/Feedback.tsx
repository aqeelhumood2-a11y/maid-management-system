export function Spinner({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center text-slate-500">
      <span className="text-3xl">📋</span>
      <p className="max-w-xs text-sm">{message}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {message}
    </div>
  );
}

export function Badge({
  color,
  children,
}: {
  color: "green" | "red" | "yellow" | "gray";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-amber-100 text-amber-800",
    gray: "bg-slate-200 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[color]}`}>
      {children}
    </span>
  );
}
