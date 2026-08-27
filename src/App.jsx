import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  Bell,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  CreditCard,
  Heart,
  Home,
  Info,
  Layers,
  LogOut,
  MapPin,
  Moon,
  QrCode,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
  Volume2,
  VolumeX,
  Wifi,
  Wind,
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
  getStudySpacesFromDb,
  seedStudySpacesIfEmpty,
  createFirestoreReservation,
  subscribeToAllReservations,
  subscribeToStudySpaces,
  updateReservationStatusInDb,
  addCreditTransactionToDb,
} from "./services/firestore";

/* =========================================================
   SAFE LOCAL STORAGE HELPERS
   ========================================================= */
const loadStorage = (key, fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};

const saveStorage = (key, value) => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {}
};

/* =========================================================
   SRM CAMPUS STUDY SPACES DATA WITH RICH PHOTOGRAPHY
   ========================================================= */
const DEFAULT_STUDY_SPACES = [
  {
    id: "central-library",
    name: "Central Library Focus Zone",
    shortName: "Central Library",
    building: "Main Campus • Block B",
    campusLocation: "University Building (UB Block)",
    description:
      "A dedicated quiet area with individual carrels and panoramic views of the campus grounds. Ideal for deep work and exam preparation.",
    totalSeats: 80,
    chargingSeats: 60,
    groupTables: 12,
    floors: 4,
    noiseLevel: "Low",
    studyType: "Quiet Zone",
    distanceStr: "0.2 mi",
    walkTimeStr: "3 min walk",
    hours: "8:00 AM - 10:00 PM",
    occupancyPercent: 85,
    availableSeats: 12,
    image:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1000&q=80",
    tags: ["Quiet Zone", "Power Outlets", "AC", "High-Speed Wi-Fi"],
  },
  {
    id: "tech-hub-3",
    name: "Tech Hub Building 3",
    shortName: "Tech Hub 3",
    building: "Tech Park 1 • Floor 3",
    campusLocation: "Tech Park (Tech Park 1)",
    description:
      "Modern collaborative workspaces featuring dual monitor docking stations, standing desks, and breakout areas.",
    totalSeats: 60,
    chargingSeats: 60,
    groupTables: 16,
    floors: 3,
    noiseLevel: "Moderate",
    studyType: "Collaborative",
    distanceStr: "0.4 mi",
    walkTimeStr: "5 min walk",
    hours: "Open until 8:00 PM",
    occupancyPercent: 70,
    availableSeats: 18,
    image:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1000&q=80",
    tags: ["Monitors", "Collab", "Power", "Wi-Fi 6"],
  },
  {
    id: "design-studio-alpha",
    name: "Design Studio Alpha",
    shortName: "Design Studio",
    building: "SEAD Architecture Block",
    campusLocation: "School of Architecture & Design",
    description:
      "Spacious creative studio with high drafting tables, natural daylighting, and material prototyping tables.",
    totalSeats: 30,
    chargingSeats: 25,
    groupTables: 8,
    floors: 2,
    noiseLevel: "Moderate",
    studyType: "Workstations",
    distanceStr: "0.3 mi",
    walkTimeStr: "4 min walk",
    hours: "8:30 AM - 9:00 PM",
    occupancyPercent: 93,
    availableSeats: 2,
    image:
      "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1000&q=80",
    tags: ["Design", "Drafting Desks", "Workstations"],
  },
  {
    id: "ub-quiet-pods",
    name: "UB Quiet Study Pods",
    shortName: "UB Study Pods",
    building: "University Building • Floor 2",
    campusLocation: "University Building (UB Block)",
    description:
      "Acoustically isolated single pods equipped with dimmable task lighting and individual climate airflows.",
    totalSeats: 50,
    chargingSeats: 50,
    groupTables: 4,
    floors: 2,
    noiseLevel: "Strict Silence",
    studyType: "Quiet Zone",
    distanceStr: "0.1 mi",
    walkTimeStr: "1 min walk",
    hours: "24/7 Access",
    occupancyPercent: 40,
    availableSeats: 30,
    image:
      "https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?auto=format&fit=crop&w=1000&q=80",
    tags: ["Quiet Pods", "24/7", "Power"],
  },
  {
    id: "tech-park-2-lounge",
    name: "Tech Park 2 Study Lounge",
    shortName: "TP2 Lounge",
    building: "Tech Park 2 • Ground Floor",
    campusLocation: "Tech Park 2",
    description:
      "Vibrant open study lounge with coffee kiosk proximity, high bar stools, and power charging strips.",
    totalSeats: 45,
    chargingSeats: 35,
    groupTables: 10,
    floors: 1,
    noiseLevel: "Moderate",
    studyType: "Collaborative",
    distanceStr: "0.1 mi",
    walkTimeStr: "2 min walk",
    hours: "7:00 AM - 11:00 PM",
    occupancyPercent: 55,
    availableSeats: 20,
    image:
      "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=1000&q=80",
    tags: ["Lounge", "Coffee Nearby", "Wi-Fi"],
  },
];

/* =========================================================
   SEAT LAYOUT GENERATOR FOR STITCH INTERACTIVE MAP
   ========================================================= */
