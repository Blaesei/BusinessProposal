//
// File: firebase.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Firebase initialization and Firestore utility functions.
//

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('[ERROR] Firestore Error Detailed: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    // Only test if we are in development
    if (process.env.NODE_ENV !== 'production') {
      await getDocFromServer(doc(db, 'test', 'connection'));
      console.log("[INFO] Firestore connection verified.");
    }
  } catch (error: any) {
    if (error.code === 'unavailable' || (error.message && error.message.includes('the client is offline'))) {
      console.warn("[WARN] Firestore is operating in offline mode. This is expected if you have a slow connection.");
    } else {
      console.error("[ERROR] Firestore connectivity issue:", error);
    }
  }
}
// testConnection(); // Commented out to reduce noise, handles errors on-demand
