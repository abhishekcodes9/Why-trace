async function synthesizeWithGemini(question, groundedAnswer) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || groundedAnswer.status !== 'answered') return groundedAnswer;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const allowed = new Set(groundedAnswer.evidence.map(e => e.id));
  const evidence = groundedAnswer.evidence.map(e => ({
    id: e.id,
    type: e.kind,
    title: e.title,
    body: e.body,
    date: e.date || null,
    author: e.author || null
  }));

  const prompt = [
    'You are the explanation layer for WhyTrace, an engineering-history investigation tool.',
    'Use only the repository evidence supplied below. Do not add general software knowledge, assumptions, guessed intent, or facts not present in the records.',
    'If the evidence does not state a reason, say that it does not state a reason.',
    'Return JSON only with fields: answer (string), evidenceIds (array of exact evidence IDs used).',
    'Do not invent IDs. Keep the answer under 180 words.',
    'Preserve exact entity identifiers such as PR numbers (e.g. PR #58671), issue references (e.g. Issue #58362), commit SHAs, and file paths exactly as written. Never omit the "#" symbol from PR or issue numbers.',
    `Question: ${question}`,
    `Deterministic evidence-grounded draft to preserve: ${groundedAnswer.answer}`,
    'Rephrase that draft for clarity without adding a new factual claim. If the draft says rationale is missing, preserve that limitation.',
    `Evidence JSON: ${JSON.stringify(evidence)}`
  ].join('\n\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 700, responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      return {
        ...groundedAnswer,
        source: 'deterministic_fallback',
        fallback: true,
        fallbackReason: `Gemini synthesis was not used because the provider returned HTTP ${response.status}; verified deterministic evidence answer is displayed.`,
        caveats: [
          ...groundedAnswer.caveats,
          `Deterministic Fallback: Gemini synthesis was not used (HTTP ${response.status}); verified deterministic evidence answer is shown.`
        ]
      };
    }

    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));

    if (typeof parsed.answer !== 'string' || parsed.answer.trim().length < 20 || !Array.isArray(parsed.evidenceIds) || parsed.evidenceIds.length === 0 || parsed.evidenceIds.some(id => !allowed.has(id))) {
      return {
        ...groundedAnswer,
        source: 'deterministic_fallback',
        fallback: true,
        fallbackReason: 'Gemini output did not pass citation validation (unverified or missing evidence IDs); verified deterministic evidence answer is displayed.',
        caveats: [
          ...groundedAnswer.caveats,
          'Deterministic Fallback: Gemini output failed citation validation against repository evidence; verified deterministic answer is shown.'
        ]
      };
    }

    const citedSet = new Set(parsed.evidenceIds);
    const orderedEvidence = [
      ...groundedAnswer.evidence.filter(e => citedSet.has(e.id)),
      ...groundedAnswer.evidence.filter(e => !citedSet.has(e.id))
    ];

    let synthesizedAnswer = parsed.answer.slice(0, 1500);
    synthesizedAnswer = synthesizedAnswer.replace(/\b(?:Pull Request|PR)\s+(\d+)\b/g, 'PR #$1');
    const draftPrMatches = groundedAnswer.answer.match(/PR #\d+/g);
    if (draftPrMatches) {
      for (const prTag of draftPrMatches) {
        if (!synthesizedAnswer.includes(prTag)) {
          synthesizedAnswer = `${synthesizedAnswer} (${prTag})`;
        }
      }
    }

    return {
      ...groundedAnswer,
      answer: synthesizedAnswer,
      evidence: orderedEvidence,
      citedEvidenceIds: parsed.evidenceIds,
      source: 'gemini',
      groundedDraft: groundedAnswer.answer
    };
  } catch (error) {
    const detail = error.name === 'AbortError' ? 'request timed out' : 'response could not be validated';
    return {
      ...groundedAnswer,
      source: 'deterministic_fallback',
      fallback: true,
      fallbackReason: `Gemini synthesis ${detail}; verified deterministic evidence answer is displayed.`,
      caveats: [
        ...groundedAnswer.caveats,
        `Deterministic Fallback: Gemini synthesis ${detail}; verified deterministic evidence answer is shown.`
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { synthesizeWithGemini };
