//
// File: Dashboard.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Main dashboard view showing stats and lists of proposals.
//

import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, or } from 'firebase/firestore';
import { Search, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, FileCheck, Send, User as UserIcon, ExternalLink } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../App';
import { Proposal, ProposalStatus } from '../../models/types';
import Navbar from '../components/Navbar';
import { Link } from 'react-router-dom';
import { cn, getDirectGoogleDriveLink } from '../../utils/utils';
import { format } from 'date-fns';
import { getGDriveFolders } from '../../config/constants';

const STATUS_CONFIG: Record<ProposalStatus, { color: string; bg: string; icon: any }> = {
  'Draft': { color: 'text-gray-600', bg: 'bg-gray-100', icon: Clock },
  'Pending Review': { color: 'text-amber-600', bg: 'bg-amber-100', icon: AlertCircle },
  'Approved': { color: 'text-green-600', bg: 'bg-green-100', icon: CheckCircle2 },
  'Denied': { color: 'text-red-600', bg: 'bg-red-100', icon: XCircle },
  'Revision Requested': { color: 'text-blue-600', bg: 'bg-blue-100', icon: RefreshCw },
  'Sent': { color: 'text-indigo-600', bg: 'bg-indigo-100', icon: Send },
};

export default function Dashboard() {
  const { isAdmin, isStaff, user, loading: authLoading } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | 'All'>('All');

  useEffect(() => {
    if (!user) return;

    let q;
    
    if (isAdmin || isStaff) {
      // Admins and staff see their own proposals (including drafts) AND all proposals that are NOT draft
      q = query(
        collection(db, 'proposals'), 
        or(
          where('createdBy', '==', user.uid),
          where('status', 'in', ['Pending Review', 'Approved', 'Denied', 'Revision Requested', 'Sent'])
        )
      );
    } else {
      // Normal/personal users only see their own proposals
      q = query(
        collection(db, 'proposals'), 
        where('createdBy', '==', user.uid)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`[INFO] Dashboard snapshot received: ${snapshot.size} proposals.`);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Proposal));
      // Sort on client side to avoid needing composite index setups in Firestore
      data.sort((a, b) => {
        const t1 = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const t2 = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        return t2 - t1;
      });
      setProposals(data);
      setLoading(false);
    }, (error) => {
      console.error("[ERROR] Dashboard subscription error:", error);
      setLoading(false);
      // Don't throw here to avoid crashing the component UI
    });

    return unsubscribe;
  }, [isAdmin, isStaff, user]);

  const filteredProposals = useMemo(() => {
    return proposals.filter(p => {
      const matchesSearch = p.companyName.toLowerCase().includes(search.toLowerCase()) ||
                            p.contactPerson.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [proposals, search, statusFilter]);

  const stats = useMemo(() => {
    return {
      All: proposals.length,
      Draft: proposals.filter(p => p.status === 'Draft').length,
      'Pending Review': proposals.filter(p => p.status === 'Pending Review').length,
      Approved: proposals.filter(p => p.status === 'Approved').length,
      Denied: proposals.filter(p => p.status === 'Denied').length,
      'Revision Requested': proposals.filter(p => p.status === 'Revision Requested').length,
      Sent: proposals.filter(p => p.status === 'Sent').length,
    };
  }, [proposals]);

  const { myDrafts, mainProposals } = useMemo(() => {
    const drafts = filteredProposals.filter(p => p.status === 'Draft' && user && p.createdBy === user.uid);
    const others = filteredProposals.filter(p => p.status !== 'Draft');
    return { myDrafts: drafts, mainProposals: others };
  }, [filteredProposals, user]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <Navbar />
        <div className="flex h-[calc(100vh-64px)] items-center justify-center">
             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1E2D5A]"></div>
        </div>
      </div>
    );
  }

  const renderProposalCard = (proposal: Proposal) => {
    const config = STATUS_CONFIG[proposal.status];
    const Icon = config.icon || FileCheck;
    
    return (
      <div key={proposal.id} className="relative group">
        <Link
          to={`/proposal/${proposal.id}`}
          className="block bg-white rounded-2xl border border-slate-200 p-6 transition-all hover:shadow-xl hover:shadow-slate-200/50 hover:border-[#1E2D5A]/30 hover:-translate-y-1 cursor-pointer"
        >
          <div className="flex justify-between items-start mb-4">
            <span className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight",
              config.bg, config.color
            )}>
              <Icon className="h-3 w-3" />
              {proposal.status}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {proposal.id?.slice(-8)}
            </span>
          </div>
          
          <h3 className="text-xl font-bold text-slate-900 group-hover:text-[#1E2D5A] transition-colors mb-1 line-clamp-1">
            {proposal.companyName}
          </h3>
          <p className="text-sm text-slate-500 font-medium mb-6 line-clamp-1">
            {proposal.serviceTypes.join(', ')}
          </p>

          <div className="flex items-center justify-between py-4 border-t border-slate-50">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Contact</span>
              <span className="text-sm font-semibold text-slate-700">{proposal.contactPerson}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Date</span>
              <span className="text-sm font-semibold text-slate-700">
                {proposal.createdAt?.seconds ? format(proposal.createdAt.seconds * 1000, 'MMM d, yyyy') : 'Recently'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-4 border-t border-slate-50 mt-1">
             <div className="h-6 w-6 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center ring-1 ring-slate-200 shrink-0">
               {proposal.creatorPhotoURL ? (
                 <img 
                   src={getDirectGoogleDriveLink(proposal.creatorPhotoURL)} 
                   alt={proposal.createdByName} 
                   className="h-full w-full object-cover" 
                   referrerPolicy="no-referrer"
                 />
               ) : (
                 <UserIcon className="h-3.5 w-3.5 text-slate-400" />
               )}
             </div>
             <span className="text-xs font-medium text-slate-500">Created by: {proposal.createdByName || 'Unknown'}</span>
          </div>
        </Link>
        <div className="absolute top-6 right-6 flex flex-col gap-2 z-10">
          {getGDriveFolders(proposal.serviceTypes).map((folder, idx) => (
            <a 
              key={idx}
              href={folder.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="group/folder flex items-center gap-2 p-1.5 pl-3 rounded-lg bg-white/90 backdrop-blur-sm border border-slate-100 text-slate-400 hover:text-blue-600 hover:bg-white hover:border-blue-100 transition-all shadow-sm"
              title={`Open ${folder.name}`}
            >
              <span className="text-[9px] font-black uppercase tracking-widest hidden group-hover/folder:block animate-in fade-in slide-in-from-right-1 duration-200">
                {folder.name}
              </span>
              <ExternalLink className="h-4 w-4" />
            </a>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-12">
      <Navbar />
      
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Row */}
        <div className="flex overflow-x-auto pb-4 mb-8 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {(['All', 'Draft', 'Pending Review', 'Revision Requested', 'Approved', 'Denied', 'Sent'] as const).map((key) => {
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key as any)}
                className={cn(
                  "flex flex-col p-4 rounded-xl transition-all border text-left active:scale-95 cursor-pointer flex-shrink-0 min-w-[130px] sm:min-w-0",
                  isActive 
                    ? "bg-white border-[#1E2D5A] shadow-lg shadow-[#1E2D5A]/10 ring-1 ring-[#1E2D5A]" 
                    : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md"
                )}
              >
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{key}</span>
                <span className="text-3xl font-black text-slate-900">{stats[key as keyof typeof stats] || 0}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by company or contact…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/20 focus:border-[#1E2D5A] transition-all"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-4 py-3 bg-white rounded-xl border border-slate-200 font-medium text-slate-700 outline-none focus:border-[#1E2D5A]"
            >
              <option value="All">All Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Approved">Approved</option>
              <option value="Denied">Denied</option>
              <option value="Revision Requested">Revision Requested</option>
              <option value="Sent">Sent</option>
            </select>
          </div>
        </div>

        {/* My Drafts Section */}
        {myDrafts.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-6">
              <Clock className="h-5 w-5 text-slate-400" />
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">My Drafts</h2>
              <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full font-bold">
                {myDrafts.length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myDrafts.map(renderProposalCard)}
            </div>
          </div>
        )}

        {/* Main Section */}
        {(mainProposals.length > 0 || myDrafts.length === 0) && (
          <div>
            {myDrafts.length > 0 && (
              <div className="flex items-center gap-2 mb-6">
                <FileCheck className="h-5 w-5 text-slate-400" />
                <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                  {statusFilter === 'All' ? 'Process Management' : `${statusFilter} Proposals`}
                </h2>
              </div>
            )}
            
            {mainProposals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {mainProposals.map(renderProposalCard)}
              </div>
            ) : (
              myDrafts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="bg-slate-100 p-6 rounded-full mb-4">
                    <FileCheck className="h-12 w-12 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">No proposals found</h3>
                  <p className="text-slate-500 max-w-sm">
                    We couldn't find any proposals matching your criteria. Try adjusting your filters.
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}
