//
// File: notifications.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Provides functions for creating in-app notifications for admins and users.
//

import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function notifyAdmins(message: string, proposalId: string, proposalName: string, type: string) {
  try {
    console.log(`[INFO] Notifying admins about proposal: ${proposalName}`);
    const q = query(collection(db, 'users'), where('role', '==', 'admin'));
    const adminDocs = await getDocs(q);
    
    if (adminDocs.empty) {
      console.warn('[WARN] No admin users found to notify.');
      return;
    }
    
    const notifications = adminDocs.docs.map(adminDoc => {
      const adminId = adminDoc.id;
      return addDoc(collection(db, 'notifications'), {
        userId: adminId,
        type,
        proposalId,
        proposalName,
        message,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
    
    await Promise.all(notifications);
  } catch (error) {
    console.error('[ERROR] Error notifying admins:', error);
  }
}

export async function notifyUser(userId: string, message: string, proposalId: string, proposalName: string, type: string, status?: string) {
  try {
    console.log(`[INFO] Notifying user ${userId} about proposal: ${proposalName}`);
    await addDoc(collection(db, 'notifications'), {
      userId,
      type,
      proposalId,
      proposalName,
      status,
      message,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('[ERROR] Error notifying user:', error);
  }
}
