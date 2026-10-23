const LIMIT = 20;

function briefingFor(caseValue) {
  if (!caseValue) return null;
  const investment = caseValue.modelResult?.investmentAssessment;
  return {
    caseId: caseValue.caseId,
    capturedAt: caseValue.snapshot?.capturedAt ?? null,
    status: caseValue.status,
    investmentStatus: investment?.status ?? null,
    reasons: investment?.reasons ?? caseValue.issues ?? [],
    executionReady: false,
  };
}

export function createResearchActivity({ store, reviewJobStore } = {}) {
  if (!store || typeof store.getRetainedPublicResearchCase !== 'function'
      || typeof store.listResearchActivityAnalyses !== 'function'
      || !reviewJobStore || typeof reviewJobStore.listActivity !== 'function') {
    throw new TypeError('Research activity requires retained research and review stores.');
  }

  return Object.freeze({
    async get(owner) {
      const [publicCase, adopted, reviews] = await Promise.all([
        store.getRetainedPublicResearchCase(),
        store.listResearchActivityAnalyses(owner),
        reviewJobStore.listActivity(owner),
      ]);
      return {
        schemaVersion: 1,
        briefing: briefingFor(publicCase),
        adopted: adopted.slice(0, LIMIT),
        reviews: reviews.slice(0, LIMIT),
        limit: LIMIT,
        executionReady: false,
      };
    },
  });
}
