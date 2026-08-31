namespace nordwerk.treasury;

using { cuid, managed, temporal } from '@sap/cds/common';

// ─── ENUMERATIONS ────────────────────────────────────────────────────────────

type RiskLevel    : String enum { Critical; High; Medium; Low; }
type ExcStatus    : String enum { Open; InProgress; Resolved; Escalated; Closed; Cancelled; }
type DocType      : String enum { PO; Payment; CashFlow; Invoice; GoodsReceipt; Contract; }
type ActionType   : String enum { FieldCorrection; OwnerAssign; ApprovalRequest; DocumentGenerate; SAPAPICall; Comment; Attachment; Escalation; }
type ApprovalSt   : String enum { Pending; Approved; Rejected; NotRequired; }
type NotifChannel : String enum { InApp; Email; Both; }
type SeverityCode : String enum { E; W; I; } // Error Warning Info

// ─── MASTER DATA ─────────────────────────────────────────────────────────────

entity CompanyCodes {
  key code        : String(10);
      description : String(100);
      currency    : String(3) default 'GBP';
      active      : Boolean  default true;
}

entity Plants {
  key code          : String(10);
      companyCode   : Association to CompanyCodes;
      description   : String(100);
      region        : String(50);
      active        : Boolean default true;
}

entity CostCentres {
  key code        : String(20);
      plant       : Association to Plants;
      description : String(100);
      owner       : String(100);
}

entity BusinessPartners {
  key id            : String(20);
      name          : String(200);
      type          : String(20); // Customer / Supplier / Both
      country       : String(50);
      creditLimit   : Decimal(15,2);
      paymentTerms  : String(20);
      active        : Boolean default true;
      riskCategory  : String(20);
}

entity Materials {
  key code          : String(40);
      description   : String(200);
      unitOfMeasure : String(10);
      materialGroup : String(20);
      active        : Boolean default true;
}

entity Users {
  key id            : String(50);
      name          : String(200);
      email         : String(200);
      role          : String(50); // TreasuryAnalyst | TreasuryManager | CFO | Admin
      companyCode   : Association to CompanyCodes;
      active        : Boolean default true;
}

// ─── CORE EXCEPTION ──────────────────────────────────────────────────────────

entity TreasuryExceptions : cuid, managed {
  // SAP Key Fields
  companyCode       : Association to CompanyCodes;
  plant             : Association to Plants;
  storageLocation   : String(10);
  costCentre        : Association to CostCentres;
  material          : Association to Materials;
  businessPartner   : Association to BusinessPartners;
  documentId        : String(30) not null;
  documentType      : DocType   not null;
  amount            : Decimal(15,2) not null;
  currency          : String(3) default 'GBP';
  requestedDate     : Date      not null;
  dueDate           : Date;
  postingDate       : Date;

  // Status & Classification
  status            : ExcStatus  default 'Open';
  riskLevel         : RiskLevel;
  riskScore         : Decimal(5,2) default 0;
  priority          : Integer default 0;    // lower = higher priority in queue
  category          : String(50);           // e.g. MissingMasterData | ApprovalGap | DataMismatch | AgingItem
  subcategory       : String(100);

  // Ageing
  raisedAt          : Timestamp;
  agingDays         : Integer default 0;
  slaBreach         : Boolean default false;
  slaDeadline       : Timestamp;
  overdueValue      : Decimal(15,2) default 0;

  // Ownership
  owner             : Association to Users;
  assignedAt        : Timestamp;
  escalatedTo       : Association to Users;
  escalatedAt       : Timestamp;

  // Validation state
  validationPassed  : Boolean default false;
  missingFields     : String(500);          // comma-separated list
  validationErrors  : Composition of many ValidationMessages on validationErrors.exception = $self;

  // AI
  aiExplanation     : String(2000);
  aiConfidence      : Decimal(3,2);         // 0.00 – 1.00
  nextBestAction    : String(200);
  nbaCategory       : String(50);
  recurrenceCount   : Integer default 0;

  // Resolution
  resolvedBy        : Association to Users;
  resolvedAt        : Timestamp;
  resolutionNotes   : String(1000);
  approvalStatus    : ApprovalSt default 'NotRequired';
  approvedBy        : Association to Users;
  approvedAt        : Timestamp;

  // Signavio process step
  signavioStep      : String(100);
  processDeviation  : String(500);

  // Relationships
  timeline          : Composition of many TimelineEvents    on timeline.exception    = $self;
  resolutionLog     : Composition of many ResolutionActions on resolutionLog.exception = $self;
  notifications     : Composition of many Notifications     on notifications.exception = $self;
  attachments       : Composition of many Attachments       on attachments.exception   = $self;
}

