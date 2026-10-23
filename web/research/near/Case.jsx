import React, { useEffect, useRef, useState } from 'react';

const CASE_ENDPOINT = '/api/research-near';
const REPLAY_ENDPOINT = '/api/research-near-replay';
const SOURCE_ENDPOINT = '/api/research-near-source';
const PUBLISHER_URL = 'https://revenue.near.org/';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const CASE_KEYS = [
  'schemaVersion', 'caseType', 'caseId', 'requestId', 'createdAt', 'status', 'snapshot',
  'snapshotHash', 'modelResult', 'sourceRefs', 'manifestRevisionId', 'issues', 'executionReady',
];
const SNAPSHOT_KEYS = [
  'schemaVersion', 'domain', 'adapterVersion', 'sourceUrl', 'capturedAt', 'rawBodySha256',
  'rawBodyBytes', 'sourceRefs', 'modelVersion', 'modelResult',
];
const MODEL_KEYS = [
  'modelVersion', 'status', 'seriesSummaries', 'unknowns', 'counterCase', 'investmentAssessment', 'executionReady',
];
const SUMMARY_KEYS = [
  'sampleCount', 'labelField', 'labelSemantics', 'firstLabel', 'lastLabel', 'unitFields',
  'previous', 'current', 'comparisons', 'sourceField', 'previousSourceId', 'currentSourceId',
];
const INVESTMENT_KEYS = ['status', 'reasons', 'proposal'];
const LABEL_SEMANTICS = 'publisher label; not normalized to a UTC window';

