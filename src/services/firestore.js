import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";

import app, { db } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";

/* =========================================================
   FIRESTORE COLLECTION CONSTANTS
   ========================================================= */

export const COLLECTIONS = {
  USERS: "users",
  STUDY_SPACES: "studySpaces",
  RESERVATIONS: "reservations",
  CREDIT_TRANSACTIONS: "creditTransactions",
  OCCUPANCY: "occupancy",
};

/* =========================================================
   1. USER PROFILE SERVICES
   ========================================================= */

export const getUserProfile = async (userId) => {
  if (!userId) return null;

  const userRef = doc(
    db,
    COLLECTIONS.USERS,
    userId,
  );

  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
};

/* =========================================================
   2. STUDY SPACE SERVICES
   ========================================================= */

export const getStudySpacesFromDb = async () => {
  const spacesRef = collection(
    db,
    COLLECTIONS.STUDY_SPACES,
  );

  const snapshot = await getDocs(spacesRef);

  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
};

/*
 * REAL-TIME STUDY SPACE LISTENER
 */
export const subscribeToStudySpaces = (callback) => {
  const spacesRef = collection(
    db,
    COLLECTIONS.STUDY_SPACES,
  );

  return onSnapshot(
    spacesRef,
    (snapshot) => {
      const spaces = snapshot.docs.map(
        (docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }),
      );

      callback(spaces);
    },
    (error) => {
      console.error(
        "Real-time study space listener error:",
        error,
      );
    },
  );
};

