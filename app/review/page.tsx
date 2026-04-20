import { notFound } from "next/navigation";

import { getPrismaClient } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ACTIVE_WINDOW_MINUTES = 5;
const MATCH_EVENT_THRESHOLD = 3;
const SAME_MEANING_STRONG_MATCH_PERCENT = 90;
const REVIEW_EVENT_LIMIT = 50;

function formatSimilarity(similarity: number | null) {
  return similarity === null ? "-" : `${Math.round(similarity * 100)}%`;
}

function getSignalStatus(matchCount: number) {
  if (matchCount === MATCH_EVENT_THRESHOLD) {
    return "At threshold";
  }

  return matchCount > MATCH_EVENT_THRESHOLD
    ? "Above threshold"
    : "Below threshold";
}

function formatMatchType(matchType: string) {
  return matchType === "approximate" ? "same meaning" : matchType;
}

async function getRecentInputs() {
  return getPrismaClient().ephemeralInput.findMany({
    where: {
      expiresAt: {
        gt: new Date()
      }
    },
    select: {
      text: true,
      normalizedText: true,
      kind: true,
      createdAt: true,
      expiresAt: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });
}

async function getRecentEvents() {
  return getPrismaClient().matchEvent.findMany({
    select: {
      representativeText: true,
      kind: true,
      matchType: true,
      matchCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      createdAt: true,
      averageSimilarity: true
    },
    orderBy: {
      lastSeenAt: "desc"
    },
    take: REVIEW_EVENT_LIMIT
  });
}

async function getReviewSummary() {
  const db = getPrismaClient();
  const now = new Date();

  const [
    totalActiveEphemeralInputs,
    totalRecentMatchEvents,
    exactMatchEvents,
    sameMeaningMatchEvents
  ] = await Promise.all([
    db.ephemeralInput.count({
      where: {
        expiresAt: {
          gt: now
        }
      }
    }),
    db.matchEvent.count(),
    db.matchEvent.count({
      where: {
        matchType: "exact"
      }
    }),
    db.matchEvent.count({
      where: {
        matchType: "approximate"
      }
    })
  ]);

  return {
    totalActiveEphemeralInputs,
    totalRecentMatchEvents,
    exactMatchEvents,
    sameMeaningMatchEvents
  };
}

export default async function ReviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [inputs, events, summary] = await Promise.all([
    getRecentInputs(),
    getRecentEvents(),
    getReviewSummary()
  ]);

  return (
    <main className="review-shell">
      <section className="review-panel" aria-labelledby="review-title">
        <div className="intro">
          <h1 id="review-title">Review Inputs</h1>
          <p>Active inputs and saved match events from local development.</p>
        </div>

        <div className="review-summary" aria-label="Review summary">
          <div>
            <span>{summary.totalActiveEphemeralInputs}</span>
            <small>Active inputs</small>
          </div>
          <div>
            <span>{summary.totalRecentMatchEvents}</span>
            <small>Match events</small>
          </div>
          <div>
            <span>{summary.exactMatchEvents}</span>
            <small>Exact events</small>
          </div>
          <div>
            <span>{summary.sameMeaningMatchEvents}</span>
            <small>Same-meaning events</small>
          </div>
        </div>

        <div className="review-tuning" aria-label="Signal tuning guide">
          <div>
            <span>Persistence threshold</span>
            <strong>{MATCH_EVENT_THRESHOLD} active matches</strong>
          </div>
          <div>
            <span>Strong same-meaning match</span>
            <strong>{SAME_MEANING_STRONG_MATCH_PERCENT}%+</strong>
          </div>
          <div>
            <span>Active window</span>
            <strong>{ACTIVE_WINDOW_MINUTES} minutes</strong>
          </div>
          <div>
            <span>Recent event view</span>
            <strong>{REVIEW_EVENT_LIMIT} newest</strong>
          </div>
        </div>

        <h2>Active Inputs</h2>
        {inputs.length > 0 ? (
          <div className="review-table-wrap">
            <table className="review-table">
              <thead>
                <tr>
                  <th scope="col">Raw text</th>
                  <th scope="col">Normalized text</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Created</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((input) => (
                  <tr
                    key={`${input.text}-${input.normalizedText}-${input.createdAt.toISOString()}`}
                  >
                    <td>{input.text}</td>
                    <td>{input.normalizedText}</td>
                    <td>{input.kind}</td>
                    <td>
                      <time dateTime={input.createdAt.toISOString()}>
                        {input.createdAt.toLocaleString()}
                      </time>
                    </td>
                    <td>
                      <time dateTime={input.expiresAt.toISOString()}>
                        {input.expiresAt.toLocaleString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No active inputs.</p>
        )}

        <div className="review-section">
          <h2>Aggregated Events</h2>
          {events.length > 0 ? (
            <div className="review-table-wrap">
              <table className="review-table">
                <thead>
                  <tr>
                    <th scope="col">Representative text</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Type</th>
                    <th scope="col">Count</th>
                    <th scope="col">Signal</th>
                    <th scope="col">Average similarity</th>
                    <th scope="col">First seen</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={`${event.matchType}-${event.representativeText}-${event.createdAt.toISOString()}`}
                    >
                      <td>{event.representativeText}</td>
                      <td>{event.kind}</td>
                      <td>{formatMatchType(event.matchType)}</td>
                      <td>{event.matchCount}</td>
                      <td>
                        <span className="signal-pill">
                          {getSignalStatus(event.matchCount)}
                        </span>
                      </td>
                      <td>
                        {formatSimilarity(event.averageSimilarity)}
                      </td>
                      <td>
                        <time dateTime={event.firstSeenAt.toISOString()}>
                          {event.firstSeenAt.toLocaleString()}
                        </time>
                      </td>
                      <td>
                        <time dateTime={event.lastSeenAt.toISOString()}>
                          {event.lastSeenAt.toLocaleString()}
                        </time>
                      </td>
                      <td>
                        <time dateTime={event.createdAt.toISOString()}>
                          {event.createdAt.toLocaleString()}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No aggregated events yet.</p>
          )}
        </div>
        <p className="review-note">
          Active inputs expire after 5 minutes. Aggregated events are retained.
        </p>
      </section>
    </main>
  );
}
