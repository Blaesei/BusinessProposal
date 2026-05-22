//
// File: types.ts
// Author: Quinn Harvey Pineda
// Date: 2026-05-19
// Purpose: Defines data models, interfaces and types used throughout the application.
//

export type UserRole = 'normal' | 'staff' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  createdAt: any;
}

export type ProposalStatus = 'Draft' | 'Pending Review' | 'Approved' | 'Denied' | 'Revision Requested' | 'Sent';

export interface MessageTemplate {
  id?: string;
  name: string;
  subject: string;
  body: string;
  recipientEmail?: string;
  createdAt: any;
  updatedAt: any;
}

export interface PeriodCover {
  from: string;
  to: string;
  type: string;
}

export interface HourlyRate {
  position: string;
  rate: number;
}

export interface AfsFeeRow {
  fee: string;
  description: string;
  amount: number | null;
}

export interface Proposal {
  id?: string;
  companyName: string;
  address: string;
  email: string;
  title?: string;
  contactPerson: string;
  position: string;
  serviceTypes: string[];
  feeType: string;
  feeAmount: number | null;
  feeNotes: string;
  hourlyRates?: HourlyRate[];
  monthlyTaxRetainerFee?: number | null;
  periodCover: PeriodCover | null;
  loaStartDate?: string;
  loaEndDate?: string;
  acceptanceFee?: number | null;
  timeBasedFee?: number | null;
  successFee?: number | null;
  afsProposalSuffix?: string;
  yearEndYear?: string;
  yearEndDate?: string;
  feeTotal?: number | null;
  forensicFixedFee?: number | null;
  afsFeeTable?: AfsFeeRow[];
  status: ProposalStatus;
  reviewerNotes: string;
  googleDocUrl: string;
  googleDocId: string;
  customFileName?: string;
  createdBy: string;
  createdByName: string;
  creatorPhotoURL?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Notification {
  id?: string;
  userId: string; // The person who should see the notification (e.g. the creator of the proposal)
  type: 'status_change' | 'comment';
  proposalId: string;
  proposalName: string;
  status: ProposalStatus;
  message: string;
  read: boolean;
  createdAt: any;
}
