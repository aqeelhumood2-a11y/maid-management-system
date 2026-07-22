import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getFinancialSummaryServer } from "@/lib/server/financialSummary";
import { ServiceError } from "@/lib/server/bookingService";
import { formatDateAr } from "@/lib/date";

/**
 * Excel export of a Financial Settlement summary. Built server-side with
 * ExcelJS (rather than in the browser) so it can reuse
 * getFinancialSummaryServer directly — the exported numbers are guaranteed
 * to match whatever the manager sees on screen, computed exactly once.
 */
export async function GET(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "معطيات الاستعلام غير مكتملة" }, { status: 400 });
  }

  let summary;
  try {
    summary = await getFinancialSummaryServer(getAdminDb(), start, end, await getActor());
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حساب التسوية المالية" }, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "نظام إدارة العاملات";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("الملخص", { views: [{ rightToLeft: true }] });
  summarySheet.columns = [
    { header: "العاملة", key: "name", width: 24 },
    { header: "الحجوزات المكتملة", key: "completed", width: 18 },
    { header: "الحجوزات المدفوعة", key: "paid", width: 18 },
    { header: "إجمالي الأرباح (د.ب)", key: "earnings", width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  for (const w of summary.workers) {
    summarySheet.addRow({
      name: w.workerName,
      completed: w.totalCompletedBookings,
      paid: w.totalPaidBookings,
      earnings: Number(w.totalEarnings.toFixed(3)),
    });
  }
  summarySheet.addRow({});
  const totalsRows = [
    summarySheet.addRow({ name: "إجمالي أرباح العاملات", earnings: Number(summary.workersTotal.toFixed(3)) }),
    summarySheet.addRow({ name: "إجمالي التحصيل من العملاء", earnings: Number(summary.overallTotal.toFixed(3)) }),
    summarySheet.addRow({ name: "صافي المدير", earnings: Number(summary.managerNet.toFixed(3)) }),
  ];
  for (const row of totalsRows) row.font = { bold: true };

  const dailySheet = workbook.addWorksheet("التفصيل اليومي", { views: [{ rightToLeft: true }] });
  dailySheet.columns = [
    { header: "العاملة", key: "name", width: 24 },
    { header: "التاريخ", key: "date", width: 14 },
    { header: "الحجوزات المكتملة", key: "completed", width: 18 },
    { header: "الحجوزات المدفوعة", key: "paid", width: 18 },
    { header: "الأرباح (د.ب)", key: "earnings", width: 16 },
  ];
  dailySheet.getRow(1).font = { bold: true };
  for (const w of summary.workers) {
    for (const day of w.daily) {
      dailySheet.addRow({
        name: w.workerName,
        date: formatDateAr(day.date),
        completed: day.completedBookings,
        paid: day.paidBookings,
        earnings: Number(day.earnings.toFixed(3)),
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="financial-settlement_${start}_${end}.xlsx"`,
    },
  });
}
