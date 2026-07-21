"use client";

import { Fragment } from "react";
import { resolveCell } from "@/lib/availability";
import { formatDateShortAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
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

const CELL_LABELS: Record<CellResolution["status"], string> = {
  available: "متاحة",
  booked: "محجوزة",
  friday_holiday: "إجازة",
  inactive: "غير نشطة",
};

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
                      return (
                        <td
                          key={`${date}-${shift}`}
                          className="border-b border-l border-slate-200 p-1.5 text-center"
                        >
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => clickable && onCellClick(worker, date, shift, resolution)}
                            className={`flex h-11 w-full min-w-16 items-center justify-center rounded-lg text-xs font-medium transition-colors ${CELL_STYLES[resolution.status]}`}
                          >
                            {CELL_LABELS[resolution.status]}
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