// ─── VALIDATION MESSAGES ─────────────────────────────────────────────────────

entity ValidationMessages : cuid {
  exception   : Association to TreasuryExceptions;
  severity    : SeverityCode not null;
  field       : String(100);
  code        : String(30)  not null;
  message     : String(500) not null;
  suggestion  : String(500);
  resolved    : Boolean default false;
  resolvedAt  : Timestamp;
}

// ─── TIMELINE ────────────────────────────────────────────────────────────────

entity TimelineEvents : cuid {
  exception     : Association to TreasuryExceptions;
  stepName      : String(100) not null;
  sapObject     : String(100);
  sapObjectType : String(50);
  actor         : Association to Users;
  actorName     : String(200);  // denormalized for audit trail
  eventType     : String(50);   // Created|Updated|Validated|Assigned|Escalated|Resolved
  fieldChanged  : String(100);
  oldValue      : String(500);
  newValue      : String(500);
  comment       : String(1000);
  timestamp     : Timestamp not null;
  signavioRef   : String(100);
  isDeviation   : Boolean default false;
}

// ─── RESOLUTION ACTIONS ──────────────────────────────────────────────────────

entity ResolutionActions : cuid {
  exception      : Association to TreasuryExceptions;
  actionType     : ActionType not null;
  performedBy    : Association to Users;
  performedByName: String(200);
  timestamp      : Timestamp not null;
  description    : String(1000);
  fieldAffected  : String(100);
  previousValue  : String(500);
  newValue       : String(500);
  approvalStatus : ApprovalSt default 'NotRequired';
  sapPayload     : String(2000); // JSON of OData call payload
  sapResponse    : String(2000);
  success        : Boolean default true;
  errorMessage   : String(500);
  auditHash      : String(64);  // SHA-256 for immutability
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

entity Notifications : cuid {
  exception         : Association to TreasuryExceptions;
  channel           : NotifChannel;
  recipient         : Association to Users;
  recipientEmail    : String(200);
  subject           : String(200);
  body              : String(2000);
  sentAt            : Timestamp;
  thresholdBreached : String(100);
  delivered         : Boolean default false;
  readAt            : Timestamp;
}

// ─── ATTACHMENTS ─────────────────────────────────────────────────────────────

entity Attachments : cuid {
  exception    : Association to TreasuryExceptions;
  fileName     : String(200) not null;
  mimeType     : String(100);
  sizeBytes    : Integer;
  uploadedBy   : Association to Users;
  uploadedAt   : Timestamp;
  filePath     : String(500);  // stored path
  description  : String(500);
}

// ─── SLA CONFIGURATION ───────────────────────────────────────────────────────

entity SLAConfig {
  key riskLevel     : RiskLevel;
      slaHours      : Integer not null;  // hours to resolve
      escalateAfter : Integer;           // hours before auto-escalate
      notifyOwner   : Boolean default true;
      notifyManager : Boolean default false;
}

// ─── NOTIFICATION RULES ──────────────────────────────────────────────────────

entity NotificationRules {
  key id            : String(20);
      triggerEvent  : String(50);   // SLABreach | HighRisk | Escalation | Resolved
      channel       : NotifChannel;
      targetRole    : String(50);
      thresholdAmount: Decimal(15,2);
      active        : Boolean default true;
}

// ─── AUDIT LOG (append-only) ─────────────────────────────────────────────────

entity AuditLog : cuid {
  entityType  : String(50)  not null;
  entityId    : String(100) not null;
  action      : String(50)  not null;
  performedBy : String(100);
  timestamp   : Timestamp   not null;
  changes     : String(2000); // JSON diff
  ipAddress   : String(50);
  sessionId   : String(100);
  auditHash   : String(64);
}
