export interface SerializedTimestamp {
  _seconds: number;
  _nanoseconds: number;
}

export type Timestamp = SerializedTimestamp;

export type Role = "employee" | "manager";

export type Shift = "morning" | "afternoon";

export type PaymentMethod = "benefit" | "cash";

export type BookingSource =
  | "today"
  | "weekly"
  | "manager_future"
  | "recurring";

export type BookingStatus = "active" | "cancelled";

export interface Worker {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt: Timestamp | null;
  updatedBy: string;
}

export interface Area {
  id: string;
  name: string;
  active: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
  updatedAt: Timestamp | null;
  updatedBy: string;
}

export interface Booking {
  id: string;
  date: string; // yyyy-MM-dd (Asia/Bahrain calendar date)
  shift: Shift;
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  paid: boolean;
  paidAmount: number | null;
  paymentDate: Timestamp | null;
  paymentBy: string | null;
  customerPhone: string;
  customerLocation: string;
  source: BookingSource;
  recurringSeriesId: string | null;
  status: BookingStatus;
  cancelledAt: Timestamp | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  cancelScope: "single" | "forward" | null;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export type RecurringScheduleStatus = "active" | "ended" | "cancelled";

export interface RecurringSchedule {
  id: string;
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  shift: Shift;
  dayOfWeek: number; // 0=Sunday ... 6=Saturday, 5(Friday) not allowed
  hours: number;
  amount: number;
  customerPhone: string;
  customerLocation: string;
  startDate: string; // yyyy-MM-dd, inclusive
  endDate: string | null; // yyyy-MM-dd, inclusive, null = open-ended
  status: RecurringScheduleStatus;
  replacesId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

/**
 * Marks a single calendar date as excluded from a recurring schedule's pattern.
 * Only "cancelled" dates need a record: single-occurrence edits are handled by
 * materializing a concrete Booking for that date instead (see lib/recurring.ts).
 */
export interface RecurringException {
  id: string; // `${recurringId}_${date}`
  recurringId: string;
  date: string;
  type: "cancelled";
  reason: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
}

export interface BookingSlot {
  id: string; // `${workerId}_${date}_${shift}`
  bookingId: string;
  workerId: string;
  date: string;
  shift: Shift;
  createdAt: Timestamp | null;
}

export type ActivityActionType =
  | "login"
  | "booking_created"
  | "booking_edited"
  | "booking_cancelled"
  | "payment_marked_paid"
  | "payment_reverted"
  | "payment_method_changed"
  | "payment_amount_changed"
  | "settlement_calculated"
  | "worker_added"
  | "worker_edited"
  | "worker_activated"
  | "worker_deactivated"
  | "recurring_created"
  | "recurring_edited"
  | "recurring_cancelled"
  | "area_added"
  | "area_edited"
  | "area_deactivated"
  | "settings_updated";

export interface ActivityLog {
  id: string;
  type: ActivityActionType;
  entityType: string;
  entityId: string;
  actingUid: string;
  actingEmail: string;
  actingName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Timestamp | null;
}

export interface AppSettings {
  businessName: string;
  timezone: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}

export type CellStatus = "available" | "booked" | "friday_holiday" | "inactive";

export interface CellResolution {
  status: CellStatus;
  booking: Booking | null;
  virtualOccurrence: {
    recurring: RecurringSchedule;
    exception: RecurringException | null;
  } | null;
}
