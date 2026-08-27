import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BatteryCharging,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Home,
  Info,
  Library,
  MapPin,
  Menu,
  Navigation,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  UserCircle,
  LogIn,
  LogOut,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import "./App.css";
import {
  subscribeToAuthChanges,
  signInWithGoogle,
  signOutUser,
} from "./firebase";
import {
  syncUserProfile,
  updateUserCredits,
  updateUserLocation,
  getStudySpacesFromDb,
  seedStudySpacesIfEmpty,
  createFirestoreReservation,
  getUserReservationsFromDb,
  subscribeToAllReservations,
  subscribeToStudySpaces,
  updateReservationStatusInDb,
  addCreditTransactionToDb,
  getUserTransactionsFromDb,
} from "./services/firestore";


/* =========================================================
   SAFE LOCAL STORAGE HELPERS
   ========================================================= */
const loadStorage = (key, fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return fallback;
    }

    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;

    return JSON.parse(raw);
  } catch (error) {
    console.warn(`StudySpot localStorage read failed for "${key}".`, error);
    return fallback;
  }
};

const saveStorage = (key, value) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`StudySpot localStorage write failed for "${key}".`, error);
  }
};


/* =========================================================
   DATE / TIME FORMAT HELPERS — V2
   Function declarations are intentionally hoisted so every component
   can safely use them regardless of declaration order.
   ========================================================= */
function formatTimeStr(dateObj) {
  return new Date(dateObj).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHourStr(dateObj) {
  return new Date(dateObj).toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
  });
}

