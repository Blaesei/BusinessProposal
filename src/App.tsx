//
// File: App.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Main entrance of the application, handles routing and authentication context.
//

import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { auth, db, signInWithGoogle } from './services/firebase';
import { UserProfile } from './models/types';

// Pages
import Dashboard from './views/pages/Dashboard';
import NewProposal from './views/pages/NewProposal';
import ProposalDetail from './views/pages/ProposalDetail';
import Settings from './views/pages/Settings';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  isStaff: boolean;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (profileUnsubscribe) {
        profileUnsubscribe();
        profileUnsubscribe = null;
      }

      if (firebaseUser) {
        try {
          // Check if user is admin
          const adminDoc = await getDoc(doc(db, 'admins', firebaseUser.uid));
          let isUserAdmin = adminDoc.exists();
          let isUserStaff = false;
          
          // Bootstrap roles for specific user emails
          const ADMIN_EMAILS = [
            'damoncrz2872@gmail.com', 
            'stlaf.acc08@gmail.com'
          ];
          const STAFF_EMAILS = [
            'mike.paras272@gmail.com',
            'stlaf.acc07@gmail.com',
            'dcpebenito@sadsadtamesislaw.com'
          ];

          if (!isUserAdmin && firebaseUser.email && ADMIN_EMAILS.includes(firebaseUser.email)) {
            console.log('[Admin] Bootstrapping admin for', firebaseUser.email);
            isUserAdmin = true; 
          }

          if (firebaseUser.email && STAFF_EMAILS.includes(firebaseUser.email)) {
            console.log('[Staff] Bootstrapping staff for', firebaseUser.email);
            isUserStaff = true;
          }
          
          setIsAdmin(isUserAdmin);
          setIsStaff(isUserAdmin || isUserStaff);

          // Listen for profile changes in real-time
          profileUnsubscribe = onSnapshot(doc(db, 'users', firebaseUser.uid), async (userDoc) => {
            if (userDoc.exists()) {
              const userData = userDoc.data() as UserProfile;
              // Sync role if needed
              const targetRole = isUserAdmin ? 'admin' : (isUserStaff ? 'staff' : 'normal');
              if (userData.role !== targetRole) {
                 await setDoc(doc(db, 'users', firebaseUser.uid), { role: targetRole }, { merge: true });
                 // The next snapshot will have the updated role
              } else {
                setProfile(userData);
              }
            } else {
              // Create new user profile
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || '',
                photoURL: firebaseUser.photoURL || '',
                role: isUserAdmin ? 'admin' : (isUserStaff ? 'staff' : 'normal'),
                createdAt: serverTimestamp(),
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              // Profile will be set by the subsequent snapshot
            }
          });
        } catch (error) {
          console.error("Auth sync error:", error);
        }
      } else {
        setProfile(null);
        setIsAdmin(false);
        setIsStaff(false);
      }
      setLoading(false);
    });

    return () => {
      authUnsubscribe();
      if (profileUnsubscribe) profileUnsubscribe();
    };
  }, []);

  const signIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const signOut = () => auth.signOut();

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, isStaff, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center font-sans">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

const LoginPage = () => {
  const { signIn, user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" />;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-4 font-sans">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200">
        <div className="mb-8 text-center">
          <div className="inline-flex h-16 px-6 items-center justify-center rounded-2xl bg-[#1E2D5A] mb-4">
               <span className="text-2xl font-bold text-white tracking-widest">STLAF</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Proposal System</h1>
          <p className="mt-2 text-slate-500 text-sm">Professional Proposals Management</p>
        </div>
        <button
          onClick={signIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-300 transition-all hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]"
        >
          <img src="https://www.google.com/favicon.ico" className="h-5 w-5" alt="Google" referrerPolicy="no-referrer" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/new" element={<ProtectedRoute><NewProposal /></ProtectedRoute>} />
          <Route path="/proposal/:id" element={<ProtectedRoute><ProposalDetail /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/edit/:id" element={<ProtectedRoute><NewProposal /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