const SERIES = [
  {
    key: 'revenueSeries',
    label: 'Revenue series',
    labelField: 'period_month',
    sourceField: null,
    rowFields: ['period_month', 'revenue_usd', 'revenue_near', 'cumulative_revenue_usd', 'cumulative_revenue_near'],
    unitFields: {
      revenue_usd: 'USD', revenue_near: 'NEAR',
      cumulative_revenue_usd: 'USD', cumulative_revenue_near: 'NEAR',
    },
    comparisons: [],
  },
  {
    key: 'intentVolumeSeries',
    label: 'Intent volume series',
    labelField: 'date_at',
    sourceField: 'source_used',
    rowFields: ['date_at', 'source_used', 'volume_usd', 'cumulative_volume_usd'],
    unitFields: { volume_usd: 'USD', cumulative_volume_usd: 'USD' },
    comparisons: [
      { field: 'volume_usd', unit: 'USD', source: 'source_used' },
      { field: 'cumulative_volume_usd', unit: 'USD', source: 'source_used' },
    ],
  },
  {
    key: 'totalFeesSeries',
    label: 'Total fees series',
    labelField: 'date_at',
    sourceField: null,
    rowFields: [
      'date_at', 'near_source_used', 'usd_source_used', 'total_fees_near', 'protocol_fee_near',
      'intents_revenue_near', 'burn_revenue_near', 'cumulative_fees_near',
      'cumulative_protocol_fee_near', 'cumulative_intents_revenue_near', 'fees_usd', 'cumulative_fees_usd',
    ],
    unitFields: {
      total_fees_near: 'NEAR', protocol_fee_near: 'NEAR', intents_revenue_near: 'NEAR',
      burn_revenue_near: 'NEAR', cumulative_fees_near: 'NEAR', cumulative_protocol_fee_near: 'NEAR',
      cumulative_intents_revenue_near: 'NEAR', fees_usd: 'USD', cumulative_fees_usd: 'USD',
    },
    comparisons: [
      { field: 'total_fees_near', unit: 'NEAR', source: 'near_source_used' },
      { field: 'cumulative_fees_near', unit: 'NEAR', source: 'near_source_used' },
      { field: 'fees_usd', unit: 'USD', source: 'usd_source_used' },
      { field: 'cumulative_fees_usd', unit: 'USD', source: 'usd_source_used' },
    ],
  },
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isHash(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function isText(value, maxLength = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isOptionalText(value, maxLength = 256) {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isCanonicalTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validTextList(value, limit = 32) {
  return Array.isArray(value) && value.length <= limit && value.every((item) => isText(item));
}

function validSourceRefs(value) {
  if (!Array.isArray(value) || value.length > 3) return false;
  const seen = new Set();
  for (const ref of value) {
    if (!hasExactKeys(ref, ['revisionId', 'sha256']) || !isUuid(ref.revisionId) || !isHash(ref.sha256)) return false;
    const normalizedId = ref.revisionId.toLowerCase();
    if (seen.has(normalizedId)) return false;
    seen.add(normalizedId);
  }
  return true;
}

function sameSourceRefs(left, right) {
  return left.length === right.length && left.every((ref, index) =>
    ref.revisionId === right[index].revisionId && ref.sha256 === right[index].sha256);
}

function validObservedRow(row, series) {
  if (row === null) return true;
  const fields = [...series.rowFields, 'is_stale', 'publisherStaleClaim'];
  if (!hasExactKeys(row, fields) || !isText(row[series.labelField], 256)
    || (row.is_stale !== '0' && row.is_stale !== '1')
    || row.publisherStaleClaim !== (row.is_stale === '1')) return false;
  for (const field of series.rowFields) {
    if (field === series.labelField) continue;
    if (Object.hasOwn(series.unitFields, field)) {
      if (typeof row[field] !== 'string' || row[field].length > 512 || !DECIMAL_PATTERN.test(row[field])) return false;
    } else if (typeof row[field] !== 'string' || row[field].length > 256) return false;
  }
  return true;
}

function validComparison(value, definition) {
  if (!isRecord(value) || !['UNKNOWN', 'COMPARED'].includes(value.status)) return false;
  const expected = [
    'field', 'unit', 'previousLabel', 'currentLabel', 'adapterVersion', 'kind', 'status',
    ...(value.status === 'UNKNOWN' ? ['reason'] : ['sourceId', 'direction']),
  ];
  if (!hasExactKeys(value, expected) || value.field !== definition.field || value.unit !== definition.unit
    || !isOptionalText(value.previousLabel) || !isOptionalText(value.currentLabel)
    || value.adapterVersion !== 'near-revenue/1' || value.kind !== 'exact-direction') return false;
  if (value.status === 'UNKNOWN') return isText(value.reason);
  return isText(value.sourceId, 256) && ['higher', 'lower', 'unchanged'].includes(value.direction);
}

function validSeriesSummary(value, series) {
  if (!hasExactKeys(value, SUMMARY_KEYS) || !Number.isSafeInteger(value.sampleCount) || value.sampleCount < 0
    || value.labelField !== series.labelField || value.labelSemantics !== LABEL_SEMANTICS
    || !isOptionalText(value.firstLabel) || !isOptionalText(value.lastLabel)
    || !hasExactKeys(value.unitFields, Object.keys(series.unitFields))
    || Object.entries(series.unitFields).some(([field, unit]) => value.unitFields[field] !== unit)
    || !validObservedRow(value.previous, series) || !validObservedRow(value.current, series)
    || !Array.isArray(value.comparisons) || value.comparisons.length !== series.comparisons.length
    || !value.comparisons.every((item, index) => validComparison(item, series.comparisons[index]))
    || value.sourceField !== series.sourceField
    || !isOptionalText(value.previousSourceId) || !isOptionalText(value.currentSourceId)) return false;

  if (value.sampleCount === 0) {
    return value.firstLabel === null && value.lastLabel === null && value.previous === null && value.current === null;
  }
  if (value.current === null || value.lastLabel !== value.current[series.labelField] || value.firstLabel === null) return false;
  return value.sampleCount === 1 ? value.previous === null : value.previous !== null;
}

function validModelResult(value) {
  if (!hasExactKeys(value, MODEL_KEYS) || value.modelVersion !== 'near-observed/1'
    || !['OBSERVED', 'NO_DATA'].includes(value.status) || value.executionReady !== false
    || !hasExactKeys(value.seriesSummaries, SERIES.map((series) => series.key))
    || !SERIES.every((series) => validSeriesSummary(value.seriesSummaries[series.key], series))
    || !validTextList(value.unknowns) || !validTextList(value.counterCase)
    || !hasExactKeys(value.investmentAssessment, INVESTMENT_KEYS)
    || value.investmentAssessment.status !== 'NO_DATA'
    || !validTextList(value.investmentAssessment.reasons) || value.investmentAssessment.proposal !== null) return false;
  return true;
}

function isCaseDto(value) {
  if (!hasExactKeys(value, CASE_KEYS) || value.schemaVersion !== 1 || value.caseType !== 'near-thesis'
    || !isUuid(value.caseId) || !isUuid(value.requestId) || !isCanonicalTime(value.createdAt)
    || !['OBSERVED', 'NO_DATA'].includes(value.status) || value.executionReady !== false
    || !validSourceRefs(value.sourceRefs) || !isUuid(value.manifestRevisionId) || !validTextList(value.issues)
    || (value.snapshotHash !== null && !isHash(value.snapshotHash))) return false;

  if (value.snapshot === null) {
    return value.status === 'NO_DATA' && value.snapshotHash === null && value.modelResult === null;
  }
  const snapshot = value.snapshot;
  if (!hasExactKeys(snapshot, SNAPSHOT_KEYS) || snapshot.schemaVersion !== 1 || snapshot.domain !== 'near-thesis'
    || snapshot.adapterVersion !== 'near-revenue/1' || snapshot.sourceUrl !== PUBLISHER_URL
    || !isCanonicalTime(snapshot.capturedAt) || !isHash(snapshot.rawBodySha256)
    || !Number.isSafeInteger(snapshot.rawBodyBytes) || snapshot.rawBodyBytes < 1 || snapshot.rawBodyBytes > 1024 * 1024
    || !validSourceRefs(snapshot.sourceRefs) || snapshot.sourceRefs.length === 0
    || !sameSourceRefs(snapshot.sourceRefs, value.sourceRefs)
    || snapshot.modelVersion !== 'near-observed/1' || !validModelResult(snapshot.modelResult)
    || !validModelResult(value.modelResult) || value.snapshotHash === null
    || value.status !== value.modelResult.status || JSON.stringify(snapshot.modelResult) !== JSON.stringify(value.modelResult)) return false;
  return true;
}

function requestedCaseId() {
  const params = new URLSearchParams(window.location.search);
  const entries = [...params.entries()];
  if (entries.some(([key]) => key !== 'caseId')) throw new Error('The case URL contains an unsupported query parameter.');
  const values = params.getAll('caseId');
  if (values.length > 1) throw new Error('The case URL must contain only one caseId.');
  if (values.length === 0) return null;
  if (!isUuid(values[0])) throw new Error('The caseId query parameter must be a UUID.');
  return values[0].toLowerCase();
}

function apiErrorDetail(payload) {
  if (!isRecord(payload) || !Object.hasOwn(payload, 'error')) return null;
  const error = payload.error;
  if (typeof error === 'string') return error.slice(0, 512);
  if (!isRecord(error)) return null;
  const message = typeof error.message === 'string' ? error.message : null;
  const code = typeof error.code === 'string' ? error.code : null;
  if (!message && !code) return null;
  return [code, message].filter(Boolean).join(': ').slice(0, 512);
}

async function readApiJson(response, method, path) {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(contentType);
  if (!isJson) {
    throw new Error(`${method} ${path} returned HTTP ${response.status} with a non-JSON response.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${method} ${path} returned HTTP ${response.status} with invalid JSON.`);
  }
  if (!response.ok) {
    const detail = apiErrorDetail(payload);
    throw new Error(`${method} ${path} returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  return payload;
}

function displayValue(value) {
  return value === null ? 'null' : value === undefined ? 'Not supplied' : String(value);
}

function DataItem({ label, value, unit }) {
  return (
    <div className="data-item">
      <dt><code>{label}</code></dt>
      <dd>
        <code>{displayValue(value)}</code>
        {unit && <span className="data-unit">{unit}</span>}
      </dd>
    </div>
  );
}

function SectionTitle({ children, note }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {note && <p>{note}</p>}
    </div>
  );
}

function FalconBrand() {
  return (
    <a className="brand" href="/" aria-label="FalconOS home">
      <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
        <path d="M30 194 171 39 129 151Z" />
        <path d="M138 195 218 70 190 195Z" />
      </svg>
      <span className="wordmark"><span>FALCON</span><span className="wordmark-os">OS</span></span>
    </a>
  );
}

function CaseHeader({ caseValue }) {
  return (
    <>
      <div className="case-heading">
        <div>
          <p className="breadcrumb"><a href="/research/">Research</a><span aria-hidden="true">/</span><span>NEAR</span></p>
          <h1>NEAR revenue, observed data only.</h1>
          <p className="lead">A retained publisher snapshot with its source records, model output, and unresolved limits.</p>
        </div>
        <div className="case-badges" aria-label="Case status and access">
          <span className={`status-badge ${caseValue.status === 'OBSERVED' ? 'is-observed' : 'is-no-data'}`}>{caseValue.status}</span>
          <span className="quiet-badge">Read only</span>
          <span className="quiet-badge">Execution ready: false</span>
        </div>
      </div>
      <section className="record-section" aria-labelledby="record-heading">
        <SectionTitle note="Server-provided case identity and record timestamps.">
          <span id="record-heading">Case record</span>
        </SectionTitle>
        <dl className="data-grid case-metadata">
          <DataItem label="caseId" value={caseValue.caseId} />
          <DataItem label="requestId" value={caseValue.requestId} />
          <DataItem label="createdAt" value={caseValue.createdAt} />
          <DataItem label="status" value={caseValue.status} />
          <DataItem label="manifestRevisionId" value={caseValue.manifestRevisionId} />
          <DataItem label="snapshotHash · canonical snapshot SHA-256" value={caseValue.snapshotHash} />
        </dl>
      </section>
    </>
  );
}

function ObservedRow({ title, row, series }) {
  return (
    <section className="observation" aria-label={title}>
      <h4>{title}</h4>
      {row === null ? (
        <p className="empty-note">No row was returned for this position.</p>
      ) : (
        <dl className="data-grid row-data">
          {Object.entries(row).map(([field, value]) => (
            <DataItem key={field} label={field} value={value} unit={series.unitFields[field]} />
          ))}
        </dl>
      )}
    </section>
  );
}

function ComparisonList({ comparisons }) {
  if (comparisons.length === 0) return <p className="empty-note">No comparison was returned for this series.</p>;
  return (
    <ul className="comparison-list">
      {comparisons.map((comparison, index) => (
        <li className="comparison-item" key={`${comparison.field}-${index}`}>
          <div className="comparison-heading">
            <strong><code>{comparison.field}</code><span>{comparison.unit}</span></strong>
            <span className={`status-badge ${comparison.status === 'COMPARED' ? 'is-observed' : 'is-unknown'}`}>{comparison.status}</span>
          </div>
          <dl className="data-grid comparison-data">
            <DataItem label="previousLabel" value={comparison.previousLabel} />
            <DataItem label="currentLabel" value={comparison.currentLabel} />
            <DataItem label="adapterVersion" value={comparison.adapterVersion} />
            <DataItem label="kind" value={comparison.kind} />
            {comparison.status === 'UNKNOWN'
              ? <DataItem label="reason" value={comparison.reason} />
              : <>
                <DataItem label="sourceId" value={comparison.sourceId} />
                <DataItem label="direction" value={comparison.direction} />
              </>}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function SeriesSection({ series, summary }) {
  return (
    <article className="series-section">
      <header className="series-heading">
        <div>
          <h3>{series.label}</h3>
          <p><code>{series.key}</code></p>
        </div>
        <span className="sample-count"><code>sampleCount: {summary.sampleCount}</code></span>
      </header>
      <dl className="data-grid series-context">
        <DataItem label="labelField" value={summary.labelField} />
        <DataItem label="labelSemantics" value={summary.labelSemantics} />
        <DataItem label="firstLabel" value={summary.firstLabel} />
        <DataItem label="lastLabel" value={summary.lastLabel} />
        <DataItem label="sourceField" value={summary.sourceField} />
        <DataItem label="previousSourceId" value={summary.previousSourceId} />
        <DataItem label="currentSourceId" value={summary.currentSourceId} />
      </dl>
      <div className="unit-reference">
        <h4>Publisher unit fields</h4>
        {Object.keys(summary.unitFields).length === 0 ? (
          <p className="empty-note">No unit fields were returned.</p>
        ) : (
          <dl className="data-grid unit-grid">
            {Object.entries(summary.unitFields).map(([field, unit]) => (
              <DataItem key={field} label={field} value={unit} />
            ))}
          </dl>
        )}
      </div>
      <div className="observations-grid">
        <ObservedRow title="Previous published row" row={summary.previous} series={series} />
        <ObservedRow title="Current published row" row={summary.current} series={series} />
      </div>
      <div className="comparison-block">
        <h4>Server comparisons</h4>
        <ComparisonList comparisons={summary.comparisons} />
      </div>
    </article>
  );
}

function ModelOutput({ modelResult }) {
  return (
    <>
      <section className="record-section" aria-labelledby="model-heading">
        <SectionTitle note="Observed series are shown separately from the investment assessment.">
          <span id="model-heading">Observed data</span>
        </SectionTitle>
        <div className="model-summary">
          <div className="model-state">
            <span className={`status-badge ${modelResult.status === 'OBSERVED' ? 'is-observed' : 'is-no-data'}`}>{modelResult.status}</span>
            <span>Model version <code>{modelResult.modelVersion}</code></span>
          </div>
          <span className="execution-state">Execution ready: false</span>
        </div>
        <div className="series-list">
          {SERIES.map((series) => (
            <SeriesSection key={series.key} series={series} summary={modelResult.seriesSummaries[series.key]} />
          ))}
        </div>
      </section>
      <section className="record-section" aria-labelledby="investment-heading">
        <SectionTitle note="This assessment is intentionally separate from the observed publisher series.">
          <span id="investment-heading">Investment assessment</span>
        </SectionTitle>
        <div className="assessment-panel">
          <div className="assessment-state">
            <span className="status-badge is-no-data">{modelResult.investmentAssessment.status}</span>
            <span>No investment proposal was returned.</span>
          </div>
          <h3>Reasons supplied by the model</h3>
          {modelResult.investmentAssessment.reasons.length === 0 ? (
            <p className="empty-note">No reasons were returned.</p>
          ) : (
            <ul className="text-list">
              {modelResult.investmentAssessment.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
            </ul>
          )}
          <DataItem label="proposal" value={modelResult.investmentAssessment.proposal} />
        </div>
      </section>
      <div className="two-column-sections">
        <section className="record-section" aria-labelledby="unknowns-heading">
          <SectionTitle note="Questions the current evidence does not resolve.">
            <span id="unknowns-heading">Unknowns</span>
          </SectionTitle>
          {modelResult.unknowns.length === 0 ? (
            <p className="empty-note">No unknowns were returned.</p>
          ) : (
            <ul className="text-list">
              {modelResult.unknowns.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          )}
        </section>
        <section className="record-section" aria-labelledby="countercase-heading">
          <SectionTitle note="The server-provided alternative interpretation.">
            <span id="countercase-heading">Counter-case</span>
          </SectionTitle>
          {modelResult.counterCase.length === 0 ? (
            <p className="empty-note">No counter-case statements were returned.</p>
          ) : (
            <ul className="text-list">
              {modelResult.counterCase.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function SnapshotSection({ caseValue }) {
  const snapshot = caseValue.snapshot;
  return (
    <section className="record-section" aria-labelledby="snapshot-heading">
      <SectionTitle note="Capture time describes when this record was saved; it does not establish source freshness.">
        <span id="snapshot-heading">Snapshot provenance</span>
      </SectionTitle>
      {snapshot === null ? (
        <div className="empty-panel">
          <p>No snapshot was retained for this case.</p>
          {caseValue.issues.length > 0 && <ul className="text-list">{caseValue.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}
        </div>
      ) : (
        <>
          <dl className="data-grid provenance-grid">
            <DataItem label="capturedAt" value={snapshot.capturedAt} />
            <DataItem label="adapterVersion" value={snapshot.adapterVersion} />
            <DataItem label="sourceUrl" value={snapshot.sourceUrl} />
            <DataItem label="rawBodyBytes" value={snapshot.rawBodyBytes} />
            <DataItem label="modelVersion" value={snapshot.modelVersion} />
            <DataItem label="snapshotHash · canonical snapshot SHA-256" value={caseValue.snapshotHash} />
            <DataItem label="rawBodySha256" value={snapshot.rawBodySha256} />
          </dl>
          <p className="freshness-note">Captured at is a retention timestamp, not a measure of publisher freshness.</p>
          <p className="freshness-note">snapshotHash is the canonical snapshot hash; rawBodySha256 hashes the full publisher body; each retainedRecordSha256 below hashes its stored source record.</p>
        </>
      )}
    </section>
  );
}

function SourcesSection({ sourceRefs }) {
  return (
    <section className="record-section source-section" aria-labelledby="sources-heading">
      <SectionTitle note="Download only retained source records. The publisher link is provided for direct inspection, not fetched by this page.">
        <span id="sources-heading">Source records</span>
      </SectionTitle>
      {sourceRefs.length === 0 ? (
        <p className="empty-note">No retained source records were returned by the server.</p>
      ) : (
        <ol className="source-list">
          {sourceRefs.map((ref, index) => {
            const href = `${SOURCE_ENDPOINT}?revisionId=${encodeURIComponent(ref.revisionId)}`;
            return (
              <li key={ref.revisionId}>
                <div className="source-identity">
                  <span>Retained source {index + 1}</span>
                  <code>{ref.revisionId}</code>
                </div>
                <dl className="data-grid source-hash-grid">
                  <DataItem label="retainedRecordSha256" value={ref.sha256} />
                </dl>
                <a className="source-download" href={href} download>Download retained source</a>
              </li>
            );
          })}
        </ol>
      )}
      <p className="publisher-link"><a href={PUBLISHER_URL} target="_blank" rel="noopener noreferrer">Open the original NEAR Revenue publisher</a></p>
    </section>
  );
}

function ReplaySection({ caseValue, state, error, result, onReplay }) {
  return (
    <section className="record-section replay-section" aria-labelledby="replay-heading">
      <div className="replay-heading-row">
        <SectionTitle note="An explicit request using this saved caseId and retained inputs; no publisher refresh or review-model call.">
          <span id="replay-heading">Deterministic replay</span>
        </SectionTitle>
        <button className="replay-button" type="button" onClick={onReplay} disabled={state === 'loading'}>
          {state === 'loading' ? 'Replaying saved case…' : 'Replay saved case'}
        </button>
      </div>
      {error && <p className="inline-error" role="alert">Replay failed: {error}</p>}
      {state === 'loading' && <p className="inline-status" role="status">Waiting for the saved-case replay response.</p>}
      {state === 'complete' && <p className="inline-status" role="status">The saved-case replay returned a case record from the server.</p>}
      {result && (
        <details className="replay-result" open>
          <summary>Server replay response for <code>{caseValue.caseId}</code></summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}

function CaseRecord({ caseValue, replayState, replayError, replayResult, onReplay }) {
  return (
    <>
      <CaseHeader caseValue={caseValue} />
      <SnapshotSection caseValue={caseValue} />
      {caseValue.modelResult ? (
        <ModelOutput modelResult={caseValue.modelResult} />
      ) : (
        <section className="record-section" aria-labelledby="assessment-empty-heading">
          <SectionTitle><span id="assessment-empty-heading">Assessment unavailable</span></SectionTitle>
          <p className="empty-panel">The server returned no model result for this case.</p>
        </section>
      )}
      {caseValue.issues.length > 0 && (
        <section className="record-section" aria-labelledby="case-issues-heading">
          <SectionTitle note="Issues returned with the retained case."><span id="case-issues-heading">Case issues</span></SectionTitle>
          <ul className="text-list">{caseValue.issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
        </section>
      )}
      <SourcesSection sourceRefs={caseValue.sourceRefs} />
      <ReplaySection caseValue={caseValue} state={replayState} error={replayError} result={replayResult} onReplay={onReplay} />
    </>
  );
}

export default function CaseView() {
  const [pageState, setPageState] = useState('loading');
  const [caseValue, setCaseValue] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [replayState, setReplayState] = useState('idle');
  const [replayError, setReplayError] = useState('');
  const [replayResult, setReplayResult] = useState(null);
  const replayController = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadCase() {
      let caseId;
      try {
        caseId = requestedCaseId();
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'The case URL is invalid.');
          setPageState('error');
        }
        return;
      }

      const path = caseId ? `${CASE_ENDPOINT}?caseId=${encodeURIComponent(caseId)}` : CASE_ENDPOINT;
      try {
        const response = await fetch(path, {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        const payload = await readApiJson(response, 'GET', path);
        if (!isCaseDto(payload) || (caseId && payload.caseId.toLowerCase() !== caseId)) {
          throw new Error('GET /api/research-near returned a malformed case response.');
        }
        if (mounted && !controller.signal.aborted) {
          setCaseValue(payload);
          setPageState('ready');
        }
      } catch (error) {
        if (!mounted || controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'The case request failed before returning a valid response.');
        setPageState('error');
      }
    }

    void loadCase();
    return () => {
      mounted = false;
      controller.abort();
      replayController.current?.abort();
      replayController.current = null;
    };
  }, []);

  async function replaySavedCase() {
    if (!caseValue || replayController.current) return;
    const controller = new AbortController();
    replayController.current = controller;
    setReplayState('loading');
    setReplayError('');
    setReplayResult(null);
    try {
      const response = await fetch(REPLAY_ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: caseValue.caseId }),
        signal: controller.signal,
      });
      const payload = await readApiJson(response, 'POST', REPLAY_ENDPOINT);
      if (!isCaseDto(payload) || payload.caseId.toLowerCase() !== caseValue.caseId.toLowerCase()) {
        throw new Error('POST /api/research-near-replay returned a malformed case response.');
      }
      if (!controller.signal.aborted) {
        setReplayResult(payload);
        setReplayState('complete');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setReplayError(error instanceof Error ? error.message : 'The saved-case replay failed before returning a valid response.');
        setReplayState('error');
      }
    } finally {
      if (replayController.current === controller) replayController.current = null;
    }
  }

  return (
    <div className="near-page">
      <header className="site-header">
        <FalconBrand />
        <nav className="site-nav" aria-label="Public pages">
          <a href="/research/">Research index</a>
          <a href="/">FalconOS home</a>
        </nav>
      </header>
      <main className="page-content">
        {pageState === 'loading' && (
          <section className="state-panel" role="status" aria-live="polite">
            <h1>Loading NEAR research case</h1>
            <p>Requesting the retained case from the same-origin research API.</p>
          </section>
        )}
        {pageState === 'error' && (
          <section className="state-panel error-panel" role="alert" aria-labelledby="load-error-heading">
            <h1 id="load-error-heading">Case unavailable</h1>
            <p>{loadError}</p>
            <a className="text-link" href="/research/">Return to the research index</a>
          </section>
        )}
        {pageState === 'ready' && caseValue && (
          <CaseRecord
            caseValue={caseValue}
            replayState={replayState}
            replayError={replayError}
            replayResult={replayResult}
            onReplay={replaySavedCase}
          />
        )}
      </main>
      <footer className="site-footer">
        <span>Falcon Investment Council</span>
        <span>Read-only research · No execution authority</span>
      </footer>
    </div>
  );
}
