//
// File: Settings.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: View for user settings, profile management, and message template configuration.
//

import React, { useState, useEffect } from 'react';
import { 
  User, 
  Mail, 
  Bell, 
  Plus, 
  Edit2, 
  Trash2, 
  Save, 
  X,
  ChevronRight,
  UserCircle,
  RefreshCw,
  Shield,
  Users,
  Key,
} from 'lucide-react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  serverTimestamp,
  orderBy,
  where,
  limit
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../App';
import { MessageTemplate, Notification, UserProfile, UserRole } from '../../models/types';
import Navbar from '../components/Navbar';
import { cn, getDirectGoogleDriveLink } from '../../utils/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Clock, XCircle, AlertCircle, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

type SettingsTab = 'profile' | 'message-templates' | 'proposal-templates' | 'notifications' | 'user-management' | 'google-integration';

export default function Settings() {
  const { user, profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('proposal-templates');
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [proposalTemplates, setProposalTemplates] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState<MessageTemplate | 'new' | null>(null);
  
  // Modal State
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');

  // Profile Edit State
  const [editName, setEditName] = useState('');
  const [editPhotoURL, setEditPhotoURL] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // User Management State
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserUid, setUpdatingUserUid] = useState<string | null>(null);
  
  // Google Integration State
  const [googleStatus, setGoogleStatus] = useState<{
    googleClientId: string;
    googleClientSecretSet: boolean;
    hasToken: boolean;
    refreshToken: string;
  } | null>(null);
  const [loadingGoogleStatus, setLoadingGoogleStatus] = useState(false);
  const [savingGoogleToken, setSavingGoogleToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [showManualToken, setShowManualToken] = useState(false);
  const [scopesStatus, setScopesStatus] = useState<any>(null);
  const [checkingScopes, setCheckingScopes] = useState(false);
  
  // Non-blocking Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  useEffect(() => {
    if (profile) {
      setEditName(profile.displayName || '');
      setEditPhotoURL(profile.photoURL || '');
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab !== 'user-management' || !isAdmin) return;
    setLoadingUsers(true);
    // Use stable, basic collection reference to avoid omitting documents missing 'createdAt'
    const q = collection(db, 'users');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      // Sort locally in-memory to prevent Firestore index requirements and omissions
      const sorted = usersData.sort((a, b) => {
        const timeA = a.createdAt ? (a.createdAt.seconds || 0) : 0;
        const timeB = b.createdAt ? (b.createdAt.seconds || 0) : 0;
        return timeB - timeA;
      });
      setAllUsers(sorted);
      setLoadingUsers(false);
    }, (error) => {
      console.error("Error loading users:", error);
      setLoadingUsers(false);
    });
    return unsubscribe;
  }, [activeTab, isAdmin]);

  const fetchGoogleStatus = async () => {
    if (!user || !isAdmin) return;
    setLoadingGoogleStatus(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/google-status', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(data);
        setManualToken(data.refreshToken || '');
      } else {
        const errorData = await res.json();
        showToast(errorData.error || 'Failed to load Google credentials status.', 'error');
      }
    } catch (err: any) {
      console.error('Error loading Google credentials:', err);
      showToast('Error loading Google credentials status: ' + err.message, 'error');
    } finally {
      setLoadingGoogleStatus(false);
    }
  };

  const handleSaveGoogleToken = async () => {
    if (!user || !isAdmin) return;
    setSavingGoogleToken(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/set-google-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ token: manualToken })
      });
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(prev => prev ? { ...prev, hasToken: true, refreshToken: data.refreshToken } : null);
        showToast('Google Refresh Token updated successfully and active!');
      } else {
        const errorData = await res.json();
        showToast(errorData.error || 'Failed to update Google Refresh Token.', 'error');
      }
    } catch (err: any) {
      console.error('Error saving Google Refresh Token:', err);
      showToast('Error saving Google Refresh Token: ' + err.message, 'error');
    } finally {
      setSavingGoogleToken(false);
    }
  };

  const handleCheckScopes = async () => {
    setCheckingScopes(true);
    try {
      const res = await fetch('/api/debug/scopes');
      const data = await res.json();
      setScopesStatus(data);
    } catch (err: any) {
      console.error('Error checking scopes:', err);
      setScopesStatus({ status: '❌ Failed to connect to server scope check API.' });
    } finally {
      setCheckingScopes(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'google-integration' && isAdmin) {
      fetchGoogleStatus();
    }
  }, [activeTab, isAdmin]);

  const handleUpdateRole = async (targetUserId: string, targetEmail: string, newRole: UserRole) => {
    if (!isAdmin) return;
    if (targetUserId === user?.uid) {
      showToast("You cannot modify your own role.", "error");
      return;
    }
    setUpdatingUserUid(targetUserId);
    try {
      // 1. Update role in the user's document
      await updateDoc(doc(db, 'users', targetUserId), {
        role: newRole,
        updatedAt: serverTimestamp()
      });

      // 2. Consistent sync to admins collection
      if (newRole === 'admin') {
        const adminRef = doc(db, 'admins', targetUserId);
        await setDoc(adminRef, {
          email: targetEmail,
          uid: targetUserId,
          assignedAt: serverTimestamp(),
          assignedBy: user?.uid || ''
        });
      } else {
        const adminRef = doc(db, 'admins', targetUserId);
        try {
          await deleteDoc(adminRef);
        } catch (e) {
          console.log('[Info] User was not in admins collection to remove.');
        }
      }

      showToast(`User role updated to ${newRole} successfully.`);
    } catch (error) {
      console.error("Error updating user role:", error);
      showToast('Failed to update user role.', 'error');
    } finally {
      setUpdatingUserUid(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'messageTemplates'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessageTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MessageTemplate)));
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    const q = query(collection(db, 'proposalTemplates'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setProposalTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

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
      setNotifications(list.slice(0, 50));
    });
    return unsubscribe;
  }, [user]);

  const markAsRead = async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    for (const n of unread) {
      if (n.id) {
        await updateDoc(doc(db, 'notifications', n.id), { read: true });
      }
    }
  };

  const getNotificationIcon = (status: string | undefined) => {
    if (status === 'Approved') return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (status === 'Denied') return <XCircle className="h-5 w-5 text-red-500" />;
    if (status === 'Revision Requested') return <AlertCircle className="h-5 w-5 text-blue-500" />;
    return <Clock className="h-5 w-5 text-amber-500" />;
  };

  const handleOpenModal = (template: MessageTemplate | 'new') => {
    if (template === 'new') {
      setName('');
      setSubject('');
      setBody('');
      setRecipientEmail('');
    } else {
      setName(template.name);
      setSubject(template.subject);
      setBody(template.body);
      setRecipientEmail(template.recipientEmail || '');
    }
    setShowModal(template);
  };

  const handleSaveTemplate = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (showModal === 'new') {
        await addDoc(collection(db, 'users', user.uid, 'messageTemplates'), {
          name,
          subject,
          body,
          recipientEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (showModal && typeof showModal !== 'string') {
        await updateDoc(doc(db, 'users', user.uid, 'messageTemplates', showModal.id!), {
          name,
          subject,
          body,
          recipientEmail,
          updatedAt: serverTimestamp(),
        });
      }
      setShowModal(null);
    } catch (error) {
      console.error("Error saving template:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProposalTemplate = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this proposal template? Staff will no longer be able to use it.')) return;
    try {
      await deleteDoc(doc(db, 'proposalTemplates', id));
    } catch (error) {
       console.error("Error deleting proposal template:", error);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!user || !window.confirm('Are you sure you want to delete this template?')) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'messageTemplates', templateId));
    } catch (error) {
      console.error("Error deleting template:", error);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: editName,
        photoURL: editPhotoURL,
        updatedAt: serverTimestamp(),
      });
      alert('Profile updated successfully.');
    } catch (error) {
      console.error("Error saving profile:", error);
      alert('Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { // 500kb limit for base64 storage
        alert('Image is too large. Please select an image under 500KB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditPhotoURL(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <Navbar />
      
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <aside className="w-full lg:w-64 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-50 bg-[#1E2D5A] h-20 relative">
                 <div className="absolute -bottom-6 left-4 h-12 w-12 rounded-xl bg-white shadow-md flex items-center justify-center border-2 border-white overflow-hidden">
                    {profile?.photoURL ? (
                      <img src={getDirectGoogleDriveLink(profile.photoURL)} alt="Avatar" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <UserCircle className="h-8 w-8 text-[#1E2D5A]" />
                    )}
                 </div>
              </div>
              <div className="pt-8 pb-4">
                <nav className="space-y-1 px-2">
                  <SidebarItem 
                    icon={User} 
                    label="Profile" 
                    active={activeTab === 'profile'} 
                    onClick={() => setActiveTab('profile')} 
                  />
                  {isAdmin && (
                    <SidebarItem 
                      icon={Mail} 
                      label="Message Templates" 
                      active={activeTab === 'message-templates'} 
                      onClick={() => setActiveTab('message-templates')} 
                    />
                  )}
                  {isAdmin && (
                    <SidebarItem 
                      icon={Users} 
                      label="User Management" 
                      active={activeTab === 'user-management'} 
                      onClick={() => setActiveTab('user-management')} 
                    />
                  )}
                  {isAdmin && (
                    <SidebarItem 
                      icon={Key} 
                      label="Google Integration" 
                      active={activeTab === 'google-integration'} 
                      onClick={() => setActiveTab('google-integration')} 
                    />
                  )}
                  <SidebarItem 
                    icon={Save} 
                    label="Proposal Templates" 
                    active={activeTab === 'proposal-templates'} 
                    onClick={() => setActiveTab('proposal-templates')} 
                  />
                  <SidebarItem 
                    icon={Bell} 
                    label="Notifications" 
                    active={activeTab === 'notifications'} 
                    onClick={() => setActiveTab('notifications')} 
                  />
                </nav>
              </div>
            </div>
          </aside>

          {/* Content Area */}
          <div className="flex-grow">
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              {activeTab === 'profile' && (
                <div className="max-w-xl">
                  <h2 className="text-xl font-bold text-slate-900 mb-6">Your Profile</h2>
                  <div className="space-y-8">
                    {/* Profile Card */}
                    <div className="flex flex-col sm:flex-row items-center gap-6 p-6 rounded-2xl bg-slate-50/50 border border-slate-100">
                       <div className="relative group">
                         <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-white shadow-md bg-[#1E2D5A] flex items-center justify-center">
                           {editPhotoURL ? (
                             <img src={getDirectGoogleDriveLink(editPhotoURL)} alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                           ) : (
                             <span className="text-3xl font-black text-white">{profile?.displayName?.charAt(0).toUpperCase()}</span>
                           )}
                         </div>
                         <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full overflow-hidden">
                            <Plus className="h-6 w-6 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                         </label>
                       </div>
                       
                       <div className="text-center sm:text-left flex-grow">
                          <p className="text-lg font-bold text-slate-900">{profile?.displayName}</p>
                          <p className="text-sm text-slate-500 font-medium mb-2">{profile?.email}</p>
                          <span className={cn(
                            "inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest",
                            isAdmin ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                          )}>
                            {isAdmin ? 'Administrator' : 'Staff Member'}
                          </span>
                       </div>
                    </div>

                    {/* Form */}
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Display Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Your full name"
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Photo URL (External)</label>
                        <input
                          type="text"
                          value={editPhotoURL}
                          onChange={(e) => setEditPhotoURL(e.target.value)}
                          placeholder="https://example.com/photo.jpg"
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                        />
                      </div>
                      
                      <div className="pt-4">
                        <button
                          onClick={handleSaveProfile}
                          disabled={savingProfile || !editName}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E2D5A] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all active:scale-95 disabled:opacity-50"
                        >
                          {savingProfile ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Update Profile
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'message-templates' && isAdmin && (
                <div>
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Message Templates</h2>
                      <p className="text-sm text-slate-500 font-medium">Create reusable email messages for your proposals.</p>
                    </div>
                    <button 
                      onClick={() => handleOpenModal('new')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1E2D5A] px-4 py-2 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4" />
                      New Template
                    </button>
                  </div>

                  {messageTemplates.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {messageTemplates.map(t => (
                        <div key={t.id} className="p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1E2D5A]/30 hover:shadow-md transition-all group">
                          <div className="flex items-start justify-between mb-3">
                            <h3 className="font-bold text-slate-900 group-hover:text-[#1E2D5A] transition-colors">{t.name}</h3>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleOpenModal(t)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600">
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteTemplate(t.id!)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Subject</p>
                          <p className="text-sm text-slate-700 font-medium mb-3 truncate">{t.subject}</p>
                          {t.recipientEmail && (
                            <>
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Recipient Email</p>
                              <p className="text-sm text-slate-700 font-medium mb-3 truncate">{t.recipientEmail}</p>
                            </>
                          )}
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Body Preview</p>
                          <p className="text-xs text-slate-500 font-medium line-clamp-2 leading-relaxed italic border-l-2 border-slate-100 pl-3">
                            {t.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      <Mail className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">No templates yet</h3>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'proposal-templates' && (
                <div>
                  <div className="mb-8">
                    <h2 className="text-xl font-bold text-slate-900">Proposal Templates</h2>
                    <p className="text-sm text-slate-500 font-medium">Manage pre-configured service sets and fee structures.</p>
                  </div>

                  {proposalTemplates.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {proposalTemplates.map(t => (
                        <div key={t.id} className="p-5 rounded-xl border border-slate-200 bg-white hover:border-[#1E2D5A]/30 hover:shadow-md transition-all group flex flex-col">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                               <h3 className="font-bold text-slate-900 group-hover:text-[#1E2D5A] transition-colors">{t.name}</h3>
                               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Created by {t.createdByName}</p>
                            </div>
                            <button 
                              onClick={() => handleDeleteProposalTemplate(t.id)} 
                              className="p-1.5 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-4 space-y-2 flex-grow">
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Included Services</p>
                             <div className="flex flex-wrap gap-1">
                               {t.data?.serviceTypes?.map((s: string) => (
                                 <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded uppercase">
                                   {s}
                                 </span>
                               ))}
                             </div>
                          </div>
                          <div className="mt-6 pt-4 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                             <span>Applied {t.usageCount || 0} times</span>
                             <span>{t.createdAt?.seconds ? format(new Date(t.createdAt.seconds * 1000), 'MMM dd, yyyy') : 'Recently'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      <Save className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">No proposal templates found</h3>
                      <p className="text-xs text-slate-400 mt-1">Create one from the New Proposal page.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'notifications' && (
                <div>
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Notifications</h2>
                      <p className="text-sm text-slate-500 font-medium">Clear or review your recent activity and submission updates.</p>
                    </div>
                    {notifications.some(n => !n.read) && (
                      <button 
                        onClick={markAllAsRead}
                        className="text-xs font-bold text-[#1E2D5A] uppercase tracking-widest hover:underline"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>

                  {notifications.length > 0 ? (
                    <div className="space-y-3">
                      {notifications.map((n) => (
                        <div 
                          key={n.id} 
                          className={cn(
                            "group p-4 rounded-xl border transition-all flex items-start gap-4",
                            !n.read 
                              ? "bg-blue-50/30 border-blue-100 shadow-sm" 
                              : "bg-white border-slate-100 hover:border-slate-200"
                          )}
                        >
                          <div className={cn(
                            "mt-1 p-2 rounded-lg flex-shrink-0",
                            !n.read ? "bg-white shadow-sm" : "bg-slate-50"
                          )}>
                            {getNotificationIcon(n.status)}
                          </div>
                          
                          <div className="flex-grow min-w-0">
                            <div className="flex items-start justify-between gap-4 mb-1">
                              <p className={cn(
                                "text-sm leading-relaxed",
                                !n.read ? "text-slate-900 font-bold" : "text-slate-600 font-medium"
                              )}>
                                {n.message}
                              </p>
                              {!n.read && (
                                <button 
                                  onClick={() => n.id && markAsRead(n.id)}
                                  className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline whitespace-nowrap"
                                >
                                  Mark read
                                </button>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-slate-400 font-bold">
                                {n.createdAt?.seconds ? formatDistanceToNow(new Date(n.createdAt.seconds * 1000), { addSuffix: true }) : 'Just now'}
                              </span>
                              <Link 
                                to={`/proposal/${n.proposalId}`}
                                onClick={() => n.id && markAsRead(n.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-[#1E2D5A] uppercase tracking-widest hover:underline"
                              >
                                <LinkIcon className="h-3 w-3" />
                                View Proposal
                              </Link>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-20 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                       <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4 mx-auto">
                          <Bell className="h-8 w-8 text-slate-300" />
                       </div>
                       <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">No notifications yet</h3>
                       <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Updates about your proposals will appear here automatically.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'user-management' && isAdmin && (
                <div>
                  <div className="mb-8">
                    <h2 className="text-xl font-bold text-slate-900">User Management</h2>
                    <p className="text-sm text-slate-500 font-medium">Manage user accounts and assign security roles (Admin, Staff, Normal).</p>
                  </div>

                  {loadingUsers ? (
                    <div className="flex justify-center items-center py-12">
                      <RefreshCw className="h-8 w-8 text-[#1E2D5A] animate-spin" />
                    </div>
                  ) : allUsers.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-150">
                        <thead>
                          <tr className="bg-slate-55/40">
                            <th scope="col" className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-50">User</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-50">Email</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-50">Role</th>
                            <th scope="col" className="px-6 py-4 text-right text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-50">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {allUsers.map((u) => {
                            const isSelf = u.uid === user?.uid;
                            return (
                              <tr key={u.uid} className="hover:bg-slate-50/50 transition-all border-b border-slate-100 last:border-none">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-[#1E2D5A] shadow-sm flex items-center justify-center border border-white overflow-hidden text-white font-bold">
                                      {u.photoURL ? (
                                        <img src={getDirectGoogleDriveLink(u.photoURL)} alt="Avatar" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                      ) : (
                                        <span>{u.displayName?.charAt(0).toUpperCase() || 'U'}</span>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-sm font-bold text-slate-900">
                                        {u.displayName || 'Unnamed User'}
                                        {isSelf && <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 font-black px-1.5 py-0.5 rounded uppercase">You</span>}
                                      </div>
                                      <div className="text-xs text-slate-400 font-medium">ID: {u.uid}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-medium">
                                  {u.email}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={cn(
                                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                                    u.role === 'admin' 
                                      ? "bg-slate-950 text-white" 
                                      : u.role === 'staff'
                                        ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                                        : "bg-slate-50 text-slate-500 border border-slate-200"
                                  )}>
                                    {u.role === 'admin' && <Shield className="h-3 w-3 inline text-white" />}
                                    {u.role || 'normal'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                                  {updatingUserUid === u.uid ? (
                                    <div className="inline-flex items-center gap-2 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                      Updating...
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button 
                                        disabled={isSelf}
                                        onClick={() => handleUpdateRole(u.uid, u.email, 'admin')}
                                        className={cn(
                                          "px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans transition-all active:scale-95 disabled:opacity-30",
                                          u.role === 'admin'
                                            ? "text-slate-400 cursor-not-allowed hidden"
                                            : "bg-slate-900 text-white hover:bg-black"
                                        )}
                                      >
                                        Admin
                                      </button>
                                      <button 
                                        disabled={isSelf}
                                        onClick={() => handleUpdateRole(u.uid, u.email, 'staff')}
                                        className={cn(
                                          "px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans transition-all active:scale-95 disabled:opacity-30",
                                          u.role === 'staff'
                                            ? "text-indigo-400 cursor-not-allowed hidden"
                                            : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100/55"
                                        )}
                                      >
                                        Staff
                                      </button>
                                      <button 
                                        disabled={isSelf}
                                        onClick={() => handleUpdateRole(u.uid, u.email, 'normal')}
                                        className={cn(
                                          "px-2.5 py-1.5 rounded-lg text-xs font-bold font-sans transition-all active:scale-95 disabled:opacity-30",
                                          u.role === 'normal' || !u.role
                                            ? "text-slate-400 cursor-not-allowed hidden"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                        )}
                                      >
                                        Normal
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      <Users className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">No users found</h3>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'google-integration' && isAdmin && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 font-sans tracking-tight">Google Workspace Integration</h2>
                    <p className="text-sm text-slate-500 mt-1">Configure and manage Google API authentication and Refresh Token access.</p>
                  </div>

                  {/* Status Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-5 rounded-2xl bg-slate-55 border border-slate-200 relative overflow-hidden">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Client ID</div>
                      {loadingGoogleStatus ? (
                        <div className="h-6 w-24 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        <div className="text-sm font-bold text-slate-800 truncate" title={googleStatus?.googleClientId}>
                          {googleStatus?.googleClientId ? 'Configured ✅' : 'Missing ❌'}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-2">Required from Google Cloud Console.</p>
                    </div>

                    <div className="p-5 rounded-2xl bg-slate-55 border border-slate-200 relative overflow-hidden">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Client Secret</div>
                      {loadingGoogleStatus ? (
                        <div className="h-6 w-24 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        <div className="text-sm font-bold text-slate-800">
                          {googleStatus?.googleClientSecretSet ? 'Configured ✅' : 'Missing ❌'}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-2">Required from Google Cloud Console.</p>
                    </div>

                    <div className="p-5 rounded-2xl bg-slate-55 border border-slate-200 relative overflow-hidden">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Refresh Token</div>
                      {loadingGoogleStatus ? (
                        <div className="h-6 w-24 bg-slate-200 animate-pulse rounded" />
                      ) : (
                        <div className="text-sm font-bold text-slate-800">
                          {googleStatus?.hasToken ? 'Active ✅' : 'Missing ❌'}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-2">Required to generate doc templates.</p>
                    </div>
                  </div>

                  {/* Manual Copy/Update Section */}
                  <div className="p-6 rounded-2xl border border-slate-250 bg-white shadow-sm space-y-6">
                    <div>
                      <h3 className="text-md font-bold text-slate-900 font-sans">Manage Refresh Token</h3>
                      <p className="text-sm text-slate-500 mt-0.5">Directly view, modify, or manually store your Google Refresh Token.</p>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Google Refresh Token</label>
                      <div className="relative">
                        <input
                          type={showManualToken ? "text" : "password"}
                          value={manualToken}
                          onChange={(e) => setManualToken(e.target.value)}
                          placeholder="PASTE_YOUR_GOOGLE_REFRESH_TOKEN_HERE"
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] font-mono text-sm tracking-wide"
                        />
                        <button
                          type="button"
                          onClick={() => setShowManualToken(!showManualToken)}
                          className="absolute right-3 top-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          {showManualToken ? 'Hide' : 'Reveal'}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4">
                      <button
                        onClick={handleSaveGoogleToken}
                        disabled={savingGoogleToken || !manualToken}
                        className="flex-grow sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E2D5A] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/10 hover:bg-[#2A3C74] transition-all active:scale-95 disabled:opacity-50"
                      >
                        {savingGoogleToken ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Refresh Token
                      </button>
                      <button
                        onClick={fetchGoogleStatus}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-6 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        Reload Status
                      </button>
                    </div>
                  </div>

                  {/* Automatic Link Flow */}
                  <div className="p-6 rounded-2xl border border-slate-200 bg-teal-50/20 shadow-sm space-y-6">
                    <div>
                      <h3 className="text-md font-bold text-teal-900 font-sans">Automatic Authentication Flow</h3>
                      <p className="text-sm text-teal-700/80 mt-0.5">The easiest way to get or renew credentials. The obtained token will be automatically saved.</p>
                    </div>

                    <div className="p-4 bg-teal-50 border border-teal-100 rounded-xl text-xs text-teal-800 space-y-2">
                      <p className="font-bold uppercase tracking-wider">💡 Troubleshooting Redirect Mismatch:</p>
                      <p className="leading-relaxed">
                        If you see a <b>redirect_uri_mismatch (Error 400)</b>, copy the callback URL below and add it to your <b>Authorized redirect URIs</b> in the Google Cloud Console credential settings:
                      </p>
                      <div className="bg-white p-2 rounded border border-teal-200 font-mono select-all text-[11px] truncate">
                        {window.location.origin}/api/debug/auth-callback
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      <a
                        href="/api/debug/auth-url"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 py-3 text-sm font-bold text-white hover:bg-teal-700 shadow-md shadow-teal-600/15 transition-all active:scale-95 animate-pulse"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Authorize & Link Google Account
                      </a>
                      
                      <button
                        onClick={handleCheckScopes}
                        disabled={checkingScopes}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-white px-6 py-3 text-sm font-bold text-teal-700 hover:bg-teal-50 transition-colors"
                      >
                        {checkingScopes ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                        Check Current Access & Permissions
                      </button>
                    </div>

                    {scopesStatus && (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-700 whitespace-pre shadow-inner">
                        <div className="font-sans font-bold text-slate-900 mb-2 border-b pb-1">System Scope Status:</div>
                        {JSON.stringify(scopesStatus, null, 2)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-900">
                {showModal === 'new' ? 'New Message Template' : 'Edit Template'}
              </h3>
              <button 
                onClick={() => setShowModal(null)} 
                className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Template Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Standard Approval Message"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Recipient Email (Optional)</label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="e.g., recipient@company.com"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Subject Line</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Your Proposal is Ready!"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Message Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type your message here..."
                  rows={8}
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-6 border-t border-slate-50 bg-slate-50/50 flex gap-4">
              <button 
                onClick={() => setShowModal(null)} 
                className="flex-1 px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveTemplate}
                disabled={loading || !name || !subject || !body}
                className="flex-[2] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E2D5A] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? <Save className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl animate-in slide-in-from-bottom-5 fade-in duration-300",
          toast.type === 'success' 
            ? "bg-slate-900 border-slate-800 text-white" 
            : "bg-red-50 border-red-200 text-red-700"
        )}>
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick }: { 
  icon: any, 
  label: string, 
  active: boolean, 
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]",
        active 
          ? "bg-[#1E2D5A]/5 text-[#1E2D5A]" 
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("h-4 w-4", active ? "text-[#1E2D5A]" : "text-slate-400")} />
        {label}
      </div>
      {active && <ChevronRight className="h-3 w-3" />}
    </button>
  );
}
