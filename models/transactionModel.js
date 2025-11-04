import { db } from "./firebase.js";
import { collection, addDoc, doc, getDoc, updateDoc, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";

/**
 * Transaction Model for Charging Station
 * Handles all charging session transactions
 */

export class TransactionModel {
  
  /**
   * Create a new charging transaction
   * @param {Object} transactionData - The transaction details
   * @returns {Promise<string>} - Transaction ID
   */
  static async createTransaction(transactionData) {
    try {
      const {
        rfid,
        studentName,
        email,
        pointsToSpend,
        socketType,
        socketNumber,
        startTime,
        expectedEndTime,
        status = "in-progress"
      } = transactionData;

      // Get current student data for remaining points
      const studentRef = doc(db, "students", rfid);
      const studentDoc = await getDoc(studentRef);
      
      if (!studentDoc.exists()) {
        throw new Error("Student not found");
      }

      const studentData = studentDoc.data();
      const currentPoints = studentData.points || 0;

      if (currentPoints < pointsToSpend) {
        throw new Error("Insufficient points");
      }

      // Calculate remaining points after this transaction
      const remainingPoints = currentPoints - pointsToSpend;

      // Create transaction record
      const transaction = {
        rfid,
        studentName,
        email,
        pointsUsed: pointsToSpend,
        socketType, // "Universal Charger" or "Own Charger"
        socketNumber, // 1 or 2
        startTime: startTime || Timestamp.now(),
        expectedEndTime: expectedEndTime || null,
        actualEndTime: null,
        status, // "in-progress", "completed", "cancelled"
        remainingPoints,
        duration: null, // Will be calculated on completion
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      // Add transaction to Firestore
      const transactionRef = await addDoc(collection(db, "transactions"), transaction);

      // Update student's points and last used
      await updateDoc(studentRef, {
        points: remainingPoints,
        lastUsed: Timestamp.now()
      });

      return transactionRef.id;
    } catch (error) {
      console.error("Error creating transaction:", error);
      throw error;
    }
  }

  /**
   * Complete a charging transaction
   * @param {string} transactionId - The transaction ID
   * @param {string} status - "completed" or "cancelled"
   * @returns {Promise<Object>} - Updated transaction data
   */
  static async completeTransaction(transactionId, status = "completed") {
    try {
      const transactionRef = doc(db, "transactions", transactionId);
      const transactionDoc = await getDoc(transactionRef);

      if (!transactionDoc.exists()) {
        throw new Error("Transaction not found");
      }

      const transactionData = transactionDoc.data();
      const actualEndTime = Timestamp.now();

      // Calculate actual duration in seconds
      const startTimeSeconds = transactionData.startTime.seconds;
      const endTimeSeconds = actualEndTime.seconds;
      const durationSeconds = endTimeSeconds - startTimeSeconds;

      // Update transaction
      const updates = {
        status,
        actualEndTime,
        duration: durationSeconds,
        updatedAt: Timestamp.now()
      };

      // If cancelled, refund the unused points
      if (status === "cancelled" && transactionData.status === "in-progress") {
        const expectedDuration = transactionData.pointsUsed * 120; // 120 seconds per point
        const usedDuration = Math.min(durationSeconds, expectedDuration);
        const usedPoints = Math.ceil(usedDuration / 120);
        const refundPoints = transactionData.pointsUsed - usedPoints;

        if (refundPoints > 0) {
          // Update student's points
          const studentRef = doc(db, "students", transactionData.rfid);
          const studentDoc = await getDoc(studentRef);
          
          if (studentDoc.exists()) {
            const currentPoints = studentDoc.data().points || 0;
            await updateDoc(studentRef, {
              points: currentPoints + refundPoints
            });

            updates.pointsRefunded = refundPoints;
            updates.actualPointsUsed = usedPoints;
            updates.remainingPoints = currentPoints + refundPoints;
          }
        }
      }

      await updateDoc(transactionRef, updates);

      return { id: transactionId, ...transactionData, ...updates };
    } catch (error) {
      console.error("Error completing transaction:", error);
      throw error;
    }
  }

  /**
   * Get all transactions for a specific student
   * @param {string} rfid - Student RFID
   * @param {number} limitCount - Number of transactions to retrieve
   * @returns {Promise<Array>} - Array of transactions
   */
  static async getStudentTransactions(rfid, limitCount = 50) {
    try {
      // Simplified query - we'll sort manually to avoid index requirement
      const q = query(
        collection(db, "transactions"),
        where("rfid", "==", rfid)
      );

      const querySnapshot = await getDocs(q);
      const transactions = [];

      querySnapshot.forEach((doc) => {
        transactions.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort by createdAt descending (newest first)
      transactions.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      // Apply limit
      return transactions.slice(0, limitCount);
    } catch (error) {
      console.error("Error getting student transactions:", error);
      throw error;
    }
  }

  /**
   * Get all transactions (for admin)
   * @param {number} limitCount - Number of transactions to retrieve
   * @returns {Promise<Array>} - Array of transactions
   */
  static async getAllTransactions(limitCount = 100) {
    try {
      // Get all transactions without ordering to avoid index requirement
      const querySnapshot = await getDocs(collection(db, "transactions"));
      const transactions = [];

      querySnapshot.forEach((doc) => {
        transactions.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort by createdAt descending (newest first)
      transactions.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      // Apply limit
      return transactions.slice(0, limitCount);
    } catch (error) {
      console.error("Error getting all transactions:", error);
      throw error;
    }
  }

  /**
   * Get active (in-progress) transaction for a student
   * @param {string} rfid - Student RFID
   * @returns {Promise<Object|null>} - Active transaction or null
   */
  static async getActiveTransaction(rfid) {
    try {
      // Simplified query without orderBy to avoid index requirement
      const q = query(
        collection(db, "transactions"),
        where("rfid", "==", rfid),
        where("status", "==", "in-progress")
      );

      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        return null;
      }

      // Manually sort by createdAt if multiple results (shouldn't happen)
      let latestDoc = querySnapshot.docs[0];
      querySnapshot.docs.forEach((doc) => {
        const currentCreatedAt = doc.data().createdAt?.seconds || 0;
        const latestCreatedAt = latestDoc.data().createdAt?.seconds || 0;
        if (currentCreatedAt > latestCreatedAt) {
          latestDoc = doc;
        }
      });

      return {
        id: latestDoc.id,
        ...latestDoc.data()
      };
    } catch (error) {
      console.error("Error getting active transaction:", error);
      throw error;
    }
  }

  /**
   * Get transaction statistics for a student
   * @param {string} rfid - Student RFID
   * @returns {Promise<Object>} - Transaction statistics
   */
  static async getStudentStats(rfid) {
    try {
      const q = query(
        collection(db, "transactions"),
        where("rfid", "==", rfid)
      );

      const querySnapshot = await getDocs(q);
      
      let totalSessions = 0;
      let totalPointsUsed = 0;
      let totalDuration = 0;
      let completedSessions = 0;
      let cancelledSessions = 0;

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        totalSessions++;
        totalPointsUsed += data.pointsUsed || 0;
        
        if (data.duration) {
          totalDuration += data.duration;
        }

        if (data.status === "completed") {
          completedSessions++;
        } else if (data.status === "cancelled") {
          cancelledSessions++;
        }
      });

      return {
        totalSessions,
        totalPointsUsed,
        totalDuration,
        completedSessions,
        cancelledSessions,
        averagePointsPerSession: totalSessions > 0 ? Math.round(totalPointsUsed / totalSessions) : 0,
        averageDuration: totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0
      };
    } catch (error) {
      console.error("Error getting student stats:", error);
      throw error;
    }
  }
}