export const seedStudySpacesIfEmpty = async (spaces) => {
  try {
    const existing = await getStudySpacesFromDb();

    if (existing && existing.length > 0) {
      return existing;
    }

    const promises = spaces.map(
      async (space) => {
        const spaceDocRef = doc(
          db,
          COLLECTIONS.STUDY_SPACES,
          space.id,
        );

        const spaceData = {
          name: space.name,
          description: space.description,
          building: space.building,
          capacity: space.totalSeats,
          seats: space.totalSeats,
          chargingAvailable: space.chargingSeats,
          environment: space.noiseLevel,
          studyType:
            space.studyType || "Individual",
          defaultWalkingTime:
            space.defaultWalkingTime,
          defaultDistance:
            space.defaultDistance,
          typicalOccupancy:
            space.usualModifier || 1.0,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        await setDoc(
          spaceDocRef,
          spaceData,
        );

        return {
          id: space.id,
          ...spaceData,
        };
      },
    );

    return await Promise.all(promises);
  } catch (error) {
    console.warn(
      "Firestore seed study spaces error:",
      error,
    );

    return spaces;
  }
};

/* =========================================================
   3. RESERVATION SERVICES
   ========================================================= */

/*
 * REAL-TIME RESERVATION LISTENER
 *
 * User 1 books A6
 *       ↓
 * Firestore changes
 *       ↓
 * onSnapshot fires
 *       ↓
 * User 2 receives the change
 *       ↓
 * A6 becomes unavailable
 */
export const subscribeToAllReservations = (callback) => {
  console.log("DIAGNOSTIC: 1. subscribeToAllReservations() started in firestore.js");
  const reservationsRef = collection(
    db,
    COLLECTIONS.RESERVATIONS,
  );

  return onSnapshot(
    reservationsRef,
    (snapshot) => {
      console.log(`DIAGNOSTIC: 2. onSnapshot fired. Total docs in snapshot: ${snapshot.docs.length}`);
      const reservations =
        snapshot.docs.map(
          (docSnap) => {
            const data = docSnap.data();
            console.log(`DIAGNOSTIC: 4. Reservation parsed from snapshot: ID=${docSnap.id}, seatId=${data.seatId}, status=${data.status}`);
            return {
              id: docSnap.id,
              ...data,
            };
          }
        );

      console.log(`DIAGNOSTIC: 3. Number of reservations received from snapshot: ${reservations.length}`);
      callback(reservations);
    },
    (error) => {
      console.error(
        "Real-time reservation listener error:",
        error,
      );
    },
  );
};

/*
 * ATOMIC RESERVATION CREATION
 *
 * Prevents two users from booking the
 * same seat for overlapping times.
 */
export const createFirestoreReservation = async (
  reservationData,
) => {
  const reservationsRef = collection(
    db,
    COLLECTIONS.RESERVATIONS,
  );

  const locationId =
    reservationData?.locationId;

  const seatId =
    reservationData?.seatId;

  const requestedStartMs = Number(
    reservationData?.startTimeMs ?? 0,
  );

  const requestedEndMs = Number(
    reservationData?.endTimeMs ?? 0,
  );

  if (
    !locationId ||
    !seatId ||
    !requestedStartMs ||
    !requestedEndMs ||
    requestedEndMs <= requestedStartMs
  ) {
    const error = new Error(
      "Invalid reservation data: location, seat, and valid start/end times are required.",
    );

    error.code =
      "invalid-reservation-data";

    throw error;
  }

  const seatNumber =
    reservationData?.seat?.number;

  const requestedStart =
    requestedStartMs;

  const requestedEnd =
    requestedEndMs;

  const reservationRef =
    doc(reservationsRef);

  /*
   * Firestore transaction:
   *
   * 1. Read all reservations for location
   * 2. Check seat/time overlap
   * 3. Write reservation only if no conflict
   */
  await runTransaction(
    db,
    async (transaction) => {
      const locationQuery = query(
        reservationsRef,
        where(
          "locationId",
          "==",
          locationId,
        ),
      );

      const snapshot =
        await getDocs(
          locationQuery,
        );

      const nowMs = Date.now();

      const hasConflict =
        snapshot.docs.some(
          (docSnap) => {
            const existing =
              docSnap.data() || {};

            const existingSeatId =
              existing.seatId ||
              existing.seat?.id;

            const existingSeatNumber =
              existing.seat?.number ||
              existing.seatNumber;

            const seatMatches =
              (existingSeatId &&
                existingSeatId ===
                seatId) ||
              (existingSeatNumber &&
                seatNumber &&
                existingSeatNumber ===
                seatNumber);

            if (!seatMatches) {
              return false;
            }

            /*
             * Only these statuses block a seat.
             */
            if (
              existing.status !==
              "reserved" &&
              existing.status !==
              "checked_in"
            ) {
              return false;
            }

            const existingStartMs =
              Number(
                existing.startTimeMs ??
                0,
              );

            const existingEndMs =
              Number(
                existing.endTimeMs ??
                0,
              );

            /*
             * Expired reservation
             * no longer blocks seat.
             */
            if (
              existingEndMs > 0 &&
              existingEndMs <= nowMs
            ) {
              return false;
            }

            /*
             * Malformed active reservation
             * is treated conservatively
             * as blocking the seat.
             */
            if (
              !existingStartMs ||
              !existingEndMs
            ) {
              return true;
            }

            /*
             * Overlap formula:
             *
             * requestedStart < existingEnd
             * AND
             * requestedEnd > existingStart
             */
            return (
              requestedStart <
              existingEndMs &&
              requestedEnd >
              existingStartMs
            );
          },
        );

      if (hasConflict) {
        const error = new Error(
          "This seat is already booked for part of the selected time.",
        );

        error.code =
          "seat-time-conflict";

        throw error;
      }

      const docData = {
        ...reservationData,
        id: reservationRef.id,
        createdAt:
          serverTimestamp(),
        updatedAt:
          serverTimestamp(),
      };

      transaction.set(
        reservationRef,
        docData,
      );
    },
  );

  return {
    ...reservationData,
    id: reservationRef.id,
  };
};

/* =========================================================
   USER RESERVATIONS
   ========================================================= */

export const getUserReservationsFromDb =
  async (userId) => {
    if (!userId) return [];

    const reservationsRef =
      collection(
        db,
        COLLECTIONS.RESERVATIONS,
      );

    const q = query(
      reservationsRef,
      where(
        "userId",
        "==",
        userId,
      ),
    );

    const snapshot =
      await getDocs(q);

    const items =
      snapshot.docs.map(
        (docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }),
      );

    /*
     * Sort client-side to avoid
     * requiring composite indexes.
     */
    return items.sort(
      (a, b) => {
        const aTime =
          a.createdAt?.toMillis
            ? a.createdAt.toMillis()
            : Number(
              a.bookedAt ||
              a.createdAt ||
              0,
            );

        const bTime =
          b.createdAt?.toMillis
            ? b.createdAt.toMillis()
            : Number(
              b.bookedAt ||
              b.createdAt ||
              0,
            );

        return bTime - aTime;
      },
    );
  };

/* =========================================================
   UPDATE RESERVATION STATUS
   ========================================================= */

export const updateReservationStatusInDb =
  async (
    reservationId,
    status,
  ) => {
    if (!reservationId) {
      throw new Error(
        "Reservation ID is required.",
      );
    }

    if (!status) {
      throw new Error(
        "Reservation status is required.",
      );
    }

    const reservationRef =
      doc(
        db,
        COLLECTIONS.RESERVATIONS,
        reservationId,
      );

    await updateDoc(
      reservationRef,
      {
        status,
        updatedAt:
          serverTimestamp(),
      },
    );

    return {
      id: reservationId,
      status,
    };
  };

/* =========================================================
   4. CREDIT TRANSACTION SERVICES
   ========================================================= */

