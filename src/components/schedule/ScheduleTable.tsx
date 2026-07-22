"use client";

import { Fragment } from "react";
import { resolveCell } from "@/lib/availability";
import { formatDateShortAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
import { useManagerSession } from "@/context/ManagerSessionContext";
import type {
  Booking,
  CellResolution,
  RecurringException,
  RecurringSchedule,
  Shift,
  Worker,
} from "@/lib/types";

const CELL_STYLES: Record<CellResolution["status"], string> = {
  available: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer",
  booked: "bg-red-100 text-red-800 hover:bg-red-200 cursor-pointer",
  friday_holiday: "bg-amber-100 text-amber-800 cursor-default",
  inactive: "bg-slate-100 text-slate-400 cursor-default",
};

const CELL_LABELS: Record<Exclude<CellResolution["status"], "booked">, string> = {
  available: "متاحة",
  friday_holiday: "إجازة",
  inactive: "غير نشطة",
};

const BOOKED_FALLBACK_LABEL = "محجوزة";

/**
 * Booked cells show the booking's typed area name instead of a generic
 * "محجوزة" label, so the schedule grid itself is more informative at a
 * glance — never the customer phone number or location, which stay behind
 * the booking-details click-through. Falls back to the generic label only
 * if the area is unexpectedly empty (older data from before area became a
 * required field).
 */
export function cellLabel(resolution: CellResolution): string {
  if (resolution.status !== "booked") return CELL_LABELS[resolution.status];
  const areaName = resolution.booking?.areaName ?? resolution.virtualOccurrence?.recurring.areaName ?? "";
  return areaName.trim() || BOOKED_FALLBACK_LABEL;
}

export function ScheduleTable({
  workers,
  dates,
  bookings,
  recurringSchedules,
  exceptions,
  onCellClick,
}: {
  workers: Worker[];
  dates: string[];
  bookings: Booking[];
  recurringSchedules: RecurringSchedule[];
  exceptions: RecurringException[];
  onCellClick: (worker: Worker, date: string, shift: Shift, resolution: CellResolution) => void;
}) {
  const today = todayBahrain();
  const multiDay = dates.length > 1;
  const { isManager } = useManagerSession();

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky right-0 z-10 min-w-[110px] border-b border-l border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-700"
            >
              العاملة
            </th>
            {dates.map((date) => (
              <th
                key={date}
                colSpan={2}
                className={`border-b border-l border-slate-200 px-2 py-2 text-center font-semibold ${
                  date === today ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-700"
                }`}
              >
                {multiDay ? (
                  <>
                    {weekdayLabelAr(date)}
                    <span className="block text-xs font-normal text-slate-500">
                      {formatDateShortAr(date)}
                    </span>
                  </>
                ) : (
                  "اليوم"
                )}
              </th>
            ))}
          </tr>
          <tr>
            {dates.map((date) => (
              <Fragment key={date}>
                <th className="border-b border-l border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-slate-500">
                  صباحي
                </th>
                <th className="border-b border-l border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-slate-500">
                  مسائي
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr key={worker.id}>
              <td className="sticky right-0 z-10 border-b border-l border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">
                {worker.name}
              </td>
              {dates.map((date) => {
                const shifts: Shift[] = ["morning", "afternoon"];
                return (
                  <Fragment key={date}>
                    {shifts.map((shift) => {
                      const resolution = resolveCell(
                        worker,
                        date,
                        shift,
                        bookings,
                        recurringSchedules,
                        exceptions
                      );
                      const clickable = resolution.status === "available" || resolution.status === "booked";
                      const isPaid = resolution.status === "booked" && (resolution.booking?.paid ?? false);
                      return (
                        <td
                          key={`${date}-${shift}`}
                          className="border-b border-l border-slate-200 p-1.5 text-center"
                        >
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => clickable && onCellClick(worker, date, shift, resolution)}
                            title={cellLabel(resolution)}
                            className={`relative flex h-11 w-full min-w-16 items-center justify-center truncate rounded-lg px-1.5 text-xs font-medium transition-colors ${CELL_STYLES[resolution.status]}`}
                          >
                            {cellLabel(resolution)}
                            {isManager && resolution.status === "booked" && (
                              <span
                                title={isPaid ? "مدفوع" : "غير مدفوع"}
                                className={`absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                                  isPaid ? "bg-emerald-600" : "bg-amber-500"
                                }`}
                              />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
