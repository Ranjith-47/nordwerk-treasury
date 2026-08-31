using { nordwerk.treasury as db } from '../db/schema';

service TreasuryService @(path: '/api/treasury') {

  // ─── EXCEPTIONS ──────────────────────────────────────────────────────────

  @readonly
  entity Exceptions as projection on db.TreasuryExceptions {
    *,
    companyCode.code       as companyCode,
    companyCode.description as companyCodeDesc,
    plant.code             as plant,
    plant.description      as plantDesc,
    plant.region           as region,
    costCentre.code        as costCentre,
    costCentre.description as costCentreDesc,
    material.code          as material,
    material.description   as materialDesc,
    businessPartner.id     as businessPartner,
    businessPartner.name   as businessPartnerName,
    owner.id               as owner,
    owner.name             as ownerName,
    owner.email            as ownerEmail,
    escalatedTo.id         as escalatedTo,
    escalatedTo.name       as escalatedToName,
    resolvedBy.id          as resolvedBy,
    resolvedBy.name        as resolvedByName,
  }
  actions {
    action validate()               returns ValidationResult;
    action assignOwner(userId: String) returns ActionResult;
    action escalate(userId: String, reason: String) returns ActionResult;
    action resolve(notes: String)   returns ActionResult;
    action addComment(text: String) returns ActionResult;
    action requestApproval(approverId: String) returns ActionResult;
    action generateReport(format: String) returns ReportResult;
    action triggerSAPRelease()      returns SAPCallResult;
  }

  entity ExceptionsMutable as projection on db.TreasuryExceptions;

  // ─── CHILD ENTITIES ───────────────────────────────────────────────────────

  entity Timeline        as projection on db.TimelineEvents;
  entity ResolutionLog   as projection on db.ResolutionActions;
  entity ValidationMsgs  as projection on db.ValidationMessages;
  entity Notifications   as projection on db.Notifications;
  entity AttachmentsView as projection on db.Attachments;
  entity AuditLogView    as projection on db.AuditLog;

  // ─── MASTER DATA ─────────────────────────────────────────────────────────

  @readonly entity CompanyCodes      as projection on db.CompanyCodes;
  @readonly entity Plants            as projection on db.Plants;
  @readonly entity CostCentres       as projection on db.CostCentres;
  @readonly entity BusinessPartners  as projection on db.BusinessPartners;
  @readonly entity Materials         as projection on db.Materials;
  @readonly entity Users             as projection on db.Users;
  @readonly entity SLAConfig         as projection on db.SLAConfig;

  // ─── ACTIONS (service-level) ──────────────────────────────────────────────

  action   importExceptions(payload: String)  returns ImportResult;
  function kpis()                             returns KPIResult;
  function analytics()                        returns AnalyticsResult;

  // ─── TYPES ────────────────────────────────────────────────────────────────

  type ValidationResult {
    valid       : Boolean;
    errors      : many ValidationMessage;
    warnings    : many ValidationMessage;
    infos       : many ValidationMessage;
    summary     : String;
    missingFields: String;
  }

  type ValidationMessage {
    severity   : String;
    field      : String;
    code       : String;
    message    : String;
    suggestion : String;
  }

  type ActionResult {
    success    : Boolean;
    message    : String;
    exceptionId: String;
    timestamp  : String;
  }

  type ReportResult {
    success    : Boolean;
    downloadUrl: String;
    format     : String;
    fileName   : String;
  }

  type SAPCallResult {
    success    : Boolean;
    sapStatus  : String;
    payload    : String;
    response   : String;
    message    : String;
  }

  type ImportResult {
    imported   : Integer;
    failed     : Integer;
    errors     : many String;
  }

  type KPIResult {
    exceptionCount       : Integer;
    openCount            : Integer;
    resolvedCount        : Integer;
    totalExposure        : Decimal;
    overdueTotal         : Decimal;
    revenueAtRiskPct     : String;
    avgResolutionHours   : Decimal;
    slaAdherence         : Decimal;
    firstPassYield       : Decimal;
    recurrenceRate       : Decimal;
    byRiskLevel          : String;  // JSON
    agingBuckets         : String;  // JSON
    productivityGainLow  : Integer;
    productivityGainHigh : Integer;
  }

  type AnalyticsResult {
    rootCauses     : String; // JSON array
    trendsByPeriod : String;
    byLocation     : String;
    byPartner      : String;
    cycleTime      : String;
  }
}