export const getUserTransactionsFromDb =
  async (userId) => {
    if (!userId) return [];

    const txRef = collection(
      db,
      COLLECTIONS.CREDIT_TRANSACTIONS,
    );

    const q = query(
      txRef,
      where(
        "userId",
        "==",
        userId,
      ),
    );

    const snapshot =
      await getDocs(q);

    const items =
      snapshot.docs.map(
        (docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }),
      );

    return items.sort(
      (a, b) => {
        const aTime =
          a.createdAt?.toMillis
            ? a.createdAt.toMillis()
            : Number(
              a.timestamp ||
              a.createdAt ||
              0,
            );

        const bTime =
          b.createdAt?.toMillis
            ? b.createdAt.toMillis()
            : Number(
              b.timestamp ||
              b.createdAt ||
              0,
            );

        return bTime - aTime;
      },
    );
  };

/* =========================================================
   5. OCCUPANCY SERVICES
   ========================================================= */

export const getOccupancyFromDb =
  async (spaceId) => {
    if (!spaceId) return null;

    const occRef = doc(
      db,
      COLLECTIONS.OCCUPANCY,
      spaceId,
    );

    const snapshot =
      await getDoc(occRef);

    if (!snapshot.exists()) {
      return null;
    }

    return {
      id: snapshot.id,
      ...snapshot.data(),
    };
  };

export const updateOccupancyInDb =
  async (
    spaceId,
    currentCount,
    typicalCount,
  ) => {
    if (!spaceId) return;

    const occRef = doc(
      db,
      COLLECTIONS.OCCUPANCY,
      spaceId,
    );

    await setDoc(
      occRef,
      {
        currentCount,
        typicalCount,
        updatedAt:
          serverTimestamp(),
      },
      {
        merge: true,
      },
    );
  };

/* =========================================================
   6. USER REAL-TIME PROFILE
   ========================================================= */

export const subscribeToUserProfile = (
  userId,
  callback,
) => {
  if (!userId) {
    return () => { };
  }

  const userRef = doc(
    db,
    COLLECTIONS.USERS,
    userId,
  );

  return onSnapshot(
    userRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback({
          id: snapshot.id,
          ...snapshot.data(),
        });
      }
    },
  );
};

/* =========================================================
   7. FIREBASE CLOUD FUNCTIONS
   ========================================================= */

const functions =
  getFunctions(app);

/*
 * Atomic booking through Cloud Function
 */
export const runAtomicBooking =
  async (
    userId,
    reservationData,
  ) => {
    const bookReservation =
      httpsCallable(
        functions,
        "bookReservation",
      );

    const result =
      await bookReservation(
        reservationData,
      );

    return result.data;
  };

/*
 * Atomic cancellation
 */
export const runAtomicCancellation =
  async (
    userId,
    reservationId,
  ) => {
    const cancelReservation =
      httpsCallable(
        functions,
        "cancelReservation",
      );

    const result =
      await cancelReservation({
        reservationId,
      });

    return result.data;
  };

/*
 * Atomic checkout
 */
export const runAtomicCheckout =
  async (
    userId,
    reservationId,
  ) => {
    const checkoutReservation =
      httpsCallable(
        functions,
        "checkoutReservation",
      );

    const result =
      await checkoutReservation({
        reservationId,
      });

    return result.data;
  };

/*
 * Atomic no-show processing
 */
export const runAtomicNoShow =
  async (
    userId,
    reservationId,
  ) => {
    const processNoShow =
      httpsCallable(
        functions,
        "processNoShow",
      );

    const result =
      await processNoShow({
        reservationId,
      });

    return result.data;
  };

/* =========================================================
   8. USER LOCATION
   ========================================================= */

export const runAtomicUpdateLocation =
  async (
    userId,
    location,
  ) => {
    if (!userId) {
      throw new Error(
        "User ID is required to update location.",
      );
    }

    const userRef = doc(
      db,
      COLLECTIONS.USERS,
      userId,
    );

    await updateDoc(
      userRef,
      {
        currentLocation: location,
        updatedAt:
          serverTimestamp(),
      },
    );

    return {
      success: true,
      userId,
      location,
    };
  };

/* =========================================================
   9. APP.JSX COMPATIBILITY EXPORTS
   ========================================================= */

export const syncUserProfile =
  async (user) => {
    if (!user || !user.uid) {
      return null;
    }

    return await getUserProfile(
      user.uid,
    );
  };

export const updateUserCredits =
  async (
    userId,
    credits,
    lockedCredits,
  ) => {
    if (!userId) return;

    const userRef = doc(
      db,
      COLLECTIONS.USERS,
      userId,
    );

    await setDoc(
      userRef,
      {
        credits,
        lockedCredits,
        updatedAt:
          serverTimestamp(),
      },
      { merge: true }
    );
  };

export const updateUserLocation =
  runAtomicUpdateLocation;

export const addCreditTransactionToDb =
  async (
    tx,
    userId,
  ) => {
    if (!userId || !tx) {
      return;
    }

    const txRef = doc(
      collection(
        db,
        COLLECTIONS.CREDIT_TRANSACTIONS,
      ),
    );

    await setDoc(
      txRef,
      {
        ...tx,
        userId,
        createdAt:
          serverTimestamp(),
      },
    );

    return {
      id: txRef.id,
      ...tx,
    };
  };