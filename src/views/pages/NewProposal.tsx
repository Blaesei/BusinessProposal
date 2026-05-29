//
// File: NewProposal.tsx
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: View for creating or editing a proposal with step-by-step logic.
//

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getGDriveFolders } from '../../config/constants';
import { ExternalLink, ChevronLeft, Save, Send, Eye, Loader2, Check, Plus, Trash2, Edit } from 'lucide-react';

import { db, handleFirestoreError, OperationType } from '../../services/firebase';
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { useAuth } from '../../App';
import { Proposal, ProposalStatus } from '../../models/types';
import Navbar from '../components/Navbar';
import { cn } from '../../utils/utils';
import { format } from 'date-fns';
import { notifyAdmins } from '../../services/notifications';

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

export default function NewProposal() {
  const { profile, user, isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);
  const [timer, setTimer] = useState<number | null>(null);
  const [fetching, setFetching] = useState(!!id);
  const [currencyInputs, setCurrencyInputs] = useState<Record<string, string>>({});
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  const lastCalculatedFileName = useRef('');

  const [formData, setFormData] = useState<Partial<Proposal>>({
    companyName: '',
    address: '',
    email: '',
    title: 'Mr.',
    contactPerson: '',
    position: '',
    serviceTypes: [],
    feeType: 'Monthly Retainer',
    feeAmount: null,
    feeNotes: '',
    hourlyRates: [],
    monthlyTaxRetainerFee: null,
    periodCover: { from: '', to: '', type: '' },
    loaStartDate: '',
    loaEndDate: '',
    acceptanceFee: null,
    timeBasedFee: null,
    successFee: null,
    afsProposalSuffix: '',
    yearEndYear: '',
    yearEndDate: '',
    feeTotal: null,
    forensicFixedFee: 200000,
    afsFeeTable: [
      { fee: 'Fee', description: 'Initial Fee upon signing of the proposal', amount: 50000 },
      { fee: 'Fee', description: 'Upon finalization of the AFS and submission of ITR', amount: 50000 },
    ],
    status: 'Draft',
    reviewerNotes: '',
    googleDocUrl: '',
    googleDocId: '',
    customFileName: '',
  });

  const isClientInfoFilled = Boolean(formData.companyName && formData.address && formData.email && formData.contactPerson && formData.position);

  // Load available templates
  useEffect(() => {
    if (!user) return;
    
    // We query the whole collection of proposalTemplates. 
    // If the user is staff or admin, they will get all templates.
    // If they are a normal user, Firestore rules will only allow them to read templates where createdBy == user.uid,
    // so we should restrict the query to createdBy == user.uid if the user is normal to avoid permission denied.
    const isPowerUser = isAdmin || isStaff;
    const q = isPowerUser
      ? query(collection(db, 'proposalTemplates'))
      : query(collection(db, 'proposalTemplates'), where('createdBy', '==', user.uid));
      
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort on client side to avoid needing composite index setup in Firestore
      list.sort((a: any, b: any) => {
        const timeA = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        return timeB - timeA;
      });
      setAvailableTemplates(list);
    }, (err) => {
      console.error('[ERROR] Failed to load proposal templates in NewProposal (global query):', err);
      // Fallback: try loading just personal if the global query failed
      const personalQuery = query(collection(db, 'proposalTemplates'), where('createdBy', '==', user.uid));
      onSnapshot(personalQuery, (personalSnap) => {
        const list = personalSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => {
          const timeA = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
          const timeB = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
          return timeB - timeA;
        });
        setAvailableTemplates(list);
      }, (err2) => {
        handleFirestoreError(err2, OperationType.LIST, 'proposalTemplates');
      });
    });
    return unsub;
  }, [user, isAdmin, isStaff]);

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

   useEffect(() => {
    if (id) {
       const loadProposal = async () => {
         const snap = await getDoc(doc(db, 'proposals', id));
         if (snap.exists()) {
           const data = snap.data() as Proposal;
           
           // Permission Check: Staff cannot edit if status is Pending Review, Approved, or Sent
           // Only Admins can edit anytime.
           const isPendingOrTerminal = ['Pending Review', 'Approved', 'Sent'].includes(data.status);

           if (!isAdmin && isPendingOrTerminal) {
              alert('You do not have permission to edit this proposal in its current status.');
              navigate(`/proposal/${id}`);
              return;
           }

           setFormData(data);
           // Initialize currency strings
           setCurrencyInputs({
             feeAmount: data.feeAmount?.toString() || '',
             monthlyTaxRetainerFee: data.monthlyTaxRetainerFee?.toString() || '',
             acceptanceFee: data.acceptanceFee?.toString() || '',
             timeBasedFee: data.timeBasedFee?.toString() || '',
             successFee: data.successFee?.toString() || '',
             feeTotal: data.feeTotal?.toString() || '',
             forensicFixedFee: data.forensicFixedFee?.toString() || '200000',
             ...Object.fromEntries(data.hourlyRates?.map((r, i) => [`hourlyRate_${i}`, r.rate.toString()]) || []),
             ...Object.fromEntries(data.afsFeeTable?.map((r, i) => [`afsFee_${i}`, r.amount?.toString() || '']) || [])
           });
         }
         setFetching(false);
       };
       loadProposal();
    }
  }, [id, user, profile, navigate]);

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
      // If selecting a Group A item, it's exclusive
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
      // If selecting a Group B item, remove any Group A
      newServices = newServices.filter(s => !GROUP_A.includes(s));
      newFeeType = 'Monthly Retainer';
      
      if (newServices.includes(service)) {
        newServices = newServices.filter(s => s !== service);
        // Auto-deselect the other if they are linked
        if (service === 'Tax Compliance (Phase 2)') {
          newServices = newServices.filter(s => s !== 'General Accounting Services (Phase 3)');
        }
        if (service === 'General Accounting Services (Phase 3)') {
          newServices = newServices.filter(s => s !== 'Tax Compliance (Phase 2)');
        }
      } else {
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

        // Auto-select the other if they are linked
        if (service === 'Tax Compliance (Phase 2)') {
          if (!newServices.includes('General Accounting Services (Phase 3)')) {
            newServices.push('General Accounting Services (Phase 3)');
          }
        }
        if (service === 'General Accounting Services (Phase 3)') {
          if (!newServices.includes('Tax Compliance (Phase 2)')) {
            newServices.push('Tax Compliance (Phase 2)');
          }
        }
        
        // Sort Group B services by phase order
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

  const getServiceDescription = () => {
    if (!formData.serviceTypes?.length) return '';
    return formData.serviceTypes.join(', ');
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName) {
      alert('Please enter a template name.');
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'proposalTemplates'), {
        name: newTemplateName,
        data: {
          ...formData,
          // Don't save transient/doc fields in template
          googleDocId: '',
          googleDocUrl: '',
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
      setLoading(false);
    }
  };

  const handleLoadTemplate = (tpl: any) => {
    const data = tpl.data;
    setFormData(prev => ({
      ...prev,
      ...data,
      // Load template client info if present, otherwise keep what's already typed
      companyName: data.companyName || prev.companyName,
      address: data.address || prev.address,
      email: data.email || prev.email,
      contactPerson: data.contactPerson || prev.contactPerson,
      position: data.position || prev.position,
      title: data.title || prev.title,
    }));
    
    // Re-initialize currency inputs cleanly
    setCurrencyInputs({
      feeAmount: data.feeAmount?.toString() || '',
      monthlyTaxRetainerFee: data.monthlyTaxRetainerFee?.toString() || '',
      acceptanceFee: data.acceptanceFee?.toString() || '',
      timeBasedFee: data.timeBasedFee?.toString() || '',
      successFee: data.successFee?.toString() || '',
      feeTotal: data.feeTotal?.toString() || '',
      forensicFixedFee: data.forensicFixedFee?.toString() || '',
      ...Object.fromEntries(data.hourlyRates?.map((r: any, i: number) => [`hourlyRate_${i}`, r.rate?.toString() || '']) || []),
      ...Object.fromEntries(data.afsFeeTable?.map((r: any, i: number) => [`afsFee_${i}`, r.amount?.toString() || '']) || [])
    });
  };

  const formatCurrencyInput = (field: string, numericValue: number | null) => {
    const raw = currencyInputs[field];
    if (raw === undefined || raw === null || raw === '') {
      return numericValue !== null ? numericValue.toLocaleString('en-US') : '';
    }
    
    // If user is typing, try to format with commas but preserve decimals
    const parts = raw.split('.');
    const whole = parts[0].replace(/,/g, '');
    let formattedWhole = '';
    
    if (whole !== '') {
      const parsed = parseInt(whole);
      formattedWhole = isNaN(parsed) ? '' : parsed.toLocaleString('en-US');
      // If user typed '0', ensure it stays '0'
      if (whole === '0') formattedWhole = '0';
    }
    
    if (parts.length > 1) {
      return `${formattedWhole}.${parts[1].substring(0, 2)}`;
    }
    return formattedWhole;
  };

  const handleCurrencyChange = (field: keyof Proposal, inputValue: string, key?: string) => {
    const stateKey = key || (field as string);
    // Remove everything except numbers and dot
    const cleanValue = inputValue.replace(/[^0-9.]/g, '');
    
    // Prevent multiple dots
    const dots = cleanValue.split('.').length - 1;
    if (dots > 1) return;

    setCurrencyInputs(prev => ({ ...prev, [stateKey]: cleanValue }));
    
    const numValue = cleanValue === '' || cleanValue === '.' ? null : parseFloat(cleanValue);
    
    if (field === 'afsFeeTable' && key) {
      const index = parseInt(key.split('_')[1]);
      const newTable = [...(formData.afsFeeTable || [])];
      newTable[index] = { ...newTable[index], amount: numValue };
      setFormData(prev => ({ ...prev, afsFeeTable: newTable }));
    } else if (field === 'hourlyRates' && key) {
      const index = parseInt(key.split('_')[1]);
      updateHourlyRate(index, 'rate', numValue || 0);
    } else {
      handleFieldChange(field, numValue);
    }
  };

  const updateAfsFeeRow = (index: number, field: 'fee' | 'description' | 'amount', value: any) => {
    const newTable = [...(formData.afsFeeTable || [])];
    newTable[index] = { ...newTable[index], [field]: value };
    setFormData(prev => ({ ...prev, afsFeeTable: newTable }));
  };

  const addAfsFeeRow = () => {
    setFormData(prev => ({
      ...prev,
      afsFeeTable: [...(prev.afsFeeTable || []), { fee: 'Fee', description: '', amount: 0 }]
    }));
  };

  const removeAfsFeeRow = (index: number) => {
    setFormData(prev => ({
      ...prev,
      afsFeeTable: (prev.afsFeeTable || []).filter((_, i) => i !== index)
    }));
  };

  const handleSave = async (status: ProposalStatus) => {
    if (!user) {
      alert('You must be logged in to save proposals.');
      return;
    }
    if (!profile) {
      alert('Your profile is still loading. Please wait a moment and try again.');
      return;
    }
    if (!formData.companyName) {
      alert('Please enter a Company Name before saving.');
      return;
    }
    setLoading(true);

    try {
      console.log('Initiating save for:', formData.companyName, 'Status:', status);

      const formatDateForDoc = (dateStr: string) => {
        if (!dateStr) return '';
        if (!dateStr.includes('-')) return dateStr; // already formatted or text
        try {
          // Use UTC-friendly parsing to avoid off-by-one errors with YYYY-MM-DD
          const [year, month, day] = dateStr.split('-').map(Number);
          return format(new Date(year, month - 1, day), 'MMMM d, yyyy');
        } catch (e) {
          return dateStr;
        }
      };

      // Prepare template name for API
      let templateName = '';
      const services = formData.serviceTypes || [];
      if (services.includes('LOA Assistance')) templateName = 'LOA Assistance';
      else if (services.includes('Audited Financial Statement')) templateName = 'Audited Financial Statement';
      else if (services.includes('Forensic Audit')) templateName = 'Forensic Audit';
      else if (services.length === 1 && services[0] === 'Tax Retainer (Phase 1)') templateName = 'Tax Retainer';
      else templateName = 'Tax Retainer + Tax Compliance + General Accounting';

      const fromFormatted = formatDateForDoc(formData.periodCover?.from || '');
      const toFormatted = formatDateForDoc(formData.periodCover?.to || '');
      const periodStr = fromFormatted ? `From ${fromFormatted} to ${toFormatted} (${formData.periodCover?.type || 'Regular'})` : '';

      let googleDocId = formData.googleDocId;
      let googleDocUrl = formData.googleDocUrl;

      // Only generate if we don't already have a valid doc from a satisfied preview
      // OR if we are specifically saving as something other than Draft (to ensure freshness)
      // Actually, standardizing on always generating for non-drafts is safer.
      const shouldGenerate = !googleDocId || status !== 'Draft';

      if (shouldGenerate) {
        // Cleanup previous preview doc if it's different from what we're about to generate
        if (previewDocId && previewDocId !== googleDocId) {
          try {
            await fetch('/api/delete-doc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docId: previewDocId })
            });
          } catch (e) { console.error('Failed to cleanup preview doc:', e); }
        }

        console.log('Calling document generation API...');
        const resp = await fetch('/api/generate-proposal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            selectedServices: services, // CRITICAL: Map serviceTypes to selectedServices for backend
            date: format(new Date(), 'MMMM dd, yyyy'),
            periodCover: periodStr,
            periodFrom: fromFormatted,
            periodTo: toFormatted,
            loaStartDate: formatDateForDoc(formData.loaStartDate || ''),
            loaEndDate: formatDateForDoc(formData.loaEndDate || ''),
            serviceDescription: getServiceDescription(),
            templateName
          })
        });

        let result: any = {};
        if (!resp.ok) {
          let errorMsg = 'Failed to generate document';
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
        googleDocId = result.docId;
        googleDocUrl = result.docUrl;
        console.log('Document generated successfully:', googleDocId);
      }

      const finalData: any = {
        ...formData,
        status,
        googleDocUrl: googleDocUrl,
        googleDocId: googleDocId,
        createdBy: formData.createdBy || user.uid,
        createdByName: formData.createdByName || profile.displayName || 'Unknown User',
        creatorPhotoURL: formData.creatorPhotoURL || profile.photoURL || '',
        updatedAt: serverTimestamp(),
      };

      // If moving from Draft to Pending Review, refresh createdAt to reflect submission time
      if (id && status === 'Pending Review' && formData.status === 'Draft') {
        finalData.createdAt = serverTimestamp();
      }

      let finalId = id;
      if (id) {
        try {
          console.log('Updating existing proposal doc...');
          await updateDoc(doc(db, 'proposals', id), finalData);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `proposals/${id}`);
        }
      } else {
        try {
          console.log('Creating new proposal doc in Firestore...');
          const docRef = await addDoc(collection(db, 'proposals'), {
            ...finalData,
            createdAt: serverTimestamp(),
          });
          finalId = docRef.id;
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'proposals');
        }
      }

      // Notify admins if submitted for review
      if (status === 'Pending Review' && finalId) {
        await notifyAdmins(
          `${profile?.displayName || 'Someone'} submitted a new proposal for ${formData.companyName}`,
          finalId,
          formData.companyName!,
          'new_proposal'
        );
      }

      console.log('Proposal saved successfully.');
      navigate('/');
    } catch (error: any) {
      console.error('Error in handleSave:', error);
      alert('Operation failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (timer !== null && timer > 0) {
      interval = setInterval(() => {
        setTimer(t => (t !== null ? t - 1 : null));
      }, 1000);
    } else if (timer === 0) {
      handleCancelPreview();
    }
    return () => clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    const handleUnload = () => {
      if (previewDocId) {
        // use sendBeacon for reliable cleanup on unload
        const data = JSON.stringify({ docId: previewDocId });
        navigator.sendBeacon('/api/delete-doc', new Blob([data], { type: 'application/json' }));
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [previewDocId]);

  const handleCancelPreview = async () => {
    if (previewDocId) {
      try {
        await fetch('/api/delete-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: previewDocId })
        });
      } catch (err) {
        console.error('Failed to delete temporary doc:', err);
      }
    }
    setIsPreviewMode(false);
    setIsEditMode(false);
    setPreviewDocId(null);
    setPreviewDocUrl(null);
    setTimer(null);
    setPreviewing(false);
  };

  const handleSatisfied = () => {
    setIsPreviewMode(false);
    setIsEditMode(false);
    setTimer(null);
    // Keep the previewDocId/Url in formData for the final save
    setFormData(prev => ({
      ...prev,
      googleDocId: previewDocId || prev.googleDocId,
      googleDocUrl: previewDocUrl || prev.googleDocUrl
    }));
  };

  const handlePreview = async () => {
    if (!formData.companyName) {
      alert('Please enter a Company Name before previewing.');
      return;
    }
    setPreviewing(true);
    
    // Aggressive cleanup: delete previous preview doc if it exists before generating a new one
    if (previewDocId) {
      try {
        await fetch('/api/delete-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: previewDocId })
        });
        console.log('Cleaned up previous preview doc:', previewDocId);
      } catch (e) {
        console.error('Failed to pre-cleanup doc:', e);
      }
    }

    try {
      console.log('Initiating preview...');
      const formatDateForDoc = (dateStr: string) => {
        if (!dateStr) return '';
        if (!dateStr.includes('-')) return dateStr;
        try {
          const [year, month, day] = dateStr.split('-').map(Number);
          return format(new Date(year, month - 1, day), 'MMMM d, yyyy');
        } catch (e) {
          return dateStr;
        }
      };

      let templateName = '';
      const services = formData.serviceTypes || [];
      if (services.includes('LOA Assistance')) templateName = 'LOA Assistance';
      else if (services.includes('Audited Financial Statement')) templateName = 'Audited Financial Statement';
      else if (services.includes('Forensic Audit')) templateName = 'Forensic Audit';
      else if (services.length === 1 && services[0] === 'Tax Retainer (Phase 1)') templateName = 'Tax Retainer';
      else templateName = 'Tax Retainer + Tax Compliance + General Accounting';

      const fromFormatted = formatDateForDoc(formData.periodCover?.from || '');
      const toFormatted = formatDateForDoc(formData.periodCover?.to || '');
      const periodStr = fromFormatted ? `From ${fromFormatted} to ${toFormatted} (${formData.periodCover?.type || 'Regular'})` : '';

      const resp = await fetch('/api/generate-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          selectedServices: services, // CRITICAL: Map serviceTypes to selectedServices
          date: format(new Date(), 'MMMM dd, yyyy'),
          periodCover: periodStr,
          periodFrom: fromFormatted,
          periodTo: toFormatted,
          loaStartDate: formatDateForDoc(formData.loaStartDate || ''),
          loaEndDate: formatDateForDoc(formData.loaEndDate || ''),
          serviceDescription: getServiceDescription(),
          templateName
        })
      });

      let result: any = {};
      if (!resp.ok) {
        let errorMsg = 'Failed to generate document for preview';
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

      setPreviewDocId(result.docId);
      setPreviewDocUrl(result.docUrl);
      setIsPreviewMode(true);
      setTimer(300); // 5 minutes auto-delete
    } catch (error: any) {
      console.error('Error in handlePreview:', error);
      alert('Preview failed: ' + error.message);
    } finally {
      setPreviewing(false);
    }
  };

  if (fetching) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Loader2 className="h-12 w-12 animate-spin text-[#1E2D5A]" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <Navbar />

      {/* Sticky Preview Header */}
      {isPreviewMode && (
        <div className="sticky top-16 z-[30] bg-[#1E2D5A] text-white px-6 py-3 flex items-center justify-between shadow-xl animate-in slide-in-from-top duration-500">
          <div className="flex items-center gap-4">
            <div className="bg-amber-400 text-[#1E2D5A] font-bold px-3 py-1 rounded-full text-[10px] uppercase tracking-wider animate-pulse">
               Preview Mode
            </div>
            <p className="text-sm font-medium">Review your generated proposal below. Please click Satisfied to confirm.</p>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-right border-r border-white/20 pr-6">
              <p className="text-[10px] text-white/60 font-bold uppercase tracking-widest">Auto-cancels in</p>
              <p className={cn(
                "text-lg font-mono font-black",
                (timer || 0) < 60 ? "text-amber-400" : "text-white"
              )}>
                {Math.floor((timer || 0) / 60)}:{((timer || 0) % 60).toString().padStart(2, '0')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {getGDriveFolders(formData.serviceTypes).map((folder, idx) => (
                <a 
                  key={idx}
                  href={folder.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all text-xs font-bold flex items-center gap-2"
                  title={`Open ${folder.name} Folder`}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="hidden lg:inline">{folder.name}</span>
                </a>
              ))}
              <div className="h-8 w-px bg-white/20 mx-1 hidden sm:block" />
              <button 
                onClick={() => setIsEditMode(!isEditMode)}
                className={cn(
                  "px-4 py-2 rounded-lg font-bold transition-all text-sm flex items-center gap-2 outline-none focus:ring-2 focus:ring-amber-400/50",
                  isEditMode 
                    ? "bg-amber-400 text-[#1E2D5A] shadow-lg shadow-amber-400/20" 
                    : "bg-white/10 text-white hover:bg-white/20"
                )}
              >
                {isEditMode ? (
                  <>
                    <Eye className="h-4 w-4" />
                    Back to Preview
                  </>
                ) : (
                  <>
                    <Edit className="h-4 w-4" />
                    Edit Content
                  </>
                )}
              </button>
              <div className="h-8 w-px bg-white/20 mx-1 hidden sm:block" />
              <button 
                onClick={handleCancelPreview}
                className="px-4 py-2 rounded-lg text-white/70 font-bold hover:text-white hover:bg-white/10 transition-all text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={handleSatisfied}
                className="px-6 py-2 rounded-lg bg-white text-[#1E2D5A] font-bold shadow-lg hover:bg-slate-100 transition-all text-sm active:scale-95"
              >
                Satisfied
              </button>
            </div>
          </div>
        </div>
      )}
      
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-4 mb-8 justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
              <ChevronLeft className="h-6 w-6 text-slate-900" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{id ? 'Edit Proposal' : 'New Proposal'}</h1>
              <p className="text-sm text-slate-500">Fill in the details below to create a professional proposal</p>
            </div>
          </div>

          {availableTemplates.length > 0 && !id && (
            <div className="relative group">
              <select 
                value={selectedTemplateId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTemplateId(val);
                  if (val) {
                    const tpl = availableTemplates.find(t => t.id === val);
                    if (tpl) handleLoadTemplate(tpl);
                  }
                  // Reset back to blank option after load
                  setTimeout(() => setSelectedTemplateId(''), 100);
                }}
                className="appearance-none bg-white border border-slate-200 px-4 py-2 pr-10 rounded-xl text-sm font-bold text-[#1E2D5A] focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 shadow-sm transition-all cursor-pointer"
              >
                <option value="">Load Template...</option>
                {availableTemplates.map(tpl => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#1E2D5A]">
                <Plus className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Section: Client Information */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">Client Information</h2>
              {isClientInfoFilled && !isCreatingTemplate && (
                <button 
                  onClick={() => setIsCreatingTemplate(true)}
                  className="text-xs font-bold text-[#1E2D5A] flex items-center gap-1 hover:bg-white px-2 py-1 rounded transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Save Template
                </button>
              )}
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Company Name</label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => handleFieldChange('companyName', e.target.value)}
                  placeholder="Enter business name"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleFieldChange('address', e.target.value)}
                  placeholder="Full business address"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  placeholder="client@company.com"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Contact Person</label>
                <div className="flex gap-2">
                  <select
                    value={formData.title}
                    onChange={(e) => handleFieldChange('title', e.target.value)}
                    className="w-24 px-3 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                  >
                    <option>Mr.</option>
                    <option>Ms.</option>
                    <option>Mrs.</option>
                    <option>Miss.</option>
                    <option>Mx.</option>
                    <option>Atty.</option>
                    <option>Dr.</option>
                    <option>Engr.</option>
                    <option>CPA.</option>
                  </select>
                  <input
                    type="text"
                    value={formData.contactPerson}
                    onChange={(e) => handleFieldChange('contactPerson', e.target.value)}
                    placeholder="Full name"
                    className="flex-grow px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Position</label>
                <input
                  type="text"
                  value={formData.position}
                  onChange={(e) => handleFieldChange('position', e.target.value)}
                  placeholder="e.g. Chief Finance Officer"
                  className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E2D5A]/10 focus:border-[#1E2D5A] transition-all"
                />
              </div>
            </div>
          </section>

          {/* Section: Service Details */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">Service Details</h2>
            </div>
            <div className="p-6">
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-[#1E2D5A] rounded-full" />
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Group A: Individual Services</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {GROUP_A.map(service => {
                    const isSelected = formData.serviceTypes?.includes(service);
                    return (
                      <button
                        key={service}
                        onClick={() => toggleService(service, true)}
                        className={cn(
                          "flex flex-col p-4 rounded-xl border text-left transition-all relative overflow-hidden",
                          isSelected 
                            ? "bg-[#1E2D5A] border-[#1E2D5A] ring-2 ring-[#1E2D5A] shadow-lg shadow-[#1E2D5A]/20" 
                            : "bg-slate-50 border-slate-200 hover:border-[#1E2D5A]/30"
                        )}
                      >
                        <div className={cn(
                          "absolute top-2 right-2 h-4 w-4 rounded-full border flex items-center justify-center transition-colors",
                          isSelected ? "bg-white border-white" : "border-slate-300 bg-white"
                        )}>
                          {isSelected && <div className="h-2 w-2 rounded-full bg-[#1E2D5A]" />}
                        </div>
                        <span className={cn(
                          "text-sm font-bold pr-6",
                          isSelected ? "text-white" : "text-slate-700"
                        )}>{service}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-8 bg-[#1E2D5A] rounded-full" />
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Group B: Combinable Services</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {GROUP_B.map(service => {
                    const isSelected = formData.serviceTypes?.includes(service);
                    return (
                      <button
                        key={service}
                        onClick={() => toggleService(service, false)}
                        className={cn(
                          "flex flex-col p-4 rounded-xl border text-left transition-all relative",
                          isSelected 
                            ? "bg-[#1E2D5A] border-[#1E2D5A] ring-2 ring-[#1E2D5A] shadow-lg shadow-[#1E2D5A]/20" 
                            : "bg-slate-50 border-slate-200 hover:border-[#1E2D5A]/30"
                        )}
                      >
                        <div className={cn(
                          "absolute top-3 right-3 h-5 w-5 rounded border flex items-center justify-center",
                          isSelected ? "bg-white border-white" : "border-slate-300 bg-white"
                        )}>
                          {isSelected && <Check className="h-4 w-4 text-[#1E2D5A]" />}
                        </div>
                        <span className={cn(
                          "text-sm font-bold pr-6",
                          isSelected ? "text-white" : "text-slate-700"
                        )}>{service}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Section: Fee Arrangement */}
          {(formData.serviceTypes?.some(s => GROUP_B.includes(s)) || 
            formData.serviceTypes?.includes('Forensic Audit') || 
            formData.serviceTypes?.includes('LOA Assistance')) && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">Fee Arrangement</h2>
              </div>
              <div className="p-6 space-y-6">
                {formData.serviceTypes?.includes('Forensic Audit') && (
                  <div>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

                    {/* Phase 2/3 Fee (if Phase 1 not selected, or just show it separately if needed) */}
                    {/* Actually, Phase 1 already covers monthlyTaxRetainerFee. If only Phase 2/3 are selected: */}
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
                  </div>
                )}
                {/* Hourly Rates for specific services */}
                {(formData.serviceTypes?.includes('LOA Assistance') || 
                  formData.serviceTypes?.includes('Tax Compliance (Phase 2)') || 
                  formData.serviceTypes?.includes('General Accounting Services (Phase 3)')) && (
                  <div className="md:col-span-2 space-y-4 pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between px-1">
                      <label className="block text-xs font-bold text-slate-400 uppercase">Hourly Rates per Position (Role and Rate)</label>
                      <button 
                        onClick={addHourlyRate}
                        className="text-[10px] font-black text-[#1E2D5A] uppercase tracking-widest flex items-center gap-1 hover:bg-slate-50 px-2 py-1 rounded"
                      >
                        <Plus className="h-3 w-3" />
                        Add Role
                      </button>
                    </div>
                    <div className="space-y-3">
                      {formData.hourlyRates?.map((rate, index) => (
                        <div key={index} className="flex gap-3 items-start animate-in fade-in slide-in-from-left-4 duration-200">
                          <div className="flex-grow">
                            <input
                              type="text"
                              value={rate.position}
                              onChange={(e) => updateHourlyRate(index, 'position', e.target.value)}
                              placeholder="Position / Role"
                              className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-medium"
                            />
                          </div>
                          <div className="w-36 relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">₱</span>
                            <input
                              type="text"
                              value={formatCurrencyInput(`hourlyRate_${index}`, rate.rate)}
                              onChange={(e) => handleCurrencyChange('hourlyRates', e.target.value, `hourlyRate_${index}`)}
                              className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-medium"
                            />
                          </div>
                          <button 
                            onClick={() => removeHourlyRate(index)}
                            className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      ))}
                      {(formData.hourlyRates || []).length === 0 && (
                        <p className="text-center py-4 text-xs text-slate-400 italic">No hourly rates added. Click "Add Role" to add standard rates.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Section: Period Cover (Conditional for LOA) */}
          {formData.serviceTypes?.includes('LOA Assistance') && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
               <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">LOA Audit Period</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Starting Date</label>
                  <input
                    type="date"
                    value={formData.loaStartDate || ''}
                    onChange={(e) => handleFieldChange('loaStartDate', e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">End Date</label>
                  <input
                    type="date"
                    value={formData.loaEndDate || ''}
                    onChange={(e) => handleFieldChange('loaEndDate', e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Section: LOA Specific Fees */}
          {formData.serviceTypes?.includes('LOA Assistance') && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">LOA Fee Arrangement</h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Acceptance Fee</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                      <input
                        type="text"
                        value={formatCurrencyInput('acceptanceFee', formData.acceptanceFee ?? null)}
                        onChange={(e) => handleCurrencyChange('acceptanceFee', e.target.value)}
                        placeholder="50,000.00"
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
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
                        placeholder="100,000.00"
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
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
                        placeholder="300,000.00"
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section: AFS Specific Details */}
          {formData.serviceTypes?.includes('Audited Financial Statement') && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
               <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">AFS Proposal Details</h2>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Proposal Type Suffix</label>
                  <input
                    type="text"
                    value={formData.afsProposalSuffix || ''}
                    onChange={(e) => handleFieldChange('afsProposalSuffix', e.target.value)}
                    placeholder="e.g. YEAR ENDING DECEMBER 31, 2025"
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">This text appears after the main proposal title.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Year End Year</label>
                    <input
                      type="text"
                      value={formData.yearEndYear || ''}
                      onChange={(e) => handleFieldChange('yearEndYear', e.target.value)}
                      placeholder="e.g. year ending 2026"
                      className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Year End Date</label>
                    <input
                      type="text"
                      value={formData.yearEndDate || ''}
                      onChange={(e) => handleFieldChange('yearEndDate', e.target.value)}
                      placeholder="e.g. December 31, 2026"
                      className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Total AFS Fee</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                    <input
                      type="text"
                      value={formatCurrencyInput('feeTotal', formData.feeTotal ?? null)}
                      onChange={(e) => handleCurrencyChange('feeTotal', e.target.value)}
                      placeholder="e.g. 100,000.00"
                      className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] font-bold"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">Will be converted to words: e.g. "ONE HUNDRED THOUSAND PESOS (P100,000.00)"</p>
                </div>

                {/* AFS Fee Table Editor */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Fee Installment Table</label>
                    <button 
                      onClick={addAfsFeeRow}
                      className="text-[10px] font-black text-[#1E2D5A] uppercase tracking-widest flex items-center gap-1 hover:bg-slate-50 px-2 py-1 rounded"
                    >
                      <Plus className="h-3 w-3" />
                      Add row
                    </button>
                  </div>
                  <div className="space-y-3">
                    {formData.afsFeeTable?.map((row, index) => (
                      <div key={index} className="flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="w-24">
                          <input
                            type="text"
                            value={row.fee}
                            onChange={(e) => updateAfsFeeRow(index, 'fee', e.target.value)}
                            placeholder="Fee"
                            className="w-full px-3 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-medium"
                          />
                        </div>
                        <div className="flex-grow">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateAfsFeeRow(index, 'description', e.target.value)}
                            placeholder="Description"
                            className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-medium"
                          />
                        </div>
                        <div className="w-36 relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">₱</span>
                          <input
                            type="text"
                            value={formatCurrencyInput(`afsFee_${index}`, row.amount ?? null)}
                            onChange={(e) => handleCurrencyChange('afsFeeTable', e.target.value, `afsFee_${index}`)}
                            className="w-full pl-8 pr-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A] text-sm font-medium"
                          />
                        </div>
                        <button 
                          onClick={() => removeAfsFeeRow(index)}
                          className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section: Period Cover (Conditional for Combinable Services or Forensic Audit) */}
          {(formData.serviceTypes?.some(s => GROUP_B.includes(s)) || formData.serviceTypes?.includes('Forensic Audit')) && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
               <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">Period Cover</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Period From</label>
                  <input
                    type="date"
                    value={formData.periodCover?.from || ''}
                    onChange={(e) => handleFieldChange('periodCover', { ...formData.periodCover, from: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Period To</label>
                  <input
                    type="date"
                    value={formData.periodCover?.to || ''}
                    onChange={(e) => handleFieldChange('periodCover', { ...formData.periodCover, to: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-[#1E2D5A]"
                  />
                </div>
              </div>
            </section>
          )}

          {/* New Section: Template Creation and Custom Filename */}
          {(isCreatingTemplate || isClientInfoFilled) && (
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
               <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[#1E2D5A]">Document Configuration</h2>
              </div>
              <div className="p-6 space-y-6">
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
                  <p className="mt-1 text-[10px] text-slate-400 italic">This will be the name of the exported Google Doc and PDF. Default is auto-generated but you can override it.</p>
                </div>
              </div>
            </section>
          )}

          {/* Template Creation Modal */}
          {isCreatingTemplate && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
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
                      disabled={loading || !newTemplateName}
                      className="flex-[2] py-3 bg-[#1E2D5A] text-white font-bold text-sm rounded-xl shadow-lg shadow-[#1E2D5A]/10 hover:bg-[#2A3C74] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Template
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
             <button
              onClick={handlePreview}
              disabled={loading || previewing}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
            >
              {previewing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Eye className="h-5 w-5 text-slate-400" />}
              Preview Proposal
            </button>
            <button
              onClick={() => handleSave('Draft')}
              disabled={loading || previewing}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5 text-slate-400" />}
              Save as Draft
            </button>
            <button
              onClick={() => handleSave('Pending Review')}
              disabled={loading || previewing}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E2D5A] px-6 py-4 text-sm font-bold text-white shadow-lg shadow-[#1E2D5A]/20 transition-all hover:bg-[#2A3C74] active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              Submit for Review
            </button>
          </div>

          {/* Inline Preview Iframe */}
          {isPreviewMode && previewDocId && (
            <div className="mt-12 space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700" id="proposal-preview">
              <div className="flex items-center gap-3">
                <div className="h-0.5 flex-grow bg-slate-200" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Generated Document Preview</h2>
                <div className="h-0.5 flex-grow bg-slate-200" />
              </div>
              <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl shadow-slate-200/50 overflow-hidden min-h-[800px] ring-4 ring-[#1E2D5A]/5 relative">
                {isEditMode && (
                  <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2 animate-in fade-in zoom-in duration-300">
                    <a 
                      href={previewDocUrl || ''} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="bg-[#1E2D5A] text-white px-4 py-2 rounded-lg shadow-xl hover:bg-[#2A3C74] transition-all text-xs font-bold flex items-center gap-2 ring-1 ring-white/20"
                    >
                      Open in Full Editor
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                    <div className="bg-amber-400 text-[#1E2D5A] px-3 py-1.5 rounded-lg shadow-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ring-1 ring-amber-500/20">
                      <Check className="h-3 w-3" />
                      Changes saved automatically
                    </div>
                  </div>
                )}
                <div className={cn(
                  "w-full h-[800px] transition-all duration-500",
                  isEditMode ? "bg-slate-100" : "bg-white"
                )}>
                  <iframe 
                    src={isEditMode ? previewDocUrl || '' : `https://docs.google.com/document/d/${previewDocId}/preview`}
                    className="w-full h-full"
                    frameBorder="0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