function formatDateLongStr(dateObj) {
  return new Date(dateObj)
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

function formatSecondsToMMSS(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function formatSecondsToHHMMSS(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function getGreeting(dateObj) {
  const hour = new Date(dateObj).getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

/* =========================================================
   FIRESTORE ↔ LOCAL DATA HELPERS
   Function declarations are intentionally hoisted so every component
   can safely use them regardless of declaration order.
   ========================================================= */

/**
 * Normalizes a raw Firestore study-space document into the shape that the
 * local `studySpaces` array uses.  Firestore field names may differ slightly
 * from the hard-coded prototype data (e.g. camelCase vs snake_case, missing
 * optional fields), so this function provides safe defaults for everything
 * the UI reads.
 */
function normalizeFirestoreSpace(doc) {
  if (!doc) return null;

  return {
    id: doc.id ?? "",
    name: doc.name ?? "Unnamed Space",
    building: doc.building ?? "",
    description: doc.description ?? "",
    totalSeats: Number(doc.totalSeats ?? 0),
    chargingSeats: Number(doc.chargingSeats ?? 0),
    groupTables: Number(doc.groupTables ?? 0),
    floors: Number(doc.floors ?? 1),
    noiseLevel: doc.noiseLevel ?? "Moderate",
    studyType: doc.studyType ?? "Individual & Group",
    defaultWalkingTime: Number(doc.defaultWalkingTime ?? 0),
    defaultDistance: Number(doc.defaultDistance ?? 0),
    usualModifier: Number(doc.usualModifier ?? 1.0),
    currentOccupancy: Number(doc.currentOccupancy ?? 0),
    assumptionNote: doc.assumptionNote ?? "",
  };
}

/**
 * Returns the first Firestore reservation that conflicts with the proposed
 * seat + time window, or `null` if no conflict exists.
 *
 * A conflict means: same location, same seat, status is "reserved" or
 * "checked_in", the reservation has not expired, AND the time windows
 * overlap (requestedStart < existingEnd AND requestedEnd > existingStart).
 */
function getSeatReservationConflict(
  reservations,
  locationId,
  seatId,
  startTimeMs,
  endTimeMs,
) {
  if (!Array.isArray(reservations)) return null;

  const nowMs = Date.now();
  const requestedLocationId = String(locationId ?? "");
  const requestedSeatId = String(seatId ?? "");

  const conflict = reservations.find((reservation) => {
    if (!reservation) return false;

    const reservedLocationId = String(reservation.locationId ?? reservation.location?.id ?? "");
    const reservedSeatId = String(reservation.seatId ?? reservation.seat?.id ?? "");

    if (reservedLocationId !== requestedLocationId || reservedSeatId !== requestedSeatId) {
      return false;
    }

    const status = String(reservation.status ?? "").toLowerCase();
    if (status !== "reserved" && status !== "checked_in") {
      return false;
    }

    const existingStartMs = Number(reservation.startTimeMs ?? 0);
    const existingEndMs = Number(reservation.endTimeMs ?? 0);

    if (existingEndMs > 0 && existingEndMs <= nowMs) {
      return false;
    }

    if (!existingStartMs || !existingEndMs) {
      return true;
    }

    return startTimeMs < existingEndMs && endTimeMs > existingStartMs;
  }) ?? null;

  return conflict;
}

/**
 * Flattens a local booking object into the document shape expected by
 * `createFirestoreReservation()`.  The Firestore function reads `locationId`,
 * `seatId`, `startTimeMs`, `endTimeMs`, and spreads the rest into the doc.
 */
function serializeBookingForFirestore(booking, userId) {
  return {
    userId,
    locationId: booking.location?.id ?? "",
    seatId: booking.seat?.id ?? "",
    location: booking.location ?? {},
    seat: booking.seat ?? {},
    duration: booking.duration,
    deposit: booking.deposit,
    status: booking.status,
    startTimeMs: booking.startTimeMs,
    endTimeMs: booking.endTimeMs,
    checkInDeadlineMs: booking.checkInDeadlineMs,
    startTimeStr: booking.startTimeStr,
    endTimeStr: booking.endTimeStr,
    warningNotified: booking.warningNotified ?? false,
    bookedAt: booking.bookedAt ?? Date.now(),
  };
}

/**
 * Flattens a local credit-transaction object into the document shape
 * expected by `addCreditTransactionToDb()`.
 */
function serializeTransactionForFirestore(tx, userId) {
  return {
    clientTransactionId: tx.id,
    userId,
    title: tx.title,
    subtitle: tx.subtitle,
    amount: tx.amount,
    type: tx.type,
    timestamp: tx.timestamp ?? Date.now(),
  };
}

/* =========================================================
   CAMPUS LOCATIONS & PROTOTYPE DISTANCE MATRIX
   ========================================================= */

const campusLocations = [
  "University Building (UB Block)",
  "Tech Park (Tech Park 1)",
  "Tech Park 2",
  "Basic Engineering Block (BEL / Main Building)",
  "Electrical & Sciences (ES) Block",
  "Biotechnology & Bioengineering Block",
  "School of Architecture & Design (SEAD Block)",
  "School of Law Block",
  "School of Management (SOM / Valliammai Block)",
  "Vendhar Square & Museum",
  "Dr. T.P. Ganesan Auditorium",
  "SRM Medical College Hospital & Research Centre",
  "SRM Kattankulathur Dental College & Hospital",
  "Pharmacy & Nursing Blocks",
  "Central Boys",
  "High-Rise Boys",
  "South Boys",
  "TRS / International Hostel",
  "Pierre Fauchard (Medical Boys)",
  "Central Girls",
  "Inner Ring Girls",
  "Medical Girls",
];

/*
 * VERIFIED SRM KATTANKULATHUR STUDY-SPACE DATA SUPPLIED FOR PHASE 1.
 * Charging/group counts are explicit prototype assumptions because the source
 * dataset provides total seating capacity, but not a verified charging/group
 * breakdown for every facility.
 */
const studySpaces = [
  {
    id: "central-library",
    name: "Central Library",
    building: "University Building (UB Block)",
    description: "Main SRM central library with reading halls, own-book zone, digital library and group discussion rooms.",
    totalSeats: 1500,
    chargingSeats: 450,
    groupTables: 40,
    floors: 3,
    noiseLevel: "Quiet",
    studyType: "Individual & Group",
    defaultWalkingTime: 0,
    defaultDistance: 0,
    usualModifier: 1.0,
    assumptionNote: "450 charging seats and 40 four-seat group tables are prototype assumptions.",
  },
  {
    id: "medical-library",
    name: "Medical Central Library",
    building: "Medical College Block",
    description: "Medical library with UG/PG reading halls, digital browsing hub and 24-hour reading hall.",
    totalSeats: 700,
    chargingSeats: 210,
    groupTables: 20,
    floors: 2,
    noiseLevel: "Quiet",
    studyType: "Individual & Group",
    defaultWalkingTime: 11,
    defaultDistance: 850,
    usualModifier: 0.9,
    assumptionNote: "Charging and group-table counts are prototype assumptions.",
  },
  {
    id: "dental-library",
    name: "Dental College Library",
    building: "Dental Block",
    description: "Dental research library with study seating, EBSCO research terminals and journal archives.",
    totalSeats: 200,
    chargingSeats: 50,
    groupTables: 10,
    floors: 1,
    noiseLevel: "Quiet",
    studyType: "Individual & Group",
    defaultWalkingTime: 0,
    defaultDistance: 0,
    usualModifier: 0.85,
    assumptionNote: "Charging and group-table counts are prototype assumptions.",
  },
  {
    id: "law-library",
    name: "School of Law Library",
    building: "School of Law Block",
    description: "Legal research library with law reporters, Bare Acts and focused study seating.",
    totalSeats: 150,
    chargingSeats: 30,
    groupTables: 8,
    floors: 1,
    noiseLevel: "Quiet",
    studyType: "Individual & Group",
    defaultWalkingTime: 7,
    defaultDistance: 550,
    usualModifier: 0.85,
    assumptionNote: "Charging and group-table counts are prototype assumptions.",
  },
  {
    id: "architecture-library",
    name: "Architecture Library",
    building: "School of Architecture & Design (SEAD Block)",
    description: "Architecture study library with drafting desks and design-reference archives.",
    totalSeats: 100,
    chargingSeats: 20,
    groupTables: 10,
    floors: 1,
    noiseLevel: "Moderate",
    studyType: "Individual & Group",
    defaultWalkingTime: 5,
    defaultDistance: 400,
    usualModifier: 0.8,
    assumptionNote: "Charging and group-table counts are prototype assumptions.",
  },
  {
    id: "tech-park-2-lounge",
    name: "Tech Park 2 Study Lounge",
    building: "Tech Park 2 (Ground Floor)",
    description: "Dedicated indoor study lounge with high tables, power outlets and Wi-Fi.",
    totalSeats: 150,
    chargingSeats: 45,
    groupTables: 12,
    floors: 1,
    noiseLevel: "Moderate",
    studyType: "Individual & Group",
    defaultWalkingTime: 1,
    defaultDistance: 120,
    usualModifier: 0.9,
    assumptionNote: "Charging and group-table counts are prototype assumptions.",
  },
];

const distanceMatrix = {
  "University Building (UB Block)": {
    "central-library": { distance: 0, walkingTime: 0 }, "tech-park-2-lounge": { distance: 250, walkingTime: 3 }, "law-library": { distance: 550, walkingTime: 7 }, "architecture-library": { distance: 400, walkingTime: 5 }, "medical-library": { distance: 850, walkingTime: 11 },
  },
  "Tech Park (Tech Park 1)": {
    "central-library": { distance: 150, walkingTime: 2 }, "tech-park-2-lounge": { distance: 120, walkingTime: 2 }, "law-library": { distance: 650, walkingTime: 8 }, "architecture-library": { distance: 500, walkingTime: 7 }, "medical-library": { distance: 900, walkingTime: 12 },
  },
  "Tech Park 2": {
    "central-library": { distance: 250, walkingTime: 3 }, "tech-park-2-lounge": { distance: 0, walkingTime: 0 }, "law-library": { distance: 700, walkingTime: 9 }, "architecture-library": { distance: 550, walkingTime: 7 }, "medical-library": { distance: 950, walkingTime: 13 },
  },
  "Basic Engineering Block (BEL / Main Building)": {
    "central-library": { distance: 300, walkingTime: 4 }, "tech-park-2-lounge": { distance: 350, walkingTime: 5 }, "law-library": { distance: 400, walkingTime: 5 }, "architecture-library": { distance: 250, walkingTime: 3 }, "medical-library": { distance: 700, walkingTime: 9 },
  },
  "Electrical & Sciences (ES) Block": {
    "central-library": { distance: 250, walkingTime: 3 }, "tech-park-2-lounge": { distance: 350, walkingTime: 5 }, "law-library": { distance: 500, walkingTime: 6 }, "architecture-library": { distance: 350, walkingTime: 5 }, "medical-library": { distance: 800, walkingTime: 10 },
  },
  "Biotechnology & Bioengineering Block": {
    "central-library": { distance: 350, walkingTime: 5 }, "tech-park-2-lounge": { distance: 450, walkingTime: 6 }, "law-library": { distance: 450, walkingTime: 6 }, "architecture-library": { distance: 300, walkingTime: 4 }, "medical-library": { distance: 750, walkingTime: 10 },
  },
  "School of Architecture & Design (SEAD Block)": {
    "central-library": { distance: 400, walkingTime: 5 }, "tech-park-2-lounge": { distance: 550, walkingTime: 7 }, "law-library": { distance: 250, walkingTime: 3 }, "architecture-library": { distance: 0, walkingTime: 0 }, "medical-library": { distance: 600, walkingTime: 8 },
  },
  "School of Law Block": {
    "central-library": { distance: 550, walkingTime: 7 }, "tech-park-2-lounge": { distance: 700, walkingTime: 9 }, "law-library": { distance: 0, walkingTime: 0 }, "architecture-library": { distance: 250, walkingTime: 3 }, "medical-library": { distance: 500, walkingTime: 6 },
  },
  "School of Management (SOM / Valliammai Block)": {
    "central-library": { distance: 350, walkingTime: 5 }, "tech-park-2-lounge": { distance: 500, walkingTime: 7 }, "law-library": { distance: 300, walkingTime: 4 }, "architecture-library": { distance: 200, walkingTime: 3 }, "medical-library": { distance: 650, walkingTime: 8 },
  },
  "Dr. T.P. Ganesan Auditorium": {
    "central-library": { distance: 350, walkingTime: 5 }, "tech-park-2-lounge": { distance: 500, walkingTime: 7 }, "law-library": { distance: 500, walkingTime: 6 }, "architecture-library": { distance: 350, walkingTime: 5 }, "medical-library": { distance: 750, walkingTime: 10 },
  },
  "SRM Medical College Hospital & Research Centre": {
    "central-library": { distance: 850, walkingTime: 11 }, "tech-park-2-lounge": { distance: 950, walkingTime: 13 }, "law-library": { distance: 500, walkingTime: 6 }, "architecture-library": { distance: 600, walkingTime: 8 }, "medical-library": { distance: 0, walkingTime: 0 },
  },
  "Central Boys": { "central-library": { distance: 450, walkingTime: 6 }, "tech-park-2-lounge": { distance: 550, walkingTime: 7 }, "law-library": { distance: 650, walkingTime: 8 }, "architecture-library": { distance: 500, walkingTime: 6 }, "medical-library": { distance: 1000, walkingTime: 13 } },
  "High-Rise Boys": { "central-library": { distance: 650, walkingTime: 9 }, "tech-park-2-lounge": { distance: 750, walkingTime: 10 }, "law-library": { distance: 850, walkingTime: 11 }, "architecture-library": { distance: 700, walkingTime: 9 }, "medical-library": { distance: 1200, walkingTime: 16 } },
  "South Boys": { "central-library": { distance: 400, walkingTime: 5 }, "tech-park-2-lounge": { distance: 500, walkingTime: 7 }, "law-library": { distance: 450, walkingTime: 6 }, "architecture-library": { distance: 350, walkingTime: 5 }, "medical-library": { distance: 850, walkingTime: 11 } },
  "TRS / International Hostel": { "central-library": { distance: 500, walkingTime: 7 }, "tech-park-2-lounge": { distance: 600, walkingTime: 8 }, "law-library": { distance: 700, walkingTime: 9 }, "architecture-library": { distance: 550, walkingTime: 7 }, "medical-library": { distance: 1100, walkingTime: 14 } },
  "Pierre Fauchard (Medical Boys)": { "central-library": { distance: 900, walkingTime: 12 }, "tech-park-2-lounge": { distance: 1000, walkingTime: 13 }, "law-library": { distance: 550, walkingTime: 7 }, "architecture-library": { distance: 650, walkingTime: 9 }, "medical-library": { distance: 200, walkingTime: 3 } },
  "Central Girls": { "central-library": { distance: 450, walkingTime: 6 }, "tech-park-2-lounge": { distance: 550, walkingTime: 7 }, "law-library": { distance: 650, walkingTime: 8 }, "architecture-library": { distance: 500, walkingTime: 6 }, "medical-library": { distance: 1000, walkingTime: 13 } },
  "Inner Ring Girls": { "central-library": { distance: 550, walkingTime: 7 }, "tech-park-2-lounge": { distance: 650, walkingTime: 8 }, "law-library": { distance: 750, walkingTime: 10 }, "architecture-library": { distance: 600, walkingTime: 8 }, "medical-library": { distance: 1100, walkingTime: 14 } },
  "Medical Girls": { "central-library": { distance: 950, walkingTime: 12 }, "tech-park-2-lounge": { distance: 1050, walkingTime: 14 }, "law-library": { distance: 600, walkingTime: 8 }, "architecture-library": { distance: 700, walkingTime: 9 }, "medical-library": { distance: 150, walkingTime: 2 } },
};

const usualOccupancyCurve = [
  { hour: 0, percent: 6 },
  { hour: 6, percent: 10 },
  { hour: 8, percent: 30 },
  { hour: 10, percent: 52 },
  { hour: 12, percent: 78 },
  { hour: 14, percent: 88 },
  { hour: 16, percent: 72 },
  { hour: 18, percent: 48 },
  { hour: 20, percent: 32 },
  { hour: 22, percent: 15 },
  { hour: 24, percent: 6 },
];

const getUsualOccupancyPercent = (dateObj, modifier = 1.0) => {
  const decimalHour = dateObj.getHours() + dateObj.getMinutes() / 60;

  let p1 = usualOccupancyCurve[0];
  let p2 = usualOccupancyCurve[1];

  for (let i = 0; i < usualOccupancyCurve.length - 1; i += 1) {
    if (
      decimalHour >= usualOccupancyCurve[i].hour &&
      decimalHour <= usualOccupancyCurve[i + 1].hour
    ) {
      p1 = usualOccupancyCurve[i];
      p2 = usualOccupancyCurve[i + 1];
      break;
    }
  }

  const ratio = (decimalHour - p1.hour) / (p2.hour - p1.hour || 1);
  const basePercent = p1.percent + ratio * (p2.percent - p1.percent);
  return Math.max(5, Math.min(95, Math.round(basePercent * modifier)));
};

/* =========================================================
   SEAT GENERATION HELPERS
   ========================================================= */

const representativeSeatCountPerFloor = 50;

/*
 * The real facilities can have hundreds/thousands of seats, but rendering all
 * of them would make the prototype unusable.  Each floor therefore gets a
 * consistent 50-seat representative map: 5 rows x 10 seats.  This keeps the
 * floor plans visually balanced and makes the layout predictable.
 *
 * Firestore reservation IDs remain stable as <location>-f<floor>-s<seat>, so
 * this is a layout-only change and does not break the booking logic.
 */
const createSeats = (locationId, total, chargingSeats, groupTables = 0, floors = 1) => {
  const seats = [];
  const safeFloors = Math.max(1, Number(floors) || 1);
  const chargingRatio = Number(total) > 0
    ? Math.max(0, Math.min(1, Number(chargingSeats || 0) / Number(total)))
    : 0;
  const chargingPerFloor = Math.round(
    representativeSeatCountPerFloor * chargingRatio,
  );
  const groupBase = Math.floor(groupTables / safeFloors);
  const groupRemainder = groupTables % safeFloors;

  for (let floor = 1; floor <= safeFloors; floor += 1) {
    const groupCount = groupBase + (floor <= groupRemainder ? 1 : 0);

    // Exactly 50 individual seats per floor, arranged as A1-A10 through E1-E10.
    for (let i = 1; i <= representativeSeatCountPerFloor; i += 1) {
      const row = String.fromCharCode(65 + Math.floor((i - 1) / 10));
      const number = ((i - 1) % 10) + 1;

      seats.push({
        id: `${locationId}-f${floor}-s${i}`,
        number: `${row}${number}`,
        floor,
        kind: "individual",
        capacity: 1,
        hasCharging: i <= chargingPerFloor,
        status: "available",
      });
    }

    // Group tables are placed after the individual-seat grid so they form a
    // distinct purple block instead of interrupting the normal seat rows.
    for (let i = 1; i <= groupCount; i += 1) {
      const globalGroupIndex = groupBase * (floor - 1) + Math.min(floor, groupRemainder) + i;
      seats.push({
        id: `${locationId}-f${floor}-g${i}`,
        number: `G${globalGroupIndex}`,
        floor,
        kind: "group",
        capacity: 4,
        hasCharging: false,
        status: "available",
      });
    }
  }

  return seats;
};

const initialSeatData = studySpaces.reduce((acc, location) => {
  acc[location.id] = createSeats(
    location.id,
    location.totalSeats,
    location.chargingSeats,
    location.groupTables,
    location.floors,
  );
  return acc;
}, {});

/* Never restore the old prototype's local seat map. Firestore reservations
 * are the only source that may turn a seat red/gray. */
const createCleanSeatData = () =>
  Object.fromEntries(
    Object.entries(initialSeatData).map(([locationId, seats]) => [
      locationId,
      seats.map((seat) => ({ ...seat, status: "available" })),
    ]),
  );

/* =========================================================
   MAIN APP COMPONENT
   ========================================================= */

function App() {
  // Navigation & UI State
  const [page, setPage] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [theme, setTheme] = useState(() => loadStorage("studyspot_theme", "light"));

  useEffect(() => {
    saveStorage("studyspot_theme", theme);
  }, [theme]);

  // Real-time clock tick (every second)
  const [now, setNow] = useState(new Date());

  // Firebase Authentication / Firestore state
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [firestoreSpaces, setFirestoreSpaces] = useState(null);
  const [firebaseProfileLoaded, setFirebaseProfileLoaded] = useState(false);

  // Firestore is the source of truth for cross-user seat reservations.
  // This state is populated by the real-time reservation listener.
  const [remoteReservations, setRemoteReservations] = useState([]);

  // Preferences (Persisted)
  const [userLocation, setUserLocation] = useState(() =>
    loadStorage("studyspot_user_location", ""),
  );
  const [duration, setDuration] = useState(() =>
    loadStorage("studyspot_duration", 1),
  );
  const [chargingRequired, setChargingRequired] = useState(() =>
    loadStorage("studyspot_charging_req", false),
  );
  const [environment, setEnvironment] = useState(() =>
    loadStorage("studyspot_environment", "Any"),
  );

  // Credits & Transactions (Persisted)
  const [credits, setCredits] = useState(() =>
    loadStorage("studyspot_credits", 100),
  );
  const [lockedCredits, setLockedCredits] = useState(() =>
    loadStorage("studyspot_locked_credits", 0),
  );
  const [transactions, setTransactions] = useState(() =>
    loadStorage("studyspot_transactions", [
      {
        id: "tx-init",
        title: "Initial StudySpot Credits",
        subtitle: "SRMIST Student Account Creation",
        amount: 100,
        type: "positive",
        timestamp: Date.now(),
      },
    ]),
  );

  // Seats & Active Booking (Persisted)
  const [seatData, setSeatData] = useState(() => createCleanSeatData());
  const [booking, setBooking] = useState(() =>
    loadStorage("studyspot_booking", null),
  );

  // Seat Selection View State (Start Time is between NOW+1m and NOW+15m)
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [startDelayMinutes, setStartDelayMinutes] = useState(5); // Default 5 min in advance

  // Keep the seat map synchronized with Firestore reservations.
  //
  // Firestore active reservations are the authoritative source for seats.
  // The local booking is also included as a temporary fallback while a newly
  // created reservation is travelling to Firestore and its listener callback.
  useEffect(() => {
    setSeatData((current) => {
      const next = { ...current };

      Object.keys(next).forEach((locationId) => {
        next[locationId] = (next[locationId] || []).map((seat) => ({
          ...seat,
          status: "available",
        }));
      });

      const nowMs = Date.now();

      const activeReservations = Array.isArray(remoteReservations)
        ? remoteReservations.filter((reservation) => {
          if (!reservation?.locationId || !reservation?.seatId) {
            return false;
          }

          if (
            reservation.status !== "reserved" &&
            reservation.status !== "checked_in"
          ) {
            return false;
          }

          const endTimeMs = Number(reservation.endTimeMs ?? 0);
          return !(endTimeMs > 0 && endTimeMs <= nowMs);
        })
        : [];

      activeReservations.forEach((reservation) => {
        const locationId = reservation.locationId;
        const seatId = reservation.seatId;

        if (!next[locationId]) return;

        next[locationId] = next[locationId].map((seat) =>
          seat.id === seatId
            ? {
              ...seat,
              status:
                reservation.status === "checked_in"
                  ? "occupied"
                  : "reserved",
            }
            : seat,
        );
      });

      if (
        booking &&
        (booking.status === "reserved" || booking.status === "checked_in") &&
        booking.location?.id &&
        booking.seat?.id
      ) {
        const alreadyInFirestore = activeReservations.some(
          (reservation) =>
            reservation.id === booking.id ||
            (reservation.userId === firebaseUser?.uid &&
              reservation.locationId === booking.location.id &&
              reservation.seatId === booking.seat.id),
        );

        if (!alreadyInFirestore) {
          const locationSeats = next[booking.location.id] || [];
          next[booking.location.id] = locationSeats.map((seat) =>
            seat.id === booking.seat.id
              ? {
                ...seat,
                status:
                  booking.status === "checked_in"
                    ? "occupied"
                    : "reserved",
              }
              : seat,
          );
        }
      }

      // Avoid a redundant seatData update when the calculated statuses did
      // not actually change. This prevents unnecessary render churn when the
      // Firestore listeners deliver the same reservation state repeatedly.
      const sameSeatData = Object.keys(next).every((locationId) => {
        const before = current[locationId] || [];
        const after = next[locationId] || [];

        if (before.length !== after.length) return false;

        return before.every((seat, index) => {
          const updatedSeat = after[index];
          return (
            seat.id === updatedSeat?.id &&
            seat.status === updatedSeat?.status &&
            seat.hasCharging === updatedSeat?.hasCharging &&
            seat.number === updatedSeat?.number
          );
        });
      });

      return sameSeatData ? current : next;
    });
  }, [remoteReservations, booking, firebaseUser]);

  // Clock ticker effect
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Firebase authentication + initial Firestore synchronization
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (user) => {
      setFirebaseUser(user);
      setFirebaseProfileLoaded(false);

      if (!user) {
        if (typeof window !== "undefined" && typeof window._unsubscribeUserProfile === "function") {
          window._unsubscribeUserProfile();
          window._unsubscribeUserProfile = null;
        }
        setFirestoreSpaces(null);
        setRemoteReservations([]);
        setFirebaseProfileLoaded(false);
        setAuthLoading(false);
        return;
      }

      try {
        // Creates the users/{uid} document on first Google sign-in.
        const profile = await syncUserProfile(user);

        if (profile) {
          setCredits(Number(profile.credits ?? 100));
          setLockedCredits(Number(profile.lockedCredits ?? 0));

          if (profile.currentLocation) {
            setUserLocation(profile.currentLocation);
          }
        }

        setFirebaseProfileLoaded(true);

        // Pull study spaces from Firestore. If the database is empty,
        // seed it from the existing prototype data without changing UI logic.
        let dbSpaces = [];
        try {
          dbSpaces = await getStudySpacesFromDb();
          if (!dbSpaces.length) {
            await seedStudySpacesIfEmpty(studySpaces);
            dbSpaces = await getStudySpacesFromDb();
          }
        } catch (spaceError) {
          console.warn("Firestore study-space sync failed:", spaceError);
        }

        if (dbSpaces.length) {
          const normalizedSpaces = dbSpaces.map(normalizeFirestoreSpace);
          setFirestoreSpaces(normalizedSpaces);

          // Ensure the existing seat grid has entries for Firestore-backed spaces.
          setSeatData((current) => {
            const next = { ...current };
            normalizedSpaces.forEach((space) => {
              if (!next[space.id]) {
                next[space.id] = createSeats(
                  space.id,
                  space.totalSeats,
                  space.chargingSeats,
                  space.groupTables ?? 0,
                  space.floors ?? 1,
                );
              } else {
                // Remove legacy fake occupancy from the persisted seat grid.
                next[space.id] = next[space.id].map((seat) => ({
                  ...seat,
                  status: "available",
                }));
              }
            });
            return next;
          });
        }

        // Restore the user's latest reservation from Firestore.
        try {
          const reservations = await getUserReservationsFromDb(user.uid);
          if (reservations.length) {
            const latest = reservations[0];
            if (latest.status === "reserved" || latest.status === "checked_in") {
              setBooking({
                id: latest.id,
                location: latest.location,
                seat: latest.seat,
                duration: latest.duration,
                deposit: latest.deposit,
                status: latest.status,
                startTimeMs: latest.startTimeMs,
                endTimeMs: latest.endTimeMs,
                checkInDeadlineMs: latest.checkInDeadlineMs,
                startTimeStr: latest.startTimeStr,
                endTimeStr: latest.endTimeStr,
                warningNotified: Boolean(latest.warningNotified),
                bookedAt: latest.bookedAt ?? Date.now(),
                checkedInAt: latest.checkedInAt,
                sessionEnded: latest.sessionEnded,
              });
            }
          }
        } catch (reservationError) {
          console.warn("Firestore reservation sync failed:", reservationError);
        }

        // Pull credit transactions. The local copy remains as a cache/fallback.
        try {
          const remoteTransactions = await getUserTransactionsFromDb(user.uid);
          if (remoteTransactions.length) {
            setTransactions(
              remoteTransactions.map((tx) => ({
                id: tx.clientTransactionId ?? tx.id,
                title: tx.title,
                subtitle: tx.subtitle,
                amount: tx.amount,
                type: tx.type,
                timestamp: tx.timestamp ?? Date.now(),
              })),
            );
          }
        } catch (transactionError) {
          console.warn("Firestore transaction sync failed:", transactionError);
        }

        setAuthLoading(false);
      } catch (error) {
        console.error("Firebase initialization/sync failed:", error);
        showToast(
          "Firebase connection failed. The prototype will continue using local data.",
          "warning",
        );
        setFirebaseProfileLoaded(true);
        setAuthLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  /*
   * =========================================================
   * REAL-TIME FIRESTORE SYNCHRONIZATION
   * =========================================================
   *
   * This is intentionally separate from the initial Firebase sync above.
   * The initial sync loads data once; these listeners keep the application
   * updated after another student's booking/cancellation/check-in/check-out.
   */

  useEffect(() => {
    // Firestore rules require an authenticated user to read reservations.
    // Start the listener only after Firebase Auth has established the session,
    // and recreate it whenever the signed-in user changes.
    if (!firebaseUser) {
      setRemoteReservations([]);
      return undefined;
    }

    const unsubscribeReservations = subscribeToAllReservations(
      (reservations) => {
        console.log(`DIAGNOSTIC: 5. App.jsx received callback with ${reservations?.length} reservations`);
        setRemoteReservations(
          Array.isArray(reservations) ? reservations : [],
        );
      },
      (error) => {
        console.error(
          "Real-time reservation listener failed:",
          error,
        );
      },
    );

    return () => {
      if (typeof unsubscribeReservations === "function") {
        unsubscribeReservations();
      }
    };
  }, [firebaseUser]);

  useEffect(() => {
    console.log(`DIAGNOSTIC: 6. remoteReservations state updated. Current length: ${remoteReservations.length}`);
  }, [remoteReservations]);

  // Keep study-space metadata synchronized with Firestore as well.
  useEffect(() => {
    if (!firebaseUser) return undefined;

    const unsubscribeSpaces = subscribeToStudySpaces(
      (spaces) => {
        if (!Array.isArray(spaces) || spaces.length === 0) return;

        const normalizedSpaces = spaces
          .map(normalizeFirestoreSpace)
          .filter(Boolean);

        setFirestoreSpaces(normalizedSpaces);

        // Ensure every Firestore-backed space has a clean local seat grid.
        setSeatData((current) => {
          const next = { ...current };

          normalizedSpaces.forEach((space) => {
            if (!next[space.id]) {
              next[space.id] = createSeats(
                space.id,
                space.totalSeats,
                space.chargingSeats,
                space.groupTables ?? 0,
                space.floors ?? 1,
              );
            }
          });

          return next;
        });
      },
      (error) => {
        console.error(
          "Real-time study-space listener failed:",
          error,
        );
      },
    );

    return () => {
      if (typeof unsubscribeSpaces === "function") {
        unsubscribeSpaces();
      }
    };
  }, [firebaseUser]);

  // Save persistent state
  useEffect(() => {
    saveStorage("studyspot_user_location", userLocation);
  }, [userLocation]);

  useEffect(() => {
    saveStorage("studyspot_duration", duration);
  }, [duration]);

  useEffect(() => {
    saveStorage("studyspot_charging_req", chargingRequired);
  }, [chargingRequired]);

  useEffect(() => {
    saveStorage("studyspot_environment", environment);
  }, [environment]);

  useEffect(() => {
    saveStorage("studyspot_credits", credits);
  }, [credits]);

  useEffect(() => {
    saveStorage("studyspot_locked_credits", lockedCredits);
  }, [lockedCredits]);

  useEffect(() => {
    saveStorage("studyspot_transactions", transactions);
  }, [transactions]);

  useEffect(() => {
    saveStorage("studyspot_seat_data", seatData);
  }, [seatData]);

  useEffect(() => {
    saveStorage("studyspot_booking", booking);
  }, [booking]);

  // Persist the user's location preference to Firestore when authenticated.
  useEffect(() => {
    if (!firebaseUser || !firebaseProfileLoaded || !userLocation) return;

    updateUserLocation(firebaseUser.uid, userLocation).catch((error) => {
      console.warn("Firestore location update failed:", error);
    });
  }, [firebaseUser, firebaseProfileLoaded, userLocation]);

  // Keep the user's credit balance synchronized with Firestore.
  // This preserves the current prototype behavior while adding persistence.
  useEffect(() => {
    if (!firebaseUser || !firebaseProfileLoaded) return;

    updateUserCredits(firebaseUser.uid, credits, lockedCredits).catch((error) => {
      console.warn("Firestore credit update failed:", error);
    });
  }, [firebaseUser, firebaseProfileLoaded, credits, lockedCredits]);

  // Request browser notification permission once politely
  const requestNotificationAccess = async () => {
    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn("Notification request permission failed:", e);
      }
    }
  };

  const showToast = (message, type = "success") => {
    setNotice({ message, type });
    window.setTimeout(() => {
      setNotice(null);
    }, 4000);
  };

  // Enhance study spaces with distance and Google-Maps-Style Current vs Usual Crowd Comparison
  const activeStudySpaces = studySpaces;

  const spacesWithDetails = useMemo(() => {
    return activeStudySpaces.map((space) => {
      // 1. Proximity
      let distance = space.defaultDistance;
      let walkingTime = `${space.defaultWalkingTime} min`;
      let rawWalkingMinutes = space.defaultWalkingTime;

      if (userLocation && distanceMatrix[userLocation]?.[space.id]) {
        const info = distanceMatrix[userLocation][space.id];
        distance = info.distance;
        walkingTime = `${info.walkingTime} min`;
        rawWalkingMinutes = info.walkingTime;
      }

      // 2. Current Occupancy
      // Active Firestore reservations are the cross-user source of truth.
      // We still use the local seat grid as a fallback during initial load.
      const localSeats = seatData[space.id];

      const nowMs = Date.now();
      const activeRemoteReservations = Array.isArray(remoteReservations)
        ? remoteReservations.filter((reservation) => {
          if (
            reservation?.locationId !== space.id ||
            (reservation.status !== "reserved" &&
              reservation.status !== "checked_in")
          ) {
            return false;
          }

          const endTimeMs = Number(reservation.endTimeMs ?? 0);
          return !endTimeMs || endTimeMs > nowMs;
        })
        : [];

      const remoteOccupiedCount = activeRemoteReservations.reduce(
        (sum, reservation) => sum + Number(reservation?.seat?.capacity ?? (reservation?.seat?.kind === "group" ? 4 : 1)),
        0,
      );

      const localOccupiedCount = Array.isArray(localSeats)
        ? localSeats.filter(
          (seat) =>
            seat.status === "occupied" ||
            seat.status === "reserved",
        ).length
        : 0;

      const currentOccupancy =
        remoteOccupiedCount > 0 ||
          Array.isArray(remoteReservations)
          ? remoteOccupiedCount
          : localOccupiedCount || Number(space.currentOccupancy ?? 0);

      const currentOccupancyPercent =
        space.totalSeats > 0
          ? Math.round((currentOccupancy / space.totalSeats) * 100)
          : 0;

      const calculatedAvailableSeats = Math.max(
        0,
        space.totalSeats - currentOccupancy,
      );

      const activeChargingReservations = activeRemoteReservations.reduce(
        (sum, reservation) =>
          sum + (reservation?.seat?.hasCharging ? 1 : 0),
        0,
      );
      const calculatedAvailableChargingSeats = Math.max(
        0,
        Number(space.chargingSeats ?? 0) - activeChargingReservations,
      );

      // 3. Usual Occupancy (Deterministic time-based heuristic for this time of day)
      const usualPercent = getUsualOccupancyPercent(now, space.usualModifier);
      const usualOccupancy = Math.max(
        1,
        Math.round((usualPercent / 100) * space.totalSeats),
      );
      const usualOccupancyPercent = Math.round(
        (usualOccupancy / space.totalSeats) * 100,
      );

      // 4. Difference & Status
      const diff = currentOccupancy - usualOccupancy;
      const percentDiff = Math.round(
        ((currentOccupancy - usualOccupancy) / (usualOccupancy || 1)) * 100,
      );

      let crowd = "Moderate";
      if (currentOccupancyPercent >= 70) crowd = "High";
      else if (currentOccupancyPercent <= 40) crowd = "Low";

      let comparison = {
        diff,
        percentDiff,
        label: "About as crowded as usual",
        diffText: "About usual",
        percentText: "Similar to usual for this time",
        tone: "normal", // 'heavy' | 'light' | 'normal'
        hint: "About as busy as usual right now.",
      };

      if (diff >= 4 || percentDiff >= 10) {
        comparison = {
          diff,
          percentDiff,
          label: "More crowded than usual",
          diffText: `↑ ${Math.abs(diff)} more than usual`,
          percentText: `${Math.abs(percentDiff)}% more crowded than usual`,
          tone: "heavy",
          hint: "More crowded than usual right now.",
        };
      } else if (diff <= -4 || percentDiff <= -10) {
        comparison = {
          diff,
          percentDiff,
          label: "Less crowded than usual",
          diffText: `↓ ${Math.abs(diff)} fewer than usual`,
          percentText: `${Math.abs(percentDiff)}% less crowded than usual`,
          tone: "light",
          hint: "Less crowded than usual right now.",
        };
      }

      return {
        ...space,
        distance,
        walkingTime,
        rawWalkingMinutes,
        currentOccupancy,
        currentOccupancyPercent,
        availableSeats: calculatedAvailableSeats,
        availableChargingSeats: calculatedAvailableChargingSeats,
        usualOccupancy,
        usualOccupancyPercent,
        crowd,
        crowdComparison: comparison,
      };
    });
  }, [activeStudySpaces, userLocation, now, seatData]);

  // Calculate recommendation score incorporating Current vs Usual crowd data
  const recommendedLocation = useMemo(() => {
    let best = null;
    let bestScore = -1;

    spacesWithDetails.forEach((location) => {
      const availabilityScore =
        (location.availableSeats / location.totalSeats) * 100;

      const chargingScore = chargingRequired
        ? (location.availableChargingSeats /
          Math.max(location.chargingSeats, 1)) *
        100
        : 100;

      const quietnessScore =
        environment === "Quiet"
          ? location.noiseLevel === "Quiet"
            ? 100
            : 30
          : environment === "Moderate"
            ? location.noiseLevel === "Moderate"
              ? 100
              : 50
            : environment === "Group"
              ? location.studyType === "Group"
                ? 100
                : 40
              : 100;

      const distanceScore = Math.max(0, 100 - location.distance / 8);
      const currentCrowdScore = 100 - location.currentOccupancyPercent;

      // Crowd comparison score: boost locations that are less crowded than usual, penalize heavier crowds
      const crowdComparisonScore = Math.max(
        0,
        Math.min(100, 50 - location.crowdComparison.percentDiff * 1.5),
      );

      const score = userLocation
        ? availabilityScore * 0.3 +
        chargingScore * 0.25 +
        distanceScore * 0.15 +
        quietnessScore * 0.1 +
        currentCrowdScore * 0.1 +
        crowdComparisonScore * 0.1
        : availabilityScore * 0.35 +
        chargingScore * 0.25 +
        quietnessScore * 0.15 +
        currentCrowdScore * 0.1 +
        crowdComparisonScore * 0.1 +
        distanceScore * 0.05;

      if (score > bestScore) {
        bestScore = score;
        best = location;
      }
    });

    return best || spacesWithDetails[0];
  }, [spacesWithDetails, chargingRequired, environment, userLocation]);

  // Lifecycle check for booking: 5-minute grace period expiry & 10-minute warning
  useEffect(() => {
    if (!booking) return;

    const nowMs = Date.now();

    // 1. Check if check-in grace period expired for upcoming reservation
    if (booking.status === "reserved" && nowMs > booking.checkInDeadlineMs) {
      const refund = booking.deposit;
      setCredits((c) => c + refund);
      setLockedCredits((lc) => Math.max(0, lc - booking.deposit));

      // Release seat
      setSeatData((current) => ({
        ...current,
        [booking.location.id]: current[booking.location.id].map((s) =>
          s.id === booking.seat.id ? { ...s, status: "available" } : s,
        ),
      }));

      // Record transaction
      const tx = {
        id: `tx-exp-${Date.now()}`,
        title: "Deposit Refunded (Check-in Expired)",
        subtitle: `${booking.location.name} • Seat ${booking.seat.number}`,
        amount: refund,
        type: "positive",
        timestamp: Date.now(),
      };
      setTransactions((prev) => [tx, ...prev]);
      persistTransaction(tx);

      if (firebaseUser && booking.id) {
        persistBookingStatus(booking.id, "no_show", { refund });
      }

      setBooking((current) => ({
        ...current,
        status: "no_show",
        refund,
      }));

      showToast("Check-in window expired. Your deposit has been returned.", "warning");
    }

    // 2. 10-minute warning check for active checked-in session
    if (booking.status === "checked_in") {
      const remainingMs = booking.endTimeMs - nowMs;

      // Exactly <= 10 minutes remaining and not yet notified
      if (
        remainingMs <= 10 * 60 * 1000 &&
        remainingMs > 0 &&
        !booking.warningNotified
      ) {
        setBooking((current) => ({
          ...current,
          warningNotified: true,
        }));

        // Browser notification
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("StudySpot SRM: 10 Minutes Remaining", {
              body: `Your study session at ${booking.location.name} ends at ${booking.endTimeStr}.`,
              icon: "/favicon.svg",
            });
          } catch (e) {
            console.warn("Notification error:", e);
          }
        }

        showToast(
          `10 minutes remaining: Your session at ${booking.location.name} ends at ${booking.endTimeStr}.`,
          "warning",
        );
      }

      // If time reached 0 during active session, mark it only once.
      // Without the guard, this effect keeps calling setBooking every second
      // after the session ends, which causes a React "Maximum update depth"
      // loop because booking is one of this effect's dependencies.
      if (
        remainingMs <= 0 &&
        booking.status === "checked_in" &&
        !booking.sessionEnded
      ) {
        setBooking((current) =>
          current && !current.sessionEnded
            ? { ...current, sessionEnded: true }
            : current,
        );
      }
    }
  }, [now, booking, firebaseUser]);

  const openLocation = (location) => {
    setSelectedLocation(location);
    setSelectedSeat(null);
    setStartDelayMinutes(5); // Default 5 min ahead (1–15 min window)
    setPage("seats");
  };

  const handleSeatClick = (seat) => {
    if (seat.status !== "available") return;

    if (chargingRequired && !seat.hasCharging) {
      showToast("Please select a seat with charging access.", "error");
      return;
    }
    setSelectedSeat(seat);
  };

  const persistTransaction = async (tx) => {
    if (!firebaseUser) return;

    try {
      await addCreditTransactionToDb(
        serializeTransactionForFirestore(tx, firebaseUser.uid),
      );
    } catch (error) {
      console.warn("Firestore credit transaction write failed:", error);
    }
  };

  const persistBookingStatus = async (bookingId, status, extraFields = {}) => {
    if (!firebaseUser || !bookingId) return;

    try {
      await updateReservationStatusInDb(bookingId, status, extraFields);
    } catch (error) {
      console.warn("Firestore reservation status update failed:", error);
    }
  };

  // Reserve Seat: Strictly between NOW + 1 min and NOW + 15 min
  const reserveSeat = async () => {
    if (!selectedLocation || !selectedSeat) {
      showToast("Please select an available seat.", "error");
      return;
    }

    const isGroupBooking = selectedSeat?.kind === "group";
    const deposit = duration * (isGroupBooking ? 50 : 25);

    if (credits < deposit) {
      showToast("You don't have enough available StudySpot Credits.", "error");
      return;
    }

    requestNotificationAccess();

    const nowMs = Date.now();
    // Clamped strictly between 1 and 15 minutes ahead
    const safeStartDelay = Math.min(15, Math.max(1, startDelayMinutes));
    const startTimeMs = nowMs + safeStartDelay * 60 * 1000;
    const durationMs = duration * 60 * 60 * 1000;
    const endTimeMs = startTimeMs + durationMs;
    const checkInDeadlineMs = startTimeMs + 5 * 60 * 1000; // 5-minute grace period

    // Final client-side revalidation against the real-time Firestore snapshot.
    // This is intentionally time-aware: a reservation only blocks this seat
    // when the requested booking window overlaps the existing window.
    const remoteConflict = getSeatReservationConflict(
      remoteReservations,
      selectedLocation.id,
      selectedSeat.id,
      startTimeMs,
      endTimeMs,
    );

    const localConflict =
      booking &&
        (booking.status === "reserved" || booking.status === "checked_in") &&
        booking.location?.id === selectedLocation.id &&
        booking.seat?.id === selectedSeat.id &&
        Number(booking.endTimeMs ?? 0) > startTimeMs &&
        Number(booking.startTimeMs ?? 0) < endTimeMs
        ? booking
        : null;

    if (remoteConflict || localConflict) {
      setSelectedSeat(null);
      showToast(
        `Seat ${selectedSeat.number} is already reserved during the selected time. Please choose another seat or time.`,
        "error",
      );
      return;
    }

    const startTimeStr = formatTimeStr(new Date(startTimeMs));
    const endTimeStr = formatTimeStr(new Date(endTimeMs));

    setCredits((c) => c - deposit);
    setLockedCredits((lc) => lc + deposit);

    // Reserve seat in seat grid
    setSeatData((current) => ({
      ...current,
      [selectedLocation.id]: current[selectedLocation.id].map((s) =>
        s.id === selectedSeat.id ? { ...s, status: "reserved" } : s,
      ),
    }));

    const newBooking = {
      id: `bk-${Date.now()}`,
      location: selectedLocation,
      seat: selectedSeat,
      duration,
      deposit,
      status: "reserved",
      startTimeMs,
      endTimeMs,
      checkInDeadlineMs,
      startTimeStr,
      endTimeStr,
      warningNotified: false,
      bookedAt: Date.now(),
    };

    setBooking(newBooking);

    // Persist reservation to Firestore when the user is authenticated.
    if (firebaseUser) {
      try {
        const savedReservation = await createFirestoreReservation(
          serializeBookingForFirestore(newBooking, firebaseUser.uid),
        );
        setBooking((current) =>
          current
            ? { ...current, id: savedReservation.id }
            : current,
        );
      } catch (error) {
        console.error("Firestore reservation creation failed:", error);
        showToast(
          "Reservation saved locally, but Firestore could not save it.",
          "warning",
        );
      }
    }

    // Add lock transaction
    const tx = {
      id: `tx-lock-${Date.now()}`,
      title: "Reservation Deposit Locked",
      subtitle: `${selectedLocation.name} • Seat ${selectedSeat.number}`,
      amount: -deposit,
      type: "negative",
      timestamp: Date.now(),
    };
    setTransactions((prev) => [tx, ...prev]);
    persistTransaction(tx);

    setSelectedSeat(null);
    setPage("reservations");
    showToast(
      `Reservation confirmed for ${startTimeStr}. Credits locked.`,
    );
  };

  const cancelBooking = () => {
    if (!booking) return;

    setCredits((c) => c + booking.deposit);
    setLockedCredits((lc) => Math.max(0, lc - booking.deposit));

    // Release seat
    setSeatData((current) => ({
      ...current,
      [booking.location.id]: current[booking.location.id].map((s) =>
        s.id === booking.seat.id ? { ...s, status: "available" } : s,
      ),
    }));

    const tx = {
      id: `tx-can-${Date.now()}`,
      title: "Reservation Cancelled (Full Refund)",
      subtitle: `${booking.location.name} • Seat ${booking.seat.number}`,
      amount: booking.deposit,
      type: "positive",
      timestamp: Date.now(),
    };
    setTransactions((prev) => [tx, ...prev]);
    persistTransaction(tx);

    if (firebaseUser && booking.id) {
      persistBookingStatus(booking.id, "cancelled", {
        refund: booking.deposit,
      });
    }

    setBooking(null);
    showToast("Reservation cancelled. Your credits have been returned.");
  };

  const checkIn = () => {
    if (!booking) return;

    const checkedInAt = Date.now();

    setBooking((current) => ({
      ...current,
      status: "checked_in",
      checkedInAt,
    }));

    if (firebaseUser && booking.id) {
      persistBookingStatus(booking.id, "checked_in", { checkedInAt });
    }

    showToast("Checked in successfully! Your study session is now active.");
  };

  const checkOut = () => {
    if (!booking) return;

    setCredits((c) => c + booking.deposit);
    setLockedCredits((lc) => Math.max(0, lc - booking.deposit));

    // Release seat
    setSeatData((current) => ({
      ...current,
      [booking.location.id]: current[booking.location.id].map((s) =>
        s.id === booking.seat.id ? { ...s, status: "available" } : s,
      ),
    }));

    const tx = {
      id: `tx-out-${Date.now()}`,
      title: "Completed Session Deposit Refund",
      subtitle: `${booking.location.name} • Seat ${booking.seat.number}`,
      amount: booking.deposit,
      type: "positive",
      timestamp: Date.now(),
    };
    setTransactions((prev) => [tx, ...prev]);
    persistTransaction(tx);

    if (firebaseUser && booking.id) {
      persistBookingStatus(booking.id, "completed", {
        checkedOutAt: Date.now(),
      });
    }

    setBooking((current) => ({
      ...current,
      status: "completed",
    }));

    showToast(`${booking.deposit} StudySpot Credits returned to your wallet.`);
  };

  // Demo simulation helper (jump forward to start time for quick testing)
  const simulateCheckInOpen = () => {
    if (!booking || booking.status !== "reserved") return;
    const nowMs = Date.now();
    const simulatedStartTimeMs = nowMs - 1000;
    const simulatedDeadlineMs = nowMs + 5 * 60 * 1000;

    setBooking((current) => ({
      ...current,
      startTimeMs: simulatedStartTimeMs,
      checkInDeadlineMs: simulatedDeadlineMs,
      startTimeStr: formatTimeStr(new Date(simulatedStartTimeMs)),
    }));

    if (firebaseUser && booking.id) {
      persistBookingStatus(booking.id, "reserved", {
        startTimeMs: simulatedStartTimeMs,
        checkInDeadlineMs: simulatedDeadlineMs,
        startTimeStr: formatTimeStr(new Date(simulatedStartTimeMs)),
      });
    }

    showToast("Demo: Check-in window is now OPEN for 5 minutes.");
  };

  const simulateNoShowExpired = () => {
    if (!booking) return;
    const refund = booking.deposit;
    setCredits((c) => c + refund);
    setLockedCredits((lc) => Math.max(0, lc - booking.deposit));

    setSeatData((current) => ({
      ...current,
      [booking.location.id]: current[booking.location.id].map((s) =>
        s.id === booking.seat.id ? { ...s, status: "available" } : s,
      ),
    }));

    const tx = {
      id: `tx-exp-${Date.now()}`,
      title: "Deposit Refunded (Check-in Expired)",
      subtitle: `${booking.location.name} • Seat ${booking.seat.number}`,
      amount: refund,
      type: "positive",
      timestamp: Date.now(),
    };
    setTransactions((prev) => [tx, ...prev]);
    persistTransaction(tx);

    if (firebaseUser && booking.id) {
      persistBookingStatus(booking.id, "no_show", { refund });
    }

    setBooking((current) => ({
      ...current,
      status: "no_show",
      refund,
    }));

    showToast("Demo: Simulated missed check-in window.", "warning");
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "find", label: "Find a Space", icon: Search },
    { id: "reservations", label: "Reservations", icon: CalendarDays },
    { id: "credits", label: "Credits", icon: CreditCard },
  ];

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f8fafc",
          color: "#64748b",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        Loading StudySpot SRM...
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <LoginPage
        firebaseUser={null}
        onLogin={async () => {
          try {
            await signInWithGoogle();
            showToast("Signed in with Google successfully.");
          } catch (error) {
            console.error("Google sign-in failed:", error);
            showToast("Google sign-in failed. Please try again.", "error");
          }
        }}
      />
    );
  }

  if (!firebaseProfileLoaded) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f8fafc",
          color: "#64748b",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        Loading your StudySpot account...
      </div>
    );
  }

  return (
    <div className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      {notice && (
        <div className={`toast toast-${notice.type}`}>
          <div className="toast-icon">
            {notice.type === "error" ? (
              <X size={18} />
            ) : notice.type === "warning" ? (
              <AlertCircle size={18} />
            ) : (
              <Check size={18} />
            )}
          </div>
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* TOPBAR HEADER */}
      <header className="topbar">
        <div className="brand" onClick={() => setPage("dashboard")}>
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">StudySpot SRM</div>
            <div className="brand-campus">SRMIST • Kattankulathur</div>
          </div>
        </div>

        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <button
          className="mobile-menu-button"
          onClick={() => setMobileMenu((value) => !value)}
          aria-label="Toggle menu"
        >
          <Menu size={22} />
        </button>

        <div className="topbar-right">
          <div
            className="credit-mini"
            onClick={() => setPage("credits")}
            style={{ cursor: "pointer" }}
            title="View Credits"
          >
            <CreditCard size={17} />
            <div>
              <span>Available</span>
              <strong>{credits}</strong>
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="avatar"
              title={
                firebaseUser
                  ? `Signed in as ${firebaseUser.displayName ||
                  firebaseUser.email ||
                  "SRMIST Student"
                  }`
                  : "Open StudySpot account"
              }
              onClick={() => setProfileMenuOpen((value) => !value)}
              aria-label="Open account menu"
              aria-expanded={profileMenuOpen}
              style={{
                border: "none",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              {firebaseUser?.displayName
                ? firebaseUser.displayName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()
                : "GM"}
            </button>

            {profileMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 10px)",
                  right: 0,
                  width: 280,
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  boxShadow: "0 18px 45px rgba(15, 23, 42, 0.16)",
                  padding: 14,
                  zIndex: 1000,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 8px 12px",
                    borderBottom: "1px solid #eef0f3",
                    marginBottom: 10,
                  }}
                >
                  <UserCircle size={22} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: "#111827",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {firebaseUser?.displayName || "SRM Student"}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6b7280",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {firebaseUser?.email || "Not signed in"}
                    </div>
                  </div>
                </div>

                {firebaseUser ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPage("credits");
                        setProfileMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        padding: "10px 8px",
                        borderRadius: 10,
                        cursor: "pointer",
                        color: "#334155",
                      }}
                    >
                      <CreditCard size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                      StudySpot Credits
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await signOutUser();
                          setProfileMenuOpen(false);
                          setPage("dashboard");
                          setSelectedLocation(null);
                          setSelectedSeat(null);
                          showToast("Signed out successfully.");
                        } catch (error) {
                          console.error("Sign-out failed:", error);
                          showToast("Sign-out failed. Please try again.", "error");
                        }
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        padding: "10px 8px",
                        borderRadius: 10,
                        cursor: "pointer",
                        color: "#b91c1c",
                      }}
                    >
                      <LogOut size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPage("login");
                        setProfileMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        padding: "10px 8px",
                        borderRadius: 10,
                        cursor: "pointer",
                        color: "#1d4ed8",
                        fontWeight: 600,
                      }}
                    >
                      <LogIn size={16} style={{ verticalAlign: "middle", marginRight: 8 }} />
                      Sign in with Google
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="main-layout">
        {/* SIDEBAR NAVIGATION */}
        <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
          <div className="sidebar-label">Workspace</div>

          <nav>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? "active" : ""}`}
                  onClick={() => {
                    setPage(item.id);
                    setMobileMenu(false);
                  }}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-bottom">
            <div className="reliability-card">
              <div className="reliability-icon">
                <ShieldCheck size={20} />
              </div>
              <div>
                <strong>Good Standing</strong>
                <span>Responsible booking</span>
              </div>
            </div>

            <div className="sidebar-campus">
              <span>Campus environment</span>
              <strong>StudySpot SRM • SRMIST</strong>
            </div>
          </div>
        </aside>

        {/* CONTENT ROUTING */}
        <main className="content">
          {page === "login" && (
            <LoginPage
              firebaseUser={firebaseUser}
              onLogin={async () => {
                try {
                  await signInWithGoogle();
                  setPage("dashboard");
                  showToast("Signed in with Google successfully.");
                } catch (error) {
                  console.error("Google sign-in failed:", error);
                  showToast("Google sign-in failed. Please try again.", "error");
                }
              }}
              onContinue={() => setPage("dashboard")}
            />
          )}

          {page === "dashboard" && (
            <Dashboard
              now={now}
              credits={credits}
              lockedCredits={lockedCredits}
              booking={booking}
              recommendedLocation={recommendedLocation}
              locations={spacesWithDetails}
              userLocation={userLocation}
              onFindSpace={() => setPage("find")}
              onOpenLocation={openLocation}
              onViewBooking={() => setPage("reservations")}
              onCheckIn={checkIn}
              onCheckOut={checkOut}
              userName={
                firebaseUser?.displayName ||
                firebaseUser?.email?.split("@")[0] ||
                "SRM Student"
              }
            />
          )}

          {page === "find" && (
            <FindSpace
              now={now}
              locations={spacesWithDetails}
              userLocation={userLocation}
              setUserLocation={setUserLocation}
              chargingRequired={chargingRequired}
              setChargingRequired={setChargingRequired}
              environment={environment}
              setEnvironment={setEnvironment}
              duration={duration}
              setDuration={setDuration}
              recommendedLocation={recommendedLocation}
              onOpenLocation={openLocation}
            />
          )}

          {page === "seats" && selectedLocation && (
            <SeatSelection
              now={now}
              location={selectedLocation}
              seats={seatData[selectedLocation.id] || []}
              selectedSeat={selectedSeat}
              duration={duration}
              setDuration={setDuration}
              startDelayMinutes={startDelayMinutes}
              setStartDelayMinutes={setStartDelayMinutes}
              remoteReservations={remoteReservations}
              booking={booking}
              setSelectedSeat={setSelectedSeat}
              credits={credits}
              chargingRequired={chargingRequired}
              onBack={() => setPage("find")}
              onSeatClick={handleSeatClick}
              onReserve={reserveSeat}
            />
          )}

          {page === "reservations" && (
            <Reservations
              now={now}
              booking={booking}
              onCheckIn={checkIn}
              onCheckOut={checkOut}
              onCancel={cancelBooking}
              onSimulateCheckInOpen={simulateCheckInOpen}
              onSimulateNoShow={simulateNoShowExpired}
              onFindSpace={() => setPage("find")}
            />
          )}

          {page === "credits" && (
            <Credits
              credits={credits}
              lockedCredits={lockedCredits}
              transactions={transactions}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* =========================================================
   LOGIN PAGE
   ========================================================= */

function LoginPage({ firebaseUser, onLogin, onContinue }) {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "grid",
        placeItems: "center",
        padding: "32px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 24,
          padding: 32,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.10)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            margin: "0 auto 18px",
            borderRadius: 16,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, #0b2a5b, #174a8b)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          SRM
        </div>

        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#64748b",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          StudySpot SRM
        </div>

        <h1
          style={{
            margin: "0 0 10px",
            fontSize: 30,
            lineHeight: 1.15,
            color: "#0f172a",
          }}
        >
          {firebaseUser ? "You're signed in" : "Welcome back"}
        </h1>

        <p
          style={{
            margin: "0 auto 24px",
            maxWidth: 360,
            color: "#64748b",
            lineHeight: 1.6,
            fontSize: 14,
          }}
        >
          Sign in with your Google account to sync your StudySpot reservations,
          credits and campus preferences.
        </p>

        {firebaseUser ? (
          <>
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: "#f8fafc",
                marginBottom: 16,
                color: "#334155",
              }}
            >
              <strong>{firebaseUser.displayName || "SRM Student"}</strong>
              <div style={{ fontSize: 13, marginTop: 4, color: "#64748b" }}>
                {firebaseUser.email}
              </div>
            </div>

            <button
              type="button"
              onClick={onContinue}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 12,
                padding: "13px 16px",
                background: "#0b2a5b",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Continue to StudySpot
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            style={{
              width: "100%",
              border: "1px solid #dbe1ea",
              borderRadius: 12,
              padding: "13px 16px",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <LogIn size={18} />
            Continue with Google
          </button>
        )}

        <div
          style={{
            marginTop: 18,
            fontSize: 12,
            color: "#94a3b8",
            lineHeight: 1.5,
          }}
        >
          Prototype for SRMIST Kattankulathur (KTR).
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   1. DASHBOARD COMPONENT
   ========================================================= */

function Dashboard({
  now,
  credits,
  lockedCredits,
  booking,
  recommendedLocation,
  locations,
  userLocation,
  onFindSpace,
  onOpenLocation,
  onViewBooking,
  onCheckIn,
  onCheckOut,
  userName,
}) {
  const nowMs = now.getTime();

  // Booking state calculation
  const isUpcoming =
    booking &&
    booking.status === "reserved" &&
    nowMs < booking.startTimeMs;

  const isCheckInOpen =
    booking &&
    booking.status === "reserved" &&
    nowMs >= booking.startTimeMs &&
    nowMs <= booking.checkInDeadlineMs;

  const isActiveSession =
    booking && booking.status === "checked_in";

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{formatDateLongStr(now)}</div>
          <h1>{getGreeting(now)}, {userName}.</h1>
          <p>
            Find a focused place to study without walking around SRM campus
            looking for an empty seat.
          </p>
        </div>

        <button className="primary-button" onClick={onFindSpace}>
          Find a Study Space
          <ArrowRight size={17} />
        </button>
      </div>

      {/* ACTIVE / UPCOMING RESERVATION HERO WIDGET */}
      {booking && booking.status !== "completed" && (
        <section className="current-booking">
          <div className="section-header-row">
            <div>
              <span className="eyebrow">
                {isActiveSession
                  ? "ACTIVE STUDY SESSION"
                  : isCheckInOpen
                    ? "CHECK-IN WINDOW OPEN"
                    : isUpcoming
                      ? "UPCOMING RESERVATION"
                      : "CURRENT RESERVATION"}
              </span>
              <h3>
                {booking.location.name} — Seat {booking.seat.number}
              </h3>
            </div>

            <span
              className={`status-pill ${isActiveSession
                  ? "checked_in"
                  : isCheckInOpen
                    ? "checkin_open"
                    : isUpcoming
                      ? "reserved"
                      : booking.status
                }`}
            >
              {isActiveSession
                ? "Active Session"
                : isCheckInOpen
                  ? "Check-In Available"
                  : isUpcoming
                    ? "Upcoming"
                    : booking.status === "no_show"
                      ? "Expired"
                      : "Reserved"}
            </span>
          </div>

          <div className="booking-summary-grid">
            <div>
              <span>Location</span>
              <strong>{booking.location.building}</strong>
            </div>

            <div>
              <span>Scheduled Time</span>
              <strong>
                {booking.startTimeStr} – {booking.endTimeStr}
              </strong>
            </div>

            <div>
              <span>Deposit</span>
              <strong>{booking.deposit} credits locked</strong>
            </div>

            <div>
              <span>
                {isActiveSession
                  ? "Time Remaining"
                  : isCheckInOpen
                    ? "Check-In Closes In"
                    : "Check-In Opens In"}
              </span>
              <strong className="timer-highlight">
                {isActiveSession
                  ? formatSecondsToHHMMSS(
                    Math.max(0, Math.floor((booking.endTimeMs - nowMs) / 1000)),
                  )
                  : isCheckInOpen
                    ? formatSecondsToMMSS(
                      Math.max(
                        0,
                        Math.floor(
                          (booking.checkInDeadlineMs - nowMs) / 1000,
                        ),
                      ),
                    )
                    : formatSecondsToMMSS(
                      Math.max(
                        0,
                        Math.floor((booking.startTimeMs - nowMs) / 1000),
                      ),
                    )}
              </strong>
            </div>
          </div>

          <div className="booking-quick-actions">
            {isCheckInOpen && (
              <button className="primary-button" onClick={onCheckIn}>
                <Check size={16} /> Check In Now
              </button>
            )}

            {isActiveSession && (
              <button className="primary-button" onClick={onCheckOut}>
                <Check size={16} /> Check Out & Return Credits
              </button>
            )}

            <button className="secondary-button" onClick={onViewBooking}>
              View Details & Map <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}

      {/* DASHBOARD GRID: WALLET + QUICK ACTIONS */}
      <section className="dashboard-grid">
        <div className="credit-hero">
          <div className="credit-hero-top">
            <div>
              <span className="card-label">STUDYSPOT CREDITS</span>
              <h2>{credits}</h2>
              <p>Available Credits ready for booking</p>
            </div>

            <div className="credit-symbol">
              <CreditCard size={26} />
            </div>
          </div>

          <div className="credit-divider" />

          <div className="credit-footer">
            <div>
              <span>Locked</span>
              <strong>{lockedCredits}</strong>
            </div>

            <div>
              <span>Booking rate</span>
              <strong>25/hr</strong>
            </div>

            <div>
              <span>Max duration</span>
              <strong>2 hrs</strong>
            </div>
          </div>
        </div>

        <div className="quick-actions">
          <div className="section-title">
            <div>
              <span className="eyebrow">QUICK ACTIONS</span>
              <h3>What do you need?</h3>
            </div>
          </div>

          <div className="quick-action-grid">
            <button onClick={onFindSpace}>
              <div className="action-icon blue">
                <Search size={20} />
              </div>
              <span>Find a Seat Near You</span>
              <ChevronRight size={17} />
            </button>

            <button onClick={() => onOpenLocation(locations[0])}>
              <div className="action-icon purple">
                <Library size={20} />
              </div>
              <span>Browse Central Library</span>
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {/* SMART MATCH RECOMMENDATION WITH GOOGLE-MAPS-STYLE OCCUPANCY COMPARISON */}
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">SMART MATCH</span>
            <h2>Recommended for you</h2>
          </div>

          <button className="text-button" onClick={onFindSpace}>
            View all spaces <ArrowRight size={15} />
          </button>
        </div>

        <div className="recommendation-card">
          <div className="recommendation-main">
            <div className="recommendation-icon">
              <Sparkles size={24} />
            </div>

            <div>
              <div className="tag-row">
                <span className="recommendation-tag">
                  {userLocation ? `BEST MATCH FROM ${userLocation.toUpperCase()}` : "BEST MATCH"}
                </span>
                <span className={`crowd-status-badge ${recommendedLocation.crowdComparison.tone}`}>
                  {recommendedLocation.crowdComparison.label}
                </span>
              </div>

              <h3>{recommendedLocation.name}</h3>
              <p className="building-subtitle">
                <MapPin size={14} /> {recommendedLocation.building}
              </p>
              <p>{recommendedLocation.description}</p>

              <div className="location-meta">
                <span>
                  <Navigation size={15} />
                  {recommendedLocation.distance} m · ~{recommendedLocation.walkingTime} walk
                </span>
                <span>
                  <BatteryCharging size={15} />
                  {recommendedLocation.availableChargingSeats} charging seats
                </span>
                <span>
                  <BookOpen size={15} />
                  {recommendedLocation.noiseLevel} environment
                </span>
              </div>
            </div>
          </div>

          {/* GOOGLE-MAPS STYLE CURRENT VS USUAL COMPARISON IN HERO */}
          <div className="recommendation-right">
            <div className="comparison-mini-widget">
              <div className="comp-mini-header">
                <span>OCCUPANCY AT {formatHourStr(now)}</span>
                <span className="prototype-subtle">Prototype estimate</span>
              </div>

              <div className="comp-mini-stats">
                <div>
                  <span className="mini-lbl">Current</span>
                  <strong>{recommendedLocation.currentOccupancy}/{recommendedLocation.totalSeats} ({recommendedLocation.currentOccupancyPercent}%)</strong>
                </div>
                <div>
                  <span className="mini-lbl">Usually</span>
                  <span>{recommendedLocation.usualOccupancy}/{recommendedLocation.totalSeats} ({recommendedLocation.usualOccupancyPercent}%)</span>
                </div>
              </div>

              <div className={`comp-mini-pill ${recommendedLocation.crowdComparison.tone}`}>
                {recommendedLocation.crowdComparison.tone === "heavy" ? (
                  <TrendingUp size={13} />
                ) : recommendedLocation.crowdComparison.tone === "light" ? (
                  <TrendingDown size={13} />
                ) : (
                  <Users size={13} />
                )}
                <span>{recommendedLocation.crowdComparison.diffText}</span>
              </div>
            </div>

            <button
              className="secondary-button"
              onClick={() => onOpenLocation(recommendedLocation)}
            >
              View Seats
            </button>
          </div>
        </div>
      </section>

      {/* CAMPUS AVAILABILITY CARDS */}
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">CAMPUS AVAILABILITY</span>
            <h2>Study spaces around SRM</h2>
          </div>
          <span className="prototype-label">Demo Occupancy Estimates</span>
        </div>

        <div className="location-grid">
          {locations.map((location) => (
            <LocationCard
              key={location.id}
              now={now}
              location={location}
              onClick={() => onOpenLocation(location)}
            />
          ))}
        </div>
      </section>

      {/* DEMAND FORECAST */}
      <section className="prediction-banner">
        <div className="prediction-icon">
          <Clock3 size={22} />
        </div>

        <div>
          <span>DEMAND FORECAST</span>
          <strong>Peak period expected between 12:00 PM – 4:00 PM</strong>
          <p>
            Tech Park and Central Library experience highest occupancy during afternoon lab hours.
          </p>
        </div>

        <button onClick={onFindSpace}>
          Find a quieter space
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

/* =========================================================
   2. FIND SPACE COMPONENT
   ========================================================= */

function FindSpace({
  now,
  locations,
  userLocation,
  setUserLocation,
  chargingRequired,
  setChargingRequired,
  environment,
  setEnvironment,
  duration,
  setDuration,
  recommendedLocation,
  onOpenLocation,
}) {
  return (
    <div className="page">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">DISCOVER</div>
          <h1>Find your study space.</h1>
          <p>
            Tell us what you need and we'll prioritize the most suitable
            locations across SRM campus.
          </p>
        </div>
      </div>

      {/* FILTER TOOLBAR */}
      <section className="filter-panel">
        {/* OPTIONAL CURRENT CAMPUS LOCATION */}
        <div className="filter-group">
          <label>Where are you now?</label>
          <select
            value={userLocation}
            onChange={(e) => setUserLocation(e.target.value)}
            className="location-select"
          >
            <option value="">Select location (Optional)</option>
            {campusLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>

        {/* DURATION */}
        <div className="filter-group">
          <label>Duration</label>
          <div className="segmented">
            {[0.5, 1, 2].map((value) => (
              <button
                key={value}
                className={duration === value ? "selected" : ""}
                onClick={() => setDuration(value)}
              >
                {value === 0.5 ? "30 min" : `${value} hour${value > 1 ? "s" : ""}`}
              </button>
            ))}
          </div>
        </div>

        {/* CHARGING REQUIRED TOGGLE */}
        <div className="filter-group">
          <label>Power Outlet</label>
          <button
            className={`toggle-filter ${chargingRequired ? "selected" : ""}`}
            onClick={() => setChargingRequired((value) => !value)}
          >
            <Zap size={16} />
            Charging required
          </button>
        </div>

        {/* ENVIRONMENT DROPDOWN */}
        <div className="filter-group">
          <label>Environment</label>
          <select
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
          >
            <option value="Any">Any</option>
            <option value="Quiet">Quiet</option>
            <option value="Moderate">Moderate</option>
            <option value="Group">Group</option>
          </select>
        </div>
      </section>

      {/* FILTER EXPLANATION */}
      <div className="filter-note">
        <Sparkles size={17} />
        <span>
          {userLocation
            ? `Ranking study spaces by walking distance from ${userLocation}, seat availability, charging access, quietness, and current crowd conditions.`
            : "Smart matching prioritizes availability, charging access, quietness, crowd level, and live vs usual occupancy."}
        </span>
      </div>

      {/* RECOMMENDED BEST MATCH */}
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">RECOMMENDED</span>
            <h2>Best match</h2>
          </div>
        </div>

        <LocationCard
          now={now}
          location={recommendedLocation}
          featured
          onClick={() => onOpenLocation(recommendedLocation)}
        />
      </section>

      {/* ALL SPACES */}
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">ALL SPACES</span>
            <h2>Available around campus</h2>
          </div>
          <span className="prototype-label">Demo Occupancy Estimates</span>
        </div>

        <div className="location-grid">
          {locations.map((location) => (
            <LocationCard
              key={location.id}
              now={now}
              location={location}
              onClick={() => onOpenLocation(location)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   3. LOCATION CARD COMPONENT (WITH GOOGLE-MAPS STYLE CROWD)
   ========================================================= */

function LocationCard({ now, location, featured = false, onClick }) {
  const comparison = location.crowdComparison;

  return (
    <article className={`location-card ${featured ? "featured" : ""}`}>
      <div className="location-card-top">
        <div className="location-icon">
          <Library size={20} />
        </div>

        <div className="badge-cluster">
          <span className={`crowd-badge ${location.crowd.toLowerCase()}`}>
            {location.crowd} crowd
          </span>
        </div>
      </div>

      <h3>{location.name}</h3>
      <p className="card-building">
        <MapPin size={13} /> {location.building}
      </p>
      <p className="card-desc">{location.description}</p>

      <div className="availability-number">
        <strong>{location.availableSeats}</strong>
        <span>seats available ({location.availableChargingSeats} with charging)</span>
      </div>

      {/* GOOGLE-MAPS-STYLE OCCUPANCY & CROWD COMPARISON */}
      <div className="crowd-comparison-box">
        <div className="comparison-header">
          <div className="comparison-title-row">
            <Users size={13} />
            <span>OCCUPANCY & CROWD LEVEL</span>
          </div>
          <span className="demo-subtle-badge">
            Prototype estimate
          </span>
        </div>

        <div className="occupancy-bars">
          {/* CURRENT OCCUPANCY BAR */}
          <div className="occupancy-row">
            <div className="occupancy-label-row">
              <span className="occ-name">Current Occupancy</span>
              <strong className="occ-val">{location.currentOccupancy} / {location.totalSeats} ({location.currentOccupancyPercent}%)</strong>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill current ${comparison.tone}`}
                style={{ width: `${location.currentOccupancyPercent}%` }}
              />
            </div>
          </div>

          {/* USUAL OCCUPANCY BAR */}
          <div className="occupancy-row">
            <div className="occupancy-label-row">
              <span className="occ-name">Usual at {formatHourStr(now)}</span>
              <span className="occ-val-subtle">{location.usualOccupancy} / {location.totalSeats} ({location.usualOccupancyPercent}%)</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill usual"
                style={{ width: `${location.usualOccupancyPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* COMPARISON STATUS BADGE */}
        <div className={`crowd-status-pill ${comparison.tone}`}>
          {comparison.tone === "heavy" ? (
            <TrendingUp size={13} />
          ) : comparison.tone === "light" ? (
            <TrendingDown size={13} />
          ) : (
            <Check size={13} />
          )}
          <strong>{comparison.diffText}</strong>
          <span>• {comparison.label}</span>
        </div>
      </div>

      <div className="location-details">
        <span>
          <Navigation size={14} />
          {location.distance} m · ~{location.walkingTime} walk
        </span>
        <span>
          <BatteryCharging size={14} />
          {location.availableChargingSeats} charging
        </span>
        <span>
          <Wifi size={14} />
          {location.noiseLevel}
        </span>
      </div>

      <button className="card-action" onClick={onClick}>
        View available seats
        <ArrowRight size={16} />
      </button>
    </article>
  );
}

/* =========================================================
   4. SEAT / FLOOR PLAN SELECTION COMPONENT (PART 1: 1–15 MIN)
   ========================================================= */

function SeatSelection({
  now,
  location,
  seats,
  selectedSeat,
  duration,
  setDuration,
  startDelayMinutes,
  setStartDelayMinutes,
  remoteReservations,
  booking,
  setSelectedSeat,
  credits,
  chargingRequired,
  onBack,
  onSeatClick,
  onReserve,
}) {
  const [selectedFloor, setSelectedFloor] = useState(1);
  const isGroupBooking = selectedSeat?.kind === "group";
  const deposit = duration * (isGroupBooking ? 50 : 25);
  const nowMs = now.getTime();

  // Strict rule: Between NOW + 1 min and NOW + 15 min
  const chosenMinutes = Math.min(15, Math.max(1, startDelayMinutes));
  const startTimeMs = nowMs + chosenMinutes * 60 * 1000;
  const endTimeMs = startTimeMs + duration * 60 * 60 * 1000;

  const formattedStartTime = formatTimeStr(new Date(startTimeMs));
  const formattedEndTime = formatTimeStr(new Date(endTimeMs));

  // Generate dynamic 15 individual minute options (from +1 to +15 minutes)
  const minuteOptions = useMemo(() => {
    const options = [];
    for (let m = 1; m <= 15; m += 1) {
      const targetTime = new Date(nowMs + m * 60 * 1000);
      options.push({
        minutes: m,
        timeStr: formatTimeStr(targetTime),
        label: `${formatTimeStr(targetTime)} (In ${m} min${m > 1 ? "s" : ""})`,
      });
    }
    return options;
  }, [nowMs]);

  // Time-aware seat map. A seat is unavailable when either the real-time
  // Firestore reservations or the current user's local booking overlaps the
  // selected window. The active checked-in state has higher priority than a
  // future reservation, and both have higher priority than the physical
  // charging state of the seat.
  const displaySeats = useMemo(() => {
    return seats.filter((seat) => Number(seat.floor ?? 1) === selectedFloor).map((seat) => {
      const remoteConflict = getSeatReservationConflict(
        remoteReservations,
        location.id,
        seat.id,
        startTimeMs,
        endTimeMs,
      );

      const requestedLocationId = String(location.id ?? "");
      const requestedSeatId = String(seat.id ?? "");
      const bookingLocationId = String(booking?.location?.id ?? booking?.locationId ?? "");
      const bookingSeatId = String(booking?.seat?.id ?? booking?.seatId ?? "");

      const localConflict =
        booking &&
        (booking.status === "reserved" || booking.status === "checked_in") &&
        bookingLocationId === requestedLocationId &&
        bookingSeatId === requestedSeatId &&
        Number(booking.endTimeMs ?? 0) > startTimeMs &&
        Number(booking.startTimeMs ?? 0) < endTimeMs
          ? booking
          : null;

      // Prefer the local booking when it exists because it is updated
      // immediately on this client, while the Firestore listener can arrive
      // a moment later. Otherwise use the real-time Firestore reservation.
      const conflict = localConflict || remoteConflict;

      if (!conflict) {
        return {
          ...seat,
          status: "available",
        };
      }

      return {
        ...seat,
        status:
          conflict.status === "checked_in" ? "occupied" : "reserved",
      };
    });
  }, [
    seats,
    remoteReservations,
    booking,
    location.id,
    startTimeMs,
    endTimeMs,
    selectedFloor,
  ]);

  // If the user changes the time/duration while a seat is selected and that
  // seat becomes unavailable for the new window, clear the selection.
  useEffect(() => {
    if (!selectedSeat) return;

    const stillAvailable = displaySeats.some(
      (seat) => seat.id === selectedSeat.id && seat.status === "available",
    );

    if (!stillAvailable) {
      setSelectedSeat(null);
    }
  }, [displaySeats, selectedSeat, setSelectedSeat]);

  return (
    <div className="page">
      <button className="back-button" onClick={onBack}>
        ← Back to spaces
      </button>

      <div className="page-heading compact">
        <div>
          <div className="eyebrow">SEAT SELECTION</div>
          <h1>{location.name}</h1>
          <p className="building-subtitle">
            <MapPin size={15} /> {location.building} • {location.description}
          </p>
        </div>
      </div>

      <div className="seat-layout">
        {/* FLOOR MAP PANEL */}
        <section className="seat-map-panel">
          <div className="seat-map-header">
            <div>
              <span className="eyebrow">STUDY AREA FLOOR PLAN</span>
              <h2>Select an available seat</h2>
            </div>

            <div className="seat-legend">
              <span>
                <i className="legend-dot available" />
                Available
              </span>
              <span>
                <i className="legend-dot occupied" />
                Occupied
              </span>
              <span>
                <i className="legend-dot booked" />
                Booked
              </span>
              <span>
                <i className="legend-dot group" />
                Group
              </span>
              <span>
                <i className="legend-dot charging" />
                Charging
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: "8px",
              fontSize: "12px",
              color: "#6b7280",
            }}
          >
            <strong style={{ color: "#dc2626" }}>Booked</strong> means the seat is reserved for the selected time but the student has not checked in yet.
          </div>

          {Number(location.floors ?? 1) > 1 && (
            <div className="floor-tabs">
              {Array.from({ length: Number(location.floors) }, (_, index) => index + 1).map((floor) => (
                <button
                  key={floor}
                  className={selectedFloor === floor ? "selected" : ""}
                  onClick={() => {
                    setSelectedFloor(floor);
                    setSelectedSeat(null);
                  }}
                >
                  Floor {floor}
                </button>
              ))}
            </div>
          )}

          <div className="floor-summary">
            <strong>{location.totalSeats.toLocaleString()} total seats</strong> · {location.floors} floor{location.floors > 1 ? "s" : ""} · {location.groupTables} group tables (4 seats each) · 50 individual seats per floor · arranged in 5 rows with a central aisle
          </div>

          <div className="window-label">WINDOW ZONE</div>

          <div className="floor-plan-map">
            <div className="map-zone-label">INDIVIDUAL STUDY ZONE</div>

            <div className="seat-map-grid" aria-label={`Floor ${selectedFloor} individual study seats`}>
              {displaySeats
                .filter((seat) => seat.kind === "individual")
                .map((seat, index) => {
                  const column = index % 10;
                  const aisleClass = column === 4 ? "aisle-after" : "";
                  return (
                    <button
                      key={seat.id}
                      disabled={seat.status !== "available"}
                      className={[
                        "seat",
                        seat.status,
                        seat.hasCharging ? "has-charging" : "",
                        selectedSeat?.id === seat.id ? "selected" : "",
                        chargingRequired && !seat.hasCharging ? "not-matching" : "",
                        aisleClass,
                      ].filter(Boolean).join(" ")}
                      onClick={() => onSeatClick(seat)}
                      title={
                        seat.status === "reserved"
                          ? `Seat ${seat.number} is booked for the selected time and is not yet checked in`
                          : seat.status === "occupied"
                            ? `Seat ${seat.number} is currently occupied and is not available for the selected time`
                            : `Seat ${seat.number} ${seat.hasCharging ? "(Charging Available)" : ""} - ${seat.status}`
                      }
                    >
                      {seat.hasCharging && <Zap size={10} />}
                      <span>{seat.number}</span>
                    </button>
                  );
                })}
            </div>

            <div className="map-aisle-label">CENTRAL AISLE</div>

            <div className="map-zone-label group-zone-title">GROUP STUDY ZONE</div>
            <div className="group-seat-map" aria-label={`Floor ${selectedFloor} group tables`}>
              {displaySeats
                .filter((seat) => seat.kind === "group")
                .map((seat) => (
                  <button
                    key={seat.id}
                    disabled={seat.status !== "available"}
                    className={[
                      "seat",
                      "group-table",
                      seat.status,
                      selectedSeat?.id === seat.id ? "selected" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => onSeatClick(seat)}
                    title={
                      seat.status === "reserved"
                        ? `Group table ${seat.number} is booked for the selected time`
                        : seat.status === "occupied"
                          ? `Group table ${seat.number} is currently occupied`
                          : `Group table ${seat.number} - 4 seats`
                    }
                  >
                    <Users size={12} />
                    <span>{seat.number}</span>
                    <small>4 seats</small>
                  </button>
                ))}
            </div>
          </div>

          <div className="group-pricing-note">
            <Users size={14} />
            <span>Group tables seat 4 students. Group booking rate: 25 / 50 / 100 credits for 30 min / 1 hr / 2 hrs.</span>
          </div>

          <div className="entrance-label">ENTRANCE & CHECK-IN DESK</div>
        </section>

        {/* RESERVATION SIDE PANEL */}
        <aside className="reservation-panel">
          <div className="panel-heading">
            <span className="eyebrow">RESERVATION</span>
            <h3>Reserve your spot</h3>
          </div>

          <div className="selected-seat-display">
            <div>
              <span>Selected seat</span>
              <strong>{selectedSeat ? selectedSeat.number : "—"}</strong>
            </div>
            {selectedSeat?.kind === "group" ? (
              <span className="badge-tag group-badge">
                <Users size={12} /> 4 seats · Group
              </span>
            ) : selectedSeat?.hasCharging ? (
              <span className="badge-tag">
                <Zap size={12} /> Charging
              </span>
            ) : null}
          </div>

          {/* DYNAMIC MINUTE-LEVEL START TIME SELECTOR (1 TO 15 MINUTES IN ADVANCE) */}
          <div className="reservation-field">
            <label>
              <Clock3 size={13} /> Start Time (1 to 15 min ahead)
            </label>
            <select
              value={chosenMinutes}
              onChange={(e) => setStartDelayMinutes(Number(e.target.value))}
              className="time-select"
            >
              {minuteOptions.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="lead-time-rule">
              <Info size={13} />
              <span>Reservations can be made up to 15 minutes in advance.</span>
            </div>
            <span className="field-hint">
              Scheduled for <strong>{formattedStartTime}</strong> to <strong>{formattedEndTime}</strong>
            </span>
          </div>

          {/* DURATION OPTIONS */}
          <div className="reservation-field">
            <label>Duration</label>
            <div className="duration-options">
              {[0.5, 1, 2].map((value) => (
                <button
                  key={value}
                  className={duration === value ? "selected" : ""}
                  onClick={() => setDuration(value)}
                >
                  <strong>{value === 0.5 ? "30 min" : `${value} hr${value > 1 ? "s" : ""}`}</strong>
                  <span>{value * (isGroupBooking ? 50 : 25)} credits</span>
                </button>
              ))}
            </div>
          </div>

          {/* CHECK-IN GRACE WINDOW INFO */}
          <div className="checkin-notice-box">
            <Info size={15} />
            <div>
              <strong>5-Minute Check-In Grace Window</strong>
              <p>
                You can check in from {formattedStartTime} until 5 minutes after start time.
              </p>
            </div>
          </div>

          {/* COST SUMMARY */}
          <div className="cost-summary">
            <div>
              <span>Booking rate</span>
              <strong>{isGroupBooking ? "50 credits / hour" : "25 credits / hour"}</strong>
            </div>

            <div>
              <span>Locked deposit</span>
              <strong>{deposit} credits</strong>
            </div>

            <div>
              <span>Available balance</span>
              <strong>{credits}</strong>
            </div>

            <div className="cost-total">
              <span>After reservation</span>
              <strong>{credits - deposit} available</strong>
            </div>
          </div>

          <div className="refund-note">
            <ShieldCheck size={16} />
            <p>
              This is a refundable deposit. Complete your session or cancel to
              receive 100% of your credits back.
            </p>
          </div>

          <button
            className="primary-button full"
            disabled={!selectedSeat || credits < deposit}
            onClick={onReserve}
          >
            {credits < deposit
              ? "Insufficient Credits"
              : selectedSeat
                ? `Confirm Reservation (${formattedStartTime})`
                : "Select a Seat"}
            <ArrowRight size={17} />
          </button>
        </aside>
      </div>
    </div>
  );
}

/* =========================================================
   5. RESERVATIONS COMPONENT
   ========================================================= */

function Reservations({
  now,
  booking,
  onCheckIn,
  onCheckOut,
  onCancel,
  onSimulateCheckInOpen,
  onSimulateNoShow,
  onFindSpace,
}) {
  const nowMs = now.getTime();

  const isUpcoming =
    booking &&
    booking.status === "reserved" &&
    nowMs < booking.startTimeMs;

  const isCheckInOpen =
    booking &&
    booking.status === "reserved" &&
    nowMs >= booking.startTimeMs &&
    nowMs <= booking.checkInDeadlineMs;

  const isActiveSession =
    booking && booking.status === "checked_in";

  return (
    <div className="page">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">BOOKINGS & SESSIONS</div>
          <h1>My reservations.</h1>
          <p>Manage your current, upcoming, and previous StudySpot bookings.</p>
        </div>
      </div>

      {!booking && (
        <div className="empty-state">
          <div className="empty-icon">
            <CalendarDays size={28} />
          </div>
          <h3>No active reservation</h3>
          <p>
            Find a study space and reserve a seat whenever you're ready to study.
          </p>
          <button className="primary-button" onClick={onFindSpace}>
            Find a Study Space
            <ArrowRight size={17} />
          </button>
        </div>
      )}

      {booking && (
        <>
          <div className="reservation-status-card">
            <div className="reservation-status-top">
              <div>
                <span className="eyebrow">
                  {isActiveSession
                    ? "ACTIVE STUDY SESSION"
                    : isCheckInOpen
                      ? "CHECK-IN WINDOW OPEN"
                      : isUpcoming
                        ? "UPCOMING RESERVATION"
                        : "RESERVATION DETAILS"}
                </span>
                <h2>{booking.location.name}</h2>
                <p className="card-building">
                  <MapPin size={14} /> {booking.location.building}
                </p>
              </div>

              <span
                className={`status-pill ${isActiveSession
                  ? "checked_in"
                  : isCheckInOpen
                    ? "checkin_open"
                    : isUpcoming
                      ? "reserved"
                      : booking.status === "completed"
                        ? "completed"
                        : booking.status === "cancelled"
                          ? "cancelled"
                          : booking.status === "no_show"
                            ? "no_show"
                            : "reserved"
                  }`}
              >
                {isActiveSession
                  ? "Active Session"
                  : isCheckInOpen
                    ? "Check-In Open"
                    : isUpcoming
                      ? "Upcoming"
                      : booking.status === "completed"
                        ? "Completed"
                        : booking.status === "cancelled"
                          ? "Cancelled"
                          : booking.status === "no_show"
                            ? "Check-In Expired"
                            : "Reserved"}
              </span>
            </div>

            <div className="reservation-details">
              <div>
                <span>Seat</span>
                <strong>{booking.seat.number}</strong>
              </div>

              <div>
                <span>Time Window</span>
                <strong>
                  {booking.startTimeStr} – {booking.endTimeStr}
                </strong>
              </div>

              <div>
                <span>Duration</span>
                <strong>{booking.duration === 0.5 ? "30 mins" : `${booking.duration} hr${booking.duration > 1 ? "s" : ""}`}</strong>
              </div>

              <div>
                <span>Deposit</span>
                <strong>{booking.deposit} credits locked</strong>
              </div>
            </div>

            {/* STATE 1: UPCOMING (BEFORE START TIME) */}
            {isUpcoming && (
              <div className="lifecycle-block upcoming-block">
                <div className="checkin-window">
                  <div className="checkin-icon">
                    <Clock3 size={20} />
                  </div>
                  <div>
                    <strong>Check-in opens at {booking.startTimeStr}</strong>
                    <p>
                      A reservation starts within 15 minutes of booking. You
                      will have a 5-minute window ({booking.startTimeStr} –{" "}
                      {formatTimeStr(new Date(booking.checkInDeadlineMs))}) to
                      check in.
                    </p>
                  </div>
                </div>

                <div className="countdown-widget">
                  <span>CHECK-IN OPENS IN</span>
                  <div className="timer-display">
                    {formatSecondsToMMSS(
                      Math.max(0, Math.floor((booking.startTimeMs - nowMs) / 1000)),
                    )}
                  </div>
                </div>

                <div className="reservation-actions">
                  <button className="secondary-button" onClick={onCancel}>
                    Cancel Reservation (Full Refund)
                  </button>
                  <button
                    className="demo-button"
                    onClick={onSimulateCheckInOpen}
                    title="Fast forward device time to test Check-In window"
                  >
                    Demo: Fast-Forward to Check-In
                  </button>
                </div>
              </div>
            )}

            {/* STATE 2: CHECK-IN AVAILABLE (START TIME TO START TIME + 5 MINS) */}
            {isCheckInOpen && (
              <div className="lifecycle-block checkin-active-block">
                <div className="checkin-window active-window">
                  <div className="checkin-icon pulse-icon">
                    <Clock3 size={20} />
                  </div>
                  <div>
                    <strong>5-Minute Check-In Window Is Now Active!</strong>
                    <p>
                      Please check in before{" "}
                      {formatTimeStr(new Date(booking.checkInDeadlineMs))} to
                      claim your seat.
                    </p>
                  </div>
                </div>

                <div className="countdown-widget grace-widget">
                  <span>CHECK IN WITHIN</span>
                  <div className="timer-display alert">
                    {formatSecondsToMMSS(
                      Math.max(
                        0,
                        Math.floor((booking.checkInDeadlineMs - nowMs) / 1000),
                      ),
                    )}
                  </div>
                </div>

                <div className="reservation-actions">
                  <button className="primary-button" onClick={onCheckIn}>
                    <Check size={18} /> Check In Now
                  </button>
                  <button className="secondary-button" onClick={onCancel}>
                    Cancel Reservation
                  </button>
                  <button
                    className="demo-button"
                    onClick={onSimulateNoShow}
                    title="Simulate missed check-in window"
                  >
                    Demo: Simulate Missed Check-In
                  </button>
                </div>
              </div>
            )}

            {/* STATE 3: ACTIVE STUDY SESSION (CHECKED IN) */}
            {isActiveSession && (
              <div className="lifecycle-block active-session-block">
                <div className="active-session">
                  <div>
                    <span>ACTIVE STUDY SESSION</span>
                    <strong>
                      You are using Seat {booking.seat.number} at {booking.location.name}
                    </strong>
                    <p>Session ends at {booking.endTimeStr}</p>
                  </div>

                  <div className="timer">
                    {formatSecondsToHHMMSS(
                      Math.max(
                        0,
                        Math.floor((booking.endTimeMs - nowMs) / 1000),
                      ),
                    )}
                  </div>
                </div>

                {/* 10-MINUTE WARNING NOTIFICATION IN-APP BANNER */}
                {booking.endTimeMs - nowMs <= 10 * 60 * 1000 &&
                  booking.endTimeMs - nowMs > 0 && (
                    <div className="warning-banner-box">
                      <Bell size={18} />
                      <div>
                        <strong>10 Minutes Remaining!</strong>
                        <p>
                          Your session at {booking.location.name} ends at {booking.endTimeStr}.
                          Please prepare to check out.
                        </p>
                      </div>
                    </div>
                  )}

                <div className="reservation-actions">
                  <button className="primary-button" onClick={onCheckOut}>
                    <Check size={18} /> Check Out & Return Credits
                  </button>
                </div>
              </div>
            )}

            {/* STATE 4: COMPLETED */}
            {booking.status === "completed" && (
              <div className="success-result">
                <Check size={22} />
                <div>
                  <strong>Reservation completed successfully.</strong>
                  <p>
                    {booking.deposit} StudySpot Credits have been fully returned
                    to your wallet.
                  </p>
                </div>
              </div>
            )}

            {/* STATE 5: NO SHOW / CHECK-IN EXPIRED */}
            {booking.status === "no_show" && (
              <div className="warning-result">
                <Clock3 size={22} />
                <div>
                  <strong>Check-in window expired.</strong>
                  <p>
                    You did not check in within the 5-minute grace period. Your
                    seat was released and {booking.refund || booking.deposit} credits
                    were returned to your balance.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="fairness-card">
            <div className="fairness-icon">
              <ShieldCheck size={22} />
            </div>
            <div>
              <strong>Guaranteed Fairness & Refundable Deposits</strong>
              <p>
                StudySpot Credits are refundable deposits designed to encourage
                responsible study-space usage. Check-in within 5 minutes of your
                start time and check out when done to receive 100% of your credits back.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   6. CREDITS WALLET COMPONENT
   ========================================================= */

function Credits({ credits, lockedCredits, transactions }) {
  return (
    <div className="page">
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">STUDYSPOT CREDITS</div>
          <h1>Your credit wallet.</h1>
          <p>
            Credits are refundable booking deposits designed to encourage
            responsible use of study spaces across SRM campus.
          </p>
        </div>
      </div>

      {/* WALLET METRICS */}
      <div className="wallet-grid">
        <div className="wallet-card primary">
          <span>AVAILABLE CREDITS</span>
          <strong>{credits}</strong>
          <p>Credits ready for your next study space reservation.</p>
        </div>

        <div className="wallet-card secondary">
          <span>LOCKED CREDITS</span>
          <strong>{lockedCredits}</strong>
          <p>Temporarily held against active and upcoming reservations.</p>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section className="credit-explanation">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">HOW IT WORKS</span>
            <h2>Refundable, not spent.</h2>
          </div>
        </div>

        <div className="credit-steps">
          <div>
            <span>01</span>
            <CreditCard size={20} />
            <strong>Book in Advance</strong>
            <p>
              25 credits are locked for every hour. Book 1 to 15 minutes in advance.
            </p>
          </div>

          <div>
            <span>02</span>
            <Clock3 size={20} />
            <strong>Check In on Time</strong>
            <p>
              Arrive and check in during the 5-minute grace period from start time.
            </p>
          </div>

          <div>
            <span>03</span>
            <Check size={20} />
            <strong>Check Out & Refund</strong>
            <p>100% of your locked deposit returns automatically to your wallet.</p>
          </div>
        </div>
      </section>

      {/* TRANSACTION HISTORY (PERSISTED) */}
      <section className="section-block">
        <div className="section-header-row">
          <div>
            <span className="eyebrow">TRANSACTIONS</span>
            <h2>Credit history</h2>
          </div>
        </div>

        <div className="transaction-list">
          {transactions.map((tx) => (
            <div key={tx.id} className="transaction">
              <div
                className={`transaction-icon ${tx.type === "positive" ? "positive" : "negative"
                  }`}
              >
                {tx.type === "positive" ? (
                  <Check size={17} />
                ) : (
                  <CreditCard size={17} />
                )}
              </div>

              <div>
                <strong>{tx.title}</strong>
                <span>{tx.subtitle}</span>
              </div>

              <strong
                className={`amount ${tx.type === "positive" ? "positive-text" : "negative-text"
                  }`}
              >
                {tx.type === "positive" ? `+${tx.amount}` : `${tx.amount}`}
              </strong>
            </div>
          ))}
        </div>
      </section>

      {/* VIRTUAL PROTOTYPE POLICY */}
      <div className="credit-policy">
        <ShieldCheck size={19} />
        <div>
          <strong>Virtual SRM Prototype Credits</strong>
          <p>
            StudySpot Credits are virtual prototype credits. They are not real
            money, cannot be withdrawn, and do not affect university fees,
            grades, academic records or student standing at SRMIST.
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;