const INITIAL_SEATS = [
  // Row A (Individual Carrels)
  { id: "A1", label: "A1", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "A2", label: "A2", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "occupied" },
  { id: "A3", label: "A3", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "occupied" },
  { id: "A4", label: "A4", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  // Row B
  { id: "B1", label: "B1", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "maintenance" },
  { id: "B2", label: "B2", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "B3", label: "B3", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "occupied" },
  { id: "B4", label: "B4", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  // Row C
  { id: "C1", label: "C1", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "C2", label: "C2", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "C3", label: "C3", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "occupied" },
  { id: "C4", label: "C4", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "C5", label: "C5", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  { id: "C6", label: "C6", zone: "Silent Zone A", kind: "carrel", floor: 1, hasPower: true, status: "available" },
  // Collaborative Tables
  { id: "T1", label: "T1", zone: "Collab Table A", kind: "round", floor: 1, table: "A", hasPower: true, status: "available" },
  { id: "T2", label: "T2", zone: "Collab Table A", kind: "round", floor: 1, table: "A", hasPower: true, status: "occupied" },
  { id: "T3", label: "T3", zone: "Collab Table B", kind: "round", floor: 1, table: "B", hasPower: true, status: "available" },
  { id: "T4", label: "T4", zone: "Collab Table B", kind: "round", floor: 1, table: "B", hasPower: true, status: "available" },
];

/* Helper to format time */
function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return "00:00";
  const totalSecs = Math.floor(msRemaining / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function App() {
  // App navigation state: 'home' | 'space-details' | 'seat-map' | 'seat-booking' | 'booking-confirmed' | 'bookings' | 'profile' | 'login'
  const [currentScreen, setCurrentScreen] = useState("home");
  const [theme, setTheme] = useState(() => loadStorage("studyspot_theme", "light"));

  // Apply theme attribute to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveStorage("studyspot_theme", theme);
  }, [theme]);

  // Real-time clock tick
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Firebase Auth State
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Notifications Toast
  const [toast, setToast] = useState(null);
  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3800);
  };

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        try {
          await syncUserProfile(fbUser);
        } catch (e) {
          console.warn("Profile sync:", e);
        }
      } else {
        setUser(null);
      }
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  // Study Spaces & Firestore Real-time Sync
  const [spaces, setSpaces] = useState(DEFAULT_STUDY_SPACES);
  const [selectedSpace, setSelectedSpace] = useState(DEFAULT_STUDY_SPACES[0]);

  useEffect(() => {
    seedStudySpacesIfEmpty(DEFAULT_STUDY_SPACES).catch(() => {});
    const unsubSpaces = subscribeToStudySpaces((dbSpaces) => {
      if (dbSpaces && dbSpaces.length > 0) {
        setSpaces(dbSpaces);
      }
    });
    return () => unsubSpaces();
  }, []);

  // Firestore Real-Time Seat Reservations Sync
  const [firestoreReservations, setFirestoreReservations] = useState([]);
  useEffect(() => {
    const unsubRes = subscribeToAllReservations((reservations) => {
      setFirestoreReservations(reservations || []);
    });
    return () => unsubRes();
  }, []);

  // Credits & Locked Credits
  const [credits, setCredits] = useState(() => loadStorage("studyspot_credits", 100));
  const [lockedCredits, setLockedCredits] = useState(() => loadStorage("studyspot_locked_credits", 0));
  const [transactions, setTransactions] = useState(() =>
    loadStorage("studyspot_txs", [
      {
        id: "tx-welcome",
        title: "Welcome Credits Added",
        subtitle: "SRMIST Student Account Initiation",
        amount: 100,
        type: "positive",
        time: Date.now() - 3600000,
      },
    ])
  );

  useEffect(() => saveStorage("studyspot_credits", credits), [credits]);
  useEffect(() => saveStorage("studyspot_locked_credits", lockedCredits), [lockedCredits]);
  useEffect(() => saveStorage("studyspot_txs", transactions), [transactions]);

  // Active Booking
  const [activeBooking, setActiveBooking] = useState(() => loadStorage("studyspot_active_booking", null));
  useEffect(() => saveStorage("studyspot_active_booking", activeBooking), [activeBooking]);

  // Search & Filter state for Discover
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All Spaces");
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [bookingDuration, setBookingDuration] = useState(2); // Default 2 hours

  // Live Seat Matrix combining Firestore reservations
  const currentSeatMap = useMemo(() => {
    return INITIAL_SEATS.map((seat) => {
      // Check if reserved in Firestore for this space & seat
      const isReservedInDb = firestoreReservations.some(
        (r) =>
          r.seatId === seat.id &&
          r.locationId === selectedSpace.id &&
          (r.status === "reserved" || r.status === "checked_in") &&
          Number(r.endTimeMs) > Date.now()
      );

      // Check if local active booking holds this seat
      const isLocalActive =
        activeBooking &&
        activeBooking.seatId === seat.id &&
        activeBooking.spaceId === selectedSpace.id &&
        (activeBooking.status === "reserved" || activeBooking.status === "checked_in");

      if (isReservedInDb || isLocalActive) {
        return { ...seat, status: "occupied" };
      }
      return seat;
    });
  }, [firestoreReservations, activeBooking, selectedSpace.id]);

  // Filtered Study Spaces list
  const filteredSpaces = useMemo(() => {
    return spaces.filter((sp) => {
      const matchSearch =
        sp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sp.building.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (sp.campusLocation && sp.campusLocation.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchSearch) return false;
      if (activeFilter === "All Spaces") return true;
      if (activeFilter === "Quiet Zone") return sp.noiseLevel === "Low" || sp.noiseLevel === "Strict Silence";
      if (activeFilter === "Collaborative") return sp.studyType === "Collaborative" || sp.noiseLevel === "Moderate";
      if (activeFilter === "Power Available") return (sp.chargingSeats || 0) > 0;
      if (activeFilter === "Near Me") return sp.distanceStr && (sp.distanceStr.includes("0.1") || sp.distanceStr.includes("0.2"));
      return true;
    });
  }, [spaces, searchQuery, activeFilter]);

  // Login handler
  const handleGoogleLogin = async () => {
    try {
      const cred = await signInWithGoogle();
      if (cred.user) {
        setUser(cred.user);
        showToast("Signed in successfully with Google!");
        setCurrentScreen("home");
      }
    } catch (err) {
      showToast("Google sign in cancelled or failed.", "error");
    }
  };

  const handleDemoStudentLogin = () => {
    const mockUser = {
      uid: "srm-student-211103010452",
      displayName: "Thilak Govind",
      email: "tg4520@srmist.edu.in",
      regNo: "RA211103010452",
      department: "B.Tech Computer Science & Engineering",
      semester: "6th Semester",
    };
    setUser(mockUser);
    showToast("Logged in as SRM Student RA211103010452");
    setCurrentScreen("home");
  };

  const handleSignOut = async () => {
    await signOutUser();
    setUser(null);
    showToast("Signed out successfully.");
    setCurrentScreen("home");
  };

  // Booking Flow: Confirm Reservation
  const handleConfirmReservation = async () => {
    if (!selectedSeat) {
      showToast("Please select a seat from the map first.", "error");
      return;
    }

    const costInCredits = bookingDuration * 25; // 25 credits per hour
    if (credits < costInCredits) {
      showToast("Insufficient StudySpot credits.", "error");
      return;
    }

    const startTime = Date.now() + 5 * 60 * 1000; // starts in 5 minutes
    const endTime = startTime + bookingDuration * 3600 * 1000;
    const checkInDeadline = startTime + 15 * 60 * 1000; // 15 min check-in window

    const newBooking = {
      id: `booking-${Date.now()}`,
      spaceId: selectedSpace.id,
      spaceName: selectedSpace.name,
      building: selectedSpace.building,
      seatId: selectedSeat.id,
      seatLabel: selectedSeat.label,
      zone: selectedSeat.zone || "Silent Zone A",
      durationHours: bookingDuration,
      cost: costInCredits,
      status: "reserved", // 'reserved' | 'checked_in' | 'completed' | 'cancelled'
      startTimeMs: startTime,
      endTimeMs: endTime,
      checkInDeadlineMs: checkInDeadline,
      formattedStart: formatTime(startTime),
      formattedEnd: formatTime(endTime),
      bookedAt: Date.now(),
    };

    // Update credits locally
    setCredits((prev) => prev - costInCredits);
    setLockedCredits((prev) => prev + costInCredits);

    // Record Transaction
    const tx = {
      id: `tx-${Date.now()}`,
      title: `Seat ${selectedSeat.label} Reserved (Deposit Held)`,
      subtitle: `${selectedSpace.shortName || selectedSpace.name} • ${bookingDuration} Hr`,
      amount: -costInCredits,
      type: "negative",
      time: Date.now(),
    };
    setTransactions((prev) => [tx, ...prev]);

    // Save to Firestore for realtime sync across users
    try {
      if (user?.uid) {
        await createFirestoreReservation({
          userId: user.uid,
          locationId: selectedSpace.id,
          seatId: selectedSeat.id,
          startTimeMs: startTime,
          endTimeMs: endTime,
          status: "reserved",
          deposit: costInCredits,
          duration: bookingDuration,
        });
        await addCreditTransactionToDb(tx, user.uid);
      }
    } catch (e) {
      console.warn("Firestore reservation sync warning:", e);
    }

    setActiveBooking(newBooking);
    setCurrentScreen("booking-confirmed");
    showToast(`Seat ${selectedSeat.label} reserved! 50 Credits held.`);
  };

  // Check In Handler
  const handleCheckIn = async () => {
    if (!activeBooking) return;
    const updated = { ...activeBooking, status: "checked_in" };
    setActiveBooking(updated);

    try {
      if (user?.uid) {
        await updateReservationStatusInDb(activeBooking.id, "checked_in");
      }
    } catch (e) {}

    showToast("Check-in successful! Welcome to your StudySpot.");
  };

  // Release / Check Out / Cancel Handler (Instant 100% Refund)
  const handleReleaseOrCheckOut = async () => {
    if (!activeBooking) return;
    const refundAmount = activeBooking.cost;

    setCredits((prev) => prev + refundAmount);
    setLockedCredits((prev) => Math.max(0, prev - refundAmount));

    const refundTx = {
      id: `tx-ref-${Date.now()}`,
      title: `Deposit Refunded (Seat Released)`,
      subtitle: `${activeBooking.spaceName} • Seat ${activeBooking.seatLabel}`,
      amount: refundAmount,
      type: "positive",
      time: Date.now(),
    };
    setTransactions((prev) => [refundTx, ...prev]);

    try {
      if (user?.uid) {
        await updateReservationStatusInDb(activeBooking.id, "completed");
        await addCreditTransactionToDb(refundTx, user.uid);
      }
    } catch (e) {}

    setActiveBooking(null);
    setSelectedSeat(null);
    showToast(`Checked out! ${refundAmount} Credits refunded to wallet.`);
    setCurrentScreen("home");
  };

  // Quick Open Space Details
  const handleOpenSpaceDetails = (space) => {
    setSelectedSpace(space);
    setCurrentScreen("space-details");
  };

  // Quick Open Seat Map
  const handleOpenSeatMap = (space) => {
    if (space) setSelectedSpace(space);
    setCurrentScreen("seat-map");
  };

  // Quick Pick Seat on Map
  const handleSelectSeatOnMap = (seat) => {
    if (seat.status === "occupied" || seat.status === "maintenance") return;
    setSelectedSeat(seat);
  };

  return (
    <div className="app-container">
      {/* ---------------------------------------------------------
          GLOBAL TOAST NOTIFICATIONS
          --------------------------------------------------------- */}
      {toast && (
        <div className={`toast-banner ${toast.type}`}>
          {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------
          TOP NAVIGATION BAR (ACADEMIC INTELLIGENCE)
          --------------------------------------------------------- */}
      <header className="top-nav">
        <div className="nav-left">
          {user ? (
            <div className="user-badge-pill" onClick={() => setCurrentScreen("profile")}>
              <div className="user-avatar-circle">
                {user.displayName ? user.displayName.slice(0, 2).toUpperCase() : "RA"}
              </div>
              <span className="user-reg-no">{user.regNo || "RA211103010452"}</span>
              <span className="srm-crest-icon">🏛️</span>
            </div>
          ) : (
            <button className="user-badge-pill" onClick={() => setCurrentScreen("login")}>
              <User size={15} />
              <span>Sign In</span>
            </button>
          )}
        </div>

        <div className="nav-center-brand" onClick={() => setCurrentScreen("home")}>
          <div className="brand-crest">
            <Sparkles size={16} />
          </div>
          <div className="brand-text">
            StudySpot <span>SRM</span>
          </div>
        </div>

        <div className="nav-right">
          <div className="credits-pill" onClick={() => setCurrentScreen("profile")}>
            <span>🪙</span>
            <span>{credits}</span>
          </div>

          <button
            className="icon-btn"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            title="Toggle Light/Dark Theme"
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>

          <button
            className="icon-btn"
            onClick={() => {
              if (activeBooking) setCurrentScreen("bookings");
              else showToast("No new notifications.", "info");
            }}
          >
            <Bell size={17} />
            {activeBooking && <div className="notification-badge-dot" />}
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------
          MAIN SCREEN ROUTING
          --------------------------------------------------------- */}
      <main className="main-wrapper">
        {/* =========================================================
            1. DISCOVER VIEW (HOME)
            ========================================================= */}
        {currentScreen === "home" && (
          <div className="discover-header">
            <h1 className="discover-title">Discover</h1>

            {/* Search Bar */}
            <div className="search-bar-container">
              <Search className="search-bar-icon" size={18} />
              <input
                type="text"
                className="search-bar-input"
                placeholder="Search spaces, buildings, or facilities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filter Chips matching Stitch */}
            <div className="filter-chips-row">
              {["All Spaces", "Quiet Zone", "Collaborative", "Power Available", "Near Me"].map((chip) => (
                <button
                  key={chip}
                  className={`filter-chip ${activeFilter === chip ? "active" : ""}`}
                  onClick={() => setActiveFilter(chip)}
                >
                  {chip === "All Spaces" && <Layers size={14} />}
                  {chip === "Quiet Zone" && <VolumeX size={14} />}
                  {chip === "Collaborative" && <Sparkles size={14} />}
                  {chip === "Power Available" && <Zap size={14} />}
                  {chip === "Near Me" && <MapPin size={14} />}
                  {chip}
                </button>
              ))}
            </div>

            {/* Section Header */}
            <div className="section-title-row">
              <h2>Available Now</h2>
              <button className="view-map-link" onClick={() => handleOpenSeatMap(spaces[0])}>
                <span>View Map</span>
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Study Spaces Cards Grid */}
            <div className="cards-grid">
              {filteredSpaces.map((space) => {
                const isFull = space.availableSeats <= 5;
                const dotColor = space.availableSeats > 15 ? "green" : space.availableSeats > 5 ? "amber" : "red";

                return (
                  <div
                    key={space.id}
                    className="space-card"
                    onClick={() => handleOpenSpaceDetails(space)}
                  >
                    <div className="space-card-image-wrap">
                      <img src={space.image} alt={space.name} className="space-card-image" />
                      <div className="space-badge-seats">
                        <div className={`status-dot ${dotColor}`} />
                        <span>{space.availableSeats} Seats</span>
                      </div>
                      <div className="space-badge-distance">
                        <MapPin size={11} />
                        <span>{space.distanceStr || "0.2 mi"}</span>
                      </div>
                      <button
                        className="space-card-favorite-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          showToast(`Saved ${space.shortName || space.name} to favorites`);
                        }}
                      >
                        <Heart size={15} />
                      </button>
                    </div>

                    <div className="space-card-body">
                      <div className="space-card-title-row">
                        <h3 className="space-card-title">{space.name}</h3>
                        <div className="space-card-hours">
                          <Clock size={12} />
                          <span>{space.hours || "Open until 10:00 PM"}</span>
                        </div>
                      </div>

                      {/* Occupancy Progress Meter */}
                      <div className="space-occupancy-bar-wrap">
                        <div className="space-occupancy-header">
                          <span>Occupancy</span>
                          <span>{space.occupancyPercent || 75}%</span>
                        </div>
                        <div className="occupancy-track">
                          <div
                            className={`occupancy-fill ${dotColor}`}
                            style={{ width: `${space.occupancyPercent || 75}%` }}
                          />
                        </div>
                      </div>

                      {/* Feature Tags */}
                      <div className="space-tags-row">
                        {(space.tags || ["Quiet Zone", "Power"]).map((tag) => (
                          <span key={tag} className="tag-pill">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =========================================================
            2. SPACE DETAILS VIEW (MATCHING STITCH SCREEN)
            ========================================================= */}
        {currentScreen === "space-details" && selectedSpace && (
          <div className="space-details-view">
            <div className="details-top-bar">
              <button className="back-btn" onClick={() => setCurrentScreen("home")}>
                <ArrowLeft size={16} />
                <span>Space Details</span>
              </button>
              <button
                className="icon-btn"
                onClick={() => showToast("Space link copied to clipboard!")}
              >
                <Share2 size={16} />
              </button>
            </div>

            {/* Hero Image with Badge */}
            <div className="details-hero">
              <img src={selectedSpace.image} alt={selectedSpace.name} />
              <div className="details-occupancy-pill">
                <div className="status-dot amber" />
                <span>{selectedSpace.occupancyPercent || 85}% Full</span>
              </div>
            </div>

            <div>
              <div className="details-location-breadcrumb">
                📍 {selectedSpace.building.toUpperCase()}
              </div>
              <h1 className="details-heading">{selectedSpace.name}</h1>
              <p className="details-desc">{selectedSpace.description}</p>
            </div>

            {/* Stats Grid */}
            <div className="details-stats-grid">
              <div className="stat-box full-width">
                <div className="stat-label">Available Seats</div>
                <div className="stat-number-row">
                  <div className="stat-value">{selectedSpace.availableSeats}</div>
                  <div className="stat-total">/ {selectedSpace.totalSeats}</div>
                </div>
                <div className="occupancy-track">
                  <div
                    className="occupancy-fill amber"
                    style={{
                      width: `${(selectedSpace.availableSeats / selectedSpace.totalSeats) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Noise Level</div>
                <div className="stat-icon-row">
                  <Volume2 size={18} color="#002d62" />
                  <span>{selectedSpace.noiseLevel}</span>
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Hours</div>
                <div className="stat-icon-row">
                  <Clock size={18} color="#002d62" />
                  <span>{selectedSpace.hours || "8AM - 10PM"}</span>
                </div>
              </div>
            </div>

            {/* Amenities Section */}
            <div className="amenities-section">
              <h3>Amenities</h3>
              <div className="amenities-grid">
                <div className="amenity-card">
                  <Wifi size={16} />
                  <span>High-Speed Wi-Fi</span>
                </div>
                <div className="amenity-card">
                  <Wind size={16} />
                  <span>Air Conditioned</span>
                </div>
                <div className="amenity-card">
                  <Zap size={16} />
                  <span>Power Outlets</span>
                </div>
                <div className="amenity-card">
                  <VolumeX size={16} />
                  <span>Quiet Zone</span>
                </div>
              </div>
            </div>

            {/* Primary Action */}
            <button className="primary-cta-btn" onClick={() => setCurrentScreen("seat-map")}>
              <span>View Seat Map</span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* =========================================================
            3. INTERACTIVE SEAT MAP VIEW (MATCHING STITCH)
            ========================================================= */}
        {currentScreen === "seat-map" && (
          <div className="seat-map-view">
            <div className="details-top-bar">
              <button className="back-btn" onClick={() => setCurrentScreen("home")}>
                <ArrowLeft size={16} />
                <span>{selectedSpace.shortName || selectedSpace.name}</span>
              </button>
            </div>

            {/* Floor Selector Bar */}
            <div className="floor-selector-bar">
              {[
                { num: 0, label: "Ground Floor" },
                { num: 1, label: "Floor 1" },
                { num: 2, label: "Floor 2" },
                { num: 3, label: "Floor 3" },
              ].map((f) => (
                <div
                  key={f.num}
                  className={`floor-btn ${selectedFloor === f.num ? "active" : ""}`}
                  onClick={() => setSelectedFloor(f.num)}
                >
                  {f.label}
                </div>
              ))}
            </div>

            {/* Zone A Card (Silent Zone) */}
            <div className="seat-zone-card">
              <div className="seat-zone-header">
                <div className="seat-zone-title">
                  <span>Silent Zone A</span>
                </div>
                <div className="seat-zone-badge">
                  <VolumeX size={13} />
                  <span>Strict Silence</span>
                </div>
              </div>

              {/* 4-column seat matrix */}
              <div className="seat-matrix-grid">
                {currentSeatMap
                  .filter((s) => s.kind === "carrel")
                  .map((seat) => {
                    const isSelected = selectedSeat?.id === seat.id;
                    const statusClass = isSelected ? "selected" : seat.status;

                    return (
                      <div
                        key={seat.id}
                        className={`seat-item ${statusClass}`}
                        onClick={() => handleSelectSeatOnMap(seat)}
                      >
                        <span>{seat.label}</span>
                        {seat.hasPower && <Zap className="seat-power-icon" size={10} />}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Zone B Card (Collaborative Hub Round Tables) */}
            <div className="seat-zone-card">
              <div className="seat-zone-header">
                <div className="seat-zone-title">
                  <span>Collaborative Hub</span>
                </div>
                <div className="seat-zone-badge">
                  <Sparkles size={13} />
                  <span>Discussion Allowed</span>
                </div>
              </div>

              <div className="collab-tables-container">
                {/* Table A */}
                <div className="round-table-group">
                  <div className="round-table-center">Table A</div>
                  {currentSeatMap
                    .filter((s) => s.table === "A")
                    .map((s, idx) => {
                      const pos = idx === 0 ? "top" : "bottom";
                      const isSel = selectedSeat?.id === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`round-seat ${pos} ${isSel ? "selected" : s.status}`}
                          onClick={() => handleSelectSeatOnMap(s)}
                        >
                          {s.label}
                        </div>
                      );
                    })}
                </div>

                {/* Table B */}
                <div className="round-table-group">
                  <div className="round-table-center">Table B</div>
                  {currentSeatMap
                    .filter((s) => s.table === "B")
                    .map((s, idx) => {
                      const pos = idx === 0 ? "left" : "right";
                      const isSel = selectedSeat?.id === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`round-seat ${pos} ${isSel ? "selected" : s.status}`}
                          onClick={() => handleSelectSeatOnMap(s)}
                        >
                          {s.label}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Legend Bar */}
            <div className="map-legend-bar">
              <div className="legend-item">
                <div className="legend-box avail" />
                <span>Available</span>
              </div>
              <div className="legend-item">
                <div className="legend-box occ" />
                <span>Occupied</span>
              </div>
              <div className="legend-item">
                <div className="legend-box sel" />
                <span>Selected</span>
              </div>
              <div className="legend-item">
                <div className="legend-box maint" />
                <span>Maint.</span>
              </div>
            </div>

            {/* Bottom Action if seat selected */}
            {selectedSeat ? (
              <button
                className="primary-cta-btn"
                onClick={() => setCurrentScreen("seat-booking")}
              >
                <span>Reserve Seat {selectedSeat.label}</span>
                <ArrowRight size={18} />
              </button>
            ) : (
              <div style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginTop: "12px" }}>
                Select an available white seat above to proceed
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            4. SEAT RESERVATION & DURATION PICKER VIEW
            ========================================================= */}
        {currentScreen === "seat-booking" && (
          <div className="reservation-view">
            <div className="details-top-bar">
              <button className="back-btn" onClick={() => setCurrentScreen("seat-map")}>
                <ArrowLeft size={16} />
                <span>Seat Reservation</span>
              </button>
              <button className="icon-btn" onClick={() => setCurrentScreen("home")}>
                <X size={16} />
              </button>
            </div>

            <div className="reservation-card">
              {/* Selected Seat Hero */}
              <div className="selected-seat-hero">
                <img
                  src="https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1000&q=80"
                  alt="Seat View"
                />
                <div className="selected-seat-badges">
                  <div className="seat-hero-badge">
                    <Sun size={12} />
                    <span>Window Side</span>
                  </div>
                  <div className="seat-hero-badge">
                    <VolumeX size={12} />
                    <span>Quiet Zone</span>
                  </div>
                </div>
              </div>

              {/* Title Block */}
              <div className="seat-title-block">
                <h2>
                  Seat {selectedSeat ? selectedSeat.label : "B4"} — {selectedSpace.shortName || selectedSpace.name}
                </h2>
                <p>{selectedSpace.building}, 1st Floor North Wing</p>
              </div>

              {/* Feature Tags */}
              <div className="seat-features-row">
                <div className="seat-feature-box">
                  <Zap size={16} color="#002d62" />
                  <span>Power Available</span>
                </div>
                <div className="seat-feature-box">
                  <Wifi size={16} color="#002d62" />
                  <span>WiFi High Speed</span>
                </div>
              </div>

              {/* Duration 3-button Picker */}
              <div>
                <span className="stat-label" style={{ display: "block", marginBottom: "8px" }}>
                  Select Duration
                </span>
                <div className="duration-selector-group">
                  {[
                    { hours: 1, credits: 1, label: "1 Hour", pts: "25 PTS" },
                    { hours: 2, credits: 2, label: "2 Hours", pts: "50 PTS" },
                    { hours: 4, credits: 4, label: "4 Hours", pts: "100 PTS" },
                  ].map((dur) => (
                    <button
                      key={dur.hours}
                      className={`duration-option-btn ${bookingDuration === dur.hours ? "active" : ""}`}
                      onClick={() => setBookingDuration(dur.hours)}
                    >
                      <strong>{dur.label}</strong>
                      <span>{dur.credits} CREDIT ({dur.pts})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Check-in Warning Notice (Amber) */}
              <div className="notice-box-amber">
                <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Check-in Required</strong>
                  <p>
                    You must check in via the app within 15 minutes of your start time, or your reservation will be automatically cancelled and credits returned.
                  </p>
                </div>
              </div>

              {/* Balance preview */}
              <div className="credit-calc-row">
                <span>Credits Balance After</span>
                <strong>{Math.max(0, credits - bookingDuration * 25)} Credits</strong>
              </div>

              {/* Confirm CTA */}
              <button className="primary-cta-btn" onClick={handleConfirmReservation}>
                <span>Confirm Reservation</span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            5. BOOKING CONFIRMATION & DIGITAL QR PASS (STITCH)
            ========================================================= */}
        {currentScreen === "booking-confirmed" && activeBooking && (
          <div className="confirmation-container">
            <div className="success-badge-circle">
              <Check size={32} />
            </div>

            <div>
              <h1 className="conf-title">Booking Confirmed!</h1>
              <p className="conf-subtitle">
                Your reservation at StudySpot SRM has been secured.
              </p>
            </div>

            {/* Digital Pass Card */}
            <div className="digital-pass-card">
              {/* Real QR Code graphic */}
              <div className="qr-code-frame">
                <svg
                  width="180"
                  height="180"
                  viewBox="0 0 200 200"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect width="200" height="200" rx="12" fill="white" />
                  {/* Outer position markers */}
                  <rect x="20" y="20" width="50" height="50" rx="6" fill="#002D62" />
                  <rect x="30" y="30" width="30" height="30" rx="3" fill="white" />
                  <rect x="38" y="38" width="14" height="14" rx="2" fill="#002D62" />

                  <rect x="130" y="20" width="50" height="50" rx="6" fill="#002D62" />
                  <rect x="140" y="30" width="30" height="30" rx="3" fill="white" />
                  <rect x="148" y="38" width="14" height="14" rx="2" fill="#002D62" />

                  <rect x="20" y="130" width="50" height="50" rx="6" fill="#002D62" />
                  <rect x="30" y="140" width="30" height="30" rx="3" fill="white" />
                  <rect x="38" y="148" width="14" height="14" rx="2" fill="#002D62" />

                  {/* QR Pattern Bits */}
                  <rect x="80" y="20" width="12" height="12" fill="#002D62" />
                  <rect x="100" y="20" width="12" height="12" fill="#002D62" />
                  <rect x="80" y="40" width="24" height="12" fill="#002D62" />
                  <rect x="90" y="60" width="20" height="12" fill="#002D62" />
                  <rect x="30" y="85" width="140" height="10" fill="#002D62" />
                  <rect x="40" y="105" width="25" height="12" fill="#002D62" />
                  <rect x="75" y="105" width="30" height="12" fill="#002D62" />
                  <rect x="120" y="105" width="40" height="12" fill="#002D62" />
                  <rect x="80" y="130" width="30" height="12" fill="#002D62" />
                  <rect x="130" y="130" width="50" height="12" fill="#002D62" />
                  <rect x="90" y="155" width="40" height="12" fill="#002D62" />
                  <rect x="145" y="155" width="35" height="12" fill="#002D62" />
                  <rect x="90" y="175" width="90" height="10" fill="#002D62" />
                </svg>
              </div>

              {/* Pass Details Grid */}
              <div className="pass-info-grid">
                <div className="pass-info-item">
                  <span>SPACE</span>
                  <strong>Seat L1-{activeBooking.seatLabel || "024"}</strong>
                </div>
                <div className="pass-info-item">
                  <span>LOCATION</span>
                  <strong>{activeBooking.spaceName}</strong>
                </div>
                <div className="pass-info-item">
                  <span>DURATION</span>
                  <strong>
                    {activeBooking.formattedStart} - {activeBooking.formattedEnd}
                  </strong>
                </div>
                <div className="pass-info-item">
                  <span>DEPOSIT HELD</span>
                  <strong>{activeBooking.cost} Credits (Refundable)</strong>
                </div>
              </div>

              {/* Check-in deadline badge */}
              <div className="checkin-deadline-pill">
                <Clock size={14} />
                <span>Check-in before {formatTime(activeBooking.checkInDeadlineMs)}</span>
              </div>

              {/* Pass Actions */}
              <div className="pass-actions-column">
                {activeBooking.status === "reserved" ? (
                  <button className="primary-cta-btn" onClick={handleCheckIn}>
                    <Check size={18} />
                    <span>Check In Now</span>
                  </button>
                ) : (
                  <div
                    style={{
                      background: "var(--status-available-bg)",
                      color: "var(--status-available-text)",
                      padding: "12px",
                      borderRadius: "10px",
                      fontWeight: 700,
                      fontSize: "14px",
                    }}
                  >
                    ✓ Checked In & Study Session Active
                  </div>
                )}

                <button className="secondary-btn" onClick={() => showToast("Opening campus walking map...")}>
                  <Compass size={16} />
                  <span>Get Walking Directions</span>
                </button>

                <button className="danger-outline-btn" onClick={handleReleaseOrCheckOut}>
                  {activeBooking.status === "checked_in" ? "End Session & Refund Deposit" : "Cancel & Refund Deposit"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            6. MY BOOKINGS VIEW
            ========================================================= */}
        {currentScreen === "bookings" && (
          <div className="bookings-view">
            <h1 className="discover-title">My Bookings</h1>

            {activeBooking ? (
              <div className="space-card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="details-location-breadcrumb">ACTIVE RESERVATION</div>
                  <div className="status-dot green" />
                </div>

                <div className="space-card-title-row">
                  <h3 className="space-card-title">{activeBooking.spaceName}</h3>
                  <strong style={{ color: "var(--primary-seed)", fontSize: "16px" }}>
                    Seat {activeBooking.seatLabel}
                  </strong>
                </div>

                <p style={{ fontSize: "13.5px", color: "var(--text-muted)" }}>
                  {activeBooking.building} • {activeBooking.formattedStart} - {activeBooking.formattedEnd}
                </p>

                <div className="pass-info-grid">
                  <div className="pass-info-item">
                    <span>STATUS</span>
                    <strong style={{ color: activeBooking.status === "checked_in" ? "#10b981" : "#f59e0b" }}>
                      {activeBooking.status === "checked_in" ? "Checked In" : "Reserved (Pending Check-in)"}
                    </strong>
                  </div>
                  <div className="pass-info-item">
                    <span>LOCKED DEPOSIT</span>
                    <strong>{activeBooking.cost} Credits</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                  {activeBooking.status === "reserved" ? (
                    <button className="primary-cta-btn" style={{ margin: 0 }} onClick={handleCheckIn}>
                      Check In
                    </button>
                  ) : (
                    <button className="primary-cta-btn" style={{ margin: 0 }} onClick={handleReleaseOrCheckOut}>
                      Check Out & Refund
                    </button>
                  )}
                  <button className="secondary-btn" onClick={() => setCurrentScreen("booking-confirmed")}>
                    <QrCode size={16} />
                    <span>View QR Pass</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "16px",
                  padding: "36px 20px",
                  textAlign: "center",
                }}
              >
                <BookOpen size={36} color="var(--neutral-400)" style={{ margin: "0 auto 12px" }} />
                <h3 style={{ fontSize: "17px", fontWeight: 700, marginBottom: "6px" }}>No Active Bookings</h3>
                <p style={{ fontSize: "13.5px", color: "var(--text-muted)", marginBottom: "18px" }}>
                  Find and reserve an available study carrel in any SRM campus library.
                </p>
                <button className="primary-cta-btn" onClick={() => setCurrentScreen("home")}>
                  <span>Explore Study Spaces</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            7. PROFILE & CREDITS WALLET VIEW (STITCH)
            ========================================================= */}
        {currentScreen === "profile" && (
          <div className="profile-view">
            <h1 className="discover-title">Profile & Credits</h1>

            {/* Student ID Card */}
            <div className="student-id-card">
              <div className="student-large-avatar">
                {user?.displayName ? user.displayName.slice(0, 2).toUpperCase() : "RA"}
              </div>
              <div className="student-info-col">
                <h2>{user?.displayName || "Thilak Govind"}</h2>
                <span>{user?.regNo || "RA211103010452"} • SRMIST KTR</span>
                <span>{user?.department || "B.Tech Computer Science & Engineering"}</span>
              </div>
            </div>

            {/* Academic Intelligence Wallet Card */}
            <div className="academic-wallet-card">
              <div className="wallet-badge-top">
                <span>STUDYSPOT WALLET</span>
                <span style={{ color: "var(--secondary)" }}>SRM GOOD STANDING</span>
              </div>

              <div className="wallet-amounts-row">
                <div className="wallet-primary-amount">
                  <strong>{credits}</strong>
                  <span>AVAILABLE CREDITS</span>
                </div>
                <div className="wallet-locked-amount">
                  <strong>{lockedCredits}</strong>
                  <span>LOCKED CREDITS</span>
                </div>
              </div>

              <div style={{ fontSize: "12px", opacity: 0.85 }}>
                Credits are 100% refundable upon timely check-in and checkout.
              </div>
            </div>

            {/* 3-Step Explainer */}
            <div className="steps-explainer-card">
              <h3>How Credits Work</h3>
              <div className="explainer-steps-grid">
                <div className="explainer-step-item">
                  <div className="step-num-badge">01</div>
                  <div className="step-content">
                    <strong>Book in Advance</strong>
                    <p>25 credits are held as a temporary deposit per hour.</p>
                  </div>
                </div>
                <div className="explainer-step-item">
                  <div className="step-num-badge">02</div>
                  <div className="step-content">
                    <strong>Check In on Time</strong>
                    <p>Arrive within 15 minutes of start time and scan your QR pass.</p>
                  </div>
                </div>
                <div className="explainer-step-item">
                  <div className="step-num-badge">03</div>
                  <div className="step-content">
                    <strong>100% Deposit Return</strong>
                    <p>When you check out, locked credits instantly return to your wallet.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Transaction Ledger */}
            <div className="steps-explainer-card">
              <h3>Recent Transactions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "13.5px", display: "block" }}>{tx.title}</strong>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{tx.subtitle}</span>
                    </div>
                    <strong
                      style={{
                        fontSize: "14px",
                        color: tx.type === "positive" ? "#10b981" : "var(--text-primary)",
                      }}
                    >
                      {tx.type === "positive" ? `+${tx.amount}` : tx.amount}
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Sign Out Action */}
            {user ? (
              <button className="danger-outline-btn" onClick={handleSignOut} style={{ padding: "12px" }}>
                <LogOut size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                <span>Sign Out from SRM Account</span>
              </button>
            ) : (
              <button className="primary-cta-btn" onClick={() => setCurrentScreen("login")}>
                <span>Sign In with Google</span>
              </button>
            )}
          </div>
        )}

        {/* =========================================================
            8. WELCOME / LOGIN VIEW (STITCH)
            ========================================================= */}
        {currentScreen === "login" && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-color)",
              borderRadius: "24px",
              padding: "36px 24px",
              textAlign: "center",
              boxShadow: "var(--shadow-xl)",
              marginTop: "20px",
            }}
          >
            {/* SRM Logo Emblem */}
            <div
              style={{
                width: 64,
                height: 64,
                margin: "0 auto 16px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, #002d62, #0b3d7b)",
                color: "#ffb81c",
                display: "grid",
                placeItems: "center",
                fontSize: "26px",
                boxShadow: "0 8px 20px rgba(0, 45, 98, 0.3)",
              }}
            >
              🏛️
            </div>

            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              StudySpot SRM
            </div>

            <h1 style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>Welcome back</h1>

            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                lineHeight: "1.6",
                maxWidth: "340px",
                margin: "0 auto 24px",
              }}
            >
              Sign in with your Google account to sync your StudySpot reservations, credits and campus preferences.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                className="primary-cta-btn"
                style={{ background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1" }}
                onClick={handleGoogleLogin}
              >
                <span style={{ fontSize: "16px" }}>🌐</span>
                <span>Continue with Google</span>
              </button>

              <button className="primary-cta-btn" onClick={handleDemoStudentLogin}>
                <span>Continue as SRM Student (RA211103010452)</span>
              </button>
            </div>

            <div
              style={{
                marginTop: "24px",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              Prototype for SRMIST Kattankulathur (KTR).
            </div>
          </div>
        )}
      </main>

      {/* ---------------------------------------------------------
          FLOATING BOTTOM NAVIGATION DOCK (STITCH)
          --------------------------------------------------------- */}
      <nav className="bottom-nav-dock">
        <button
          className={`nav-dock-item ${currentScreen === "home" ? "active" : ""}`}
          onClick={() => setCurrentScreen("home")}
        >
          <Home size={18} />
          <span>Home</span>
        </button>

        <button
          className={`nav-dock-item ${
            currentScreen === "space-details" || currentScreen === "seat-map" || currentScreen === "seat-booking"
              ? "active"
              : ""
          }`}
          onClick={() => handleOpenSeatMap(selectedSpace || spaces[0])}
        >
          <Compass size={18} />
          <span>Explore</span>
        </button>

        <button
          className={`nav-dock-item ${
            currentScreen === "bookings" || currentScreen === "booking-confirmed" ? "active" : ""
          }`}
          onClick={() => setCurrentScreen(activeBooking ? "booking-confirmed" : "bookings")}
        >
          <BookOpen size={18} />
          <span>Bookings</span>
          {activeBooking && <div className="nav-dock-active-badge" />}
        </button>

        <button
          className={`nav-dock-item ${currentScreen === "profile" ? "active" : ""}`}
          onClick={() => setCurrentScreen("profile")}
        >
          <User size={18} />
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}