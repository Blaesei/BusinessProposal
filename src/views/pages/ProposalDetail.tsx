//
// File: ProposalDetail.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: View for displaying a specific proposal's details, handling review workflow and PDF distribution.
//

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, orderBy, onSnapshot, deleteDoc, addDoc } from 'firebase/firestore';
import { 
  ChevronLeft, 
  Check, 
  X, 
  RefreshCw, 
  Mail, 
  Search, 
  Send, 
  Loader2, 
  AlertCircle, 
  MoreVertical, 
  FileText,
  Paperclip,
  ChevronDown,
  Plus,
  Trash2,
  User as UserIcon,
  Edit,
  Save,
  ExternalLink
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../services/firebase';
import { useAuth } from '../../App';
import { Proposal, ProposalStatus, MessageTemplate } from '../../models/types';
import Navbar from '../components/Navbar';
import { cn, getDirectGoogleDriveLink } from '../../utils/utils';
import { format } from 'date-fns';
import { notifyAdmins, notifyUser } from '../../services/notifications';
import { getGDriveFolders } from '../../config/constants';

const GROUP_A = ['LOA Assistance', 'Audited Financial Statement', 'Forensic Audit'];
const GROUP_B = [
  'Tax Retainer (Phase 1)', 
  'Tax Compliance (Phase 2)', 
  'General Accounting Services (Phase 3)'
];

const DEFAULT_HOURLY_RATES = [
  { position: 'Partners', rate: 4000 },
  { position: 'Senior Associates / S. Accountants', rate: 3500 },
  { position: 'Associates / Accountants', rate: 3000 },
  { position: 'Paralegals', rate: 2500 },
];

const STATUS_CONFIG: Record<ProposalStatus, { color: string; bg: string; label: string }> = {
  'Draft': { color: 'text-gray-600', bg: 'bg-gray-100', label: 'Draft' },
  'Pending Review': { color: 'text-amber-600', bg: 'bg-amber-100', label: 'Pending Review' },
  'Approved': { color: 'text-green-600', bg: 'bg-green-100', label: 'Approved' },
  'Denied': { color: 'text-red-600', bg: 'bg-red-100', label: 'Denied' },
  'Revision Requested': { color: 'text-blue-600', bg: 'bg-blue-100', label: 'Revision Required' },
  'Sent': { color: 'text-indigo-600', bg: 'bg-indigo-100', label: 'Sent to Client' },
};

export default function ProposalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isStaff, user, profile } = useAuth();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showModal, setShowModal] = useState<'Revision Requested' | 'Denied' | 'Submit Review' | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'doc-editor' | 'form-editor'>('preview');
  const [showEditDropdown, setShowEditDropdown] = useState(false);
  const [formData, setFormData] = useState<Partial<Proposal>>({});
  const lastCalculatedFileName = useRef('');
  const [currencyInputs, setCurrencyInputs] = useState<Record<string, string>>({});
  const [savingForm, setSavingForm] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  
  // Email State
  const [emailTo, setEmailTo] = useState('');
  const [emailCC, setEmailCC] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetchProposal = async () => {
      try {
        const snap = await getDoc(doc(db, 'proposals', id));
        if (snap.exists()) {
          const data = snap.data() as Proposal;
          setProposal(data);
          setFormData(data);
          setCurrencyInputs({
            feeAmount: data.feeAmount?.toString() || '',
            monthlyTaxRetainerFee: data.monthlyTaxRetainerFee?.toString() || '',
            acceptanceFee: data.acceptanceFee?.toString() || '',
            timeBasedFee: data.timeBasedFee?.toString() || '',
            successFee: data.successFee?.toString() || '',
            feeTotal: data.feeTotal?.toString() || '',
            forensicFixedFee: data.forensicFixedFee?.toString() || '',
            ...Object.fromEntries(data.hourlyRates?.map((r, i) => [`hourlyRate_${i}`, (r.rate || 0).toString()]) || [])
          });
          setEmailTo(data.email || '');
          setEmailSubject(`Proposal for ${data.companyName}`);
        }
        setLoading(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `proposals/${id}`);
      }
    };
    fetchProposal();
  }, [id]);

  useEffect(() => {
    if (!user || !showEmailModal) return;
    const q = query(
      collection(db, 'users', user.uid, 'messageTemplates'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MessageTemplate)));
    });
    return unsubscribe;
  }, [user, showEmailModal]);

  // Default Filename Calculation (Auto-reflecting)
  useEffect(() => {
    const calculateDefault = () => {
      if (!formData.companyName) return '';
      const cleanCompany = formData.companyName.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const now = new Date();
      const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getFullYear()}`;
      
      const services = formData.serviceTypes || [];
      let serviceDetail = 'SERVICES';
      const has = (s: string) => services.includes(s);
      
      if (has('LOA Assistance')) {
        serviceDetail = 'LOA_ASSISTANCE';
      } else if (has('Audited Financial Statement')) {
        serviceDetail = 'AUDIT';
      } else if (has('Forensic Audit')) {
        serviceDetail = 'FRAUD_AUDIT';
      } else if (services.length === 1 && has('Tax Retainer (Phase 1)')) {
        serviceDetail = 'TAX_FILING';
      } else if (services.some(s => ['Tax Compliance (Phase 2)', 'General Accounting Services (Phase 3)'].includes(s))) {
        serviceDetail = 'General Accounting Services and Tax Compliance';
      }
      
      return `${cleanCompany}_${serviceDetail}_${dateStr}`;
    };

    const nextDefault = calculateDefault();
    
    // On first run, if customFileName matches nextDefault, we consider it "currently auto-calculated"
    if (!lastCalculatedFileName.current && formData.customFileName === nextDefault) {
      lastCalculatedFileName.current = nextDefault;
    }

    // Update if field is empty OR matches last auto-calculated default
    if (!formData.customFileName || formData.customFileName === lastCalculatedFileName.current) {
      if (formData.customFileName !== nextDefault) {
        setFormData(prev => ({ ...prev, customFileName: nextDefault }));
        lastCalculatedFileName.current = nextDefault;
      }
    }
  }, [formData.companyName, formData.serviceTypes, formData.customFileName]);

  const handleStatusUpdate = async (newStatus: ProposalStatus, reviewerNotes: string = '') => {
    if (!proposal || !id) return;
    setActionLoading(true);
    try {
      const updateData: any = {
        status: newStatus,
        reviewerNotes: reviewerNotes || proposal.reviewerNotes || '',
        updatedAt: serverTimestamp()
      };

      // If moving from Draft to Pending Review, update createdAt to reflect submission time
      if (newStatus === 'Pending Review' && proposal.status === 'Draft') {
        updateData.createdAt = serverTimestamp();
      }

      await updateDoc(doc(db, 'proposals', id), updateData);

      // Notify admins if user submitted for review
      if (newStatus === 'Pending Review') {
        await notifyAdmins(
          `${profile?.displayName || 'Someone'} submitted ${proposal.companyName} for review`,
          id,
          proposal.companyName,
          'new_proposal'
        );
      }

      // Create notification for the creator if status changed by someone else (admin)
      if (isAdmin && proposal.createdBy !== user?.uid) {
        let message = '';
        if (newStatus === 'Approved') message = `Your proposal for ${proposal.companyName} has been approved!`;
        else if (newStatus === 'Denied') message = `Your proposal for ${proposal.companyName} has been denied.`;
        else if (newStatus === 'Revision Requested') message = `Revision requested for ${proposal.companyName}.`;

        if (message) {
          await notifyUser(
            proposal.createdBy,
            message,
            id,
            proposal.companyName,
            'status_change',
            newStatus
          );
        }
      }
      
      setProposal({ 
        ...proposal, 
        status: newStatus, 
        reviewerNotes: reviewerNotes || proposal.reviewerNotes || '',
        createdAt: updateData.createdAt ? { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any : proposal.createdAt
      });
      setShowModal(null);
      setShowMenu(false);
      setNotes('');
      
      // Automatically show email modal if approved
      if (newStatus === 'Approved') {
        setShowEmailModal(true);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `proposals/${id}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!proposal || !id || !profile) return;
    setActionLoading(true);
    try {
      const url = '/api/send-email';
      console.log('Fetching:', url);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: emailTo,
          cc: emailCC,
          subject: emailSubject,
          message: emailMessage,
          docId: proposal.googleDocId,
          proposalId: id,
          senderEmail: profile.displayName || profile.email
        }),
      });

      let result;
      const responseText = await response.text();
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.error('Server returned non-JSON response:', responseText);
        throw new Error(`Server error (${response.status}): The server returned an unexpected response format. Please check the logs.`);
      }
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to send email');
      }

      if (result.simulated) {
        alert("SIMULATION: " + result.message);
      }

      // Logic for actual email sending would go here (API call)
      // For now, we update status to 'Sent'
      await updateDoc(doc(db, 'proposals', id), {
        status: 'Sent',
        updatedAt: serverTimestamp()
      });
      setProposal({ ...proposal, status: 'Sent' });
      setShowEmailModal(false);
      
      if (!result.simulated) {
        alert("Email sent successfully!");
      }
    } catch (error: any) {
      console.error(error);
      alert('Error sending email: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleFieldChange = (field: keyof Proposal, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateHourlyRate = (index: number, field: 'position' | 'rate', value: any) => {
    const newRates = [...(formData.hourlyRates || [])];
    newRates[index] = { ...newRates[index], [field]: value };
    setFormData(prev => ({ ...prev, hourlyRates: newRates }));
  };

  const addHourlyRate = () => {
    setFormData(prev => ({
      ...prev,
      hourlyRates: [...(prev.hourlyRates || []), { position: '', rate: 0 }]
    }));
  };

  const removeHourlyRate = (index: number) => {
    setFormData(prev => ({
      ...prev,
      hourlyRates: (prev.hourlyRates || []).filter((_, i) => i !== index)
    }));
  };

  const toggleService = (service: string, isGroupA: boolean) => {
    let newServices = [...(formData.serviceTypes || [])];
    let newFeeType = formData.feeType || 'Monthly Retainer';
    let newHourlyRates = [...(formData.hourlyRates || [])];
    let newAcceptanceFee = formData.acceptanceFee;

    // Helper to add defaults if empty
    const ensureDefaultRates = () => {
      if (newHourlyRates.length === 0) {
        newHourlyRates = [...DEFAULT_HOURLY_RATES];
      }
    };

    if (isGroupA) {
      if (newServices.includes(service)) {
        newServices = [];
      } else {
        newServices = [service];
        // Set default feeType for Group A
        if (service === 'Forensic Audit' || service === 'Audited Financial Statement') {
          newFeeType = 'Fixed Fee';
        } else if (service === 'LOA Assistance') {
          newFeeType = 'Acceptance + Success Fee';
          ensureDefaultRates();
        }
      }
    } else {
      newServices = newServices.filter(s => !GROUP_A.includes(s));
      newFeeType = 'Monthly Retainer';
      if (newServices.includes(service)) newServices = newServices.filter(s => s !== service);
      else {
        newServices.push(service);

        // Auto-populate rates for Phase 2/3
        if (service === 'Tax Compliance (Phase 2)' || service === 'General Accounting Services (Phase 3)') {
          ensureDefaultRates();
        }

        if (service === 'Tax Retainer (Phase 1)') {
          if (newAcceptanceFee === null || newAcceptanceFee === 0) {
            newAcceptanceFee = 10000;
          }
        }

        newServices.sort((a, b) => {
           const order = ['Tax Retainer (Phase 1)', 'Tax Compliance (Phase 2)', 'General Accounting Services (Phase 3)'];
           return order.indexOf(a) - order.indexOf(b);
        });
      }
    }
    setFormData(prev => ({ 
      ...prev, 
      serviceTypes: newServices, 
      feeType: newFeeType,
      hourlyRates: newHourlyRates,
      acceptanceFee: newAcceptanceFee
    }));
  };

  const formatCurrencyInput = (field: string, numericValue: number | null) => {
    const raw = currencyInputs[field];
    if (raw === undefined) return numericValue !== null ? numericValue.toLocaleString('en-US') : '';
    const parts = raw.split('.');
    const whole = parts[0].replace(/,/g, '');
    let formattedWhole = '';
    if (whole !== '') {
      const parsed = parseInt(whole);
      formattedWhole = isNaN(parsed) ? '' : parsed.toLocaleString('en-US');
      if (whole === '0') formattedWhole = '0';
    }
    if (parts.length > 1) return `${formattedWhole}.${parts[1].substring(0, 2)}`;
    return formattedWhole;
  };

  const handleCurrencyChange = (field: keyof Proposal, inputValue: string, key?: string) => {
    const stateKey = key || (field as string);
    const cleanValue = inputValue.replace(/[^0-9.]/g, '');
    const dots = cleanValue.split('.').length - 1;
    if (dots > 1) return;
    setCurrencyInputs(prev => ({ ...prev, [stateKey]: cleanValue }));
    const numValue = cleanValue === '' || cleanValue === '.' ? null : parseFloat(cleanValue);
    if (field === 'hourlyRates' && key) {
      const index = parseInt(key.split('_')[1]);
      updateHourlyRate(index, 'rate', numValue || 0);
    } else handleFieldChange(field, numValue);
  };

  const handleSaveForm = async () => {
    if (!id || !user || !profile || !proposal) return;
    if (!formData.companyName) {
      alert('Company Name is required.');
      return;
    }
    setSavingForm(true);
    try {
      let templateName = '';
      const services = formData.serviceTypes || [];
      if (services.includes('LOA Assistance')) templateName = 'LOA Assistance';
      else if (services.includes('Audited Financial Statement')) templateName = 'Audited Financial Statement';
      else if (services.includes('Forensic Audit')) templateName = 'Forensic Audit';
      else templateName = 'Tax Retainer + Tax Compliance + General Accounting';

      const periodStr = formData.periodCover?.from ? `From ${formData.periodCover.from} to ${formData.periodCover.to} (${formData.periodCover.type})` : '';

      const resp = await fetch('/api/generate-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          selectedServices: formData.serviceTypes,
          date: format(new Date(), 'MMMM dd, yyyy'),
          periodCover: periodStr,
          serviceDescription: formData.serviceTypes?.join(', '),
          templateName
        })
      });

      let result: any = {};
      if (!resp.ok) {
        let errorMsg = 'Failed to update document';
        try {
          const errData = await resp.json();
          errorMsg = errData.error || errorMsg;
        } catch (_) {
          try {
            const rawText = await resp.text();
            if (rawText) {
              errorMsg = rawText.substring(0, 150) + (rawText.length > 150 ? '...' : '');
            }
          } catch (__) {}
        }
        console.error('API Error Response:', errorMsg);
        throw new Error(errorMsg);
      } else {
        try {
          result = await resp.json();
        } catch (jsonErr: any) {
          throw new Error(`Invalid JSON response from server: ${jsonErr.message}`);
        }
      }

      const finalData = {
        ...formData,
        googleDocUrl: result.docUrl,
        googleDocId: result.docId,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'proposals', id), finalData);
      setProposal({ ...proposal, ...finalData } as Proposal);
      setViewMode('preview');
      alert('Proposal updated successfully.');
    } catch (error: any) {
      console.error(error);
      alert('Error: ' + error.message);
    } finally {
      setSavingForm(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName) {
      alert('Please enter a template name.');
      return;
    }
    setActionLoading(true);
    try {
      await addDoc(collection(db, 'proposalTemplates'), {
        name: newTemplateName,
        data: {
          ...formData,
          googleDocId: '',
          googleDocUrl: '',
          companyName: '',
          address: '',
          email: '',
          contactPerson: '',
          position: '',
          status: 'Draft'
        },
        createdBy: user?.uid,
        createdByName: profile?.displayName || 'Unknown',
        createdAt: serverTimestamp(),
      });
      setIsCreatingTemplate(false);
      setNewTemplateName('');
      alert('Template saved successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'proposalTemplates');
    } finally {
      setActionLoading(false);
    }
  };

  const applyTemplate = (template: MessageTemplate) => {
    setEmailSubject(template.subject);
    setEmailMessage(template.body);
    if (template.recipientEmail) {
      setEmailTo(template.recipientEmail);
    }
    setShowTemplatePicker(false);
  };

  const handleDelete = async () => {
    if (!proposal || !id || !user) return;
    
    const canDelete = isAdmin || (isStaff && proposal.createdBy === user.uid && proposal.status === 'Draft');
    if (!canDelete) return;

    setActionLoading(true);
    try {
      await deleteDoc(doc(db, 'proposals', id));
      navigate('/');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `proposals/${id}`);
    } finally {
      setActionLoading(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) return (
     <div className="min-h-screen bg-slate-50 font-sans">
        <Navbar />
        <div className="flex h-[calc(100vh-64px)] items-center justify-center">
             <Loader2 className="h-12 w-12 animate-spin text-[#1E2D5A]" />
        </div>
      </div>
  );
  
  if (!proposal) return <div>Proposal not found</div>;

  const config = STATUS_CONFIG[proposal.status];
  const isCreator = profile?.uid === proposal.createdBy;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <Navbar />
      
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
              <ChevronLeft className="h-6 w-6 text-slate-900" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{proposal.companyName}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight",
                  config.bg, config.color
                )}>
                  {config.label}
                </span>
                <span className="text-xs text-slate-400 font-medium tracking-tight">ID: {id?.slice(-8)}</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 overflow-hidden">
                  <div className="h-4 w-4 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
                    {proposal.creatorPhotoURL ? (
                      <img 
                        src={getDirectGoogleDriveLink(proposal.creatorPhotoURL)} 
                        alt={proposal.createdByName} 
                        className="h-full w-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <UserIcon className="h-2.5 w-2.5 text-slate-500" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-tight">{proposal.createdByName || 'Unknown'}</span>
                </div>
                {getGDriveFolders(proposal.serviceTypes).map((folder, idx) => (
                  <a 
                    key={idx}
                    href={folder.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="text-[10px] font-bold uppercase tracking-tight">{folder.name} Folder</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Edit Actions (Authorized Users) */}
            {(isAdmin || (isStaff && !isAdmin && (proposal.status === 'Draft' || proposal.status === 'Revision Requested' || proposal.status === 'Denied')) || (user && proposal.createdBy === user.uid && (proposal.status === 'Draft' || proposal.status === 'Revision Requested' || proposal.status === 'Denied'))) && (
              <div className="relative">
                <button
                  onClick={() => setShowEditDropdown(!showEditDropdown)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-all shadow-sm",
                    viewMode !== 'preview'
                      ? "bg-[#1E2D5A] text-white border-[#1E2D5A] hover:bg-[#2A3C74]" 
                      : "bg-white text-[#1E2D5A] border-[#1E2D5A]/20 hover:bg-slate-50"
                  )}
                >
                  <Edit className="h-4 w-4" />
                  {viewMode === 'preview' ? 'Edit Content' : viewMode === 'doc-editor' ? 'Google Docs' : 'Forms'}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showEditDropdown && "rotate-180")} />
                </button>

                {showEditDropdown && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setShowEditDropdown(false)} 
                    />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl border border-slate-200 shadow-xl z-20 py-1 overflow-hidden">
                      <button
                        onClick={() => {
                          setViewMode('preview');
                          setShowEditDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2",
                          viewMode === 'preview' && "bg-slate-50 text-[#1E2D5A]"
                        )}
                      >
                        <FileText className="h-4 w-4" />
                        Preview Mode
                      </button>
                      <button
                        onClick={() => {
                          setViewMode('doc-editor');
                          setShowEditDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2",
                          viewMode === 'doc-editor' && "bg-slate-50 text-[#1E2D5A]"
                        )}
                      >
                        <Edit className="h-4 w-4" />
                        Google Docs
                      </button>
                      <button
                        onClick={() => {
                          setViewMode('form-editor');
                          setShowEditDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 flex items-center gap-2",
                          viewMode === 'form-editor' && "bg-slate-50 text-[#1E2D5A]"
                        )}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Forms (Details)
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Admin/Staff Delete Action (Trash) */}
            {(isAdmin || (isStaff && proposal.createdBy === user?.uid && proposal.status === 'Draft')) && (
               <button
                 onClick={() => setShowDeleteModal(true)}
                 disabled={actionLoading}
                 className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all border border-slate-200"
                 title="Delete Proposal"
               >
                 <Trash2 className="h-5 w-5" />
               </button>
            )}

            {/* Admin Actions */}
            {isAdmin && proposal.status === 'Pending Review' && (
              <>
                <button
                  onClick={() => setShowModal('Revision Requested')}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-100 transition-all font-sans"
                >
                  <RefreshCw className="h-4 w-4" />
                  Request Revision
                </button>
                <button
                  onClick={() => setShowModal('Denied')}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-100 transition-all font-sans"
                >
                  <X className="h-4 w-4" />
                  Deny
                </button>
                <button
                  onClick={() => handleStatusUpdate('Approved')}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-green-600/20 hover:bg-green-700 transition-all disabled:opacity-50 font-sans"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </button>
              </>
            )}

            {/* Approved / Sent Actions (Admin Only for Sending/Resending) */}
            {isAdmin && (proposal.status === 'Approved' || proposal.status === 'Sent') && (
              <button
                onClick={() => setShowEmailModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1E2D5A] px-4 py-2 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all"
              >
                <Mail className="h-4 w-4" />
                {proposal.status === 'Sent' ? 'Resend to Client' : 'Send to Client'}
              </button>
            )}

            {/* Admin Override Menu (Three Dots) - Always visible for Admins in terminal or revision states */}
            {isAdmin && ['Approved', 'Sent', 'Revision Requested', 'Denied'].includes(proposal.status) && (
              <div className="relative">
                <button 
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-all ml-2"
                >
                  <MoreVertical className="h-5 w-5 text-slate-500" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    {proposal.status !== 'Approved' && (
                      <button 
                        onClick={() => handleStatusUpdate('Approved')}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-green-600 hover:bg-green-50 transition-colors"
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                    )}
                    {proposal.status !== 'Revision Requested' && (
                      <button 
                        onClick={() => setShowModal('Revision Requested')}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Request Revision
                      </button>
                    )}
                    {proposal.status !== 'Denied' && (
                      <button 
                        onClick={() => setShowModal('Denied')}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <X className="h-4 w-4" />
                        Deny
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Draft / Revision Action (User) */}
            {isCreator && (proposal.status === 'Draft' || proposal.status === 'Revision Requested') && (
              <button
                onClick={() => {
                  if (proposal.status === 'Revision Requested') {
                    setShowModal('Submit Review');
                  } else {
                    handleStatusUpdate('Pending Review');
                  }
                }}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1E2D5A] px-4 py-2 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all disabled:opacity-50"
              >
                 {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit for Review
              </button>
            )}
          </div>
        </div>

        {/* Reviewer Notes Banner */}
        {(proposal.status === 'Revision Requested' || (proposal.status === 'Denied' && proposal.reviewerNotes)) && (
          <div className="mb-8 rounded-2xl bg-amber-50 border border-amber-200 p-6 flex gap-4 animate-in slide-in-from-top-4 duration-300">
             <AlertCircle className="h-6 w-6 text-amber-600 flex-shrink-0" />
             <div>
                <h4 className="text-sm font-bold text-amber-900 uppercase tracking-widest mb-1">Reviewer Feedback</h4>
                <p className="text-sm text-amber-800 leading-relaxed font-medium">{proposal.reviewerNotes}</p>
             </div>
          </div>
        )}

        {/* Google Doc Preview / Form Editor */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden relative min-h-[800px]">
          {viewMode === 'form-editor' ? (
            <div className="p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">Edit Proposal Details</h2>
                      <p className="text-sm text-slate-500">Update the fields below and save to re-generate the document</p>
                    </div>
                    <button 
                      onClick={() => setIsCreatingTemplate(true)}
                      className="text-xs font-bold text-[#1E2D5A] flex items-center gap-1 hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Save as Template
                    </button>
                  </div>
                  <button 
                    onClick={() => setViewMode('preview')}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <X className="h-6 w-6 text-slate-400" />
                  </button>
               </div>

               <div className="space-y-10">
                  {/* Section: Client Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Company Name</label>
                      <input
                        type="text"
                        value={formData.companyName || ''}
                        onChange={(e) => handleFieldChange('companyName', e.target.value)}
                        placeholder="Enter business name"
                        className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Address</label>
                      <input
                        type="text"
                        value={formData.address || ''}
                        onChange={(e) => handleFieldChange('address', e.target.value)}
                        placeholder="Full business address"
                        className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Email Address</label>
                      <input
                        type="email"
                        value={formData.email || ''}
                        onChange={(e) => handleFieldChange('email', e.target.value)}
                        placeholder="client@company.com"
                        className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Contact Person</label>
                      <input
                        type="text"
                        value={formData.contactPerson || ''}
                        onChange={(e) => handleFieldChange('contactPerson', e.target.value)}
                        placeholder="Full name"
                        className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                      />
                    </div>
                  </div>

                  {/* Section: Service Details */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                       <span className="w-1.5 h-4 bg-[#1E2D5A] rounded-full" />
                       Services
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[...GROUP_A, ...GROUP_B].map(service => {
                        const isSelected = formData.serviceTypes?.includes(service);
                        const isGroupA = GROUP_A.includes(service);
                        return (
                          <button
                            key={service}
                            onClick={() => toggleService(service, isGroupA)}
                            className={cn(
                              "flex items-center gap-3 p-4 rounded-xl border text-left transition-all",
                              isSelected 
                                ? "bg-[#1E2D5A] border-[#1E2D5A] text-white shadow-md" 
                                : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                            )}
                          >
                            <div className={cn(
                              "h-5 w-5 rounded border flex items-center justify-center shrink-0",
                              isSelected ? "bg-white border-white" : "bg-white border-slate-300"
                            )}>
                              {isSelected && (
                                isGroupA 
                                  ? <div className="h-2 w-2 rounded-full bg-[#1E2D5A]" />
                                  : <Check className="h-3 w-3 text-[#1E2D5A]" />
                              )}
                            </div>
                            <span className="text-xs font-bold uppercase tracking-tight">{service}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section: Fee Arrangement */}
                  <div className="space-y-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                       <span className="w-1.5 h-4 bg-[#1E2D5A] rounded-full" />
                       Fee Arrangement
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {formData.serviceTypes?.includes('Forensic Audit') && (
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fixed Fee Amount</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">Php</span>
                            <input
                              type="text"
                              value={formatCurrencyInput('forensicFixedFee', formData.forensicFixedFee ?? 200000)}
                              onChange={(e) => handleCurrencyChange('forensicFixedFee', e.target.value)}
                              placeholder="200,000.00"
                              className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] font-bold"
                            />
                          </div>
                        </div>
                      )}

                      {/* Group B Fees */}
                      {formData.serviceTypes?.some(s => GROUP_B.includes(s)) && (
                        <>
                          {/* Phase 1 Fees */}
                          {formData.serviceTypes?.includes('Tax Retainer (Phase 1)') && (
                            <>
                              <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Acceptance Fee</label>
                                <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                                  <input
                                    type="text"
                                    value={formatCurrencyInput('acceptanceFee', formData.acceptanceFee ?? null)}
                                    onChange={(e) => handleCurrencyChange('acceptanceFee', e.target.value)}
                                    placeholder="10,000.00"
                                    className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monthly Retainer</label>
                                <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                                  <input
                                    type="text"
                                    value={formatCurrencyInput('monthlyTaxRetainerFee', formData.monthlyTaxRetainerFee ?? null)}
                                    onChange={(e) => handleCurrencyChange('monthlyTaxRetainerFee', e.target.value)}
                                    placeholder="0.00"
                                    className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                                  />
                                </div>
                              </div>
                            </>
                          )}

                          {/* Phase 2/3 Fee */}
                          {!formData.serviceTypes?.includes('Tax Retainer (Phase 1)') && (formData.serviceTypes?.includes('Tax Compliance (Phase 2)') || formData.serviceTypes?.includes('General Accounting Services (Phase 3)')) && (
                            <div className="md:col-span-2">
                              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monthly Tax Retainer Fee</label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                                <input
                                  type="text"
                                  value={formatCurrencyInput('monthlyTaxRetainerFee', formData.monthlyTaxRetainerFee ?? null)}
                                  onChange={(e) => handleCurrencyChange('monthlyTaxRetainerFee', e.target.value)}
                                  placeholder="0.00"
                                  className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* LOA Fees */}
                      {formData.serviceTypes?.includes('LOA Assistance') && (
                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Acceptance Fee</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                              <input
                                type="text"
                                value={formatCurrencyInput('acceptanceFee', formData.acceptanceFee ?? null)}
                                onChange={(e) => handleCurrencyChange('acceptanceFee', e.target.value)}
                                className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Time-Based Fee</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                              <input
                                type="text"
                                value={formatCurrencyInput('timeBasedFee', formData.timeBasedFee ?? null)}
                                onChange={(e) => handleCurrencyChange('timeBasedFee', e.target.value)}
                                className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Success Fee</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                              <input
                                type="text"
                                value={formatCurrencyInput('successFee', formData.successFee ?? null)}
                                onChange={(e) => handleCurrencyChange('successFee', e.target.value)}
                                className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* AFS Fees */}
                      {formData.serviceTypes?.includes('Audited Financial Statement') && (
                        <div className="md:col-span-2">
                           <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Total AFS Fee</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                              <input
                                type="text"
                                value={formatCurrencyInput('feeTotal', formData.feeTotal ?? null)}
                                onChange={(e) => handleCurrencyChange('feeTotal', e.target.value)}
                                className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-bold"
                              />
                            </div>
                        </div>
                      )}

                      {/* Hourly Rates for specific services */}
                      {(formData.serviceTypes?.includes('LOA Assistance') || 
                        formData.serviceTypes?.includes('Tax Compliance (Phase 2)') || 
                        formData.serviceTypes?.includes('General Accounting Services (Phase 3)')) && (
                        <div className="md:col-span-2 space-y-4 pt-4 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-400 uppercase">Hourly Rates per Position (Role and Rate)</label>
                            <button onClick={addHourlyRate} className="text-[10px] font-bold text-[#1E2D5A] hover:underline uppercase transition-all">Add Role</button>
                          </div>
                          <div className="space-y-3">
                            {formData.hourlyRates?.map((rate, index) => (
                              <div key={index} className="flex gap-3 items-center">
                                <div className="flex-grow">
                                  <input
                                    type="text"
                                    value={rate.position}
                                    onChange={(e) => updateHourlyRate(index, 'position', e.target.value)}
                                    placeholder="Position / Role"
                                    className="w-full px-4 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm"
                                  />
                                </div>
                                <div className="w-32 relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₱</span>
                                  <input
                                    type="text"
                                    value={formatCurrencyInput(`hourlyRate_${index}`, rate.rate)}
                                    onChange={(e) => handleCurrencyChange('hourlyRates', e.target.value, `hourlyRate_${index}`)}
                                    className="w-full pl-6 pr-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm"
                                  />
                                </div>
                                <button onClick={() => removeHourlyRate(index)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            {(formData.hourlyRates || []).length === 0 && (
                              <p className="text-center py-2 text-xs text-slate-400 italic">No hourly rates added.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Document Configuration */}
                  <div className="space-y-6 pt-6 border-t border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                       <span className="w-1.5 h-4 bg-[#1E2D5A] rounded-full" />
                       Document Configuration
                    </h3>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Export Filename (Default)</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={formData.customFileName || ''}
                          onChange={(e) => handleFieldChange('customFileName', e.target.value)}
                          placeholder="COMPANY_SERVICE_MMDDYEAR"
                          className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] font-mono text-sm"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">.pdf</span>
                          {formData.customFileName && (
                            <button 
                              onClick={() => handleFieldChange('customFileName', '')}
                              className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400"
                              title="Reset to default"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400 italic">This will be the name of the exported Google Doc and PDF.</p>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-100 flex justify-end gap-3">
                    <button 
                      onClick={() => setViewMode('preview')}
                      disabled={savingForm}
                      className="px-6 py-3 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      Discard
                    </button>
                    <button 
                      onClick={handleSaveForm}
                      disabled={savingForm}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#1E2D5A] px-8 py-3 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all active:scale-95 disabled:opacity-50"
                    >
                      {savingForm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save & Re-generate
                    </button>
                  </div>
               </div>
            </div>
          ) : (
            <>
              {proposal.googleDocId && (
                <div className="mb-4 bg-slate-50 border border-slate-200/60 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 p-1.5 bg-[#1E2D5A]/5 text-[#1E2D5A] rounded-lg">
                      <AlertCircle className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-900">Google Docs View Helper</p>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-relaxed">
                        If you see an error here (such as <i>"check that the URL was entered correctly"</i>), your browser is blocking third-party session cookies or has multiple active Google Accounts.
                      </p>
                    </div>
                  </div>
                  <a
                    href={`https://docs.google.com/document/d/${proposal.googleDocId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#1E2D5A]/20 hover:border-[#1E2D5A]/40 text-[#1E2D5A] text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Google Docs
                  </a>
                </div>
              )}

              {proposal.googleDocId && (
                <iframe
                  src={viewMode === 'doc-editor'
                    ? `https://docs.google.com/document/d/${proposal.googleDocId}/edit` 
                    : `https://docs.google.com/document/d/${proposal.googleDocId}/preview`
                  }
                  width="100%"
                  height="800px"
                  frameBorder="0"
                  className={cn(
                    "w-full h-[800px]",
                    proposal.status === 'Denied' && "opacity-40 grayscale"
                  )}
                />
              )}

              {proposal.status === 'Denied' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-white/80 backdrop-blur-sm px-8 py-4 rounded-2xl border border-red-200 shadow-xl">
                        <span className="text-xl font-bold text-red-600 uppercase tracking-widest">Proposal Denied</span>
                    </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 mb-4">
                <Trash2 className="h-7 w-7 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Delete Proposal?</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                Are you sure you want to delete the proposal for <span className="font-bold text-slate-900">"{proposal.companyName}"</span>? This action cannot be undone.
              </p>
            </div>
            <div className="p-6 bg-slate-50/80 flex gap-3">
              <button 
                onClick={() => setShowDeleteModal(false)} 
                disabled={actionLoading}
                className="flex-1 px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 px-4 py-3 rounded-xl bg-red-600 text-sm font-bold text-white shadow-lg shadow-red-600/20 hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin inline mr-2"/> : null}
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Creation Modal */}
      {isCreatingTemplate && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-lg font-bold text-[#1E2D5A]">Save as Template</h2>
              <p className="text-xs text-slate-500 font-medium">Re-use these services and fees for future proposals</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Template Name</label>
                <input
                  type="text"
                  autoFocus
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Standard Audit Proposal"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all font-bold"
                />
                <p className="mt-2 text-[10px] text-slate-400 italic">This will store all selected services, rates, and fees. Client information is NOT saved.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    setIsCreatingTemplate(false);
                    setNewTemplateName('');
                  }}
                  className="flex-1 px-4 py-3 text-slate-600 font-bold text-sm hover:bg-slate-50 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveTemplate}
                  disabled={actionLoading || !newTemplateName}
                  className="flex-[2] py-3 bg-[#1E2D5A] text-white font-bold text-sm rounded-xl shadow-lg shadow-[#1E2D5A]/10 hover:bg-[#2A3C74] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Modal (Revision/Deny/Submit Review) */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
           <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                 <h3 className="text-lg font-bold text-slate-900">
                    {showModal === 'Revision Requested' ? 'Request Revision' : 
                     showModal === 'Denied' ? 'Deny Proposal' : 'Submit for Review'}
                 </h3>
                 <button onClick={() => { setShowModal(null); setSubmitNote(''); }} className="p-1 hover:bg-slate-200 rounded transition-colors"><X className="h-5 w-5 text-slate-400"/></button>
              </div>
              <div className="p-6">
                 <label className="block text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">
                    {showModal === 'Submit Review' ? 'Note to Reviewer (Optional)' : 'Feedback / Reasoning (Required)'}
                 </label>
                 <textarea
                    value={showModal === 'Submit Review' ? submitNote : notes}
                    onChange={(e) => showModal === 'Submit Review' ? setSubmitNote(e.target.value) : setNotes(e.target.value)}
                    placeholder={showModal === 'Submit Review' ? "e.g., I've addressed the requested changes..." : "Provide specific feedback or reasons..."}
                    rows={5}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] resize-none font-medium"
                    autoFocus
                 />
              </div>
              <div className="p-6 bg-slate-50/50 flex gap-3">
                 <button onClick={() => { setShowModal(null); setSubmitNote(''); }} className="flex-1 px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                 <button 
                    onClick={() => {
                      if (showModal === 'Submit Review') {
                        handleStatusUpdate('Pending Review', submitNote);
                        setSubmitNote('');
                      } else {
                        handleStatusUpdate(showModal, notes);
                      }
                    }}
                    disabled={(showModal !== 'Submit Review' && !notes) || actionLoading}
                    className={cn(
                        "flex-1 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-lg transition-all active:scale-95 disabled:opacity-50",
                        showModal === 'Denied' ? "bg-red-600 shadow-red-600/20" : "bg-[#1E2D5A] shadow-[#1E2D5A]/20"
                    )}
                >
                    {actionLoading && <Loader2 className="h-4 w-4 animate-spin inline mr-2"/>}
                    Confirm {showModal === 'Submit Review' ? 'Submission' : showModal}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Send Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 my-8 animate-in zoom-in-95 duration-200">
             <div className="px-6 py-4 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
               <div className="flex items-center gap-3">
                 <div className="bg-[#1E2D5A] p-2 rounded-lg">
                   <Mail className="h-5 w-5 text-white" />
                 </div>
                 <h3 className="text-lg font-bold text-slate-900">Send Proposal to Client</h3>
               </div>
               <button onClick={() => setShowEmailModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                 <X className="h-5 w-5 text-slate-400" />
               </button>
             </div>
             
             <div className="p-6 space-y-4">
               <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Sender</label>
                 <input
                   type="text"
                   disabled
                   value={profile?.email || user?.email || ''}
                   className="w-full px-4 py-3 bg-slate-100 rounded-xl border border-slate-200 text-slate-500 font-medium cursor-not-allowed"
                 />
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">To</label>
                   <input
                     type="email"
                     value={emailTo}
                     onChange={(e) => setEmailTo(e.target.value)}
                     className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                   />
                 </div>
                 <div>
                   <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">CC (Optional)</label>
                   <input
                     type="email"
                     value={emailCC}
                     onChange={(e) => setEmailCC(e.target.value)}
                     className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                   />
                 </div>
               </div>
               
               <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Subject</label>
                 <input
                   type="text"
                   value={emailSubject}
                   onChange={(e) => setEmailSubject(e.target.value)}
                   className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium"
                 />
               </div>

               <div className="relative">
                 <div className="flex items-center justify-between mb-2 px-1">
                   <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Message Body</label>
                   <div className="relative">
                     <button 
                       onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                       className="text-[10px] font-black text-[#1E2D5A] uppercase tracking-widest flex items-center gap-1 hover:underline underline-offset-4"
                     >
                       <Plus className="h-3 w-3" />
                       Insert Template
                       <ChevronDown className={cn("h-3 w-3 transition-transform", showTemplatePicker && "rotate-180")} />
                     </button>
                     
                     {showTemplatePicker && (
                       <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-[110] max-h-60 overflow-y-auto">
                         {templates.length > 0 ? (
                           templates.map((t) => (
                             <button
                               key={t.id}
                               onClick={() => applyTemplate(t)}
                               className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors"
                             >
                               <p className="text-sm font-bold text-slate-900">{t.name}</p>
                               <p className="text-[10px] text-slate-400 line-clamp-1">{t.subject}</p>
                             </button>
                           ))
                         ) : (
                           <div className="px-4 py-6 text-center">
                             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">No templates saved</p>
                             <Link to="/settings" className="text-xs font-bold text-[#1E2D5A] underline">Add Template</Link>
                           </div>
                         )}
                       </div>
                     )}
                   </div>
                 </div>
                 <textarea
                   value={emailMessage}
                   onChange={(e) => setEmailMessage(e.target.value)}
                   rows={8}
                   className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] transition-all font-medium resize-none text-sm"
                 />
               </div>

               <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <FileText className="h-5 w-5 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{proposal.customFileName ? `${proposal.customFileName}.pdf` : 'proposal.pdf'}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Auto-attached Document</p>
                    </div>
                 </div>
                 <Paperclip className="h-4 w-4 text-slate-300" />
               </div>
             </div>

             <div className="px-6 py-6 border-t border-slate-50 bg-slate-50/50 flex gap-4">
               <button 
                 onClick={() => setShowEmailModal(false)} 
                 className="flex-1 px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
               >
                 Cancel
               </button>
               <button 
                 onClick={handleSendEmail}
                 disabled={actionLoading || !emailTo || !emailSubject || !emailMessage}
                 className="flex-[2] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E2D5A] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 hover:bg-[#2A3C74] transition-all active:scale-95 disabled:opacity-50"
               >
                 {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                 Send Email
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
