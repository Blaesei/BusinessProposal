//
// File: Navbar.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Navigation component providing links to main views and user actions.
//

import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, LogOut, FileText, Settings, Bell, BellDot, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';
import { db } from '../../services/firebase';
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc, limit } from 'firebase/firestore';
import { useAuth } from '../../App';
import { cn, getDirectGoogleDriveLink } from '../../utils/utils';
import { Notification } from '../../models/types';
import { formatDistanceToNow } from 'date-fns';
import { GDRIVE_FOLDERS } from '../../config/constants';

export default function Navbar() {
  const { profile, isAdmin, isStaff, signOut, user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));
      list.sort((a, b) => {
        const t1 = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const t2 = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        return t2 - t1;
      });
      setNotifications(list.slice(0, 20));
    });
    return unsubscribe;
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    for (const n of unread) {
      if (n.id) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    }
  };

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  const getNotificationIcon = (type: Notification['type'], status: Notification['status']) => {
    if (status === 'Approved') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === 'Denied') return <XCircle className="h-4 w-4 text-red-500" />;
    if (status === 'Revision Requested') return <AlertCircle className="h-4 w-4 text-blue-500" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="flex h-8 px-2 items-center justify-center rounded bg-[#1E2D5A] font-bold text-white group-hover:scale-105 transition-transform">
              STLAF
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1E2D5A] hidden sm:block">Proposal System</span>
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <Link
            to="/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#1E2D5A] px-4 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-[#1E2D5A] transition-all hover:bg-[#2A3C74] hover:shadow-md active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Proposal</span>
          </Link>
          
          <div className="h-8 w-[1px] bg-slate-200 hidden sm:block" />

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-xs font-semibold text-slate-900 leading-tight">{profile?.displayName}</span>
              <span className={cn(
                "text-[10px] uppercase tracking-widest font-black px-1.5 rounded",
                isAdmin ? "bg-[#1E2D5A] text-white" : (isStaff ? "bg-slate-200 text-slate-700" : "text-slate-500")
              )}>
                {profile?.role || (isAdmin ? 'Admin' : (isStaff ? 'Staff' : 'User'))}
              </span>
            </div>
            <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center ring-2 ring-white overflow-hidden">
              {profile?.photoURL ? (
                <img src={getDirectGoogleDriveLink(profile.photoURL)} alt={profile.displayName} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <FileText className="h-5 w-5 text-slate-400" />
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  if (!showNotifications && unreadCount > 0) markAllAsRead();
                }}
                className="p-2 text-slate-400 hover:text-[#1E2D5A] transition-colors relative"
                title="Notifications"
              >
                {unreadCount > 0 ? (
                  <>
                    <BellDot className="h-5 w-5 text-[#1E2D5A] animate-pulse" />
                    <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-red-500" />
                  </>
                ) : (
                  <Bell className="h-5 w-5" />
                )}
              </button>

              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowNotifications(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 z-[70] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
                      {unreadCount > 0 && (
                        <button 
                          onClick={markAllAsRead} 
                          className="text-[10px] font-bold text-[#1E2D5A] uppercase tracking-widest hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {notifications.length > 0 ? (
                        notifications.map((n) => (
                          <Link 
                            key={n.id} 
                            to={`/proposal/${n.proposalId}`}
                            onClick={() => {
                              if (n.id) markAsRead(n.id);
                              setShowNotifications(false);
                            }}
                            className={cn(
                              "group block px-4 py-3 border-b border-slate-50 last:border-0 cursor-pointer transition-colors",
                              !n.read ? "bg-blue-50/30 hover:bg-blue-50/50" : "hover:bg-slate-50"
                            )}
                          >
                            <div className="flex gap-3">
                              <div className="mt-1 flex-shrink-0">
                                {getNotificationIcon(n.type, n.status)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={cn("text-xs leading-relaxed", !n.read ? "text-slate-900 font-bold" : "text-slate-600 font-medium")}>
                                  {n.message}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium">
                                  {n.createdAt ? formatDistanceToNow(new Date(n.createdAt.seconds * 1000), { addSuffix: true }) : 'Just now'}
                                </p>
                              </div>
                              {!n.read && (
                                <div className="mt-1 flex-shrink-0">
                                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                </div>
                              )}
                            </div>
                          </Link>
                        ))
                      ) : (
                        <div className="px-4 py-12 text-center">
                          <div className="mx-auto w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3 text-slate-300">
                            <Bell className="h-6 w-6" />
                          </div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No notifications yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => navigate('/settings')}
              className="p-2 text-slate-400 hover:text-[#1E2D5A] transition-colors"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={signOut}
              className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
